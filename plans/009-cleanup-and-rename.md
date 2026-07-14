# Plan 009: Guideline cleanup + manifest rename to mesh-sync

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ad05fe2..HEAD -- manifest.json versions.json package.json src/mesh-api.ts src/main.ts src/settings.ts README.md`
> Plans 007/008 land first and touch settings.ts, main.ts, README.md — those
> diffs are EXPECTED. Drift = the specific excerpts below no longer existing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED — the id rename breaks install-folder continuity for
  existing installs (accepted by the maintainer; migration note goes in the
  README). Everything else is mechanical.
- **Depends on**: plans/007-mesh-notes-sync.md, plans/008-sync-conflicts-viewer.md
  (ordering only — they touch the same files; run this LAST before final review)
- **Category**: dx / community-plugin readiness
- **Planned at**: commit `ad05fe2`, 2026-07-14

## Why this matters

The maintainer plans to share this plugin with the Mesh team and possibly
submit it to Obsidian Community Plugins. The community review rejects ids
containing "obsidian" and names containing "Obsidian", and flags settings
tabs that use raw `<h2>/<h3>` headings instead of `setHeading()`. Plus small
hygiene: a moderate esbuild dev-server advisory (GHSA-67mh-4wv8-2f99, fixed
in 0.25), an unencoded frontmatter value interpolated into a URL, and two
dead API methods.

## Current state

- `manifest.json` — `"id": "obsidian-mesh"`, `"name": "Me.sh Sync for
  Obsidian"`, `"version": "0.1.0"`. `versions.json` — `{"0.1.0": "1.5.0"}`.
  `package.json` — `"name": "obsidian-mesh"`, `"version": "0.1.0"`,
  `"esbuild": "^0.24.0"` in devDependencies.
- `src/settings.ts` `display()` — `containerEl.createEl("h2", { text:
  "Me.sh Sync for Obsidian" })` at the top; `createEl("h3", { text: "Sync
  Behavior" })` and `createEl("h3", { text: "Data Options" })` section
  headings. (Plans 007/008 may have added settings but not changed these.)
- `src/main.ts` — the `open-in-mesh` command:
  `window.open(`https://app.me.sh/contact/${fm["Mesh ID"]}`)` — `fm["Mesh
  ID"]` comes from note frontmatter (untrusted-ish).
- `src/mesh-api.ts` — `getContactNotes(id)` (~line 201) and `getSelf()`
  (~line 218) have no callers anywhere in src/ (verify with grep before
  deleting; plan 007 deliberately did NOT wire getContactNotes — notes come
  from detail.notes).
- `README.md` — Installation says copy to `.obsidian/plugins/obsidian-mesh/`.

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Install   | `npm install`   | exit 0, lockfile updated |
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |
| Audit     | `npm audit`     | 0 vulnerabilities   |

## Scope

**In scope**: `manifest.json`, `versions.json`, `package.json`,
`package-lock.json`, `src/settings.ts` (headings only), `src/main.ts`
(encodeURIComponent only), `src/mesh-api.ts` (deletions only), `README.md`.

**Out of scope**:
- Renaming source symbols/classes (MeshPlugin etc.) — id/name are external
  metadata; code names are fine.
- Command ids/names — Obsidian prefixes command names with the plugin name
  at display time; existing names are acceptable.
- Any sync/merge logic.

## Git workflow

