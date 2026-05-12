#!/usr/bin/env node
// scripts/copy-builtin-resources.js
// Post-tsc: copy all non-TS resources (rule yaml, JSON schemas, fixtures)
// from lib/lint/builtin/ → dist/lib/lint/builtin/ so the published package
// can resolve `bridge:recommended` and the runtime loader can read them.
const { readdir, mkdir, copyFile, stat } = require("node:fs/promises");
const path = require("node:path");

const SRC = path.resolve(__dirname, "../lib/lint/builtin");
const DEST = path.resolve(__dirname, "../dist/lib/lint/builtin");

const KEEP_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

async function walk(srcDir, destDir) {
  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await walk(src, dest);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (KEEP_EXTENSIONS.has(ext)) {
        await copyFile(src, dest);
      }
    }
  }
}

(async () => {
  try {
    const srcStat = await stat(SRC);
    if (!srcStat.isDirectory()) throw new Error(`${SRC} is not a directory`);
  } catch (err) {
    console.error(`copy-builtin-resources: source missing — ${err.message}`);
    process.exit(1);
  }
  await walk(SRC, DEST);
  console.log("copy-builtin-resources: yaml + json files copied to dist/");
})();
