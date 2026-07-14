# Plan 008: Persist sync conflicts and add a viewer (settings button + modal)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ad05fe2..HEAD -- src/field-merge.ts src/sync-engine.ts src/settings.ts src/main.ts`
> Plan 007 (notes sync) lands before this plan and touches settings.ts /
> plugin-data.ts / contact-mapper.ts / frontmatter.ts — those diffs are
> EXPECTED, not drift. Drift = the "Current state" excerpts below no longer
> matching the live code.

## Status

- **Priority**: P2 (feature)
- **Effort**: M
- **Risk**: MED — extends the pure merge function's contract (one new action
  emission) and threads a collector through updateFile. Mitigated by tests
  on the pure function and an explicitly specified updateFile behavior table.
- **Depends on**: plans/006-accurate-dry-run.md (DONE), plans/007-mesh-notes-sync.md
- **Category**: direction / feature
- **Planned at**: commit `ad05fe2`, 2026-07-14

## Why this matters

Conflicts are currently invisible: with the default "Obsidian wins"
resolution a manual edit silently blocks Mesh updates forever, "Ask" mode
only writes a console line, and enriched conflicts write a parallel
"(Me.sh)" field the user has to stumble on. The maintainer wants a
standard-Obsidian-UX way to SEE what conflicted: sync persists the last
run's conflicts, and a settings button (plus command palette entry) opens a
modal listing them, with links to the affected notes. View-only in v1 —
no resolve buttons.

## Current state

- `src/field-merge.ts` (all 93 lines; read it fully) — pure
  `computeFieldActions(current, mapped, lastSynced, conflictResolution,
  isEnrichedField): FieldAction[]`. Key excerpt — the direct-field
  manual-edit branch:

```ts
// Manually edited -> apply conflict resolution
if (conflictResolution === "mesh") {
    actions.push({ kind: "update", key, value: newValue });
} else if (conflictResolution === "ask") {
    actions.push({ kind: "conflict", key, current: currentValue, incoming: newValue });
}
// conflictResolution === "obsidian" -> no action
```

- `src/sync-engine.ts:263-330` — `updateFile(file, mapped, syncMeta)` calls
  `computeFieldActions` inside `processFrontMatter` and applies actions in a
  switch: `fill`/`update` → write + `updated = true`; `parallel` → write
  meshKey + `updated = true` + `[enriched conflict]` log; `conflict` →
  `[conflict]` log only. Google-Contacts migration and metadata writes
  follow the loop.
- `src/sync-engine.ts:31-45` — `sync()` builds a `SyncResult` `{created,
  updated, skipped, filtered, unmatched, errors}` and (line 119) calls
  `updateFile`. Line 158-159: on non-dry-run, `syncMeta.lastSync` is
  stamped and `saveSyncMetadata(syncMeta)` persists via read-modify-write:

```ts
private async saveSyncMetadata(meta: SyncMetadata): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.syncMeta = meta;
    await this.plugin.saveData(data);
}
```

- `src/plugin-data.ts` — `settingsFromData` extracts ONLY known settings
  keys, and `dataWithSettings` spreads settings over the raw data object —
  so any extra top-level key in data.json (like the new `lastConflicts`)
  survives settings saves automatically. No changes needed there.
- `src/main.ts` — commands registered in `onload()` via `this.addCommand`;
  see the existing `sync-now` and `open-in-mesh` commands as patterns.
- `src/settings.ts` — `MeshSettingTab.display()`; Settings are built with
  `new Setting(containerEl).setName(...).setDesc(...).addToggle/addDropdown`.
  Use `.addButton((btn) => btn.setButtonText("View").onClick(...))` for the
  viewer button.
- Obsidian API available from the `obsidian` module: `Modal` (subclass with
  `onOpen`/`onClose`, `this.contentEl`), `App`. Opening a note:
  `this.app.workspace.openLinkText(filePath, "", false)`.
- Tests: 5 test files, all green. `src/field-merge.test.ts` covers the pure
  function — you will UPDATE one pinned expectation (see Step 1).
