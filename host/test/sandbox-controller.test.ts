import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import * as child_process from "child_process";

import {
  SandboxController,
  type SandboxConfig,
  type SandboxState,
  __test,
} from "../src/sandbox/controller.ts";

// In ESM, built-in modules expose live bindings via getters which cannot be
// replaced with node:test mocks. The actual mutable exports object is on
// `default`.
const cp: any = (child_process as any).default ?? (child_process as any);

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killedSignals: Array<string | undefined> = [];

  kill(signal?: string) {
    this.killedSignals.push(signal);
    return true;
  }
}

function makeConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    qemuPath: "qemu-system-aarch64",
    kernelPath: "/tmp/vmlinuz",
    initrdPath: "/tmp/initrd",
    memory: "256M",
    cpus: 1,
    virtioSocketPath: "/tmp/virtio.sock",
    virtioFsSocketPath: "/tmp/virtiofs.sock",
    virtioSshSocketPath: "/tmp/virtio-ssh.sock",
    virtioIngressSocketPath: "/tmp/virtio-ingress.sock",
    append: "console=ttyS0",
    machineType: "virt",
    accel: "tcg",
    cpu: "max",
    console: "none",
    autoRestart: false,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

test("SandboxController: start emits state transitions and forwards logs", async () => {
  const spawned: FakeChildProcess[] = [];
  mock.method(cp, "spawn", () => {
    const c = new FakeChildProcess();
    spawned.push(c);
    return c as any;
  });

  const controller = new SandboxController(makeConfig());

  const states: SandboxState[] = [];
  const logs: Array<{ stream: string; chunk: string }> = [];
  const exits: any[] = [];
  controller.on("state", (s) => states.push(s));
  controller.on("log", (chunk: any, stream: any) =>
    logs.push({ stream, chunk }),
  );
  controller.on("exit", (e) => exits.push(e));

  await controller.start();
  assert.equal(controller.getState(), "starting");
  assert.deepEqual(states, ["starting"]);

  assert.equal(spawned.length, 1);
  const child = spawned[0]!;

  child.stdout.write("out");
  child.stderr.write("err");
  await flush();
  assert.deepEqual(logs, [
    { stream: "stdout", chunk: "out" },
    { stream: "stderr", chunk: "err" },
  ]);

  child.emit("spawn");
  assert.equal(controller.getState(), "running");
  assert.deepEqual(states, ["starting", "running"]);

  child.emit("exit", 0, null);
  assert.equal(controller.getState(), "stopped");
  assert.deepEqual(states, ["starting", "running", "stopped"]);

  assert.equal(exits.length, 1);
  assert.deepEqual(exits[0], { code: 0, signal: null });
});

test("buildQemuArgs: rootDiskVolatileMode=snapshot enables qemu snapshot mode", () => {
  const args = __test.buildQemuArgs(
    makeConfig({
      rootDiskPath: "/tmp/rootfs.ext4",
      rootDiskFormat: "raw",
      rootDiskVolatileMode: "snapshot",
    }),
  );

  const driveIndex = args.indexOf("-drive");
  assert.notEqual(driveIndex, -1);
  assert.match(args[driveIndex + 1]!, /snapshot=on/);
});

test("SandboxController: start is idempotent while running", async () => {
  let spawnCalls = 0;
  const child = new FakeChildProcess();

  mock.method(cp, "spawn", () => {
    spawnCalls += 1;
    return child as any;
  });

  const controller = new SandboxController(makeConfig());
  await controller.start();
  child.emit("spawn");

  await controller.start();
  assert.equal(spawnCalls, 1);
});

test("SandboxController: close sends SIGTERM and does not SIGKILL if child exits quickly", async () => {
  mock.timers.enable();

  const child = new FakeChildProcess();
  mock.method(cp, "spawn", () => child as any);

  const controller = new SandboxController(makeConfig());
  await controller.start();
  child.emit("spawn");

  const closing = controller.close();
  assert.deepEqual(child.killedSignals, ["SIGTERM"]);

  child.emit("exit", 0, null);
  await closing;

  // Even if we advance time past the escalation threshold, the timeout should
  // have been cleared.
  mock.timers.tick(5000);
  assert.deepEqual(child.killedSignals, ["SIGTERM"]);
  assert.equal(controller.getState(), "stopped");
});

