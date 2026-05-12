// lib/lint/kb-loader.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadKB, _resetKBCache } from "./kb-loader.js";

function makeFixtureRoot(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("loadKB: returns null when registries dir is absent", () => {
  _resetKBCache();
  const dir = makeFixtureRoot("bridge-kb-empty-");
  try {
    const snapshot = loadKB(dir);
    assert.equal(snapshot, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadKB: malformed JSON yields empty maps but does not throw", () => {
  _resetKBCache();
  const dir = makeFixtureRoot("bridge-kb-malformed-");
  try {
    const regDir = path.join(dir, "bridge-ds/knowledge-base/registries");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(path.join(regDir, "variables.json"), "{ not json");
    writeFileSync(path.join(regDir, "components.json"), "also broken");
    writeFileSync(path.join(regDir, "text-styles.json"), "");

    const snapshot = loadKB(dir);
    assert.ok(snapshot, "should still return a snapshot object");
    assert.equal(snapshot.variableByName.size, 0);
    assert.equal(snapshot.componentByName.size, 0);
    assert.equal(snapshot.textStyleByName.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadKB: populated registries produce indexed snapshot", () => {
  _resetKBCache();
  const dir = makeFixtureRoot("bridge-kb-populated-");
  try {
    const regDir = path.join(dir, "bridge-ds/knowledge-base/registries");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(
      path.join(regDir, "variables.json"),
      JSON.stringify({
        version: 1,
        variables: [
          { key: "v1", name: "color/bg/surface/subtle", resolvedType: "COLOR", status: "active" },
          { key: "v2", name: "interaction/hover", resolvedType: "FLOAT" },
        ],
      })
    );
    writeFileSync(
      path.join(regDir, "components.json"),
      JSON.stringify({
        version: 1,
        components: [{ key: "c1", name: "Button", status: "stable" }],
      })
    );
    writeFileSync(
      path.join(regDir, "text-styles.json"),
      JSON.stringify({
        version: 1,
        styles: [{ key: "t1", name: "body/md" }],
      })
    );

    const snapshot = loadKB(dir);
    assert.ok(snapshot);
    assert.equal(snapshot.variableByName.size, 2);
    assert.ok(snapshot.variableByName.has("color/bg/surface/subtle"));
    assert.equal(snapshot.variableByName.get("interaction/hover")?.resolvedType, "FLOAT");
    assert.equal(snapshot.componentByName.size, 1);
    assert.equal(snapshot.textStyleByName.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadKB: memoizes by cwd+kbPath", () => {
  _resetKBCache();
  const dir = makeFixtureRoot("bridge-kb-cache-");
  try {
    const regDir = path.join(dir, "bridge-ds/knowledge-base/registries");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(
      path.join(regDir, "variables.json"),
      JSON.stringify({ variables: [{ key: "v1", name: "x" }] })
    );
    writeFileSync(path.join(regDir, "components.json"), JSON.stringify({ components: [] }));
    writeFileSync(path.join(regDir, "text-styles.json"), JSON.stringify({ styles: [] }));

    const a = loadKB(dir);
    const b = loadKB(dir);
    assert.strictEqual(a, b, "second call should return cached snapshot reference");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadKB: token name is stored without leading $ regardless of source shape", () => {
  _resetKBCache();
  const dir = makeFixtureRoot("bridge-kb-prefix-");
  try {
    const regDir = path.join(dir, "bridge-ds/knowledge-base/registries");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(
      path.join(regDir, "variables.json"),
      JSON.stringify({
        variables: [
          { key: "v1", name: "$color/with/prefix" },
          { key: "v2", name: "color/without/prefix" },
        ],
      })
    );
    writeFileSync(path.join(regDir, "components.json"), JSON.stringify({ components: [] }));
    writeFileSync(path.join(regDir, "text-styles.json"), JSON.stringify({ styles: [] }));

    const snapshot = loadKB(dir);
    assert.ok(snapshot);
    assert.ok(snapshot.variableByName.has("color/with/prefix"));
    assert.ok(snapshot.variableByName.has("color/without/prefix"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
