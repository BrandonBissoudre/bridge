// lib/cron/orchestrator.ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractComponentsFromFigma,
  extractVariablesFromFigma,
  extractTextStylesFromFigma,
} from "../extractors/figma-rest.js";
import { parseKBConfig, resolveFileKey } from "../config/kb-config.js";

export interface CronOptions {
  configPath: string;
}

interface RegistryWrite {
  registry: string;
  fileKey: string;
}

export async function runCron(opts: CronOptions) {
  const raw = await readFile(opts.configPath, "utf8");
  const cfg = parseKBConfig(raw);
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("FIGMA_TOKEN env var is required");

  const regDir = path.join(cfg.kbPath, "knowledge-base", "registries");
  await mkdir(regDir, { recursive: true });

  const writes: RegistryWrite[] = [];

  // Components — resolve which file to fetch from (override → primary)
  {
    const fileKey = resolveFileKey(cfg, "components");
    const reg = await extractComponentsFromFigma({ fileKey, token });
    await writeFile(path.join(regDir, "components.json"), JSON.stringify(reg, null, 2) + "\n");
    writes.push({ registry: "components.json", fileKey });
  }

  // Variables
  {
    const fileKey = resolveFileKey(cfg, "variables");
    const reg = await extractVariablesFromFigma({ fileKey, token });
    await writeFile(path.join(regDir, "variables.json"), JSON.stringify(reg, null, 2) + "\n");
    writes.push({ registry: "variables.json", fileKey });
  }

  // Text styles
  {
    const fileKey = resolveFileKey(cfg, "textStyles");
    const reg = await extractTextStylesFromFigma({ fileKey, token });
    await writeFile(path.join(regDir, "text-styles.json"), JSON.stringify(reg, null, 2) + "\n");
    writes.push({ registry: "text-styles.json", fileKey });
  }

  const reportLines = [
    `# Bridge KB sync — ${cfg.dsName}`,
    "",
    "Registries refreshed from Figma:",
    "",
    ...writes.map((w) => `- \`${w.registry}\` (from \`${w.fileKey}\`)`),
    "",
  ];
  await mkdir(".bridge", { recursive: true });
  await writeFile(".bridge/last-sync-report.md", reportLines.join("\n"), "utf8");

  return { extracted: true, dsName: cfg.dsName, writes };
}

const invokedPath = process.argv[1] ?? "";
if (/[\\/]orchestrator\.(js|ts)$/.test(invokedPath)) {
  const configArgIdx = process.argv.indexOf("--config");
  const configPath = configArgIdx >= 0 ? process.argv[configArgIdx + 1] : "docs.config.yaml";
  runCron({ configPath })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
