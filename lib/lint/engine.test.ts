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
