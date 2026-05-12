// lib/lint/engine.ts
import { Spectral, Document } from "@stoplight/spectral-core";
import * as functions from "@stoplight/spectral-functions";
import { Json as JsonParser } from "@stoplight/spectral-parsers";
import type { RuleDef, LintDiagnostic, LintResult } from "./types.js";
import type { Category, Severity } from "@noemuch/bridge-ds-rule-api";

interface RunOptions {
  readonly source: string;
}

// In rulesets, the rule `id` is the record key, so callers may omit it from the
// value object. We normalize to a full RuleDef internally.
type RuleInput = Omit<RuleDef, "id"> & { readonly id?: string };

const SPECTRAL_SEVERITY: Record<Severity, number> = {
  off: -1,
  hint: 3,
  info: 2,
  warn: 1,
  error: 0,
};

const BUILTIN_FUNCTIONS = functions as unknown as Record<string, unknown>;

function resolveFunction(name: string): unknown {
  const fn = BUILTIN_FUNCTIONS[name];
  if (typeof fn !== "function") {
    throw new Error(
      `Unknown Spectral function "${name}". Built-in functions: ${Object.keys(
        BUILTIN_FUNCTIONS
      )
        .filter((k) => typeof BUILTIN_FUNCTIONS[k] === "function")
        .join(", ")}.`
    );
  }
  return fn;
}

function toCategory(rule: RuleInput): Category {
  return rule.meta.category;
}

export async function runRulesAgainstDocument(
  ruleset: { rules: Record<string, RuleInput> },
  document: unknown,
  opts: RunOptions
): Promise<LintResult> {
  const spectral = new Spectral();
  const spectralRuleset: Record<string, unknown> = {};

  for (const [id, rule] of Object.entries(ruleset.rules)) {
    spectralRuleset[id] = {
      description: rule.description,
      given: rule.given,
      then: {
        ...(rule.then.field !== undefined ? { field: rule.then.field } : {}),
        function: resolveFunction(rule.then.function),
        functionOptions: rule.then.functionOptions,
      },
      severity: SPECTRAL_SEVERITY[rule.severity],
    };
  }

  spectral.setRuleset({
    rules: spectralRuleset as never,
  } as never);

  const doc = new Document(JSON.stringify(document), JsonParser, opts.source);
  const spectralResults = await spectral.run(doc);

  const diagnostics: LintDiagnostic[] = spectralResults.map((r) => {
    const ruleId = r.code as string;
    const rule = ruleset.rules[ruleId];
    return {
      ruleId,
      severity: rule.severity,
      category: toCategory(rule),
      message: r.message,
      path: r.path as never,
      source: opts.source,
    };
  });

  const total = Object.keys(ruleset.rules).length;
  const failed = new Set(diagnostics.map((d) => d.ruleId)).size;
  return {
    diagnostics,
    coverage: {
      byCategory: {} as never, // computed later in coverage.ts
      overall: { passed: total - failed, failed, total },
    },
  };
}
