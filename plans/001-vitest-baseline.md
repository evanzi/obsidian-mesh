# Plan 001: Establish a vitest test baseline with ContactMapper coverage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f988f43..HEAD -- src/contact-mapper.ts package.json tsconfig.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — additive only; no production code changes.
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `f988f43`, 2026-07-14

## Why this matters

The repo has zero tests and no way to verify a change beyond `npm run build`
(typecheck + bundle). Plans 002–006 fix real bugs and each needs a regression
test. This plan sets up vitest and covers the existing pure logic in
`ContactMapper`, so later plans have a pattern to follow and a safety net for
the sync-critical mapping code.

## Current state

- `src/contact-mapper.ts` — pure static class `ContactMapper` with
  `mapContactDetail()`, `getFileNameFromDetail()`, `isRealContact()`,
  `isEnrichedField()`. No Obsidian API imports — only types from
  `./mesh-api` and `./settings`. Fully unit-testable as-is.
- `package.json` — scripts are only `dev` and `build`
  (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`).
- No test framework, no lint, no CI.
- The `obsidian` npm package is **type declarations only** — it has no runtime
  code. Any module importing from `"obsidian"` cannot be imported in a plain
  vitest run without a mock. `contact-mapper.ts` does NOT import it (it uses
  `import type` only from local modules), so no mock is needed for this plan.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `npm install`            | exit 0              |
| Typecheck + bundle | `npm run build` | exit 0, writes `main.js` |
| Tests (after this plan) | `npm test` | all pass |

## Scope

**In scope** (the only files you should modify/create):
- `package.json` (add vitest devDependency + `test` script)
- `package-lock.json` (via npm install)
- `vitest.config.ts` (create)
- `src/contact-mapper.test.ts` (create)

**Out of scope**:
- `src/contact-mapper.ts` itself — no production changes in this plan.
- Any CI workflow files — deferred (see plans/README.md).
- Mocking the `obsidian` module — not needed here; later plans handle it.

## Git workflow

- Branch: work on the current branch unless the operator says otherwise.
- Commit message style: short imperative, matching `git log`
  (e.g. "Add vitest baseline with ContactMapper tests").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add vitest

`npm install --save-dev vitest`. Add to `package.json` scripts:
`"test": "vitest run"`. Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

**Verify**: `npx vitest run` → exits 0 with "no test files found" or similar
(no failures).

### Step 2: Write `src/contact-mapper.test.ts`

Cover at minimum:

- `isRealContact`: rejects empty name, `.`, names containing `@`,
  pure-phone-number names (`"+1 (555) 123-4567"`); accepts a normal
  first+last contact.
- `getFileNameFromDetail`: `format: "full"` returns normalized fullName;
  `"lastFirst"` returns `"Last, First"`; falls back through displayName →
  email → `Mesh Contact {id}` when names are missing or `"."`.
- `mapContactDetail`: builds `Mesh ID` / `Mesh URL`; picks first email/phone
  from `information[]`; social handle fallback builds
  `https://github.com/<handle>` from a bare handle; score → Relationship
  Strength buckets (>=70 Strong, >=40 Medium, else Weak, 0 omitted);
  birthday `{month: 5, day: 7, year: null}` → `"0000-05-07"`; bio newlines
  collapsed to single spaces; current org = first entry with no `end`.
- `isEnrichedField`: true for `"Company"`, false for `"Email (Private)"`.

Construct minimal `MeshContactDetail` fixtures with a helper that fills
required fields with empty defaults and spreads overrides. Settings fixture:
import `DEFAULT_SETTINGS` from `./settings` — check first that `settings.ts`
imports `obsidian` at module top (it does: `App, PluginSettingTab, Setting`).
Since the obsidian package has no runtime, importing `./settings` will fail
at runtime under vitest. Instead, define a local settings fixture object in
the test file typed as `MeshSettings` via `import type { MeshSettings } from
"./settings"` (type-only imports are erased and safe).

**Verify**: `npm test` → all tests pass (expect ~12+ assertions across the
cases above).

## Test plan

This plan IS the test plan. Structural pattern for future tests: this file.

## Done criteria

- [ ] `npm test` exits 0 with all tests passing
- [ ] `npm run build` still exits 0
- [ ] `src/contact-mapper.ts` unmodified (`git diff --stat` shows no changes to it)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `import type { MeshSettings }` still causes a runtime error under vitest
  (would mean settings.ts is being loaded at runtime — report, don't work
  around by editing settings.ts).
- Any test reveals `ContactMapper` behavior that contradicts the expectations
  above (e.g. birthday formatting differs) — that's a real-behavior
  discovery; write the test to match the CURRENT behavior, and note the
  discrepancy in your report.

## Maintenance notes

- Later plans (002–006) add tests here; keep pure logic importable without
  the `obsidian` module wherever possible.
- When a module under test must import `"obsidian"`, add a vitest alias mock
  (`resolve.alias` pointing to a local stub) — decide that in the plan that
  needs it, not preemptively.