- The `obsidian` npm package is types-only; a vitest alias stub exists at
  `src/__mocks__/obsidian.ts` (40 lines). The modal itself is NOT unit
  tested (runtime UI); the pure logic is.

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/field-merge.ts` + `src/field-merge.test.ts` (obsidian-mode conflict
  emission)
- `src/sync-engine.ts` (collect + persist conflicts)
- `src/conflicts-modal.ts` (create)
- `src/settings.ts` (button)
- `src/main.ts` (command)
- `README.md` (mention the viewer under Settings/Data Handling)

**Out of scope**:
- Resolve/apply buttons in the modal (explicitly deferred to v2).
- Dry-run conflict persistence (dry run writes nothing, including this).
- Any change to which fields WIN — this feature only records and displays.

## Git workflow

- Commit message: short imperative (e.g. "Persist sync conflicts and add
  viewer modal"); end with a line containing exactly: @evanzi
- Do NOT push.

## Steps

### Step 1: Emit conflict actions in "obsidian" mode too

In `src/field-merge.ts`, change the manual-edit branch so BOTH
non-overwriting modes emit the conflict action:

```ts
// Manually edited -> apply conflict resolution
if (conflictResolution === "mesh") {
    actions.push({ kind: "update", key, value: newValue });
} else {
    // "obsidian" and "ask": keep the user's value, surface the conflict
    actions.push({ kind: "conflict", key, current: currentValue, incoming: newValue });
}
```

This is a DELIBERATE contract change (approved): `conflict` now means "user
value kept, mesh differs" in both modes. Update the doc comment. In
`src/field-merge.test.ts`, the obsidian-mode case currently pins `[]` —
change it to pin the conflict action.

CRITICAL preservation in `src/sync-engine.ts` `updateFile`: the `conflict`
case must (a) still NOT set `updated`, and (b) only emit the `[conflict]`
console log when `this.plugin.settings.conflictResolution === "ask"`
(preserving the old silent behavior in obsidian mode). Same rule in
`logDryRunUpdate`: print the `!` line only in ask mode; in obsidian mode
print nothing for conflicts (dry run mirrors the real path's silence) —
BUT still return the action in the returned array only for ask mode…
simpler equivalent: in `logDryRunUpdate`, filter obsidian-mode conflict
actions out of the "counts as a change" set the same way the real path
does (they never counted as updates in either mode — `updated++` semantics
must not change: conflict actions alone must not make dry run count a file
as updated, since the real path wouldn't). Concretely: a file whose ONLY
actions are conflicts counts as skipped in dry run, matching real behavior
(updateFile returns false unless first-sync metadata stamping applies).

**Verify**: `npm test` → field-merge tests pass with the updated pin;
`npm run build` → exit 0.

### Step 2: Collect and persist conflicts in sync()

In `src/sync-engine.ts`:

1. Types:

```ts
export interface SyncConflict {
    file: string;        // vault path of the note
    field: string;
    kept: unknown;       // the value that stayed in the note
    mesh: unknown;       // the differing me.sh value
    type: "direct" | "enriched";
    resolution: "obsidian" | "ask";  // direct only; enriched entries use "obsidian"
}

interface ConflictLog {
    timestamp: string;   // ISO, when the sync ran
    conflicts: SyncConflict[];
}
```

2. `updateFile` gains a parameter `collector: SyncConflict[]`. In the action
   loop: `conflict` actions push
   `{file: file.path, field: action.key, kept: action.current, mesh: action.incoming, type: "direct", resolution: this.plugin.settings.conflictResolution as "obsidian" | "ask"}`;
   `parallel` actions ALSO push
   `{file: file.path, field: action.key, kept: <current fm[action.key] read before the write>, mesh: action.value, type: "enriched", resolution: "obsidian"}`
   (the parallel case already reads `currentValue` for its log — reuse it).
3. `sync()` creates `const conflicts: SyncConflict[] = []` before the loop,
   passes it to every `updateFile` call, and after the loop (inside the
   existing `if (!isDryRun)` block that saves metadata) persists:

```ts
await this.saveConflictLog({ timestamp: new Date().toISOString(), conflicts });
```

4. Add, mirroring `saveSyncMetadata`:

```ts
private async saveConflictLog(log: ConflictLog): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data.lastConflicts = log;
    await this.plugin.saveData(data);
}

