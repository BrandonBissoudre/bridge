// lib/lint/overlay.ts
import type { RuleDef } from "./types.js";

interface RenderOpts {
  readonly rules: Record<string, RuleDef>;
  readonly request: { readonly archetype?: string };
  readonly maxRules?: number;
}

const SEVERITY_ORDER = ["error", "warn", "info", "hint"] as const;

export function renderSkillOverlay(opts: RenderOpts): string {
  const max = opts.maxRules ?? 10;
  const archetype = opts.request.archetype;

  const matching = Object.entries(opts.rules).filter(([, rule]) => {
    if (!rule.meta.surface.includes("skill-overlay")) return false;
    if (rule.meta.status === "deprecated") return false;
    if (rule.meta.appliesTo && rule.meta.appliesTo.length > 0) {
      if (!archetype || !rule.meta.appliesTo.includes(archetype)) return false;
    }
    return true;
  });

  matching.sort((a, b) => {
    const ac = a[1].meta.category;
    const bc = b[1].meta.category;
    if (ac !== bc) return ac.localeCompare(bc);
    const as = SEVERITY_ORDER.indexOf(a[1].severity as never);
    const bs = SEVERITY_ORDER.indexOf(b[1].severity as never);
    return as - bs;
  });

  const total = matching.length;
  const shown = matching.slice(0, max);
  const truncated = total - shown.length;

  const lines: string[] = [];
  lines.push("<iron-laws>");
  lines.push("");
  lines.push(
    `The following design-system rules apply to this spec${
      archetype ? ` (archetype: ${archetype})` : ""
    }.`
  );
  lines.push("Violations will be caught by `bridge-ds lint` and may block compile.");
  lines.push("");

  for (const [id, rule] of shown) {
    const tag = rule.meta.status === "canary" ? `CANARY ${id}` : id;
    lines.push(`[${tag}] ${rule.meta.rationale ?? rule.description}`);
    if (rule.meta.rationale) lines.push(`Why: ${rule.meta.rationale}`);
    if (rule.meta.example) lines.push(`Example: ${rule.meta.example}`);
    lines.push("");
  }

  if (truncated > 0) {
    lines.push(`(${truncated} more rules apply — full list: bridge-ds/lint/config.yaml)`);
    lines.push("");
  }

  lines.push("</iron-laws>");
  return lines.join("\n");
}
