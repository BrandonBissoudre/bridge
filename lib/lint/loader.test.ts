import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadConfig } from "./loader.js";

test("loadConfig parses a minimal yaml config", async () => {
  const config = await loadConfig(
    path.resolve("test/fixtures/lint/minimal-config.yaml")
  );
  assert.ok(config, "expected config to be non-null");
  assert.equal(Object.keys(config.rules ?? {}).length, 1);
  const rule = config.rules?.["test-rule"];
  assert.ok(rule && rule !== "off");
  // `assert.ok` narrows `rule` to RuleDef, so we can dereference directly.
  assert.equal(rule.severity, "warn");
  assert.equal(rule.meta.category, "structure");
});

test("loadConfig returns null when file is absent", async () => {
  const config = await loadConfig("/nonexistent/path/config.yaml");
  assert.equal(config, null);
});
