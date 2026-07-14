# Plan 005: Build matching indexes once per sync instead of scanning all files per contact

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f988f43..HEAD -- src/sync-engine.ts src/contact-mapper.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED — matching is the plugin's core safety behavior; the
  refactor must preserve match PRIORITY (Mesh ID > email > name). Mitigated
  by keeping the priority logic identical and adding tests.
- **Depends on**: plans/001-vitest-baseline.md
- **Category**: perf
- **Planned at**: commit `f988f43`, 2026-07-14

## Why this matters

`findMatchingFile()` runs once per contact and, on every call: iterates ALL
vault files reading `metadataCache` frontmatter for a Mesh ID match, iterates
them again for email matching, and rebuilds a lowercase-name Map from
scratch. Group membership similarly scans `g.contact_ids.includes(...)` per
contact per group. With N contacts and M files this is O(N×M) frontmatter
cache lookups plus N Map constructions — for a 2,000-contact vault, ~8M
lookups per sync, running inside the UI process on every auto-sync tick.
Building three lookup maps once per sync makes matching O(N+M) and removes
several seconds of main-thread work per sync.

## Current state

- `src/sync-engine.ts:142-210` — `findMatchingFile(files, contact, mapped)`;
  the per-contact scans described above. Key excerpts:

```ts
// Match by Mesh ID first (fastest for subsequent syncs)
for (const [_, file] of files) {
    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.["Mesh ID"] === contact.id) return file;
}
...
// Build a case-insensitive lookup from existing files
const filesLower = new Map<string, TFile>();
for (const [name, file] of files) {
    filesLower.set(name.toLowerCase(), file);
}
```

- `src/sync-engine.ts:67-126` — the sync loop calling
  `this.findMatchingFile(existingFiles, detail, mapped)` at line 84.
- `src/sync-engine.ts:61` — `existingFiles` built once via
  `getExistingPeopleFiles(folderPath)` (Map basename→TFile).
- `src/contact-mapper.ts:147-153` — per-contact group scan:

```ts
for (const g of groups) {
    if (g.contact_ids?.includes(contact.id) && !contactGroups.includes(g.title)) {
        contactGroups.push(g.title);
    }
}
```

- Match priority that MUST be preserved: (1) frontmatter `Mesh ID` equals
  contact id; (2) any Mesh email equals any comma-separated email in
  frontmatter `Email (Private)`, case-insensitive; (3) exact
  case-insensitive whitespace-collapsed name match on fullName /
  displayName / "first last"; (4) "first last" with credentials stripped
  from lastName (split on ",").
- Caveat to preserve: files CREATED during the current sync are not added to
  `existingFiles` today, and the new index must behave the same (no
  behavior change in this plan).

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/sync-engine.ts` (build indexes in `sync()`, rewrite
  `findMatchingFile` to use them)
- `src/contact-mapper.ts` (accept a prebuilt `Map<number, string[]>`
  contactId→groupTitles instead of scanning `groups`)
- `src/sync-engine.test.ts` or `src/contact-mapper.test.ts` (extend)

**Out of scope**:
- Changing match semantics in any way (order, case rules, credential
  stripping).
- The 100ms `DETAIL_FETCH_DELAY_MS` and per-contact detail fetching — that's
  an API-level question tracked separately (see plans/README.md, "Incremental
  sync" discussion item).

## Git workflow

- Commit message style: short imperative (e.g. "Index existing files once
  per sync for contact matching").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build a `FileIndex` once in `sync()`

Add a private method:

```ts
private buildFileIndex(files: Map<string, TFile>): {
    byMeshId: Map<number, TFile>;
    byEmail: Map<string, TFile>;   // lowercased email → file
    byLowerName: Map<string, TFile>; // lowercased basename → file
} {
    const byMeshId = new Map<number, TFile>();
    const byEmail = new Map<string, TFile>();
    const byLowerName = new Map<string, TFile>();
    for (const [name, file] of files) {
        byLowerName.set(name.toLowerCase(), file);
        const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (typeof fm?.["Mesh ID"] === "number") byMeshId.set(fm["Mesh ID"], file);
        const emails = fm?.["Email (Private)"];
        if (emails) {
            for (const e of String(emails).split(",")) {
                byEmail.set(e.trim().toLowerCase(), file);
            }
        }
    }
    return { byMeshId, byEmail, byLowerName };
}
```

Call it in `sync()` right after `existingFiles` is built (line ~61), and pass
the index into `findMatchingFile` instead of `existingFiles`.

**Verify**: `npm run build` → exit 0.

### Step 2: Rewrite `findMatchingFile` against the index

Same four priority tiers, now O(1) lookups:

1. `index.byMeshId.get(contact.id)`
2. for each mesh email (lowercased) → `index.byEmail.get(email)`
3. for each candidate name (same normalization as today) →
   `index.byLowerName.get(name)`
4. credential-stripped `"first last"` → `index.byLowerName.get(baseName)`

Note one intentional semantic nuance: today's email tier matches
`fm["Email (Private)"]` values; the index preserves that exactly. Keep the
same guard for empty candidate names (`n && n.trim() && n.trim() !== "."`).

**Verify**: `npm run build` → exit 0.

### Step 3: Pre-index group membership

In `sync()` after fetching groups, build
`const groupsByContact = new Map<number, string[]>()` by iterating each
group's `contact_ids` once. Change
`ContactMapper.mapContactDetail(detail, groups, settings)` to accept
`groupTitles: string[]` (the lookup result, default `[]`) instead of the raw
`groups` array; inside, replace the `groups` scan with the passed titles
(still deduplicating against `contact.lists` titles).

**Verify**: `npm run build` → exit 0.

### Step 4: Tests

`mapContactDetail` group handling (pure — extend
`src/contact-mapper.test.ts`):
- lists + passed groupTitles merge without duplicates.
- no groups → no `Mesh Groups` key.

`buildFileIndex`/`findMatchingFile` need `TFile`/`metadataCache`, which
require an obsidian stub. If plan 001's setup has no obsidian alias stub,
add one now: in `vitest.config.ts`, alias `obsidian` to `src/__mocks__/obsidian.ts`
exporting minimal `TFile`/`TFolder` classes and `normalizePath`. Then test
`buildFileIndex` with a fake metadataCache (inject via a plugin stub object).
If this mocking exceeds ~50 lines of stub code, STOP and report — the
operator may prefer manual verification instead.

**Verify**: `npm test` → all pass.

## Test plan

See Step 4. Cover: Mesh ID beats email beats name; comma-separated emails
split correctly; case-insensitive name match; credential-stripped fallback.

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0
- [ ] `findMatchingFile` contains no loops over all files
      (`grep -n "for (const \[_, file\] of files)" src/sync-engine.ts` → no matches)
- [ ] Match priority order unchanged (confirm by reading the rewritten method)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `findMatchingFile` no longer matches the excerpt (drifted).
- The obsidian test stub balloons past ~50 lines — report and fall back to
  pure-logic tests only.
- You find a call site of `mapContactDetail` other than `sync-engine.ts:79`.

## Maintenance notes

- The index is a per-sync snapshot: files created or renamed mid-sync are
  not in it (same as current behavior). If duplicate-creation across a
  single sync ever becomes an issue, add created files to the index at
  create time.
- Reviewer should diff the tier logic side-by-side with the old method —
  semantics must be identical.
