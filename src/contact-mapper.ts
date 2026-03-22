import type { MeshContactDetail, MeshContactList, MeshGroup } from "./mesh-api";
import type { MeshSettings } from "./settings";

/**
 * Fields that the plugin manages. Manual edits to other fields are never touched.
 */
export const MESH_MANAGED_FIELDS = [
	"Mesh ID",
	"Mesh URL",
	"Mesh Last Synced",
	"Last Contacted",
	"Relationship Strength",
	"Mesh Tags",
	"Mesh Groups",
	"LinkedIn",
	"Twitter",
	"GitHub",
	"Instagram",
	"Photo",
] as const;

export interface MappedContactData {
	// Mesh-specific fields
	"Mesh ID": number;
	"Mesh URL": string;
	"Mesh Last Synced": string;

	// Mapped to existing schema
	Nickname?: string;
	"Email (Private)"?: string;
	Phone?: string;
	Company?: string;
	Title?: string[];
	Birthday?: string;
	City?: string;
	Country?: string;

	// Optional Mesh fields
	LinkedIn?: string;
	Twitter?: string;
	GitHub?: string;
	Instagram?: string;
	"Last Contacted"?: string;
	"Relationship Strength"?: string;
	"Mesh Tags"?: string[];
	"Mesh Groups"?: string[];
	Photo?: string;
}

export class ContactMapper {
	/**
	 * Map a Mesh contact detail (camelCase, rich data) to Obsidian frontmatter fields
	 */
	static mapContactDetail(
		contact: MeshContactDetail,
		groups: MeshGroup[],
		settings: MeshSettings
	): MappedContactData {
		const now = new Date().toISOString().slice(0, 19);

		const data: MappedContactData = {
			"Mesh ID": contact.id,
			"Mesh URL": `https://app.me.sh/contact/${contact.id}`,
			"Mesh Last Synced": now,
		};

		// Nickname
		if (contact.nickname) data.Nickname = contact.nickname;

		// Email -- from information[] array
		const emailInfo = contact.information?.find((i) => i.type === "email");
		if (emailInfo) data["Email (Private)"] = emailInfo.value;

		// Phone -- from information[] array
		const phoneInfo = contact.information?.find((i) => i.type === "phone");
		if (phoneInfo) data.Phone = phoneInfo.value;

		// Company and Title from organizations
		// Current org = one with no end date (still active)
		const currentOrg = contact.organizations?.find((o) => !o.end)
			|| contact.organizations?.[0];
		if (currentOrg) {
			if (currentOrg.name) data.Company = currentOrg.name;
			if (currentOrg.title) data.Title = [currentOrg.title];
		} else if (contact.organization) {
			data.Company = contact.organization;
		}
		// Fallback: top-level title field
		if (!data.Title && contact.title) {
			data.Title = [contact.title];
		}

		// Birthday
		if (contact.birthday?.month && contact.birthday?.day) {
			const y = contact.birthday.year || "0000";
			const m = String(contact.birthday.month).padStart(2, "0");
			const d = String(contact.birthday.day).padStart(2, "0");
			data.Birthday = `${y}-${m}-${d}`;
		}

		// Location -- primaryLocation is an object with approximate, country, formatted
		const loc = contact.primaryLocation || contact.locations?.[0];
		if (loc) {
			if (loc.approximate) data.City = loc.approximate;
			if (loc.country) data.Country = loc.country;
		}

		// Social profiles -- top-level URL fields on the detail response
		if (settings.syncSocialProfiles) {
			if (contact.linkedinURL) data.LinkedIn = contact.linkedinURL;
			if (contact.twitterURL) data.Twitter = contact.twitterURL;
			if (contact.githubURL) data.GitHub = contact.githubURL;
			if (contact.instagramURL) data.Instagram = contact.instagramURL;

			// Fallback: check information[] for social handles
			if (!data.LinkedIn || !data.Twitter || !data.GitHub || !data.Instagram) {
				for (const info of contact.information || []) {
					if (!data.LinkedIn && info.type === "linkedin") {
						data.LinkedIn = info.value.startsWith("http")
							? info.value
							: `https://linkedin.com/in/${info.value}`;
					} else if (!data.Twitter && info.type === "twitter") {
						data.Twitter = info.value.startsWith("http")
							? info.value
							: `https://x.com/${info.value}`;
					} else if (!data.GitHub && info.type === "github") {
						data.GitHub = info.value.startsWith("http")
							? info.value
							: `https://github.com/${info.value}`;
					} else if (!data.Instagram && info.type === "instagram") {
						data.Instagram = info.value.startsWith("http")
							? info.value
							: `https://instagram.com/${info.value}`;
					}
				}
			}
		}

		// Relationship data
		if (settings.syncRelationshipData) {
			if (contact.score > 0) {
				if (contact.score >= 70) data["Relationship Strength"] = "Strong";
				else if (contact.score >= 40) data["Relationship Strength"] = "Medium";
				else data["Relationship Strength"] = "Weak";
			}

			// Last interaction date (unix timestamp to ISO date)
			if (contact.lastInteractionDate) {
				data["Last Contacted"] = new Date(contact.lastInteractionDate * 1000)
					.toISOString()
					.slice(0, 10);
			}
		}

		// Groups -- from detail endpoint's lists[] and/or the groups parameter
		if (settings.syncTagsAndGroups) {
			// Detail endpoint includes lists[] directly on the contact
			const contactGroups: string[] = [];
			if (contact.lists?.length) {
				for (const list of contact.lists) {
					contactGroups.push(list.title);
				}
			}
			// Also check groups fetched separately (may have more complete data)
			if (groups?.length) {
				for (const g of groups) {
					if (g.contact_ids?.includes(contact.id) && !contactGroups.includes(g.title)) {
						contactGroups.push(g.title);
					}
				}
			}
			if (contactGroups.length > 0) data["Mesh Groups"] = contactGroups;
		}

		// Photo
		if (settings.syncPhotos && contact.avatarURL) {
			data.Photo = contact.avatarURL;
		}

		return data;
	}

