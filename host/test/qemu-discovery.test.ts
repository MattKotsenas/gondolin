import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { __test } from "../src/sandbox/server-options.ts";

const { resolveDefaultQemuPath } = __test as any;

test("resolveDefaultQemuPath returns bare binary name on non-Windows", () => {
  if (process.platform === "win32") return;
  const result = resolveDefaultQemuPath("qemu-system-x86_64");
  assert.equal(result, "qemu-system-x86_64");
});

test("resolveDefaultQemuPath finds QEMU in Program Files on Windows", () => {
  if (process.platform !== "win32") return;
  const result = resolveDefaultQemuPath("qemu-system-x86_64");
  assert.ok(
    result.includes("qemu") && result.endsWith(".exe"),
    `expected full path to qemu exe, got: ${result}`,
  );
  assert.ok(fs.existsSync(result), `resolved path should exist: ${result}`);
});
