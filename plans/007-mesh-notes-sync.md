# Plan 007: Sync Mesh notes into a "Me.sh Notes" frontmatter field (opt-in)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ad05fe2..HEAD -- src/contact-mapper.ts src/plugin-data.ts src/settings.ts src/frontmatter.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (feature)
- **Effort**: S
- **Risk**: LOW — additive, behind a default-off setting; no sync-engine
  changes needed (the field flows through existing direct-field machinery).
- **Depends on**: plans/006-accurate-dry-run.md (DONE)
- **Category**: direction / feature
- **Planned at**: commit `ad05fe2`, 2026-07-14

## Why this matters

Mesh lets users write notes on contacts; the plugin currently drops them
even though the detail endpoint already returns them. The maintainer (Evan)
decided: an opt-in setting (off by default) writes them to a frontmatter
field named **"Me.sh Notes"** on the contact note — the "Me.sh" prefix
distinguishes the source, consistent with the existing "(Me.sh)" parallel
fields. No extra API call is needed: `MeshContactDetail.notes` is already
fetched.

## Current state

- `src/mesh-api.ts` — `MeshContactDetail` has `notes: MeshNote[]`;
  `MeshNote` is `{ id: number; body: string; created: string; updated: string }`.
  (`created` is an ISO-ish string on this endpoint.)
- `src/contact-mapper.ts:62-66` — mapper signature:

```ts
static mapContactDetail(
    contact: MeshContactDetail,
    groupTitles: string[] = [],
    settings: MeshSettings
): MappedContactData {
```

- `src/contact-mapper.ts:157-160` — the pattern to follow (Mesh Sources, a
  direct string-array field):

```ts
// Sources / integrations (direct -- which services this contact came from)
if (contact.integrations?.length) {
    data["Mesh Sources"] = contact.integrations;
}
```

- `src/contact-mapper.ts:20-48` — `MappedContactData` interface; direct
  fields listed first, enriched fields (Company, Title, …) at the bottom.
  Note "Me.sh Notes" must be a DIRECT field (not in `ENRICHED_FIELDS`), so
  it gets replace-on-change semantics via the three-way merge, like
  `Mesh Groups`.
- `src/contact-mapper.ts:171-173` — Bio shows the whitespace-collapse
  convention: `contact.bio.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()`.
- `src/plugin-data.ts` — `MeshSettings` interface + `DEFAULT_SETTINGS`
  (obsidian-free module; `settings.ts` re-exports both). Add the new
  setting here, NOT in settings.ts.
- `src/settings.ts` — settings tab; "Data Options" section (h3) contains
  toggles like "Sync social profiles" — follow that exact Setting pattern.
- `src/frontmatter.ts:41` — `FIELD_ORDER` contains `"Mesh Sources"`; new
  key goes immediately AFTER it.
- Tests: `src/contact-mapper.test.ts` (fixture helpers + `TEST_SETTINGS`
  local fixture typed via `import type`). 68 tests currently pass.
