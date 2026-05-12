// packages/rule-api/src/types.ts
// FROZEN PUBLIC API — semver-protected. Do not break in minor versions.
//
// Closed string unions (Severity, Category, Surface, Status) are intentional.
// Adding a value to any of them is a MAJOR version bump for this package —
// consumers that narrowed on the existing values would silently miss the new
// case. If you need to extend, ship v2 with a migration note.

export type Severity = "off" | "hint" | "info" | "warn" | "error";

export type Category =
  | "tokens"
  | "structure"
  | "naming"
  | "typography"
  | "workflow"
  | "copy"
  | "interaction";

export type Surface = "compile-time" | "lint-time" | "skill-overlay";
export type Status = "canary" | "active" | "deprecated";

export type JsonPath = ReadonlyArray<string | number>;

export interface SuggestPatch {
  readonly message: string;
  readonly patch:
    | { readonly path: string; readonly value: unknown }
    | { readonly regex: string; readonly replace: string };
}

export interface RuleMeta {
  readonly bridgeApi: string;
  readonly category: Category;
  readonly surface: ReadonlyArray<Surface>;
  readonly appliesTo?: ReadonlyArray<string>;
  readonly status: Status;
  readonly rationale: string;
  readonly example: string;
  readonly prompt?: string;
  readonly since: string;
  readonly deprecatedBy?: string | null;
  readonly suggest?: SuggestPatch;
}

export interface BridgeFunctionContext {
  readonly path: JsonPath;
  readonly document: unknown;
  readonly documentInventory: unknown;
}

export interface BridgeFunctionResult {
  readonly message: string;
  readonly path?: JsonPath;
}

export interface BridgeFunctionDefinition<Input = unknown, Options = unknown> {
  readonly name: string;
  readonly bridgeApi: string;
  readonly fn: (
    input: Input,
    options: Options,
    context: BridgeFunctionContext
  ) => void | ReadonlyArray<BridgeFunctionResult>;
}
