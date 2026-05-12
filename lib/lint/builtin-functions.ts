// lib/lint/builtin-functions.ts
// Real implementations + remaining stubs for the built-in custom Spectral
// functions referenced by the bridge:recommended preset.
//
// v7.1.1 ships real implementations for 9 of the 10 functions originally
// stubbed in v7.0:
//   - text-is-english                 (v7.1.0)
//   - snapshot-exists                 (v7.1.0)
//   - filename-pattern                (v7.1.0)
//   - property-key-has-figma-suffix   (v7.1.0)
//   - rule-has-bridge-api             (v7.1.0)
//   - token-exists-in-kb              (v7.1.1)
//   - token-not-deprecated            (v7.1.1)
//   - interaction-token-is-float      (v7.1.1)
//   - recipe-eligible                 (v7.1.1)
//
// `ship-bundle-complete` remains a deferred stub — it needs git history
// introspection and is scheduled for v7.2+.
//
// Why a factory? KB-based functions need per-cwd state (parsed KB
// snapshot, cache invalidation against the consumer's working directory).
// Returning a fresh `Record<string, RulesetFunction>` per
// `runRulesAgainstDocument` invocation lets the engine isolate that state
// without leaking globals.

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { IFunctionResult, RulesetFunction } from "@stoplight/spectral-core";
import { loadKB } from "./kb-loader.js";

/**
 * Context object threaded into every Bridge built-in custom function factory.
 *
 * `cwd` is the consumer repo cwd (where `bridge-ds lint` was invoked, or the
 * compiler's working directory). It is used to resolve relative paths in
 * functionOptions and to load the consumer's KB.
 */
export interface BridgeBuiltinContext {
  /** Consumer's repo cwd. Used to resolve relative paths (kbPath, fixture loads). */
  readonly cwd: string;
  /** Relative path to consumer KB, default "bridge-ds/knowledge-base". */
  readonly kbPath?: string;
}

/**
 * Build the full map of Bridge built-in custom functions for a given context.
 * Called once per `runRulesAgainstDocument` invocation.
 */
export function buildBridgeBuiltinFunctions(
  ctx: BridgeBuiltinContext
): Record<string, RulesetFunction<unknown, unknown>> {
  return {
    // Real implementations — v7.1.0.
    "text-is-english": makeTextIsEnglish() as RulesetFunction<unknown, unknown>,
    "snapshot-exists": makeSnapshotExists(ctx),
    "filename-pattern": makeFilenamePattern() as RulesetFunction<unknown, unknown>,
    "property-key-has-figma-suffix": makePropertyKeyHasFigmaSuffix() as RulesetFunction<
      unknown,
      unknown
    >,
    "rule-has-bridge-api": makeRuleHasBridgeApi(),

    // KB-based real implementations — v7.1.1.
    "token-exists-in-kb": makeTokenExistsInKB(ctx) as RulesetFunction<unknown, unknown>,
    "token-not-deprecated": makeTokenNotDeprecated(ctx) as RulesetFunction<unknown, unknown>,
    "interaction-token-is-float": makeInteractionTokenIsFloat(ctx) as RulesetFunction<
      unknown,
      unknown
    >,
    "recipe-eligible": makeRecipeEligible() as RulesetFunction<unknown, unknown>,

    // Deferred — requires git history introspection (v7.2+).
    "ship-bundle-complete": deferredStub(
      "ship-bundle-complete",
      "requires git history introspection — deferred to v7.2+"
    ),
  };
}

// ---------------------------------------------------------------------------
// Stub helper (preserved for the 5 not-yet-implemented functions)
// ---------------------------------------------------------------------------

const warnedOnce = new Set<string>();

/**
 * No-op function that emits a one-time warning explaining why the named
 * function is deferred (e.g. "needs git introspection — v7.2+"). Replaces
 * the generic v7.0 `stub()` helper now that every stub either has a real
 * impl or a known deferral reason.
 */