- README.md — Settings table (~line 46) and "Data Handling" →
  "Direct fields" list (~line 72).

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/plugin-data.ts` (setting `syncNotes: boolean`, default `false`)
- `src/settings.ts` (toggle in Data Options)
- `src/contact-mapper.ts` (`"Me.sh Notes"?: string[]` in MappedContactData;
  mapping block)
- `src/frontmatter.ts` (FIELD_ORDER entry)
- `src/contact-mapper.test.ts` (extend)
- `README.md` (settings table row + direct-fields list entry)

**Out of scope**:
- `src/sync-engine.ts` — no changes; the field flows through
  computeFieldActions/createFile automatically (arrays are handled by
  JSON.stringify comparison and stringifyYaml serialization).
- `src/mesh-api.ts` — do NOT delete `getContactNotes` here (a later cleanup
  task removes it); do not add API calls.
- ENRICHED_FIELDS — "Me.sh Notes" is direct; don't touch the enriched list.

## Git workflow

- Commit message: short imperative (e.g. "Add opt-in Mesh notes sync to
  Me.sh Notes field"); end with a line containing exactly: @evanzi
- Do NOT push.

## Steps

### Step 1: Setting

In `src/plugin-data.ts`: add `syncNotes: boolean;` to `MeshSettings` (after
`syncTagsAndGroups`) and `syncNotes: false,` to `DEFAULT_SETTINGS`.

In `src/settings.ts`, Data Options section, after the "Sync tags & groups"
toggle, add (matching the neighboring pattern exactly):

- Name: "Sync notes"
- Desc: "Write Mesh notes to a 'Me.sh Notes' field. The field is replaced
  on each sync — edit notes in Mesh, not in this field."
- Toggle bound to `this.plugin.settings.syncNotes`, saving on change.

**Verify**: `npm run build` → exit 0.

### Step 2: Mapping

In `src/contact-mapper.ts`:

1. Add to `MappedContactData` (in the direct-data section, after
   `"Mesh Sources"?: string[];`): `"Me.sh Notes"?: string[];`
2. In `mapContactDetail`, after the Sources block (line ~160), add:

```ts
// Notes (user-authored in me.sh -- direct)
if (settings.syncNotes && contact.notes?.length) {
    const notes = [...contact.notes]
        .sort((a, b) => (a.created || "").localeCompare(b.created || ""))
        .map((n) => {
            const body = (n.body || "").replace(/\s+/g, " ").trim();
            if (!body) return "";
            const date = /^\d{4}-\d{2}-\d{2}/.test(n.created || "")
                ? `${n.created.slice(0, 10)}: `
                : "";
            return `${date}${body}`;
        })
        .filter((n) => n !== "");
    if (notes.length > 0) data["Me.sh Notes"] = notes;
}
```

3. In `src/frontmatter.ts`, add `"Me.sh Notes",` to FIELD_ORDER on the line
   immediately after `"Mesh Sources",`. Change nothing else in the list.

**Verify**: `npm run build` → exit 0.

### Step 3: Tests (extend `src/contact-mapper.test.ts`)

Reuse the existing fixture helpers; add a settings variant
`{ ...TEST_SETTINGS, syncNotes: true }` (TEST_SETTINGS itself must gain the
new key to keep the type happy — set `syncNotes: false` there).

Cases:
- setting off (default): contact with notes → no `"Me.sh Notes"` key.
- setting on, no notes / empty array → no key.
- setting on, two notes with ISO `created` out of order → array sorted
  ascending by created, each entry `YYYY-MM-DD: body`.
- multiline/whitespace-heavy body → collapsed to single-spaced line.
- note with non-ISO `created` (e.g. `""`) → entry has no date prefix.
- note whose body collapses to empty → dropped; if all drop → no key.

**Verify**: `npm test` → all pass (68 + new).

### Step 4: README

- Settings table: add row `**Sync notes** | Write Mesh notes to a "Me.sh
  Notes" field (off by default; field is replaced each sync)`.
- "Direct fields" list in Data Handling: add `Me.sh Notes`.

**Verify**: none (docs).

## Test plan

See Step 3; model after the existing `mapContactDetail` describe block.

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0 with the new note cases passing
- [ ] `grep -n "Me.sh Notes" src/frontmatter.ts` → exactly 1 match, on the
      line after "Mesh Sources"
- [ ] `grep -n "syncNotes" src/plugin-data.ts src/settings.ts src/contact-mapper.ts`
      → present in all three
- [ ] No files outside the in-scope list modified (`git status` — note:
      untracked `.superpowers/` scratch is expected and not yours)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The mapper signature or the Mesh Sources block doesn't match the excerpts
  (drifted).
- You find yourself needing to modify `sync-engine.ts` for any reason —
  the design premise is that no change is needed there; if that's wrong,
  report why instead of changing it.
- `MeshNote.created` turns out to be a number (unix timestamp) in the type
  definitions rather than a string — report; the date handling would need
  a different shape.

## Maintenance notes

- The field is replace-on-change via the standard three-way merge: if the
  user hand-edits "Me.sh Notes", default "obsidian wins" resolution will
  keep their edit and stop updating it (same as any direct field). The
  settings description warns about this.
- The cleanup task (009) deletes the now-redundant `getContactNotes` API
  method; if this plan is executed after 009 for some reason, that's fine —
  they don't overlap.
