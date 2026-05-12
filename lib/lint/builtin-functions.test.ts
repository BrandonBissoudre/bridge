// lib/lint/builtin-functions.test.ts
// Focused unit tests for the 5 real built-in custom functions shipped in
// v7.1.0. We drive them through `runRulesAgainstDocument` rather than
// invoking the closures directly — that exercises the factory wiring
// (engine.ts -> buildBridgeBuiltinFunctions) end-to-end without coupling
// the tests to internal exports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runRulesAgainstDocument } from "./engine.js";
import type { RuleDef } from "./types.js";

function makeRule(
  id: string,
  partial: Partial<RuleDef> & Pick<RuleDef, "given" | "then">
): {
  rules: Record<string, RuleDef>;
} {
  return {
    rules: {
      [id]: {
        id,
        description: partial.description ?? id,
        given: partial.given,
        then: partial.then,
        severity: partial.severity ?? "error",
        meta: {
          bridgeApi: "1.x",
          category: "structure",
          surface: ["lint-time"],
          status: "active",
          since: "1.0.0",
          ...(partial.meta ?? {}),
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// text-is-english
// ---------------------------------------------------------------------------

test("text-is-english: French copy with 2+ stopwords triggers", async () => {
  const ruleset = makeRule("english-only", {
    given: "$.description",
    then: { function: "text-is-english" },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { description: "Une carte qui affiche les avoirs crypto." },
    { source: "test.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /French markers/);
});

test("text-is-english: English copy passes silently", async () => {
  const ruleset = makeRule("english-only", {
    given: "$.description",
    then: { function: "text-is-english" },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { description: "A card surfacing the user's crypto holdings with daily PnL." },
    { source: "test.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 0);
});

test("text-is-english: allowList suppresses listed words", async () => {
  // "de" is a common French stopword; without allowList this would trigger
  // alongside "la". With allowList it drops below the default threshold of 2.
  const ruleset = makeRule("english-only", {
    given: "$.description",
    then: {
      function: "text-is-english",
      functionOptions: { allowList: ["de", "la"] },
    },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { description: "Token de la token" },
    { source: "test.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
});

// ---------------------------------------------------------------------------
// snapshot-exists
// ---------------------------------------------------------------------------

test("snapshot-exists: passes when sibling snapshot file is present", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-snapshot-pass-"));
  try {
    writeFileSync(path.join(dir, "foo.cspec.yaml"), "name: foo\n");
    writeFileSync(path.join(dir, "foo-snapshot.json"), "{}");

    const ruleset = makeRule("snapshot", {
      given: "$",
      then: { function: "snapshot-exists" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { name: "foo" },
      { source: "foo.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshot-exists: emits diagnostic when snapshot is missing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-snapshot-fail-"));
  try {
    writeFileSync(path.join(dir, "foo.cspec.yaml"), "name: foo\n");

    const ruleset = makeRule("snapshot", {
      given: "$",
      then: { function: "snapshot-exists" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { name: "foo" },
      { source: "foo.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
    assert.match(r.diagnostics[0].message, /Missing snapshot/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// filename-pattern
// ---------------------------------------------------------------------------

test("filename-pattern: kebab-case filename passes", async () => {
  const ruleset = makeRule("filename", {
    given: "$",
    then: {
      function: "filename-pattern",
      functionOptions: { match: "^[a-z][a-z0-9-]*\\.cspec\\.yaml$" },
    },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { name: "ok" },
    { source: "crypto-card.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 0);
});

test("filename-pattern: PascalCase filename fails", async () => {
  const ruleset = makeRule("filename", {
    given: "$",
    then: {
      function: "filename-pattern",
      functionOptions: { match: "^[a-z][a-z0-9-]*\\.cspec\\.yaml$" },
    },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { name: "bad" },
    { source: "CryptoCard.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /does not match required pattern/);
});

// ---------------------------------------------------------------------------
// property-key-has-figma-suffix
// ---------------------------------------------------------------------------

test("property-key-has-figma-suffix: non-variant key without suffix emits", async () => {
  const ruleset = makeRule("suffix", {
    given: "$.properties",
    then: { function: "property-key-has-figma-suffix" },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    {
      properties: {
        state: "VARIANT(default | loading)", // exempt
        label: "Bitcoin", // missing suffix → emits
        "amount#1057:4": "$42,000", // ok
      },
    },
    { source: "test.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /label/);
  assert.match(r.diagnostics[0].message, /missing Figma node-id suffix/);
});

test("property-key-has-figma-suffix: variant key and suffixed key both pass", async () => {
  const ruleset = makeRule("suffix", {
    given: "$.properties",
    then: { function: "property-key-has-figma-suffix" },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    {
      properties: {
        state: "VARIANT(default | loading)",
        "label#1057:0": "Bitcoin",
      },
    },
    { source: "test.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
});

// ---------------------------------------------------------------------------
// rule-has-bridge-api
// ---------------------------------------------------------------------------

test("rule-has-bridge-api: missing field emits diagnostic", async () => {
  const ruleset = makeRule("meta", {
    given: "$.rules.*",
    then: { function: "rule-has-bridge-api" },
  });
  const doc = {
    rules: {
      "custom-rule": {
        description: "x",
        given: "$",
        then: { function: "truthy" },
        severity: "warn",
        meta: { category: "copy" }, // no bridgeApi
      },
    },
  };
  const r = await runRulesAgainstDocument(ruleset, doc, { source: "ruleset.yaml" });
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /missing meta\.bridgeApi/);
});

test("rule-has-bridge-api: invalid format emits diagnostic", async () => {
  const ruleset = makeRule("meta", {
    given: "$.rules.*",
    then: { function: "rule-has-bridge-api" },
  });
  const doc = {
    rules: {
      "custom-rule": {
        meta: { bridgeApi: "not-a-version" },
      },
    },
  };
  const r = await runRulesAgainstDocument(ruleset, doc, { source: "ruleset.yaml" });
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /not a recognizable semver range/);
});

test("rule-has-bridge-api: valid range passes", async () => {
  const ruleset = makeRule("meta", {
    given: "$.rules.*",
    then: { function: "rule-has-bridge-api" },
  });
  for (const v of ["1.x", "1.0.x", "1.0.0", "^1.0.0", "~1.0.0"]) {
    const doc = {
      rules: { "custom-rule": { meta: { bridgeApi: v } } },
    };
    const r = await runRulesAgainstDocument(ruleset, doc, { source: "ruleset.yaml" });
    assert.equal(
      r.diagnostics.length,
      0,
      `expected pass for ${v} — got ${JSON.stringify(r.diagnostics)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Smoke: factory wiring — engine resolves bridge built-ins by name
// ---------------------------------------------------------------------------

test("buildBridgeBuiltinFunctions wires into engine without throwing", async () => {
  // A rule that uses one of the remaining stubs ("token-exists-in-kb") should
  // still load (no "Unknown function" crash) and emit no diagnostics.
  // Suppress the once-per-name warning the stub prints to stderr.
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "bridge-stub-wiring-"));
    mkdirSync(dir, { recursive: true });
    const ruleset = makeRule("stub", {
      given: "$",
      then: { function: "token-exists-in-kb" },
      severity: "warn",
    });
    const r = await runRulesAgainstDocument(ruleset, {}, { source: "x.yaml", cwd: dir });
    assert.equal(r.diagnostics.length, 0);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    console.warn = originalWarn;
  }
});