- Commit message: short imperative (e.g. "Rename to mesh-sync, settings
  headings, hygiene fixes"); end with a line containing exactly: @evanzi
- Do NOT push.

## Steps

### Step 1: Manifest + versions + package rename and version bump

- `manifest.json`: `id` → `"mesh-sync"`; `name` → `"Me.sh Sync"`;
  `version` → `"0.2.0"` (this run adds features: notes sync, conflicts
  viewer). Leave description/author/authorUrl/minAppVersion/isDesktopOnly.
- `versions.json`: replace content with `{"0.2.0": "1.5.0"}` — wait: KEEP
  the existing `"0.1.0": "1.5.0"` entry and ADD `"0.2.0": "1.5.0"` (the file
  maps each release to its minimum app version; history is kept).
- `package.json`: `name` → `"mesh-sync"`, `version` → `"0.2.0"`.

**Verify**: `npm run build` → exit 0.

### Step 2: esbuild bump

- `package.json`: `"esbuild": "^0.25.0"`. Run `npm install`.

**Verify**: `npm run build` → exit 0; `npm test` → all pass;
`npm audit` → 0 vulnerabilities.

### Step 3: Settings headings

In `src/settings.ts` `display()`:
- DELETE the `createEl("h2", { text: "Me.sh Sync for Obsidian" })` line
  (community guideline: no top-level plugin-name heading).
- Replace each `containerEl.createEl("h3", { text: "X" })` with
  `new Setting(containerEl).setName("X").setHeading();` — keep the same
  section titles but sentence-case them per guidelines: "Sync behavior",
  "Data options".

**Verify**: `npm run build` → exit 0;
`grep -n 'createEl("h' src/settings.ts` → no matches.

### Step 4: URL encoding

In `src/main.ts` `open-in-mesh` callback:
`window.open(`https://app.me.sh/contact/${encodeURIComponent(String(fm["Mesh ID"]))}`)`.

**Verify**: `npm run build` → exit 0.

### Step 5: Dead code

`grep -rn "getContactNotes\|getSelf" src/` — expect matches only inside
`src/mesh-api.ts` (definitions). If any caller exists → STOP (plan 007 or
008 changed assumptions). Otherwise delete both methods. Keep `MeshNote`
(used by detail.notes / plan 007).

**Verify**: `npm run build` → exit 0; `npm test` → all pass;
`grep -rn "getContactNotes\|getSelf" src/` → no matches.

### Step 6: README

- Installation: folder → `.obsidian/plugins/mesh-sync/`.
- Add a short "Upgrading from obsidian-mesh (≤0.1.0)" note: disable the old
  plugin; create `.obsidian/plugins/mesh-sync/`; copy the new `main.js` +
  `manifest.json` there; copy `data.json` from the old
  `obsidian-mesh/` folder to preserve settings and sync metadata; enable
  "Me.sh Sync"; delete the old folder.
- Update any "Me.sh Sync for Obsidian" plugin-name references in
  install/enable instructions to "Me.sh Sync" (the README TITLE may stay
  "Me.sh Sync for Obsidian" — it's a doc title, not the manifest name).

**Verify**: `grep -n "obsidian-mesh" README.md` → only the GitHub repo URL
and the upgrade note reference the old id.

## Test plan

No new tests — mechanical changes covered by build/test/audit gates above.

## Done criteria

- [ ] `npm run build`, `npm test`, `npm audit` all exit 0 (audit: 0 vulns)
- [ ] `grep -n '"id"' manifest.json` → `"mesh-sync"`; name has no "Obsidian"
- [ ] versions.json has both 0.1.0 and 0.2.0 entries
- [ ] `grep -n 'createEl("h' src/settings.ts` → no matches
- [ ] `grep -rn "getContactNotes\|getSelf" src/` → no matches
- [ ] `grep -n "encodeURIComponent" src/main.ts` → 1 match in open-in-mesh
- [ ] No files outside the in-scope list modified (`git status`; untracked
      `.superpowers/` expected)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any caller of getContactNotes/getSelf exists (assumption broken).
- esbuild 0.25 breaks the build in a way not fixed by trivial config
  adjustment — report rather than downgrading or rewriting the config.
- Settings tab code differs structurally from the excerpt beyond plans
  007/008's additions.

## Maintenance notes

- The maintainer's own vault install must be migrated per the README note
  after this ships.
- If the plugin is submitted to Community Plugins, re-check current
  submission requirements at that time (they evolve).
