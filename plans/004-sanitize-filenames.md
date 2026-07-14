# Plan 004: Sanitize contact-derived file names before creating notes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f988f43..HEAD -- src/contact-mapper.ts src/sync-engine.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — only affects newly created files; matching of existing
  files is name-based and unchanged for names that were already legal.
- **Depends on**: plans/001-vitest-baseline.md
- **Category**: security / bug
- **Planned at**: commit `f988f43`, 2026-07-14

## Why this matters

File names are built directly from contact names
(`getFileNameFromDetail`) and interpolated into a vault path:
`normalizePath(`${folderPath}/${fileName}.md`)`. Contact names are
semi-untrusted (Mesh auto-creates contacts from email senders and
enrichment). A name containing `/` silently nests the note in a subfolder or
fails creation; `\`, `:`, `|`, `#`, `^`, `[`, `]`, `?` are illegal or
link-breaking in Obsidian; a crafted name containing `..` path segments
could place the `.md` file outside the People folder elsewhere in the vault
(path traversal — bounded to `.md` files inside the vault, but still wrong).
Today each such contact either throws (caught, logged as a sync error) or
writes to an unintended location.

## Current state

- `src/contact-mapper.ts:220-246` — `getFileNameFromDetail()` returns raw
  name strings:

```ts
static getFileNameFromDetail(contact, format): string {
    const first = (contact.firstName || "").trim();
    const last = (contact.lastName || "").trim();
    ...
    switch (format) {
        case "lastFirst":
            if (hasRealName && first && last) return `${last}, ${first}`;
        ...
    }
    if (full && full !== ".") return full;
    if (display) return display;
    const email = contact.information?.find((i) => i.type === "email")?.value;
    if (email) return email;
    return `Mesh Contact ${contact.id}`;
}
```

- `src/sync-engine.ts:80-81` — the only call site:

```ts
const fileName = ContactMapper.getFileNameFromDetail(detail, this.plugin.settings.fileNameFormat);
const filePath = normalizePath(`${folderPath}/${fileName}.md`);
```

- `normalizePath` (Obsidian) normalizes slashes/unicode but does NOT strip
  `..` segments or illegal filename characters.
- Matching of existing files happens by basename lookup earlier in
  `findMatchingFile`; sanitized names only affect the CREATE path, and the
  next sync will re-match created files by `Mesh ID` frontmatter, so a
  sanitized name can't cause duplicate creation across syncs.

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/contact-mapper.ts` (add `sanitizeFileName`, apply in
  `getFileNameFromDetail`)
- `src/contact-mapper.test.ts` (extend)

**Out of scope**:
- `src/sync-engine.ts` — no changes needed; the call site stays as-is.
- Collision handling for two distinct contacts with the same name — known
  limitation, deferred (see Maintenance notes).

## Git workflow

- Commit message style: short imperative (e.g. "Sanitize contact-derived
  file names").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `sanitizeFileName` to ContactMapper

```ts
/**
 * Make a contact-derived string safe to use as an Obsidian file name.
 * Strips characters illegal in Obsidian/OS file names and link syntax,
 * collapses whitespace, and removes path-traversal potential.
 */
static sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|#^[\]]/g, " ") // illegal + link-breaking chars
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "")   // no leading dots (hidden files / "..")
        .replace(/\.+$/, "")   // no trailing dots (Windows)
        .trim();
}
```

Apply it to every return path of `getFileNameFromDetail` by wrapping the
result: restructure the method to compute a candidate string exactly as
today, then:

```ts
const safe = this.sanitizeFileName(candidate);
return safe || `Mesh Contact ${contact.id}`;
```

(The fallback guards against names that sanitize to empty.)

**Verify**: `npm run build` → exit 0.

### Step 2: Tests in `src/contact-mapper.test.ts`

- `sanitizeFileName("Bob / ACME")` → `"Bob ACME"`.
- `sanitizeFileName("..\\..\\evil")` and `"../../evil"` → `"evil"` (no dots,
  no slashes).
- `sanitizeFileName("A:B|C#D[E]")` → `"A B C D E"`.
- `sanitizeFileName("...")` → `""`, and `getFileNameFromDetail` with a
  fullName of `"///"` falls back to `Mesh Contact {id}`.
- Email fallback: name missing, email `"a/b@evil.com"` → sanitized (`"a b@evil.com"`).
- Normal names pass through unchanged: `"Lori McLeese, GPHR"` stays intact
  (comma is legal).

**Verify**: `npm test` → all pass.

## Test plan

See Step 2; extend the plan-001 test file, same fixture helpers.

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0 including new sanitize tests
- [ ] Every return path of `getFileNameFromDetail` goes through
      `sanitizeFileName` (read the method to confirm; no raw returns)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `getFileNameFromDetail` or the sync-engine call site no longer matches the
  excerpts (drifted).
- You find other places that build vault paths from contact data (grep for
  `vault.create` and `normalizePath`) beyond `sync-engine.ts:81` — report
  them rather than expanding scope.

## Maintenance notes

- Existing vault files whose names contain now-stripped characters were
  created before this fix; they'll still be matched by Mesh ID frontmatter,
  not by name — no migration needed.
- Deferred: name-collision handling (two different contacts, same sanitized
  name → second one errors "file already exists" each sync). If addressed
  later, append ` (Mesh {id})` on collision at create time.
