# Plan 003: Replace hand-rolled YAML frontmatter serialization with Obsidian's stringifyYaml

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

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW-MED — output formatting of newly created files changes
  slightly (quoting style); no behavior change for existing files, which go
  through `processFrontMatter`.
- **Depends on**: plans/001-vitest-baseline.md
- **Category**: security / bug
- **Planned at**: commit `f988f43`, 2026-07-14

## Why this matters

`createFile()` builds YAML frontmatter by string concatenation with a
heuristic `needsQuoting()`. Contact-derived values (names, companies, titles,
group names, bios) originate outside the user's control — Mesh auto-creates
contacts from email senders and enrichment data. A value containing a newline
is written verbatim and breaks the frontmatter or injects arbitrary
frontmatter fields into the note (YAML injection). Array items (group titles)
are written entirely unquoted, so a group named `a: b` produces invalid YAML.
Boolean-lookalike strings (`yes`, `no`), leading `-`, and leading/trailing
whitespace are also mishandled. Obsidian ships a correct serializer
(`stringifyYaml`); using it eliminates the whole bug class and deletes the
heuristic.

## Current state

- `src/sync-engine.ts:436-470` — `createFile()`:

```ts
private async createFile(filePath: string, mapped: MappedContactData): Promise<void> {
    const lines: string[] = ["---"];
    const fieldOrder = SyncEngine.FIELD_ORDER;

    const data: Record<string, unknown> = {
        "Prof. Contact": false,
        "Met?": "Empty",
        "Source": "Mesh",
        "Last Update": new Date().toISOString().slice(0, 16),
        ...mapped,
    };

    for (const key of fieldOrder) {
        const value = data[key];
        if (value === undefined) continue;

        if (Array.isArray(value)) {
            lines.push(`${key}:`);
            for (const item of value) {
                lines.push(`  - ${item}`);
            }
        } else if (typeof value === "string" && this.needsQuoting(value)) {
            const escaped = value.replace(/"/g, '\\"');
            lines.push(`${key}: "${escaped}"`);
        } else {
            lines.push(`${key}: ${value}`);
        }
    }

    lines.push("---");
    lines.push("");

    await this.plugin.app.vault.create(filePath, lines.join("\n"));
}
```

- `src/sync-engine.ts:505-517` — `needsQuoting()` heuristic (to be deleted).
- `src/sync-engine.ts:216-257` — `SyncEngine.FIELD_ORDER`, the canonical key
  order; the ordering behavior MUST be preserved (JS object insertion order
  is what `stringifyYaml` will emit).
- Note: only NEW files use this path. Updates go through
  `app.fileManager.processFrontMatter` (already safe).
- The `obsidian` module exports `stringifyYaml(obj: any): string` (returns
  YAML text WITH a trailing newline). The npm package is types-only at dev
  time; at runtime inside Obsidian it exists. Unit tests therefore test the
  pure ordered-object builder, not the serializer.

## Commands you will need

| Purpose   | Command         | Expected on success |
|-----------|-----------------|---------------------|
| Typecheck + bundle | `npm run build` | exit 0 |
| Tests     | `npm test`      | all pass            |

## Scope

**In scope**:
- `src/sync-engine.ts` (`createFile`, delete `needsQuoting`, add exported
  pure helper)
- `src/sync-engine.test.ts` (create — tests for the pure helper only)

**Out of scope**:
- `updateFile` / `processFrontMatter` paths — already safe.
- `FIELD_ORDER` contents — do not change the order.
- Filename generation — that's plan 004.

## Git workflow

- Commit message style: short imperative (e.g. "Use stringifyYaml for new
  contact files").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a pure ordered-object builder

In `src/sync-engine.ts`, add a module-level exported function (NOT a class
method, so tests can import it without touching the `obsidian`-importing
class — but note the module itself imports `obsidian`, so tests need a stub;
see Step 3):

Better: create the helper in a new file `src/frontmatter.ts` with NO obsidian
imports:

```ts
/** Order `data` by fieldOrder, appending unknown keys at the end; drop undefined. */
export function orderFrontmatter(
    data: Record<string, unknown>,
    fieldOrder: readonly string[]
): Record<string, unknown> {
    const ordered: Record<string, unknown> = {};
    for (const key of fieldOrder) {
        if (data[key] !== undefined) ordered[key] = data[key];
    }
    for (const [key, value] of Object.entries(data)) {
        if (!(key in ordered) && value !== undefined) ordered[key] = value;
    }
    return ordered;
}
```

Move `FIELD_ORDER` from `SyncEngine` into `src/frontmatter.ts` as an exported
const, and update the two usages in `sync-engine.ts`
(`reorderFrontmatter` at ~line 269 and `createFile` at ~line 438).

**Verify**: `npm run build` → exit 0.

### Step 2: Rewrite `createFile`

```ts
import { stringifyYaml } from "obsidian";  // add to existing obsidian import
import { orderFrontmatter, FIELD_ORDER } from "./frontmatter";

private async createFile(filePath: string, mapped: MappedContactData): Promise<void> {
    const data: Record<string, unknown> = {
        "Prof. Contact": false,
        "Met?": "Empty",
        "Source": "Mesh",
        "Last Update": new Date().toISOString().slice(0, 16),
        ...mapped,
    };
    const ordered = orderFrontmatter(data, FIELD_ORDER);
    const content = `---\n${stringifyYaml(ordered)}---\n`;
    await this.plugin.app.vault.create(filePath, content);
}
```

Delete `needsQuoting()` entirely.

**Verify**: `npm run build` → exit 0, and
`grep -n "needsQuoting" src/` → no matches.

### Step 3: Tests for `orderFrontmatter` in `src/frontmatter.test.ts`

(`frontmatter.ts` has no obsidian import, so no stub needed.)

- Keys emitted in FIELD_ORDER order; unknown keys appended after, in
  original order.
- `undefined` values dropped; `false`, `0`, `""` kept.
- Arrays and strings pass through unchanged (serialization is
  stringifyYaml's job — do not test the obsidian API itself).

**Verify**: `npm test` → all pass.

### Step 4: Manual smoke check (report only)

If you have no Obsidian runtime available, state that in your report and
list this as remaining manual verification for the operator: create one new
contact via sync (dry run off, pointing at a test folder) and confirm the
file's frontmatter parses (Obsidian shows properties, not raw text) —
especially for a contact whose company/bio contains `:` or quotes.

## Test plan

See Step 3. Model after `src/contact-mapper.test.ts` (plan 001).

## Done criteria

- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0 including new frontmatter tests
- [ ] `grep -n "needsQuoting" src/` returns no matches
- [ ] `grep -n "stringifyYaml" src/sync-engine.ts` returns ≥1 match
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `createFile` no longer matches the excerpt (drifted).
- `stringifyYaml` is not exported by the installed `obsidian` typings
  (check `node_modules/obsidian/obsidian.d.ts`) — report; do not substitute
  a YAML dependency without operator sign-off.
- Moving FIELD_ORDER breaks `reorderFrontmatter` in a way not fixable by
  updating the reference.

## Maintenance notes

- New-file quoting style will differ cosmetically from old hand-rolled output
  (e.g. single vs double quotes); existing files are untouched.
- If a "sync notes into note body" feature is added later, body content needs
  its own escaping consideration — frontmatter safety here doesn't cover it.