test("SandboxController: close escalates to SIGKILL after 3s", async () => {
  mock.timers.enable();

  const child = new FakeChildProcess();
  mock.method(cp, "spawn", () => child as any);

  const controller = new SandboxController(makeConfig());
  await controller.start();
  child.emit("spawn");

  const closing = controller.close();
  assert.deepEqual(child.killedSignals, ["SIGTERM"]);

  mock.timers.tick(3000);
  assert.deepEqual(child.killedSignals, ["SIGTERM", "SIGKILL"]);

  child.emit("exit", 0, null);
  await closing;
});

test("SandboxController: crash triggers auto-restart after 1s (unless manual stop)", async () => {
  mock.timers.enable();

  const spawned: FakeChildProcess[] = [];
  mock.method(cp, "spawn", () => {
    const c = new FakeChildProcess();
    spawned.push(c);
    return c as any;
  });

  const controller = new SandboxController(makeConfig({ autoRestart: true }));

  await controller.start();
  spawned[0]!.emit("spawn");

  // Simulate crash.
  spawned[0]!.emit("exit", 1, null);
  assert.equal(controller.getState(), "stopped");

  // Restart should be scheduled.
  mock.timers.tick(1000);
  assert.equal(spawned.length, 2);
  assert.equal(controller.getState(), "starting");

  // If we manually stop, auto-restart must NOT happen.
  spawned[1]!.emit("spawn");
  const closing = controller.close();
  spawned[1]!.emit("exit", 0, null);
  await closing;

  mock.timers.tick(2000);
  assert.equal(spawned.length, 2);
});

test("SandboxController: error event emits exit with error and does not auto-restart", async () => {
  mock.timers.enable();

  const child = new FakeChildProcess();
  mock.method(cp, "spawn", () => child as any);

  const controller = new SandboxController(makeConfig({ autoRestart: true }));

  const exits: any[] = [];
  controller.on("exit", (e) => exits.push(e));

  await controller.start();
  child.emit("error", new Error("boom"));

  assert.equal(controller.getState(), "stopped");
  assert.equal(exits.length, 1);
  assert.equal(exits[0].code, null);
  assert.equal(exits[0].signal, null);
  assert.ok(exits[0].error instanceof Error);

  // No restart should be scheduled from the error path.
  mock.timers.tick(2000);
  assert.equal(controller.getState(), "stopped");
});

test("sandbox-controller: buildQemuArgs does not select -cpu host when using tcg", () => {
  const hostArch = process.arch === "arm64" ? "arm64" : "x64";

  // Note: cpu/accel selection is platform-specific, but "tcg" should always
  // avoid "-cpu host".
  const args = (__test as any).buildQemuArgs({
    qemuPath:
      hostArch === "arm64" ? "qemu-system-aarch64" : "qemu-system-x86_64",
    kernelPath: "/tmp/vmlinuz",
    initrdPath: "/tmp/initrd",
    memory: "256M",
    cpus: 1,
    virtioSocketPath: "/tmp/virtio.sock",
    virtioFsSocketPath: "/tmp/virtiofs.sock",
    virtioSshSocketPath: "/tmp/virtiossh.sock",
    append: "console=ttyS0",
    machineType: "q35",
    accel: "tcg",
    // cpu intentionally omitted
    console: "none",
    autoRestart: false,
  });

  const cpuIndex = args.indexOf("-cpu");
  assert.notEqual(cpuIndex, -1);
  assert.equal(args[cpuIndex + 1], "max");
});

