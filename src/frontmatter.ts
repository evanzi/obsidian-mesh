/**
 * Canonical field order for frontmatter. Fields not in this list
 * are appended at the end in their original order.
 *
 * No `obsidian` import here — kept pure so it can be unit tested without a
 * runtime stub (see frontmatter.test.ts).
 */
export const FIELD_ORDER = [
	// Primary contact info
	"Prof. Contact",
	"Last Update",
	"Conn. type",
	"Nickname",
	"Title",
	"Email (Private)",
	"Phone",
	"Profession / Position",
	"Company",
	"Team",
	"Birthday",
	"City",
	"Country",
	"URLs",
	"LinkedIn",
	"Twitter",
	"GitHub",
	"Instagram",
	"Facebook",
	"Bio",
	"Met?",
	"Relationship Strength",
	"Last Contacted",
	// Data / source fields
	"Source",
	"Company (Me.sh)",
	"Title (Me.sh)",
	"City (Me.sh)",
	"Country (Me.sh)",
	"Birthday (Me.sh)",
	"Bio (Me.sh)",
	"Mesh Sources",
	"Me.sh Notes",
	"Mesh Groups",
	"Mesh ID",
	"Mesh Last Synced",
	"Mesh URL",
	"Google Contact ID",
	"ID",
	"Photo",
] as const;

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
