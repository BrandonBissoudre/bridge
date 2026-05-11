import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseKBConfig, resolveFileKey } from "./kb-config.js";

test("parseKBConfig accepts minimal config with defaults", async () => {
  const raw = await readFile(path.resolve("test/fixtures/kb-config/minimal.yaml"), "utf8");
  const cfg = parseKBConfig(raw);
  assert.equal(cfg.dsName, "Spectra");
  assert.equal(cfg.kbPath, "bridge-ds");
  assert.equal(cfg.cron.cadence, "daily");
  assert.equal(cfg.cron.time, "06:00");
  assert.deepEqual(cfg.figmaFiles, {});
});

test("parseKBConfig accepts full config", async () => {
  const raw = await readFile(path.resolve("test/fixtures/kb-config/full.yaml"), "utf8");
  const cfg = parseKBConfig(raw);
  assert.equal(cfg.tagline, "Finary's design system.");
  assert.equal(cfg.kbPath, "bridge-ds");
});

test("parseKBConfig throws on missing required field", () => {
  assert.throws(() => parseKBConfig("dsName: Spectra\n"));
});

test("parseKBConfig throws on empty dsName", () => {
  assert.throws(() => parseKBConfig('dsName: ""\nfigmaFileKey: abc\n'));
});

test("parseKBConfig rejects custom YAML tags (defense-in-depth)", () => {
  assert.throws(() =>
    parseKBConfig('dsName: x\nfigmaFileKey: y\nkbPath: !!js/function "() => 1"\n')
  );
});

test("parseKBConfig accepts per-category figmaFiles overrides", async () => {
  const raw = await readFile(path.resolve("test/fixtures/kb-config/multi-file.yaml"), "utf8");
  const cfg = parseKBConfig(raw);
  assert.equal(cfg.figmaFileKey, "COMPONENTS_FILE");
  assert.equal(cfg.figmaFiles.variables, "FOUNDATIONS_FILE");
  assert.equal(cfg.figmaFiles.textStyles, "FOUNDATIONS_FILE");
  assert.equal(cfg.figmaFiles.components, undefined);
});

test("resolveFileKey returns the override when present, else the primary key", () => {
  const cfg = parseKBConfig(
    `dsName: x\nfigmaFileKey: PRIMARY\nfigmaFiles:\n  variables: OVERRIDE\n`
  );
  assert.equal(resolveFileKey(cfg, "variables"), "OVERRIDE");
  assert.equal(resolveFileKey(cfg, "components"), "PRIMARY");
  assert.equal(resolveFileKey(cfg, "textStyles"), "PRIMARY");
});

test("resolveFileKey falls back to primary when figmaFiles is omitted", () => {
  const cfg = parseKBConfig(`dsName: x\nfigmaFileKey: PRIMARY\n`);
  assert.equal(resolveFileKey(cfg, "components"), "PRIMARY");
  assert.equal(resolveFileKey(cfg, "variables"), "PRIMARY");
  assert.equal(resolveFileKey(cfg, "textStyles"), "PRIMARY");
});
