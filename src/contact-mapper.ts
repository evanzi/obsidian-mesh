import type { MeshContactList, MeshContactInfo, MeshGroup } from "./mesh-api";
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
	 * Extract the first info value matching a type from the contact's information array
	 */
	private static getInfo(contact: MeshContactList, type: string): string | undefined {
		return contact.information?.find((i) => i.type === type)?.value;
	}

	/**
	 * Map a Mesh contact (list endpoint, snake_case) to Obsidian frontmatter fields
	 */
	static mapContact(
		contact: MeshContactList,
		groups: MeshGroup[],
		settings: MeshSettings
	): MappedContactData {
		const now = new Date().toISOString().slice(0, 19);

		const data: MappedContactData = {
			"Mesh ID": contact.id,
			"Mesh URL": `https://app.me.sh/contacts/${contact.id}`,
			"Mesh Last Synced": now,
		};

		// Email -- type "email" in information[]
		const email = this.getInfo(contact, "email");
		if (email) data["Email (Private)"] = email;

		// Phone -- type "phone" in information[]
		const phone = this.getInfo(contact, "phone");
		if (phone) data.Phone = phone;

		// Social profiles -- stored as information[] items with type = platform name
		if (settings.syncSocialProfiles) {
			for (const info of contact.information || []) {
				switch (info.type) {
					case "linkedin":
						data.LinkedIn = info.value.startsWith("http")
							? info.value
							: `https://linkedin.com/in/${info.value}`;
						break;
					case "twitter":
						data.Twitter = info.value.startsWith("http")
							? info.value
							: `https://x.com/${info.value}`;
						break;
					case "github":
						data.GitHub = info.value.startsWith("http")
							? info.value
							: `https://github.com/${info.value}`;
						break;
					case "instagram":
						data.Instagram = info.value.startsWith("http")
							? info.value
							: `https://instagram.com/${info.value}`;
						break;
				}
			}
		}

		// Relationship strength from score
		if (settings.syncRelationshipData && contact.score > 0) {
			if (contact.score >= 70) data["Relationship Strength"] = "Strong";
			else if (contact.score >= 40) data["Relationship Strength"] = "Medium";
			else data["Relationship Strength"] = "Weak";
		}

		// Groups
		if (settings.syncTagsAndGroups) {
			const contactGroups = groups
				.filter((g) => g.contact_ids?.includes(contact.id))
				.map((g) => g.title);
			if (contactGroups.length > 0) data["Mesh Groups"] = contactGroups;
		}

		// Photo
		if (settings.syncPhotos && contact.avatar_url) {
			data.Photo = contact.avatar_url;
		}

		return data;
	}

	/**
	 * Generate the display name for a file based on settings.
	 * Filters out empty names and placeholder dots.
	 */
	static getFileName(contact: MeshContactList, format: MeshSettings["fileNameFormat"]): string {
		const first = (contact.first_name || "").trim();
		const last = (contact.last_name || "").trim();
		const full = (contact.full_name || "").trim();
		const display = (contact.display_name || "").trim();

		// Filter out contacts that are just an email or have no real name
		const hasRealName = (first && first !== ".") || (last && last !== ".");

		switch (format) {
			case "lastFirst":
				if (hasRealName && first && last) return `${last}, ${first}`;
				break;
			case "firstLast":
				if (hasRealName && first && last) return `${first} ${last}`;
				break;
		}

		// Default: use full_name, then display_name
		if (full && full !== ".") return full;
		if (display) return display;

		// Last resort: use email or ID
		const email = this.getInfo(contact, "email");
		if (email) return email;
		return `Mesh Contact ${contact.id}`;
	}
}
