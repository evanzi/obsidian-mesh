# Plan 006: Make dry run report exactly what a real sync would do

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f988f43..HEAD -- src/sync-engine.ts`
> If the file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — refactors the field-update decision logic that real syncs
  depend on. Mitigated by extracting it as a pure function with tests before
  swapping callers.
- **Depends on**: plans/001-vitest-baseline.md, plans/002-fix-syncmeta-clobber.md
  (both touch adjacent code; land them first)
- **Category**: bug
- **Planned at**: commit `f988f43`, 2026-07-14

## Why this matters

Dry run is the safety feature the README tells users to trust before letting
the plugin touch their real People folder — but it does not simulate the real
sync. Two divergences:

1. `sync()` loads an EMPTY syncMeta in dry-run mode
   (`sync-engine.ts:62`: `isDryRun ? { lastSync: "", contacts: {} } : ...`),
   so the three-way merge base is missing.
2. `logDryRunUpdate()` uses its own simplified logic: it reports `~ key:
   current → new` for any direct-field difference, ignoring both the
   `lastSynced` check and the `conflictResolution` setting. A real sync with
   "Obsidian wins" (the default) would NOT overwrite a manually edited
   field; dry run says it would.

So dry run over-reports changes, which either scares users off or — worse —
teaches them dry-run output can't be trusted. The fix: extract the real
per-field decision logic into one pure function and drive both the real
update and the dry-run report from it.

## Current state

- `src/sync-engine.ts:62` — dry run skips loading syncMeta:

```ts
const syncMeta = isDryRun ? { lastSync: "", contacts: {} } : await this.loadSyncMetadata();
```

- `src/sync-engine.ts:300-396` — `updateFile(file, mapped, syncMeta)`: the
  real logic, inside a `processFrontMatter` callback. Per field: skip
  metadata keys (`Mesh Last Synced`, `Mesh URL`, `Mesh ID`); enriched fields
  → fill-if-empty, else write `"{key} (Me.sh)"` parallel field when
  different; direct fields → fill-if-empty, update if current equals
  lastSynced, else apply `conflictResolution` ("mesh" overwrites, "ask"
  logs, "obsidian" keeps). Plus: `Source: "Google Contacts"` → `"Mesh"`, and
  metadata fields written only when something changed (or Mesh ID missing).
- `src/sync-engine.ts:401-431` — `logDryRunUpdate(file, mapped, syncMeta)`:
  the divergent simplified copy (never consults `lastSynced` or
  `conflictResolution` despite receiving `syncMeta`).
- `ContactMapper.isEnrichedField(key)` — `src/contact-mapper.ts:54-56`.
- Settings relevant here: `conflictResolution: "obsidian" | "mesh" | "ask"`
  (`src/settings.ts:9`, default `"obsidian"`).

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/sync-engine.ts` (line 62; `updateFile`; `logDryRunUpdate`)
- `src/field-merge.ts` (create — the pure decision function)
- `src/field-merge.test.ts` (create)

**Out of scope**:
- `createFile` path and its dry-run branch ("[dry-run] Would create") —
  already accurate.
- Changing any merge SEMANTICS — this is a refactor + dry-run fidelity fix;
  real sync behavior must be byte-identical.

## Git workflow

- Commit message style: short imperative (e.g. "Drive dry run from real
  merge logic").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the pure decision function into `src/field-merge.ts`

No obsidian imports. Suggested shape:

```ts
export type FieldAction =
    | { kind: "fill"; key: string; value: unknown }              // empty → fill
    | { kind: "update"; key: string; value: unknown }            // unchanged since last sync, or mesh-wins
    | { kind: "parallel"; key: string; meshKey: string; value: unknown } // enriched conflict
    | { kind: "conflict"; key: string; current: unknown; incoming: unknown }; // ask-mode log

export function computeFieldActions(
    current: Record<string, unknown>,       // existing frontmatter values
    mapped: Record<string, unknown>,        // incoming mesh values
    lastSynced: Record<string, unknown>,    // three-way base
    conflictResolution: "obsidian" | "mesh" | "ask",
    isEnrichedField: (key: string) => boolean
): FieldAction[]
```

Port the per-field logic from `updateFile` EXACTLY (same JSON.stringify
equality, same skip list for the three metadata keys, same
"only update (Me.sh) parallel field when its value changed" rule). Do not
port the `Source: Google Contacts` migration or the metadata-field writes —
those stay in `updateFile`.

**Verify**: `npm run build` → exit 0.

### Step 2: Tests for `computeFieldActions` in `src/field-merge.test.ts`

Cases (direct field unless noted):
- empty current → `fill`.
- current === lastSynced, mesh differs → `update`.
- current !== lastSynced (manual edit), resolution "obsidian" → no action.
- same, resolution "mesh" → `update`; resolution "ask" → `conflict`.
- enriched: empty → `fill`; equal → nothing; different and `(Me.sh)` absent
  → `parallel`; different and `(Me.sh)` already equals incoming → nothing.
- metadata keys (`Mesh ID` etc.) never produce actions.
- undefined incoming values skipped.

**Verify**: `npm test` → all pass.

### Step 3: Rewire `updateFile` to consume the actions

Inside the `processFrontMatter` callback: call `computeFieldActions`, apply
each action to `fm` (`fill`/`update` → `fm[key] = value`; `parallel` →
`fm[meshKey] = value`; `conflict` → the existing log line), set
`updated = true` for fill/update/parallel. Keep the Google Contacts
migration and metadata-write logic as-is after the loop.

**Verify**: `npm run build` → exit 0. Behavior parity check: re-read the old
logic vs. new; every branch must map to an action case.

### Step 4: Rewire dry run

1. Line 62: always load real metadata:
   `const syncMeta = await this.loadSyncMetadata();` (loading is read-only;
   the existing `if (!isDryRun)` guards around SAVING remain untouched —
   verify they do).
2. Rewrite `logDryRunUpdate` to call `computeFieldActions` with the file's
   cached frontmatter and print one line per action:
   `+ key: value` (fill), `~ key: current → value` (update),
   `≠ key: keeping current | would add "key (Me.sh)": value` (parallel),
   `! key: conflict (obsidian wins — no change)` (conflict). Also count and
   report files with zero actions as skipped rather than `updated++` — in
   `sync()` line 87-90, only increment `result.updated` when the action list
   is non-empty (mirroring the real path's `updated`/`skipped` split).

**Verify**: `npm run build` → exit 0; `npm test` → all pass.

## Test plan

Step 2 covers the decision core. The thin `updateFile`/`logDryRunUpdate`
wrappers are exercised manually: run a dry-run sync against a test folder
and confirm a manually-edited direct field with default settings is NOT
reported as `~` changed (report this as remaining manual verification if no
Obsidian runtime is available).

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0 including field-merge tests (≥9 cases)
- [ ] `grep -n "isDryRun ? { lastSync" src/sync-engine.ts` → no matches
- [ ] `logDryRunUpdate` calls `computeFieldActions` (read to confirm)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `updateFile` or `logDryRunUpdate` no longer match the excerpts (drifted —
  especially if plan 002 landed with unexpected changes here).
- Any real-sync behavior change is required to make the extraction work —
  the refactor must be behavior-preserving for the write path.
- The dry-run `updated++` restructure in `sync()` requires touching the
  create path.

## Maintenance notes

- `computeFieldActions` is now the single source of merge truth; future
  field-handling changes go there, with a test per new branch.
- Reviewer should scrutinize behavior parity in Step 3 — diff old branches
  against action cases one by one.
