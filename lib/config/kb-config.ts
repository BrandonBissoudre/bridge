import { load as yamlLoad, JSON_SCHEMA } from "js-yaml";
import { z } from "zod";

const CronCfg = z.object({
  cadence: z.string().default("daily"),
  time: z.string().default("06:00"),
  maxPRsPerWeek: z.number().int().positive().default(7),
  autoMergeIfTrivial: z.boolean().default(false),
});

// Per-category Figma file overrides. Each entry is optional; absent entries
// fall back to the top-level `figmaFileKey`. Use this when a design system is
// split across multiple Figma libraries — e.g. components in one file,
// variables and text styles in a "Foundations" file.
const FigmaFilesCfg = z
  .object({
    components: z.string().optional(),
    variables: z.string().optional(),
    textStyles: z.string().optional(),
  })
  .default({});

export const KBConfigSchema = z.object({
  dsName: z.string().min(1),
  tagline: z.string().optional(),
  figmaFileKey: z.string().min(1),
  figmaFiles: FigmaFilesCfg,
  kbPath: z.string().default("bridge-ds"),
  cron: CronCfg.default({}),
});

export type KBConfig = z.infer<typeof KBConfigSchema>;

export type RegistryCategory = "components" | "variables" | "textStyles";

export function resolveFileKey(cfg: KBConfig, category: RegistryCategory): string {
  return cfg.figmaFiles[category] ?? cfg.figmaFileKey;
}

export function parseKBConfig(raw: string): KBConfig {
  // JSON_SCHEMA rejects custom YAML tags (e.g. `!!js/function`) that could
  // execute code at parse time. The config is plain data, so this is safe
  // and strictly tighter than the library default.
  const parsed = yamlLoad(raw, { schema: JSON_SCHEMA });
  return KBConfigSchema.parse(parsed);
}
