import type { MeshContact, MeshContactInfo, MeshGroup } from "./mesh-api";
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

/**
 * Fields that map between existing Obsidian schema and Mesh data
 */
export const MAPPED_FIELDS = {
	"Nickname": "nickname",
	"Email (Private)": "primaryEmail",
	"Phone": "primaryPhone",
	"Company": "currentCompany",
	"Title": "currentTitle",
	"Birthday": "birthday",
	"City": "city",
	"Country": "country",
} as const;

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
	 * Extract a specific info type from the contact's information array
	 */
	private static getInfo(contact: MeshContact, type: string, label?: string): string | undefined {
		const items = contact.information?.filter(
			(i) => i.type === type && (!label || i.label === label)
		);
		return items?.[0]?.value;
	}

	/**
	 * Extract all info values of a given type
	 */
	private static getAllInfo(contact: MeshContact, type: string): string[] {
		return contact.information?.filter((i) => i.type === type).map((i) => i.value) || [];
	}

	/**
	 * Map a Mesh contact to Obsidian frontmatter fields
	 */
	static mapContact(
		contact: MeshContact,
		groups: MeshGroup[],
		settings: MeshSettings
	): MappedContactData {
		const now = new Date().toISOString().slice(0, 19);

		const data: MappedContactData = {
			"Mesh ID": contact.id,
			"Mesh URL": `https://app.me.sh/contacts/${contact.id}`,
			"Mesh Last Synced": now,
		};

		// Map standard fields
		if (contact.nickname) data.Nickname = contact.nickname;

		const primaryEmail = this.getInfo(contact, "email");
		if (primaryEmail) data["Email (Private)"] = primaryEmail;

		const primaryPhone = this.getInfo(contact, "phone");
		if (primaryPhone) data.Phone = primaryPhone;

		// Current organization
		const currentOrg = contact.organizations?.find((o) => o.current !== false) || contact.organizations?.[0];
		if (currentOrg) {
			if (currentOrg.name) data.Company = currentOrg.name;
			if (currentOrg.title) data.Title = [currentOrg.title];
		}

		// Location
		const city = this.getInfo(contact, "location", "city");
		const country = this.getInfo(contact, "location", "country");
		if (city) data.City = city;
		if (country) data.Country = country;

		// Birthday
		const birthday = this.getInfo(contact, "date", "birthday");
		if (birthday) data.Birthday = birthday;

		// Social profiles
		if (settings.syncSocialProfiles) {
			const socials = contact.information?.filter((i) => i.type === "social" || i.type === "url") || [];
			for (const s of socials) {
				const val = s.value.toLowerCase();
				if (val.includes("linkedin.com")) data.LinkedIn = s.value;
				else if (val.includes("twitter.com") || val.includes("x.com")) data.Twitter = s.value;
				else if (val.includes("github.com")) data.GitHub = s.value;
				else if (val.includes("instagram.com")) data.Instagram = s.value;
			}
		}

		// Relationship data
		if (settings.syncRelationshipData) {
			if (contact.score !== undefined) {
				if (contact.score >= 70) data["Relationship Strength"] = "Strong";
				else if (contact.score >= 40) data["Relationship Strength"] = "Medium";
				else data["Relationship Strength"] = "Weak";
			}
		}

		// Tags & groups
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
	 * Generate the display name for a file based on settings
	 */
	static getFileName(contact: MeshContact, format: MeshSettings["fileNameFormat"]): string {
		switch (format) {
			case "lastFirst":
				return `${contact.lastName}, ${contact.firstName}`;
			case "firstLast":
				return `${contact.firstName} ${contact.lastName}`;
			case "full":
			default:
				return contact.fullName || contact.displayName || `${contact.firstName} ${contact.lastName}`;
		}
	}
}
