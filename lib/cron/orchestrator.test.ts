import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCron } from "./orchestrator.js";

test("runCron throws a clear error when FIGMA_TOKEN is unset", async () => {
  const original = process.env.FIGMA_TOKEN;
  delete process.env.FIGMA_TOKEN;
  try {
    await assert.rejects(
      () => runCron({ configPath: "test/fixtures/kb-config/minimal.yaml" }),
      /FIGMA_TOKEN env var is required/
    );
  } finally {
    if (original !== undefined) process.env.FIGMA_TOKEN = original;
  }
});

test("runCron surfaces config parsing errors instead of calling Figma", async () => {
  const original = process.env.FIGMA_TOKEN;
  process.env.FIGMA_TOKEN = "dummy";
  try {
    await assert.rejects(() => runCron({ configPath: "test/fixtures/kb-config/missing.yaml" }));
  } finally {
    if (original !== undefined) process.env.FIGMA_TOKEN = original;
    else delete process.env.FIGMA_TOKEN;
  }
});

test("runCron integration: MCP-free end-to-end on fake fetch", async () => {
  // Run the orchestrator against a throwaway directory with a real
  // docs.config.yaml and a monkey-patched `fetch` so we exercise the full
  // pipeline without touching the network.
  const originalFetch = global.fetch;
  const originalToken = process.env.FIGMA_TOKEN;
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), "bridge-cron-int-"));

  const variables = {
    meta: {
      variableCollections: { C1: { id: "C1", modes: [{ modeId: "m1", name: "light" }] } },
      variables: {
        V1: {
          key: "V1",
          name: "color/bg/default",
          variableCollectionId: "C1",
          resolvedType: "COLOR",
          valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
          scopes: ["ALL_SCOPES"],
        },
      },
    },
  };
  const components = { meta: { components: [] } };
  const styles = { meta: { styles: [] } };

  global.fetch = (async (url: unknown) => {
    const u = String(url);
    let body: unknown;
    if (u.includes("/variables/local")) body = variables;
    else if (u.includes("/components")) body = components;
    else if (u.includes("/styles")) body = styles;
    else throw new Error(`unexpected fetch: ${u}`);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  try {
    process.env.FIGMA_TOKEN = "dummy";
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "docs.config.yaml"),
      `dsName: "TestDS"\nfigmaFileKey: "KEY"\nkbPath: "kb"\n`
    );
    process.chdir(dir);
    const report = await runCron({ configPath: "docs.config.yaml" });
    assert.equal(report.extracted, true);
    const body = await readFile(path.join(dir, ".bridge/last-sync-report.md"), "utf8");
    assert.match(body, /Bridge KB sync/);
  } finally {
    process.chdir(originalCwd);
    global.fetch = originalFetch;
    if (originalToken !== undefined) process.env.FIGMA_TOKEN = originalToken;
    else delete process.env.FIGMA_TOKEN;
  }
});

test("runCron multi-file: fetches each registry from its configured fileKey", async () => {
  // Verify per-category file routing: components from one file, variables and
  // text styles from another. This is the spectra-studio case (DS split across
  // SDS-Components and SDS-Foundations Figma libraries).
  const originalFetch = global.fetch;
  const originalToken = process.env.FIGMA_TOKEN;
  const originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), "bridge-cron-multi-"));

  const requestedUrls: string[] = [];

  global.fetch = (async (url: unknown) => {
    const u = String(url);
    requestedUrls.push(u);

    if (u === "https://api.figma.com/v1/files/COMPONENTS_FILE/components") {
      return new Response(
        JSON.stringify({ meta: { components: [{ key: "C1", name: "Button" }] } }),
        { status: 200 }
      );
    }
    if (u === "https://api.figma.com/v1/files/FOUNDATIONS_FILE/variables/local") {
      return new Response(
        JSON.stringify({
          meta: {
            variableCollections: { C: { id: "C", modes: [{ modeId: "m", name: "light" }] } },
            variables: {
              V: {
                key: "VAR1",
                name: "color/bg/primary",
                variableCollectionId: "C",
                resolvedType: "COLOR",
                valuesByMode: { m: { r: 1, g: 1, b: 1, a: 1 } },
              },
            },
          },
        }),
        { status: 200 }
      );
    }
    if (u === "https://api.figma.com/v1/files/FOUNDATIONS_FILE/styles") {
      return new Response(
        JSON.stringify({
          meta: { styles: [{ key: "S1", name: "label/md", style_type: "TEXT" }] },
        }),
        { status: 200 }
      );
    }
    // Any other URL would mean we're fetching from the wrong file — fail loud.
    if (
      u.includes("COMPONENTS_FILE/variables") ||
      u.includes("COMPONENTS_FILE/styles") ||
      u.includes("FOUNDATIONS_FILE/components")
    ) {
      throw new Error(`unexpected cross-file fetch: ${u}`);
    }
    throw new Error(`unmocked fetch: ${u}`);
  }) as typeof fetch;

  try {
    process.env.FIGMA_TOKEN = "dummy";
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "docs.config.yaml"),
      [
        `dsName: "MultiDS"`,
        `figmaFileKey: "COMPONENTS_FILE"`,
        `figmaFiles:`,
        `  variables: "FOUNDATIONS_FILE"`,
        `  textStyles: "FOUNDATIONS_FILE"`,
        `kbPath: "kb"`,
        ``,
      ].join("\n")
    );
    process.chdir(dir);
    const report = await runCron({ configPath: "docs.config.yaml" });

    // Each registry came from the file we declared in config.
    const findWrite = (name: string) => report.writes.find((w) => w.registry === name);
    assert.equal(findWrite("components.json")?.fileKey, "COMPONENTS_FILE");
    assert.equal(findWrite("variables.json")?.fileKey, "FOUNDATIONS_FILE");
    assert.equal(findWrite("text-styles.json")?.fileKey, "FOUNDATIONS_FILE");

    // And the registry contents reflect the right source.
    const compsRaw = await readFile(
      path.join(dir, "kb/knowledge-base/registries/components.json"),
      "utf8"
    );
    assert.match(compsRaw, /Button/);
    const varsRaw = await readFile(
      path.join(dir, "kb/knowledge-base/registries/variables.json"),
      "utf8"
    );
    assert.match(varsRaw, /color\/bg\/primary/);
    const stylesRaw = await readFile(
      path.join(dir, "kb/knowledge-base/registries/text-styles.json"),
      "utf8"
    );
    assert.match(stylesRaw, /label\/md/);

    // Sync report names each source file.
    const body = await readFile(path.join(dir, ".bridge/last-sync-report.md"), "utf8");
    assert.match(body, /components\.json.*COMPONENTS_FILE/);
    assert.match(body, /variables\.json.*FOUNDATIONS_FILE/);
  } finally {
    process.chdir(originalCwd);
    global.fetch = originalFetch;
    if (originalToken !== undefined) process.env.FIGMA_TOKEN = originalToken;
    else delete process.env.FIGMA_TOKEN;
  }
});