function deferredStub(name: string, reason: string): RulesetFunction<unknown, unknown> {
  const fn: RulesetFunction<unknown, unknown> = () => {
    if (!warnedOnce.has(name)) {
      warnedOnce.add(name);
      console.warn(
        `[bridge-ds lint] custom function "${name}" is deferred: ${reason}. Set rule severity to "off" to silence.`
      );
    }
    return undefined;
  };
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

// ---------------------------------------------------------------------------
// 2.1 text-is-english
// ---------------------------------------------------------------------------

// Lowercase French stopwords. Curated for common DS copy (button labels,
// helper text, microcopy). Keep this list short and high-signal — adding
// rare words inflates false positives on short bilingual strings.
const FRENCH_STOPWORDS = new Set<string>([
  // articles & determiners
  "le",
  "la",
  "les",
  "des",
  "du",
  "de",
  "un",
  "une",
  // conjunctions & copulas
  "et",
  "est",
  "sont",
  // demonstratives
  "ce",
  "ces",
  "cette",
  // prepositions
  "pour",
  "avec",
  "sans",
  "dans",
  "sur",
  "sous",
  // interrogatives
  "que",
  "qui",
  "quoi",
  // pronouns
  "vous",
  "nous",
  "ils",
  "elles",
  "votre",
  "notre",
  // common DS / microcopy markers
  "aide",
  "bonjour",
  "merci",
  "continuer",
  "annuler",
  "valider",
]);

interface TextIsEnglishOptions {
  readonly allowList?: readonly string[];
  readonly threshold?: number;
}

function makeTextIsEnglish(): RulesetFunction<string, TextIsEnglishOptions> {
  return (input, options, context) => {
    if (typeof input !== "string" || input.trim().length === 0) return;

    const opts = (options ?? {}) as TextIsEnglishOptions;
    const threshold = typeof opts.threshold === "number" ? opts.threshold : 2;
    const allowList = new Set((opts.allowList ?? []).map((s) => s.toLowerCase()));

    const words = input
      .toLowerCase()
      .replace(/[.,;:!?"'`()[\]{}]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const frenchHits = words.filter((w) => FRENCH_STOPWORDS.has(w) && !allowList.has(w));

    if (frenchHits.length >= threshold) {
      return [
        {
          message: `Copy must be English (detected French markers: ${frenchHits.join(", ")}): "${input}"`,
          path: context.path,
        },
      ];
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.2 snapshot-exists
// ---------------------------------------------------------------------------

function getDocumentSource(context: { document?: { source?: string | null } }): string | null {
  const src = context.document?.source;
  return typeof src === "string" && src.length > 0 ? src : null;
}

function makeSnapshotExists(ctx: BridgeBuiltinContext): RulesetFunction<unknown, unknown> {
  return (_input, _options, context) => {
    const source = getDocumentSource(context);
    if (!source || !source.endsWith(".cspec.yaml")) return undefined;

    // Resolve the spec path relative to cwd. Spectral's source is whatever
    // the caller passed into `new Document(..., source)` — typically a
    // relative path like "specs/shipped/foo.cspec.yaml".
    const absoluteSource = source.startsWith("/") ? source : join(ctx.cwd, source);
    const dir = dirname(absoluteSource);
    const name = basename(absoluteSource, ".cspec.yaml");
    const snapshotPath = join(dir, `${name}-snapshot.json`);

    if (!existsSync(snapshotPath)) {
      return [
        {
          message: `Missing snapshot at ${snapshotPath} — every shipped CSpec must have its *-snapshot.json sibling.`,
          path: [],
        },
      ];
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.3 filename-pattern
// ---------------------------------------------------------------------------

interface FilenamePatternOptions {
  readonly match?: string;
  readonly notMatch?: string;
}

function makeFilenamePattern(): RulesetFunction<unknown, FilenamePatternOptions> {
  return (_input, options, context) => {
    const source = getDocumentSource(context);
    if (!source) return undefined;

    const filename = basename(source);
    const opts = (options ?? {}) as FilenamePatternOptions;

    const results: IFunctionResult[] = [];
    if (typeof opts.match === "string" && opts.match.length > 0) {
      try {
        if (!new RegExp(opts.match).test(filename)) {
          results.push({
            message: `Filename "${filename}" does not match required pattern: ${opts.match}`,
            path: [],
          });
        }
      } catch (err) {
        results.push({
          message: `filename-pattern: invalid 'match' regex "${opts.match}": ${
            err instanceof Error ? err.message : String(err)
          }`,
          path: [],
        });
      }
    }
    if (typeof opts.notMatch === "string" && opts.notMatch.length > 0) {
      try {
        if (new RegExp(opts.notMatch).test(filename)) {
          results.push({
            message: `Filename "${filename}" matches forbidden pattern: ${opts.notMatch}`,
            path: [],
          });
        }
      } catch (err) {
        results.push({
          message: `filename-pattern: invalid 'notMatch' regex "${opts.notMatch}": ${
            err instanceof Error ? err.message : String(err)
          }`,
          path: [],
        });
      }
    }

    return results.length > 0 ? results : undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.4 property-key-has-figma-suffix
// ---------------------------------------------------------------------------

// `#<digits>:<digits>` — the Figma node-id format. Anchored to end-of-key
// so it matches "label#1057:0" but not stray "#0:0" embedded mid-string.
const FIGMA_NODE_ID_SUFFIX = /#\d+:\d+$/;

function makePropertyKeyHasFigmaSuffix(): RulesetFunction<Record<string, unknown>, unknown> {
  return (input, _options, context) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;

    const results: IFunctionResult[] = [];
    for (const [key, value] of Object.entries(input)) {
      // Variant axis keys are exempt — they bind to a component-set property,
      // not to an individual node, so they carry no node-id suffix.
      const isVariant = typeof value === "string" && value.startsWith("VARIANT(");
      if (isVariant) continue;
      if (!FIGMA_NODE_ID_SUFFIX.test(key)) {
        results.push({
          message: `Property key "${key}" missing Figma node-id suffix (e.g. "label#1057:0"). Non-variant property keys must carry the suffix.`,
          path: [...context.path, key],
        });
      }
    }
    return results.length > 0 ? results : undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.5 rule-has-bridge-api
// ---------------------------------------------------------------------------

// Accepts semver-range-ish strings used in `meta.bridgeApi`:
//   "1.x", "1.0.x", "1.0.0", "^1.0.0", "~1.0.0", ">=1.0.0", "1.0.0-2.0.0"
// We are deliberately lax — anything starting with a major version and using
// only digits, dots, `x`, and the standard range operators is acceptable.
const BRIDGE_API_RE = /^[\^~>=<]*\d+(?:\.\d+|\.x)*(?:\.\d+|\.x)?(?:\s*-\s*\d+(?:\.\d+|\.x)*)?$/;

function makeRuleHasBridgeApi(): RulesetFunction<unknown, unknown> {
  return (input, _options, context) => {
    if (input === null || typeof input !== "object") return undefined;

    const rule = input as { meta?: { bridgeApi?: unknown } };
    const bridgeApi = rule.meta?.bridgeApi;

    if (typeof bridgeApi !== "string" || bridgeApi.length === 0) {
      return [
        {
          message: `Rule is missing meta.bridgeApi (semver range string). Without it, the engine cannot decide whether to load this rule against the running Bridge version.`,
          path: context.path,
        },
      ];
    }

    if (!BRIDGE_API_RE.test(bridgeApi.trim())) {
      return [
        {
          message: `meta.bridgeApi "${bridgeApi}" is not a recognizable semver range. Expected formats: "1.x", "1.0.x", "^1.0.0".`,
          path: [...context.path, "meta", "bridgeApi"],
        },
      ];
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.6 token-exists-in-kb
// ---------------------------------------------------------------------------
//
// Rule shape: `given: $..tokens[*].name` — input is the *string* token ref
// (e.g. "$color/background/surface/subtle"). When the consumer has no KB
// extracted yet (pre-bootstrap state), we silently skip so green-field repos
// don't drown in noise.

function makeTokenExistsInKB(ctx: BridgeBuiltinContext): RulesetFunction<string, unknown> {
  return (input, _options, context) => {
    if (typeof input !== "string") return;
    const kb = loadKB(ctx.cwd, ctx.kbPath);
    if (!kb) return; // No KB → skip silently (consumer might be in pre-extract state)
    const name = input.startsWith("$") ? input.slice(1) : input;
    if (kb.variableByName.has(name)) return;
    // Could be a component or text style ref — check those too.
    if (kb.componentByName.has(name) || kb.textStyleByName.has(name)) return;
    return [
      {
        message: `Token "${input}" does not exist in the KB. Did you mean one of: ${suggestNearest(
          name,
          kb.variableByName
        )}?`,
        path: context.path,
      },
    ];
  };
}

/**
 * Cheap nearest-neighbor suggestion for missing tokens. Picks up to 3 names
 * that share a substring with the miss (case-insensitive) or whose top-level
 * namespace ("color", "spacing", ...) matches the miss's first segment.
 * Not a real edit-distance ranker — that would be overkill for a lint hint.
 */
function suggestNearest(name: string, byName: Map<string, unknown>): string {
  const lower = name.toLowerCase();
  const firstSeg = lower.split("/")[0] ?? "";
  const candidates: string[] = [];
  for (const candidate of byName.keys()) {
    const candLower = candidate.toLowerCase();
    const candFirstSeg = candLower.split("/")[0] ?? "";
    if (candLower.includes(lower) || (firstSeg.length > 0 && candFirstSeg === firstSeg)) {
      candidates.push(candidate);
      if (candidates.length >= 3) break;
    }
  }
  return candidates.length > 0 ? candidates.join(", ") : "(no close matches found)";
}

// ---------------------------------------------------------------------------
// 2.7 token-not-deprecated
// ---------------------------------------------------------------------------

function makeTokenNotDeprecated(ctx: BridgeBuiltinContext): RulesetFunction<string, unknown> {
  return (input, _options, context) => {
    if (typeof input !== "string") return;
    const kb = loadKB(ctx.cwd, ctx.kbPath);
    if (!kb) return;
    const name = input.startsWith("$") ? input.slice(1) : input;
    const entry = kb.variableByName.get(name);
    if (entry?.status === "deprecated") {
      return [
        {
          message: `Token "${input}" is deprecated in the KB. Migrate to a non-deprecated alternative.`,
          path: context.path,
        },
      ];
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.8 interaction-token-is-float
// ---------------------------------------------------------------------------
//
// Interaction tokens are opacity overlays (FLOAT). Modeling them as COLOR
// breaks the overlay semantic — a designer ends up baking the hover/pressed
// state into the base fill instead of stacking translucent layers.
//
// `given` may yield either the bare string ref or the parent token object
// (depending on rule authoring style); we tolerate both.

function makeInteractionTokenIsFloat(
  ctx: BridgeBuiltinContext
): RulesetFunction<{ name?: string } | string, unknown> {
  return (input, _options, context) => {
    const tokenRef =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && "name" in input
          ? (input as { name?: string }).name
          : undefined;
    if (typeof tokenRef !== "string") return;
    if (!tokenRef.startsWith("$interaction/")) return;
    const kb = loadKB(ctx.cwd, ctx.kbPath);
    if (!kb) return;
    const name = tokenRef.slice(1);
    const entry = kb.variableByName.get(name);
    if (entry && entry.resolvedType && entry.resolvedType !== "FLOAT") {
      return [
        {
          message: `Interaction token "${tokenRef}" has resolvedType ${entry.resolvedType}, expected FLOAT. Interaction tokens are opacity overlays — modeling them as COLOR breaks the overlay semantic.`,
          path: context.path,
        },
      ];
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// 2.9 recipe-eligible
// ---------------------------------------------------------------------------
//
// Info-level guidance, not a hard fail. Recipes are typically extracted for
// `screen`-archetype CSpecs with few corrections. Other archetypes (component,
// page) or specs with many corrections may still ship a recipe, but the
// designer should confirm intent — high correction counts indicate fragile
// assumptions that may drift on replay.

interface RecipeEligibleOptions {
  readonly archetype?: string;
  readonly maxCorrections?: number;
}

function makeRecipeEligible(): RulesetFunction<
  { archetype?: string; meta?: { corrections?: number } } | unknown,
  RecipeEligibleOptions
> {
  return (input, options, context) => {
    const opts = (options ?? {}) as RecipeEligibleOptions;
    const requiredArchetype = opts.archetype ?? "screen";
    const maxCorrections = opts.maxCorrections ?? 2;

    const doc = input as { archetype?: string; meta?: { corrections?: number } };
    const archetype = doc?.archetype;
    const corrections = doc?.meta?.corrections ?? 0;

    if (archetype !== requiredArchetype) {
      return [
        {
          message: `Recipe eligibility (info): archetype is "${archetype ?? "<missing>"}", recipes are typically only extracted for "${requiredArchetype}". Confirm intent if shipping a recipe.`,
          path: context.path,
        },
      ];
    }
    if (corrections > maxCorrections) {
      return [
        {
          message: `Recipe eligibility (info): ${corrections} corrections recorded, max ${maxCorrections}. High correction count indicates fragile assumptions — recipe replay may drift.`,
          path: context.path,
        },
      ];
    }
    return undefined;
  };
}
