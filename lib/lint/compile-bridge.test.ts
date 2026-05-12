import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runLintAtCompileTime } from "./compile-bridge.js";

test("runLintAtCompileTime returns empty diagnostics when no config", async () => {
  const result = await runLintAtCompileTime(
    { name: "test", archetype: "card", component: "Test" },
    "/nonexistent/config.yaml"
  );
  assert.deepEqual(result.diagnostics, []);
});

test("runLintAtCompileTime returns empty diagnostics when config has only lint-time rules", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bridge-compile-bridge-"));
  const configPath = path.join(dir, "config.yaml");
  // Rule pattern would otherwise fire on value:"foo" — but surface is lint-time
  // only, so compile-time filter must drop it and return zero diagnostics.
  await writeFile(
    configPath,
    `rules:
  no-foo:
    description: "Disallow 'foo'"
    given: "$.value"
    then: { function: pattern, functionOptions: { notMatch: "^foo$" } }
    severity: error
    meta: { bridgeApi: "1.x", category: structure, surface: [lint-time], status: active, since: "1.0.0" }
`
  );
  const result = await runLintAtCompileTime({ value: "foo" }, configPath);
  assert.deepEqual(result.diagnostics, []);
});
