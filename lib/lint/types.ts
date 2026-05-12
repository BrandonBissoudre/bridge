// lib/lint/types.ts
// Internal contracts for the lint engine.
import type {
  Severity,
  Category,
  Surface,
  Status,
} from "@noemuch/bridge-ds-rule-api";

export interface RuleDef {
  readonly id: string;
  readonly description: string;
  readonly given: string | string[];
  readonly then: {
    readonly field?: string;
    readonly function: string;
    readonly functionOptions?: unknown;
  };
  readonly severity: Severity;
  readonly meta: {
    readonly bridgeApi: string;
    readonly category: Category;
    readonly surface: readonly Surface[];
    readonly appliesTo?: readonly string[];
    readonly status: Status;
    readonly rationale?: string;
    readonly example?: string;
    readonly prompt?: string;
    readonly since: string;
    readonly deprecatedBy?: string | null;
  };
}

export interface LintConfig {
  readonly extends?: readonly string[];
  readonly rules?: Readonly<Record<string, RuleDef | "off">>;
  readonly overrides?: ReadonlyArray<{
    readonly files: readonly string[];
    readonly rules: Readonly<Record<string, Severity>>;
  }>;
  readonly functionsDir?: string;
}

export interface LintDiagnostic {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly message: string;
  readonly path: ReadonlyArray<string | number>;
  readonly source: string;
}

export interface CoverageReport {
  readonly byCategory: Readonly<
    Record<Category, { passed: number; failed: number; total: number }>
  >;
  readonly overall: { passed: number; failed: number; total: number };
}

export interface LintResult {
  readonly diagnostics: readonly LintDiagnostic[];
  readonly coverage: CoverageReport;
}
