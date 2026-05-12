# Bridge Migration Guide

Breaking changes across major versions. Most recent at the bottom.

## v5 → v6

Bridge v6.0.0 is a deliberate cleanup release. The headline change: **the docs subsystem has been removed entirely**.

### Why

The docs subsystem (`bridge-ds docs build/sync/check/mcp`) produced empty boilerplate in practice. CSpecs — the user-authored content the docs were supposed to render — were never wired into the doc generator (`generate.ts` always passed `docs: {}`). The promise of "auto-maintained docs" was unfulfilled. Rather than wire CSpecs into a system nobody was using, we removed the system. See `docs/v6-cleanup-audit.md` for the full reasoning.

### What you need to do

#### If you used `bridge-ds docs build` (or sync/check/mcp)

These commands no longer exist. Two paths:

- **Delete** the `design-system/` directory in your repo. It was an empty boilerplate forest.
- **Use a real docs platform** (Storybook, ZeroHeight, your-own-static-site) for hosted DS docs.

#### If your cron worked off the docs subsystem

Re-run `setup bridge` in Claude Code. It will scaffold the new KB-only workflow that uses `npx -y @noemuch/bridge-ds@6.0.0 cron --config docs.config.yaml`. The new cron extracts KB, persists registries, and opens PRs with the diff.

#### If you had `generating-ds-docs` slash commands

Removed. Your skill autocomplete is now 5 skills instead of 6.

#### If you had `KBSchemaError` in your code

Still works — `assertKBCompatible` is the only export. It now throws plain `Error` instead of `KBSchemaError`, with the same actionable messages.

### What you DON'T need to do

- Your shipped CSpecs in `specs/shipped/` are untouched.
- Your recipes in `knowledge-base/recipes/` are untouched.
- Your `learnings.json` is untouched.
- Your `make` / `fix` / `done` workflow is unchanged.

### Upgrade command

```bash
/plugin update bridge-ds   # in Claude Code
```

Or for npm direct consumers:

```bash
npm install @noemuch/bridge-ds@6.0.0
```

Then in your DS repo:

```bash
bridge-ds doctor   # confirms KB still valid
```

If the doctor flags issues, follow its hints.

## v6 → v7

Bridge v7.0.0 introduces the DS rules engine. **It is opt-in** — existing consumers experience no breakage. To enable:

1. Create `bridge-ds/lint/config.yaml` at your repo root:

   ```yaml
   extends: [bridge:recommended]
   ```

2. Run `npx -y @noemuch/bridge-ds@7 lint --coverage` to see your baseline.

3. Add `.github/workflows/bridge-lint.yml` (template lands as a separate consumer scaffold task).

4. (Optional) Author custom rules in `bridge-ds/lint/rulesets/*.yaml` and custom TS functions in `bridge-ds/lint/functions/*.ts`. The TS function API lives in `@noemuch/bridge-ds-rule-api` (peer-installed automatically when you use the lint command).

### Built-in rules referencing custom functions

10 of the 18 universal rules reference custom functions (`token-exists-in-kb`, `text-is-english`, etc.). v7.0.0 ships **stubs** for these — the rules load successfully but fire no diagnostics until real implementations land in a future release. Consumers can:

- Wait for upstream implementations (planned for v7.1+).
- Write their own implementations and reference them via `functionsDir` in their config.
- Set `severity: off` on these rules in their config to silence stub warnings.

### What's not breaking

- The compiler runs exactly as v6 when no `lintConfigPath` is provided. Both `compile(options)` (legacy sync) and `compile(spec, opts)` (new async with lint) work.
- Skills render `SKILL.md` verbatim when `{{ACTIVE_RULES}}` is not present (or when no config exists — placeholder is replaced with empty string).
- The cron continues to work as in 6.2.x — no changes to KB-sync semantics.

### What's deprecated

Nothing in v7. Rules with `status: deprecated` in their meta are flagged but supported; full removal is a v8 concern.
