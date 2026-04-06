// E2E acceptance test: VM.create() + exec("echo Hello World") on Windows
//
// Uses the local guest image and the full Gondolin host stack with TCP IPC.

import path from "path";
import { VM } from "../src/vm/core.ts";

const imgDir = "C:\\Projects\\gondolin\\.cache\\dotnet-image";

console.log("Creating VM with custom dotnet image...");
console.log(`  Image: ${imgDir}`);
console.log(`  Platform: ${process.platform}`);

try {
  const vm = await VM.create({
    sandbox: {
      imagePath: {
        kernelPath: path.join(imgDir, "vmlinuz-virt"),
        initrdPath: path.join(imgDir, "initramfs.cpio.lz4"),
        rootfsPath: path.join(imgDir, "rootfs.ext4"),
      },
      memory: "4G",
      cpus: 2,
      console: "none",
    },
  });

  console.log("VM created. Running exec...");

  const result = await vm.exec('echo "Hello World from Gondolin on Windows!" && dotnet --version');

  console.log(`\n=== E2E RESULT ===`);
  console.log(`Exit code: ${result.exitCode}`);
  console.log(`stdout: ${result.stdout.trim()}`);
  if (result.stderr.trim()) console.log(`stderr: ${result.stderr.trim()}`);

  if (
    result.exitCode === 0 &&
    result.stdout.includes("Hello World from Gondolin on Windows!")
  ) {
    console.log("\n✅ E2E PASSED: Hello World + dotnet from Windows micro-VM!");
  } else {
    console.log("\n❌ E2E FAILED: unexpected output");
    process.exitCode = 1;
  }

  await vm.close();
} catch (err) {
  console.error("\n❌ E2E FAILED:", err);
  process.exitCode = 1;
}
