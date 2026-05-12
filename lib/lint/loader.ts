// lib/lint/loader.ts
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { load as yamlLoad, JSON_SCHEMA } from "js-yaml";
import type { LintConfig, RuleDef } from "./types.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadYaml<T>(p: string): Promise<T> {
  const raw = await readFile(p, "utf-8");
  return yamlLoad(raw, { schema: JSON_SCHEMA }) as T;
}

/**
 * Load a lint config file. Returns null if the file does not exist
 * (engine is then dormant — opt-in via presence of config).
 *
 * Resolves `extends` chains recursively. Later configs override earlier.
 */
export async function loadConfig(configPath: string): Promise<LintConfig | null> {
  if (!(await fileExists(configPath))) return null;

  const raw = await loadYaml<LintConfig>(configPath);
  const baseDir = dirname(configPath);

  // Resolve `extends`
  const resolved: { rules: Record<string, RuleDef | "off"> } = { rules: {} };
  for (const ext of raw.extends ?? []) {
    if (ext.startsWith("bridge:")) {
      const preset = ext.slice("bridge:".length);
      const builtinPath = resolve(
        __dirname,
        "builtin/_rulesets",
        `${preset}.yaml`
      );
      const sub = await loadConfig(builtinPath);
      if (sub?.rules) Object.assign(resolved.rules, sub.rules);
    } else {
      const sub = await loadConfig(resolve(baseDir, ext));
      if (sub?.rules) Object.assign(resolved.rules, sub.rules);
    }
  }
  Object.assign(resolved.rules, raw.rules ?? {});

  return {
    ...raw,
    rules: resolved.rules,
  };
}