async loadConflictLog(): Promise<ConflictLog | null> {
    const data = await this.plugin.loadData();
    return data?.lastConflicts || null;
}
```

(`loadConflictLog` is public — the modal and settings tab call it.)

5. Add `conflicts: number` to `SyncResult` (count of collected conflicts);
   in `main.ts` `runSync`, append `` `${result.conflicts} conflicts` `` to
   the notice parts when > 0.

Persist an EMPTY log too (a clean sync clears stale conflicts) — that's why
step 3 saves unconditionally on non-dry-run.

**Verify**: `npm run build` → exit 0; `npm test` → all pass.

### Step 3: The modal

Create `src/conflicts-modal.ts`:

```ts
import { App, Modal } from "obsidian";
import type MeshPlugin from "./main";
import type { SyncConflict } from "./sync-engine";
```

`export class ConflictsModal extends Modal` taking `(app: App, plugin: MeshPlugin)`.
`onOpen()`:
- `const log = await this.plugin.syncEngine.loadConflictLog();`
- Title: "Me.sh sync conflicts".
- Empty state (no log or zero conflicts): a paragraph "No conflicts in the
  last sync." (+ last-sync timestamp when a log exists).
- Otherwise: timestamp line, then group conflicts by `file`. Per file: the
  note name as a clickable element (`createEl("a", ...)` or a heading with
  `cursor: pointer`) that calls
  `this.app.workspace.openLinkText(conflict.file, "", false); this.close();`
  Per conflict under it, one row: field name in bold, then
  `kept: <kept> · me.sh: <mesh>` and a muted annotation:
  type enriched → "kept yours; wrote parallel (Me.sh) field",
  direct+obsidian → "kept yours (Obsidian wins)",
  direct+ask → "unresolved (Ask mode)".
- Render values with `String(...)`; truncate display at ~120 chars with "…".
- Use plain `createEl`/`createDiv` DOM helpers (standard Obsidian modal
  style); no innerHTML with interpolated values (conflict values are
  contact-derived — treat as untrusted; createEl text assignment is safe).

`onClose()`: `this.contentEl.empty();`

**Verify**: `npm run build` → exit 0.

### Step 4: Entry points

- `src/settings.ts`: in `display()`, after the "Conflict resolution"
  dropdown, add:

```ts
new Setting(containerEl)
    .setName("Sync conflicts")
    .setDesc("Review conflicts from the last sync")
    .addButton((btn) =>
        btn.setButtonText("View conflicts").onClick(() => {
            new ConflictsModal(this.app, this.plugin).open();
        })
    );
```

- `src/main.ts`: register a command `id: "view-conflicts"`,
  `name: "View last sync conflicts"`, callback opens the modal.

**Verify**: `npm run build` → exit 0; `npm test` → all pass.

### Step 5: README

Add a short "Sync conflicts" paragraph under Data Handling: conflicts from
the last sync are viewable via the settings button or the "View last sync
conflicts" command; the log lives in the plugin's data.json and is replaced
each sync.

## Test plan

- `src/field-merge.test.ts`: obsidian-mode manual edit now yields the
  conflict action (updated pin); ask-mode unchanged; mesh-mode unchanged.
- New pure tests are NOT required for the collector/persistence (they're
  thin I/O around loadData/saveData, mirroring the accepted saveSyncMetadata
  pattern), but if `src/sync-engine.test.ts`'s existing stub setup makes a
  collector test cheap (<20 lines), add one: updateFile pushes a direct
  conflict and an enriched conflict with the right shapes.
- Manual verification (report as remaining if no Obsidian runtime): settings
  button opens modal; empty state renders; a conflicting contact shows
  grouped rows; note link opens the file.

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0 (field-merge pin updated; no other test regressions)
- [ ] `grep -n "lastConflicts" src/sync-engine.ts` → save + load present
- [ ] `grep -n "ConflictsModal" src/settings.ts src/main.ts` → both entry
      points wired
- [ ] Conflict actions still never set `updated` in updateFile; `[conflict]`
      console log still ask-mode-only (read the switch to confirm)
- [ ] No files outside the in-scope list modified (`git status`; untracked
      `.superpowers/` is expected)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The field-merge excerpt or updateFile action switch doesn't match the
  live code (drift beyond plan 007's expected files).
- Preserving "conflict actions don't count as updates" in dry-run counting
  turns out to require changing the real path's `updated` semantics — the
  real path must not change; report instead.
- The modal needs more than ~150 lines — report scope growth before
  continuing.

## Maintenance notes

- v2 candidates (deferred): resolve buttons (take Mesh / keep mine) acting
  via processFrontMatter; showing dry-run conflicts without persisting.
- The conflict log is one-sync-deep by design; if history is ever wanted,
  key by timestamp instead of replacing `lastConflicts`.
- Reviewer should scrutinize: the ask-mode-only console log preservation,
  dry-run counting parity, and that a clean sync clears stale conflicts.
