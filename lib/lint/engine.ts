// lib/lint/engine.ts
import { Spectral, Document } from "@stoplight/spectral-core";
import * as functions from "@stoplight/spectral-functions";
import { Json as JsonParser } from "@stoplight/spectral-parsers";
import type { RuleDef, LintDiagnostic, LintResult } from "./types.js";
import type { Category, Severity } from "@noemuch/bridge-ds-rule-api";
import { BRIDGE_BUILTIN_STUBS } from "./builtin-functions.js";
import type { LoadedFunction } from "./load-custom-functions.js";

interface RunOptions {
  readonly source: string;
  readonly customFunctions?: ReadonlyArray<LoadedFunction>;
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

// TODO(v7.1): generate a typed function registry from @stoplight/spectral-functions
// so RuleDef['then']['function'] can be a typed union (BuiltinFunctionId | (string & {})).
// Today we resolve dynamically via string name; unknown names throw.
const BUILTIN_FUNCTIONS = functions as unknown as Record<string, unknown>;

function resolveFunction(name: string, customFunctions: ReadonlyArray<LoadedFunction>): unknown {
  // 1. Consumer-loaded custom functions (highest priority — let consumers
  //    override bridge stubs and stoplight builtins if they need to).
  const custom = customFunctions.find((f) => f.name === name);
  if (custom) return custom.fn;

  // 2. Bridge built-in stubs (custom functions referenced by bridge:recommended).
  //    These fail OPEN — they emit no diagnostics and warn once per name — so
  //    consumers can extend the recommended preset without crashing on
  //    "Unknown function" before real implementations land.
  const stub = BRIDGE_BUILTIN_STUBS[name];
  if (typeof stub === "function") {
    return stub;
  }

  // 3. Stoplight built-in functions (truthy, pattern, schema, ...).
  const fn = BUILTIN_FUNCTIONS[name];
  if (typeof fn !== "function") {
    throw new Error(
      `Unknown Spectral function "${name}". Built-in functions: ${Object.keys(BUILTIN_FUNCTIONS)
        .filter((k) => typeof BUILTIN_FUNCTIONS[k] === "function")
        .concat(Object.keys(BRIDGE_BUILTIN_STUBS))
        .concat(customFunctions.map((f) => f.name))
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
  const customFunctions = opts.customFunctions ?? [];

  // We serialize once and reuse the JSON string across per-rule Spectral
  // instances. Document is cheap to reconstruct and not safe to share across
  // Spectral.run() invocations.
  const serialized = JSON.stringify(document);

  const diagnostics: LintDiagnostic[] = [];

  // Per-rule isolation. v7.0.1 ran all rules through one Spectral instance;
  // when a single rule's JSONPath crashed (typically nimma's filter expression
  // against an array containing null elements), the whole batch was lost and
  // the outer catch synthesized a misleading `lint-engine/parse-error`. v7.0.2
  // runs each rule in its own Spectral instance so a crash is contained to
  // that rule. ~50-100ms extra per doc on a 43-rule corpus — acceptable.
  for (const [id, rule] of Object.entries(ruleset.rules)) {
    // Filter `off` rules before handing to Spectral. Spectral's severity -1 is
    // undefined behavior — it may still execute rules. Skipping here is the
    // only safe way to disable a rule.
    if (rule.severity === "off") continue;

    const spectral = new Spectral();
    try {
      spectral.setRuleset({
        rules: {
          [id]: {
            description: rule.description,
            given: rule.given,
            then: {
              ...(rule.then.field !== undefined ? { field: rule.then.field } : {}),
              function: resolveFunction(rule.then.function, customFunctions),
              functionOptions: rule.then.functionOptions,
            },
            severity: SPECTRAL_SEVERITY[rule.severity],
          },
        } as never,
      } as never);
    } catch (err) {
      // Unknown function / malformed `then` — surface as a rule-crash so the
      // operator sees the offending rule name instead of a parse-error.
      diagnostics.push({
        ruleId: "lint-engine/rule-crash",
        severity: "warn",
        category: "structure",
        message: `Rule "${id}" failed to load: ${err instanceof Error ? err.message : String(err)}.`,
        path: [],
        source: opts.source,
      });
      continue;
    }

    const doc = new Document(serialized, JsonParser, opts.source);
    let spectralResults;
    try {
      spectralResults = await spectral.run(doc);
    } catch (err) {
      // Most common cause: nimma JSONPath filter crashes when the targeted
      // array contains null elements (e.g. `[?(@.type == 'X')]` against
      // `[null, {...}]`). We emit a rule-specific warning rather than killing
      // the whole batch.
      diagnostics.push({
        ruleId: "lint-engine/rule-crash",
        severity: "warn",
        category: "structure",
        message: `Rule "${id}" crashed during evaluation: ${
          err instanceof Error ? err.message : String(err)
        }. The rule is likely using a JSONPath filter that doesn't handle null elements — consider tightening with [?(@ && @.field == ...)].`,
        path: [],
        source: opts.source,
      });
      continue;
    }

    for (const r of spectralResults) {
      const ruleId = (r.code as string) ?? id;
      diagnostics.push({
        ruleId,
        severity: rule.severity,
        category: toCategory(rule),
        message: r.message,
        path: r.path as never,
        source: opts.source,
      });
    }
  }

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
