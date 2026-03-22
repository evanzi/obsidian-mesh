# Me.sh Sync for Obsidian

Sync your contacts from [me.sh](https://me.sh) (Automattic's personal CRM, formerly Clay) into Obsidian as People notes with structured YAML frontmatter.

No API key needed -- the plugin reads auth tokens directly from the me.sh desktop app's local storage. Just have me.sh installed and logged in.

## What It Does

- Syncs contacts from me.sh into Obsidian People notes with YAML frontmatter
- Maps contact data to frontmatter fields: name, email, phone, company, title, location, social profiles (LinkedIn, Twitter, GitHub, Instagram, Facebook), bio, birthday, relationship strength, last contacted, and groups
- Separates **direct** data (from connected services) from **enriched** data (from me.sh's enrichment engine, which can be inaccurate) -- enriched fields never overwrite existing data, and when they differ, a parallel "(Me.sh)" field is added so you can compare
- Smart contact matching: Mesh ID > email (multi-email, both sides) > filename (case-insensitive, partial match with credentials stripped)
- Auto-reorders frontmatter fields to a consistent order
- Filters out non-person entries (phone numbers, shared mailboxes, etc.)
- Deep links to open contacts in the me.sh web app
- Uses the me.sh logo in the Obsidian ribbon

## Requirements

- **me.sh desktop app** installed and logged in (macOS, Windows, or Linux)
- **Obsidian 1.5.0+**
- **Desktop only** (the plugin reads from the local filesystem)

## Installation

Manual installation only (not yet in Community Plugins):

1. Download the latest release from [GitHub](https://github.com/evanzi/obsidian-mesh), or clone the repo
2. Copy `main.js` and `manifest.json` to `.obsidian/plugins/obsidian-mesh/` in your vault
3. Enable "Me.sh Sync for Obsidian" in Obsidian Settings > Community Plugins
4. Set your People folder path in the plugin settings

### Development

```bash
git clone https://github.com/evanzi/obsidian-mesh.git
cd obsidian-mesh
npm install
npm run build
```

## Settings

| Setting | Description |
|---------|-------------|
| **People folder** | Path to the folder where contact files are stored (e.g., `People` or `Work/People`) |
| **Update only** | Only update existing files, don't create new contacts. Recommended for initial testing. |
| **Dry run** | Log what would change to the console (`Cmd+Option+I`) without writing any files |
| **Conflict resolution** | For direct fields when me.sh data conflicts with manual edits: *Obsidian wins* (default), *Me.sh wins*, or *Ask* (log for review) |
| **Sync social profiles** | Toggle sync for LinkedIn, Twitter, GitHub, Instagram, Facebook |
| **Sync relationship data** | Toggle last contacted date and relationship strength |
| **Sync tags & groups** | Toggle me.sh group memberships |

## Testing Safely

**Before running against your real People folder, copy it to a test location first.**

Recommended workflow:

1. Copy your People folder to a test location (e.g., `00System/People-Test`)
2. Set the plugin's People folder to the test location
3. Enable **Update only** -- this only updates existing files, won't create new ones
4. Run a sync and inspect the results
5. Check a few contacts to verify fields were added correctly and existing data wasn't overwritten
6. When satisfied, disable **Update only** to allow new contact creation
7. When fully validated, point the plugin at your real People folder

## Data Handling

### Direct fields (reliable, from connected services)

These follow your conflict resolution setting:

- Email, Phone
- LinkedIn, Twitter, GitHub, Instagram, Facebook
- Last Contacted, Relationship Strength
- Groups, Sources

### Enriched fields (from me.sh's enrichment engine, can be inaccurate)

These only fill empty fields. When existing data differs, a parallel field is created so you can compare:

- Company, Title, City, Country, Birthday, Bio

For example, if your note has `Company: Automattic` and me.sh says Anthropic PBC, the plugin adds `Company (Me.sh): Anthropic PBC` alongside the original. Your data stays untouched.

### Fields me.sh never touches

Any field not listed above is left completely alone -- Team, Conn. type, Prof. Contact, Met?, Profession/Position, Google Contact ID, ID, URLs, and anything else you've added.

## How Authentication Works

The plugin reads JWT tokens from the me.sh desktop app's Local Storage (LevelDB files). No API key or manual login is needed -- just have the me.sh app installed and logged in. Tokens are refreshed automatically via me.sh's token refresh endpoint.

## License

MIT

## Author

Evan Zimmerman ([@evanzi](https://github.com/evanzi))