	/**
	 * Generate the display name for a file based on the detail endpoint data
	 */
	/**
	 * Collapse multiple spaces into one
	 */
	private static normalize(s: string): string {
		return s.replace(/\s+/g, " ").trim();
	}

	static getFileNameFromDetail(
		contact: MeshContactDetail,
		format: MeshSettings["fileNameFormat"]
	): string {
		const first = (contact.firstName || "").trim();
		const last = (contact.lastName || "").trim();
		const full = this.normalize(contact.fullName || "");
		const display = this.normalize(contact.displayName || "");

		const hasRealName = (first && first !== ".") || (last && last !== ".");

		switch (format) {
			case "lastFirst":
				if (hasRealName && first && last) return `${last}, ${first}`;
				break;
			case "firstLast":
				if (hasRealName && first && last) return `${first} ${last}`;
				break;
		}

		if (full && full !== ".") return full;
		if (display) return display;

		// Last resort: use email or ID
		const email = contact.information?.find((i) => i.type === "email")?.value;
		if (email) return email;
		return `Mesh Contact ${contact.id}`;
	}

	/**
	 * Check if a contact from the list endpoint looks like a real person
	 * (not a shared mailbox, crash reporter, etc.)
	 */
	static isRealContact(contact: MeshContactList): boolean {
		const name = (contact.display_name || "").trim();
		const firstName = (contact.first_name || "").trim();
		const lastName = (contact.last_name || "").trim();

		// Has a real first and last name
		if (firstName && firstName !== "." && lastName && lastName !== ".") {
			return true;
		}

		// Has a reasonable full name (not just an email)
		if (name && !name.includes("@") && name !== "." && name.length > 1) {
			return true;
		}

		return false;
	}
}
