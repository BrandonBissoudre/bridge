import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compile } from "./compile.js";

test("compile fails when a compile-time rule is violated", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bridge-compile-lint-"));
  await writeFile(
    path.join(dir, "config.yaml"),
    `
rules:
  no-hex-fill:
    description: "No hex"
    given: "$..fill"
    then:
      function: pattern
      functionOptions: { notMatch: "^#" }
    severity: error
    meta:
      bridgeApi: "1.x"
      category: tokens
      surface: [compile-time]
      status: active
      since: "1.0.0"
`
  );

  const result = await compile(
    { name: "test", archetype: "card", component: "Test", fill: "#fff" } as never,
    { lintConfigPath: path.join(dir, "config.yaml") } as never
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { ruleId?: string }) => e.ruleId === "no-hex-fill"));
});

test("compile passes when lint config is absent (backward compat)", async () => {
  const result = await compile(
    { name: "test", archetype: "card", component: "Test", fill: "#fff" } as never,
    { lintConfigPath: "/nonexistent.yaml" } as never
  );
  assert.ok("ok" in result);
});
