import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractFromFigma,
  extractComponentsFromFigma,
  extractVariablesFromFigma,
  extractTextStylesFromFigma,
} from "./figma-rest.js";

function mockFetch(responsesByUrl: Record<string, unknown>): typeof fetch {
  return (async (url: any) => {
    const key = String(url);
    const body = responsesByUrl[key];
    if (!body) throw new Error(`unmocked url: ${key}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
    } as Response;
  }) as typeof fetch;
}

function recordingFetch(responsesByUrl: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = (async (url: any) => {
    const key = String(url);
    urls.push(key);
    const body = responsesByUrl[key];
    if (!body) throw new Error(`unmocked url: ${key}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, urls };
}

test("extractFromFigma normalizes REST responses", async () => {
  const FIX = path.resolve("test/fixtures/figma-rest");
  const v = JSON.parse(await readFile(path.join(FIX, "variables-response.json"), "utf8"));
  const c = JSON.parse(await readFile(path.join(FIX, "components-response.json"), "utf8"));
  const s = JSON.parse(await readFile(path.join(FIX, "styles-response.json"), "utf8"));

  const fetchMock = mockFetch({
    "https://api.figma.com/v1/files/FILEKEY/variables/local": v,
    "https://api.figma.com/v1/files/FILEKEY/components": c,
    "https://api.figma.com/v1/files/FILEKEY/styles": s,
  });

  const result = await extractFromFigma({
    fileKey: "FILEKEY",
    token: "figd_test",
    fetchImpl: fetchMock,
  });

  assert.equal(result.variables.variables.length, 1);
  assert.equal(result.variables.variables[0].name, "color/bg/primary");
  assert.equal(result.variables.variables[0].key, "VAR_KEY_1");
  assert.ok((result.variables.variables[0].valuesByMode as any).light);
  assert.equal(result.components.components.length, 1);
  assert.equal(result.components.components[0].name, "Button");
  assert.equal(result.components.components[0].key, "COMPKEY_BTN");
  assert.equal(result.textStyles.styles.length, 1);
  assert.equal(result.textStyles.styles[0].name, "label/md");
});

test("extractFromFigma throws on missing token", async () => {
  await assert.rejects(() => extractFromFigma({ fileKey: "x", token: "" }));
});

test("extractComponentsFromFigma only hits /components endpoint", async () => {
  const FIX = path.resolve("test/fixtures/figma-rest");
  const c = JSON.parse(await readFile(path.join(FIX, "components-response.json"), "utf8"));
  const { fetchImpl, urls } = recordingFetch({
    "https://api.figma.com/v1/files/FILEKEY/components": c,
  });
  const reg = await extractComponentsFromFigma({
    fileKey: "FILEKEY",
    token: "figd_test",
    fetchImpl,
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/components$/);
  assert.equal(reg.components.length, 1);
});

test("extractVariablesFromFigma only hits /variables/local endpoint", async () => {
  const FIX = path.resolve("test/fixtures/figma-rest");
  const v = JSON.parse(await readFile(path.join(FIX, "variables-response.json"), "utf8"));
  const { fetchImpl, urls } = recordingFetch({
    "https://api.figma.com/v1/files/FILEKEY/variables/local": v,
  });
  const reg = await extractVariablesFromFigma({
    fileKey: "FILEKEY",
    token: "figd_test",
    fetchImpl,
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/variables\/local$/);
  assert.equal(reg.variables.length, 1);
});

test("extractVariablesFromFigma throws VariablesEndpointUnavailableError on 403", async () => {
  const { VariablesEndpointUnavailableError } = await import("./figma-rest.js");
  const fetchImpl = (async () => {
    return {
      ok: false,
      status: 403,
      async json() {
        return {};
      },
    } as Response;
  }) as typeof fetch;
  await assert.rejects(
    () => extractVariablesFromFigma({ fileKey: "X", token: "t", fetchImpl }),
    (err: unknown) => err instanceof VariablesEndpointUnavailableError
  );
});

test("extractVariablesFromFigma throws VariablesEndpointUnavailableError on 404", async () => {
  const { VariablesEndpointUnavailableError } = await import("./figma-rest.js");
  const fetchImpl = (async () => {
    return {
      ok: false,
      status: 404,
      async json() {
        return {};
      },
    } as Response;
  }) as typeof fetch;
  await assert.rejects(
    () => extractVariablesFromFigma({ fileKey: "X", token: "t", fetchImpl }),
    (err: unknown) => err instanceof VariablesEndpointUnavailableError
  );
});

test("extractVariablesFromFigma rethrows other HTTP errors as generic Error", async () => {
  const fetchImpl = (async () => {
    return {
      ok: false,
      status: 500,
      async json() {
        return {};
      },
    } as Response;
  }) as typeof fetch;
  await assert.rejects(
    () => extractVariablesFromFigma({ fileKey: "X", token: "t", fetchImpl }),
    /failed: 500/
  );
});

test("extractTextStylesFromFigma only hits /styles endpoint", async () => {
  const FIX = path.resolve("test/fixtures/figma-rest");
  const s = JSON.parse(await readFile(path.join(FIX, "styles-response.json"), "utf8"));
  const { fetchImpl, urls } = recordingFetch({
    "https://api.figma.com/v1/files/FILEKEY/styles": s,
  });
  const reg = await extractTextStylesFromFigma({
    fileKey: "FILEKEY",
    token: "figd_test",
    fetchImpl,
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/styles$/);
  assert.equal(reg.styles.length, 1);
});
