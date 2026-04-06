import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";

import {
  unixEndpoint,
  tcpEndpoint,
  bindTcpEndpoint,
  formatChardevSocket,
  formatNetdevStream,
} from "../src/ipc-endpoint.ts";

test("unixEndpoint creates a unix endpoint", () => {
  const ep = unixEndpoint("/tmp/test.sock");
  assert.deepEqual(ep, { type: "unix", path: "/tmp/test.sock" });
});

test("tcpEndpoint creates a tcp endpoint", () => {
  const ep = tcpEndpoint("127.0.0.1", 12345);
  assert.deepEqual(ep, { type: "tcp", host: "127.0.0.1", port: 12345 });
});

test("formatChardevSocket formats unix endpoint", () => {
  const ep = unixEndpoint("/tmp/virtio.sock");
  const result = formatChardevSocket("virtiocon0", ep);
  assert.equal(result, "socket,id=virtiocon0,path=/tmp/virtio.sock,server=off");
});

test("formatChardevSocket formats tcp endpoint", () => {
  const ep = tcpEndpoint("127.0.0.1", 54321);
  const result = formatChardevSocket("virtiocon0", ep);
  assert.equal(
    result,
    "socket,id=virtiocon0,host=127.0.0.1,port=54321,server=off",
  );
});

test("formatNetdevStream formats unix endpoint", () => {
  const ep = unixEndpoint("/tmp/net.sock");
  const result = formatNetdevStream("net0", ep);
  assert.equal(
    result,
    "stream,id=net0,server=off,addr.type=unix,addr.path=/tmp/net.sock",
  );
});

test("formatNetdevStream formats tcp endpoint", () => {
  const ep = tcpEndpoint("127.0.0.1", 55555);
  const result = formatNetdevStream("net0", ep);
  assert.equal(
    result,
    "stream,id=net0,server=off,addr.type=inet,addr.host=127.0.0.1,addr.port=55555",
  );
});

test("bindTcpEndpoint binds to an ephemeral port", async () => {
  const { endpoint, server } = await bindTcpEndpoint();
  assert.equal(endpoint.type, "tcp");
  assert.equal(endpoint.host, "127.0.0.1");
  assert.ok(
    endpoint.type === "tcp" && endpoint.port > 0,
    "port should be assigned",
  );

  // Verify we can connect to it
  const connected = await new Promise<boolean>((resolve) => {
    if (endpoint.type !== "tcp") {
      resolve(false);
      return;
    }
    const client = net.createConnection(
      { host: endpoint.host, port: endpoint.port },
      () => {
        client.destroy();
        resolve(true);
      },
    );
    client.on("error", () => resolve(false));
  });
  assert.ok(connected, "should be able to connect to bound TCP endpoint");

  server.close();
});

test("bindTcpEndpoint ports are unique across calls", async () => {
  const results = await Promise.all([
    bindTcpEndpoint(),
    bindTcpEndpoint(),
    bindTcpEndpoint(),
  ]);
  const ports = results.map((r) =>
    r.endpoint.type === "tcp" ? r.endpoint.port : 0,
  );
  const unique = new Set(ports);
  assert.equal(unique.size, 3, "all ports should be unique");
  for (const r of results) r.server.close();
});
