import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSkillOverlay } from "./overlay.js";
import type { RuleDef } from "./types.js";

test("renderSkillOverlay filters by archetype and caps at 10 rules", () => {
  const rules: Record<string, RuleDef> = {};
  for (let i = 0; i < 15; i++) {
    rules[`rule-${i}`] = {
      id: `rule-${i}`,
      description: `desc ${i}`,
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: ["card"],
        status: "active",
        rationale: `Rationale ${i}`,
        example: `Example ${i}`,
        since: "1.0.0",
      },
    } as never;
  }

  const xml = renderSkillOverlay({
    rules,
    request: { archetype: "card" },
  });

  assert.ok(xml.startsWith("<iron-laws>"));
  assert.ok(xml.endsWith("</iron-laws>"));
  const ruleMatches = xml.match(/^\[rule-\d+\]/gm) ?? [];
  assert.equal(ruleMatches.length, 10);
  assert.match(xml, /5 more rules apply/);
});

test("renderSkillOverlay skips rules not matching the archetype", () => {
  const rules = {
    "card-rule": {
      id: "card-rule",
      description: "card only",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: ["card"],
        status: "active",
        rationale: "r",
        example: "e",
        since: "1.0.0",
      },
    },
    "screen-rule": {
      id: "screen-rule",
      description: "screen only",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: ["screen"],
        status: "active",
        rationale: "r",
        example: "e",
        since: "1.0.0",
      },
    },
  } as never;

  const xml = renderSkillOverlay({ rules, request: { archetype: "card" } });
  assert.match(xml, /\[card-rule\]/);
  assert.doesNotMatch(xml, /\[screen-rule\]/);
});

test("renderSkillOverlay treats missing appliesTo as universal (matches any archetype)", () => {
  const rules = {
    "universal-rule": {
      id: "universal-rule",
      description: "applies everywhere",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        status: "active",
        rationale: "r",
        example: "e",
        since: "1.0.0",
      },
    },
    "empty-applies-to-rule": {
      id: "empty-applies-to-rule",
      description: "empty appliesTo",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: [],
        status: "active",
        rationale: "r",
        example: "e",
        since: "1.0.0",
      },
    },
  } as never;

  const xmlCard = renderSkillOverlay({ rules, request: { archetype: "card" } });
  assert.match(xmlCard, /\[universal-rule\]/);
  assert.match(xmlCard, /\[empty-applies-to-rule\]/);

  const xmlScreen = renderSkillOverlay({
    rules,
    request: { archetype: "screen" },
  });
  assert.match(xmlScreen, /\[universal-rule\]/);
  assert.match(xmlScreen, /\[empty-applies-to-rule\]/);
});

test("renderSkillOverlay skips deprecated rules and prefixes canary rules", () => {
  const rules = {
    "active-rule": {
      id: "active-rule",
      description: "active",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: ["card"],
        status: "active",
        rationale: "r-active",
        example: "e",
        since: "1.0.0",
      },
    },
    "deprecated-rule": {
      id: "deprecated-rule",
      description: "deprecated",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: ["card"],
        status: "deprecated",
        rationale: "r-deprecated",
        example: "e",
        since: "1.0.0",
      },
    },
    "canary-rule": {
      id: "canary-rule",
      description: "canary",
      given: "$",
      then: { function: "truthy" },
      severity: "warn",
      meta: {
        bridgeApi: "1.x",
        category: "tokens",
        surface: ["skill-overlay"],
        appliesTo: ["card"],
        status: "canary",
        rationale: "r-canary",
        example: "e",
        since: "1.0.0",
      },
    },
  } as never;

  const xml = renderSkillOverlay({ rules, request: { archetype: "card" } });
  assert.match(xml, /\[active-rule\]/);
  assert.doesNotMatch(xml, /\[deprecated-rule\]/);
  assert.doesNotMatch(xml, /deprecated-rule/);
  assert.match(xml, /\[CANARY canary-rule\]/);
});
