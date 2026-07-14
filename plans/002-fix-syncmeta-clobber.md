# Plan 002: Stop saveSettings from clobbering sync metadata in data.json

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f988f43..HEAD -- src/main.ts src/sync-engine.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — small, localized change to load/save; migration is a no-op
  for well-formed data.
- **Depends on**: plans/001-vitest-baseline.md (for the regression test)
- **Category**: bug
- **Planned at**: commit `f988f43`, 2026-07-14

## Why this matters

The plugin stores both user settings and sync metadata (`syncMeta`) in the
same `data.json` via Obsidian's `loadData()`/`saveData()`. `loadSettings()`
merges the ENTIRE file — including `syncMeta` — into `this.settings`, and
`saveSettings()` writes `this.settings` back wholesale. Sequence that loses
data: plugin loads (settings holds syncMeta snapshot v1) → a sync completes
and writes syncMeta v2 to disk → the user toggles any setting →
`saveSettings()` writes the stale v1 back, silently reverting the sync
metadata. `syncMeta` is the three-way-merge base that distinguishes "user
manually edited this field" from "unchanged since last sync" — corrupting it
causes wrongful overwrites of manual edits (when conflict resolution is
"mesh") or spurious re-updates. This is a silent data-integrity bug in the
plugin's core safety mechanism.

## Current state

- `src/main.ts:151-157` — the bug:

```ts
async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}

async saveSettings() {
    await this.saveData(this.settings);
}
```

- `src/sync-engine.ts:494-503` — syncMeta read/write (correct on its own):

```ts
private async loadSyncMetadata(): Promise<SyncMetadata> {
    const data = await this.plugin.loadData();
    return data?.syncMeta || { lastSync: "", contacts: {} };
}

private async saveSyncMetadata(meta: SyncMetadata): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.syncMeta = meta;
    await this.plugin.saveData(data);
}
```

- `src/settings.ts:4-30` — `MeshSettings` interface and `DEFAULT_SETTINGS`
  (11 keys: peopleFolder, autoSync, syncInterval, fileNameFormat,
  conflictResolution, updateOnly, dryRun, syncSocialProfiles,
  syncRelationshipData, syncTagsAndGroups, syncPhotos).
- Existing user data.json files in the wild contain settings keys AND a
  `syncMeta` key at the top level. The fix must keep reading those.

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Install   | `npm install`   | exit 0              |
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/main.ts` (loadSettings/saveSettings)
- `src/plugin-data.ts` (create — pure helpers)
- `src/plugin-data.test.ts` (create)

**Out of scope**:
- `src/sync-engine.ts` `loadSyncMetadata`/`saveSyncMetadata` — they already
  read-modify-write correctly; leave them.
- Restructuring data.json into `{settings: {...}, syncMeta: {...}}` — a
  cleaner shape, but requires a migration; explicitly deferred (see
  Maintenance notes).

## Git workflow

- Commit message style: short imperative (e.g. "Fix saveSettings clobbering
  sync metadata").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create pure helpers in `src/plugin-data.ts`

```ts
import type { MeshSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";  // STOP — see note below
```

NOTE: `settings.ts` imports the `obsidian` module at runtime, so importing
`DEFAULT_SETTINGS` from it would break vitest (obsidian has no runtime).
Instead: move `MeshSettings` and `DEFAULT_SETTINGS` OUT of `settings.ts`
into `plugin-data.ts`, and have `settings.ts` re-export them
(`export { DEFAULT_SETTINGS } from "./plugin-data"; export type { MeshSettings } ...`)
so existing imports in `main.ts` keep working unchanged.

Then add two pure functions:

```ts
/** Extract only settings keys from a raw data.json object. */
export function settingsFromData(data: unknown): MeshSettings {
    const raw = (data ?? {}) as Record<string, unknown>;
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof MeshSettings)[]) {
        if (raw[key] !== undefined) (settings as Record<string, unknown>)[key] = raw[key];
    }
    return settings;
}

/** Merge settings into a raw data.json object, preserving all other keys (syncMeta). */
export function dataWithSettings(data: unknown, settings: MeshSettings): Record<string, unknown> {
    return { ...((data ?? {}) as Record<string, unknown>), ...settings };
}
```

**Verify**: `npm run build` → exit 0.

### Step 2: Use the helpers in `src/main.ts`

```ts
async loadSettings() {
    this.settings = settingsFromData(await this.loadData());
}

async saveSettings() {
    const data = dataWithSettings(await this.loadData(), this.settings);
    await this.saveData(data);
}
```

Import `settingsFromData`, `dataWithSettings` from `./plugin-data`.

**Verify**: `npm run build` → exit 0.

### Step 3: Regression tests in `src/plugin-data.test.ts`

- `settingsFromData({peopleFolder: "X", syncMeta: {...}})` → returns settings
  with `peopleFolder: "X"`, all other defaults, and NO `syncMeta` key
  (`expect("syncMeta" in result).toBe(false)`).
- `settingsFromData(null)` → equals `DEFAULT_SETTINGS`.
- `dataWithSettings({syncMeta: {lastSync: "T", contacts: {"1": {}}}}, settings)`
  → result preserves `syncMeta` unchanged and contains all settings keys.
- Round-trip regression: simulate the bug sequence — `load` old data, disk
  gains new syncMeta, then `dataWithSettings(freshDiskData, settings)` keeps
  the NEW syncMeta.

**Verify**: `npm test` → all pass.

## Test plan

See Step 3. Model structure after `src/contact-mapper.test.ts` (from plan 001).

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0, including the 4 new plugin-data tests
- [ ] `grep -n "Object.assign({}, DEFAULT_SETTINGS, await this.loadData())" src/main.ts` returns no matches
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `main.ts` no longer matches the excerpt (drifted).
- Moving `DEFAULT_SETTINGS` out of `settings.ts` breaks other importers you
  can't fix by re-exporting.
- You find additional top-level keys in data.json handling beyond settings
  keys and `syncMeta` — report what they are before deciding they're safe.

## Maintenance notes

- Deferred: restructure data.json to `{settings, syncMeta}` with a one-time
  migration. Do it if a third category of persisted state ever appears.
- Reviewer should scrutinize: that `saveSettings` now does a read-modify-write
  (same pattern as `saveSyncMetadata`), and that no `syncMeta` key can leak
  into `this.settings`.
