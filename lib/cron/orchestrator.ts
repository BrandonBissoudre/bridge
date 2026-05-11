// lib/cron/orchestrator.ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractComponentsFromFigma,
  extractVariablesFromFigma,
  extractTextStylesFromFigma,
  VariablesEndpointUnavailableError,
} from "../extractors/figma-rest.js";
import { parseKBConfig, resolveFileKey } from "../config/kb-config.js";

export interface CronOptions {
  configPath: string;
}

interface RegistryWrite {
  registry: string;
  fileKey: string;
}

interface RegistrySkip {
  registry: string;
  reason: string;
}

export async function runCron(opts: CronOptions) {
  const raw = await readFile(opts.configPath, "utf8");
  const cfg = parseKBConfig(raw);
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("FIGMA_TOKEN env var is required");

  const regDir = path.join(cfg.kbPath, "knowledge-base", "registries");
  await mkdir(regDir, { recursive: true });

  const writes: RegistryWrite[] = [];
  const skips: RegistrySkip[] = [];

  // Components — resolve which file to fetch from (override → primary)
  {
    const fileKey = resolveFileKey(cfg, "components");
    const reg = await extractComponentsFromFigma({ fileKey, token });
    await writeFile(path.join(regDir, "components.json"), JSON.stringify(reg, null, 2) + "\n");
    writes.push({ registry: "components.json", fileKey });
  }

  // Variables — gracefully skip if the endpoint is unavailable (non-Enterprise
  // plans get a 403 on /variables/local). Existing variables.json is left
  // untouched so manual MCP refreshes remain authoritative.
  {
    const fileKey = resolveFileKey(cfg, "variables");
    try {
      const reg = await extractVariablesFromFigma({ fileKey, token });
      await writeFile(path.join(regDir, "variables.json"), JSON.stringify(reg, null, 2) + "\n");
      writes.push({ registry: "variables.json", fileKey });
    } catch (err) {
      if (err instanceof VariablesEndpointUnavailableError) {
        skips.push({
          registry: "variables.json",
          reason: `endpoint returned ${err.status} (Enterprise-only — refresh manually via MCP)`,
        });
      } else {
        throw err;
      }
    }
  }

  // Text styles
  {
    const fileKey = resolveFileKey(cfg, "textStyles");
    const reg = await extractTextStylesFromFigma({ fileKey, token });
    await writeFile(path.join(regDir, "text-styles.json"), JSON.stringify(reg, null, 2) + "\n");
    writes.push({ registry: "text-styles.json", fileKey });
  }

  const reportLines = [`# Bridge KB sync — ${cfg.dsName}`, ""];
  if (writes.length > 0) {
    reportLines.push("Registries refreshed from Figma:", "");
    for (const w of writes) {
      reportLines.push(`- \`${w.registry}\` (from \`${w.fileKey}\`)`);
    }
    reportLines.push("");
  }
  if (skips.length > 0) {
    reportLines.push("Skipped (existing files preserved):", "");
    for (const s of skips) {
      reportLines.push(`- \`${s.registry}\` — ${s.reason}`);
    }
    reportLines.push("");
  }
  await mkdir(".bridge", { recursive: true });
  await writeFile(".bridge/last-sync-report.md", reportLines.join("\n"), "utf8");

  return { extracted: true, dsName: cfg.dsName, writes, skips };
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
