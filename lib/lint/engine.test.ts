import { test } from "node:test";
import assert from "node:assert/strict";
import { runRulesAgainstDocument } from "./engine.js";

test("runRulesAgainstDocument returns diagnostics for a simple rule violation", async () => {
  const ruleset = {
    rules: {
      "no-foo": {
        description: "Disallow the literal 'foo'",
        given: "$.value",
        then: { function: "pattern", functionOptions: { notMatch: "^foo$" } },
        severity: "error" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
    },
  };

  const document = { value: "foo" };
  const result = await runRulesAgainstDocument(ruleset, document, {
    source: "test.yaml",
  });

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].ruleId, "no-foo");
  assert.equal(result.diagnostics[0].severity, "error");
  assert.equal(result.diagnostics[0].category, "structure");
});

test("runRulesAgainstDocument returns no diagnostics when no rules fire", async () => {
  const ruleset = {
    rules: {
      "no-foo": {
        description: "Disallow 'foo'",
        given: "$.value",
        then: { function: "pattern", functionOptions: { notMatch: "^foo$" } },
        severity: "error" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
    },
  };

  const document = { value: "bar" };
  const result = await runRulesAgainstDocument(ruleset, document, {
    source: "test.yaml",
  });

  assert.equal(result.diagnostics.length, 0);
});

test("runRulesAgainstDocument skips rules with severity 'off'", async () => {
  const ruleset = {
    rules: {
      "no-foo": {
        description: "Disallow 'foo'",
        given: "$.value",
        then: { function: "pattern", functionOptions: { notMatch: "^foo$" } },
        severity: "off" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
    },
  };
  const result = await runRulesAgainstDocument(
    ruleset,
    { value: "foo" },
    {
      source: "test.yaml",
    }
  );
  assert.equal(result.diagnostics.length, 0);
});

test("runRulesAgainstDocument isolates per-rule crashes — one bad JSONPath doesn't kill the batch", async () => {
  const ruleset = {
    rules: {
      "crashes-on-null": {
        description: "Filter with null-vulnerable JSONPath",
        given: "$.items[?(@.type == 'X')]",
        then: { function: "truthy" },
        severity: "error" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
      "always-passes": {
        description: "Innocuous rule",
        given: "$.value",
        then: { function: "pattern", functionOptions: { match: ".*" } },
        severity: "error" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
    },
  };

  const docWithNulls = { items: [null, { type: "X" }, null], value: "ok" };
  const result = await runRulesAgainstDocument(ruleset, docWithNulls, { source: "test" });

  // The crashing rule should produce a lint-engine/rule-crash warning,
  // and always-passes should still have run cleanly (no diagnostic on a passing doc).
  const crashDiag = result.diagnostics.find((d) => d.ruleId === "lint-engine/rule-crash");
  assert.ok(crashDiag, "rule-crash diagnostic missing");
  assert.match(crashDiag!.message, /crashes-on-null/);
  // always-passes is innocuous on this doc → no diagnostic from it
  const passDiag = result.diagnostics.find((d) => d.ruleId === "always-passes");
  assert.equal(passDiag, undefined);
});

test("runRulesAgainstDocument fires multiple rules at differing severities", async () => {
  const ruleset = {
    rules: {
      "rule-a": {
        description: "Disallow 'foo'",
        given: "$.value",
        then: { function: "pattern", functionOptions: { notMatch: "^foo$" } },
        severity: "error" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
      "rule-b": {
        description: "Warn on short values",
        given: "$.value",
        then: { function: "length", functionOptions: { min: 5 } },
        severity: "warn" as const,
        meta: {
          bridgeApi: "1.x",
          category: "structure" as const,
          surface: ["lint-time" as const],
          status: "active" as const,
          since: "1.0.0",
        },
      },
    },
  };
  const result = await runRulesAgainstDocument(
    ruleset,
    { value: "foo" },
    {
      source: "test.yaml",
    }
  );
  // Both rules fire on { value: "foo" }: rule-a (pattern violation), rule-b (length<5)
  const severities = result.diagnostics.map((d) => d.severity).sort();
  assert.ok(severities.includes("error"));
  assert.ok(severities.includes("warn"));
  assert.equal(result.diagnostics.length, 2);
});
