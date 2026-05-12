// lib/lint/builtin-functions.test.ts
// Focused unit tests for the 5 real built-in custom functions shipped in
// v7.1.0. We drive them through `runRulesAgainstDocument` rather than
// invoking the closures directly — that exercises the factory wiring
// (engine.ts -> buildBridgeBuiltinFunctions) end-to-end without coupling
// the tests to internal exports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runRulesAgainstDocument } from "./engine.js";
import type { RuleDef } from "./types.js";
import { _resetKBCache } from "./kb-loader.js";

const KB_FIXTURE_SRC = path.resolve("test/fixtures/lint/kb");

/** Create a temp cwd with the lint KB fixture copied under bridge-ds/knowledge-base. */
function makeKBCwd(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const dest = path.join(dir, "bridge-ds", "knowledge-base");
  mkdirSync(dest, { recursive: true });
  cpSync(KB_FIXTURE_SRC, dest, { recursive: true });
  _resetKBCache();
  return dir;
}

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
// token-exists-in-kb
// ---------------------------------------------------------------------------

test("token-exists-in-kb: existing token passes silently", async () => {
  const dir = makeKBCwd("bridge-token-exists-pass-");
  try {
    const ruleset = makeRule("token-exists", {
      given: "$..tokens[*].name",
      then: { function: "token-exists-in-kb" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$color/background/surface/subtle" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token-exists-in-kb: missing token emits diagnostic with suggestions", async () => {
  const dir = makeKBCwd("bridge-token-exists-fail-");
  try {
    const ruleset = makeRule("token-exists", {
      given: "$..tokens[*].name",
      then: { function: "token-exists-in-kb" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$color/nope/whatever" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
    assert.match(r.diagnostics[0].message, /does not exist in the KB/);
    assert.match(r.diagnostics[0].message, /Did you mean/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token-exists-in-kb: no KB → silently skips", async () => {
  _resetKBCache();
  const dir = mkdtempSync(path.join(tmpdir(), "bridge-token-exists-nokb-"));
  try {
    const ruleset = makeRule("token-exists", {
      given: "$..tokens[*].name",
      then: { function: "token-exists-in-kb" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$color/nope/whatever" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// token-not-deprecated
// ---------------------------------------------------------------------------

test("token-not-deprecated: non-deprecated token passes", async () => {
  const dir = makeKBCwd("bridge-deprecated-pass-");
  try {
    const ruleset = makeRule("not-deprecated", {
      given: "$..tokens[*].name",
      then: { function: "token-not-deprecated" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$color/background/surface/subtle" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token-not-deprecated: deprecated token emits diagnostic", async () => {
  const dir = makeKBCwd("bridge-deprecated-fail-");
  try {
    const ruleset = makeRule("not-deprecated", {
      given: "$..tokens[*].name",
      then: { function: "token-not-deprecated" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$color/text/legacy/muted" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
    assert.match(r.diagnostics[0].message, /deprecated/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// interaction-token-is-float
// ---------------------------------------------------------------------------

test("interaction-token-is-float: FLOAT interaction token passes", async () => {
  const dir = makeKBCwd("bridge-interaction-pass-");
  try {
    const ruleset = makeRule("interaction-float", {
      given: "$..tokens[*].name",
      then: { function: "interaction-token-is-float" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$interaction/hover" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interaction-token-is-float: COLOR-typed interaction token emits", async () => {
  const dir = makeKBCwd("bridge-interaction-fail-");
  try {
    const ruleset = makeRule("interaction-float", {
      given: "$..tokens[*].name",
      then: { function: "interaction-token-is-float" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$interaction/pressed-bad" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
    assert.match(r.diagnostics[0].message, /expected FLOAT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interaction-token-is-float: non-interaction token is ignored", async () => {
  const dir = makeKBCwd("bridge-interaction-skip-");
  try {
    const ruleset = makeRule("interaction-float", {
      given: "$..tokens[*].name",
      then: { function: "interaction-token-is-float" },
    });
    const r = await runRulesAgainstDocument(
      ruleset,
      { tokens: [{ name: "$color/background/surface/subtle" }] },
      { source: "x.cspec.yaml", cwd: dir }
    );
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// recipe-eligible
// ---------------------------------------------------------------------------

test("recipe-eligible: screen archetype with low corrections passes", async () => {
  const ruleset = makeRule("recipe", {
    given: "$",
    then: { function: "recipe-eligible" },
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { archetype: "screen", meta: { corrections: 1 } },
    { source: "x.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
});

test("recipe-eligible: component archetype emits info", async () => {
  const ruleset = makeRule("recipe", {
    given: "$",
    then: { function: "recipe-eligible" },
    severity: "info",
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { archetype: "component", meta: { corrections: 0 } },
    { source: "x.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /archetype is "component"/);
});

test("recipe-eligible: high correction count emits info", async () => {
  const ruleset = makeRule("recipe", {
    given: "$",
    then: { function: "recipe-eligible" },
    severity: "info",
  });
  const r = await runRulesAgainstDocument(
    ruleset,
    { archetype: "screen", meta: { corrections: 5 } },
    { source: "x.cspec.yaml" }
  );
  assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
  assert.match(r.diagnostics[0].message, /5 corrections recorded/);
});

// ---------------------------------------------------------------------------
// Smoke: factory wiring — deferred stub for ship-bundle-complete still loads
// ---------------------------------------------------------------------------

test("ship-bundle-complete deferred stub: loads without crashing, emits warning once", async () => {
  // Suppress the once-per-name warning the stub prints to stderr.
  const originalWarn = console.warn;
  let warnMessage: string | undefined;
  console.warn = (msg: string) => {
    warnMessage = msg;
  };
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "bridge-deferred-wiring-"));
    mkdirSync(dir, { recursive: true });
    const ruleset = makeRule("deferred", {
      given: "$",
      then: { function: "ship-bundle-complete" },
      severity: "warn",
    });
    const r = await runRulesAgainstDocument(ruleset, {}, { source: "x.yaml", cwd: dir });
    assert.equal(r.diagnostics.length, 0);
    assert.match(warnMessage ?? "", /deferred/);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    console.warn = originalWarn;
  }
});