test("sandbox-controller: selectCpu only uses host with matching hw accel", () => {
  const hostArch = process.arch === "arm64" ? "arm64" : "x64";

  assert.equal((__test as any).selectCpu(hostArch, "tcg"), "max");

  if (process.platform === "linux") {
    assert.equal((__test as any).selectCpu(hostArch, "kvm"), "host");
  } else if (process.platform === "darwin") {
    assert.equal((__test as any).selectCpu(hostArch, "hvf"), "host");
  } else {
    assert.equal((__test as any).selectCpu(hostArch, "kvm"), "max");
  }

  const otherArch = hostArch === "arm64" ? "x64" : "arm64";
  assert.equal((__test as any).selectCpu(otherArch, "kvm"), "max");
});

test("sandbox-controller: selectMachineType avoids microvm for x64 tcg", () => {
  const selectMachineType = (__test as any).selectMachineType as (
    targetArch: string,
    accel?: string,
  ) => string;

  if (process.platform === "linux") {
    assert.equal(selectMachineType("x64", "kvm"), "microvm");
    assert.equal(selectMachineType("x64", "tcg"), "q35");
    assert.equal(selectMachineType("x64", undefined), "q35");
  }

  assert.equal(selectMachineType("arm64", "tcg"), "virt");
});

test("sandbox-controller: buildQemuArgs uses rng-builtin", () => {
  const args = (__test as any).buildQemuArgs(makeConfig());
  const objectIdx = args.indexOf("-object");
  assert.notEqual(objectIdx, -1, "expected -object flag in QEMU args");
  assert.equal(
    args[objectIdx + 1],
    "rng-builtin,id=rng0",
    "expected rng-builtin backend (no host dependency)",
  );
  // Ensure no reference to /dev/urandom
  const allArgs = args.join(" ");
  assert.equal(
    allArgs.includes("/dev/urandom"),
    false,
    "rng-random with /dev/urandom should not appear",
  );
});

test("sandbox-controller: buildQemuArgs uses TCP endpoints when provided", () => {
  const args = (__test as any).buildQemuArgs(
    makeConfig({
      virtioEndpoint: { type: "tcp", host: "127.0.0.1", port: 10001 },
      virtioFsEndpoint: { type: "tcp", host: "127.0.0.1", port: 10002 },
      virtioSshEndpoint: { type: "tcp", host: "127.0.0.1", port: 10003 },
      virtioIngressEndpoint: { type: "tcp", host: "127.0.0.1", port: 10004 },
      netSocketPath: "ignored",
      netEndpoint: { type: "tcp", host: "127.0.0.1", port: 10005 },
    }),
  );

  const allArgs = args.join(" ");

  // Chardevs should use TCP host:port syntax
  assert.ok(
    allArgs.includes("host=127.0.0.1,port=10001"),
    "virtio chardev should use TCP",
  );
  assert.ok(
    allArgs.includes("host=127.0.0.1,port=10002"),
    "virtiofs chardev should use TCP",
  );
  assert.ok(
    allArgs.includes("host=127.0.0.1,port=10003"),
    "virtiossh chardev should use TCP",
  );
  assert.ok(
    allArgs.includes("host=127.0.0.1,port=10004"),
    "ingress chardev should use TCP",
  );

  // Netdev should use TCP inet syntax
  assert.ok(
    allArgs.includes("addr.type=inet,addr.host=127.0.0.1,addr.port=10005"),
    "netdev should use TCP inet",
  );

  // Should NOT contain any unix socket paths
  assert.equal(
    allArgs.includes("addr.type=unix"),
    false,
    "no unix addr when TCP endpoints provided",
  );
  assert.equal(
    allArgs.includes("/tmp/virtio.sock"),
    false,
    "unix path should not appear in chardev when TCP endpoint overrides it",
  );
});

test("sandbox-controller: killActiveChildren kills tracked processes", async () => {
  const child = new FakeChildProcess();
  mock.method(cp, "spawn", () => child as any);

  const controller = new SandboxController(makeConfig());
  await controller.start();

  assert.equal(__test.getActiveChildrenCount() >= 1, true);
  __test.killActiveChildren();
  assert.ok(child.killedSignals.includes("SIGKILL"));
});
