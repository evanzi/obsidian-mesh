import type { MeshContactDetail, MeshContactList, MeshGroup } from "./mesh-api";
import type { MeshSettings } from "./settings";

/**
 * Fields sourced from me.sh enrichment engine (can be wrong -- matched to wrong person).
 * These get special handling: only fill empty fields, and when conflicting with
 * existing data, write to a parallel "(Me.sh)" field instead of overwriting.
 */
export const ENRICHED_FIELDS = [
	"Company",
	"Title",
	"City",
	"Country",
	"Birthday",
	"Bio",
] as const;

export type EnrichedField = typeof ENRICHED_FIELDS[number];

export interface MappedContactData {
	// Mesh-specific fields (always written)
	"Mesh ID": number;
	"Mesh URL": string;
	"Mesh Last Synced": string;

	// Direct integration data (reliable -- from connected services)
	Nickname?: string;
	"Email (Private)"?: string;
	Phone?: string;
	LinkedIn?: string;
	Twitter?: string;
	GitHub?: string;
	Instagram?: string;
	Facebook?: string;
	"Last Contacted"?: string;
	"Relationship Strength"?: string;
	"Mesh Groups"?: string[];
	"Mesh Sources"?: string[];
	Photo?: string;

	// Enriched data (potentially unreliable -- from me.sh enrichment engine)
	Company?: string;
	Title?: string[];
	Birthday?: string;
	City?: string;
	Country?: string;
	Bio?: string;
}

export class ContactMapper {
	/**
	 * Check if a field is enriched (potentially unreliable)
	 */
	static isEnrichedField(key: string): boolean {
		return (ENRICHED_FIELDS as readonly string[]).includes(key);
	}

	/**
	 * Map a me.sh contact detail to Obsidian frontmatter fields.
	 * Separates direct integration data from enriched data.
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

		// ── Direct integration data (reliable) ──

		// Nickname
		if (contact.nickname) data.Nickname = contact.nickname;

		// Email -- from information[] (direct from connected accounts)
		const emailInfo = contact.information?.find((i) => i.type === "email");
		if (emailInfo) data["Email (Private)"] = emailInfo.value;

		// Phone -- from information[] (direct from address book)
		const phoneInfo = contact.information?.find((i) => i.type === "phone");
		if (phoneInfo) data.Phone = phoneInfo.value;

		// Social profiles -- from information[] (direct from integrations)
		if (settings.syncSocialProfiles) {
			// Top-level URL fields (may come from enrichment, but the URL itself
			// is usually correct even when org data is wrong)
			if (contact.linkedinURL) data.LinkedIn = contact.linkedinURL;
			if (contact.twitterURL) data.Twitter = contact.twitterURL;
			if (contact.githubURL) data.GitHub = contact.githubURL;
			if (contact.instagramURL) data.Instagram = contact.instagramURL;
			if (contact.facebookURL) data.Facebook = contact.facebookURL;

			// Fallback: social handles from information[]
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
				} else if (!data.Facebook && info.type === "facebook") {
					data.Facebook = info.value.startsWith("http")
						? info.value
						: `https://facebook.com/${info.value}`;
				}
			}
		}

		// Relationship data (me.sh's own tracking -- reliable)
		if (settings.syncRelationshipData) {
			if (contact.score > 0) {
				if (contact.score >= 70) data["Relationship Strength"] = "Strong";
				else if (contact.score >= 40) data["Relationship Strength"] = "Medium";
				else data["Relationship Strength"] = "Weak";
			}

			if (contact.lastInteractionDate) {
				data["Last Contacted"] = new Date(contact.lastInteractionDate * 1000)
					.toISOString()
					.slice(0, 10);
			}
		}

		// Groups (user-managed in me.sh -- reliable)
		if (settings.syncTagsAndGroups) {
			const contactGroups: string[] = [];
			if (contact.lists?.length) {
				for (const list of contact.lists) {
					contactGroups.push(list.title);
				}
			}
			if (groups?.length) {
				for (const g of groups) {
					if (g.contact_ids?.includes(contact.id) && !contactGroups.includes(g.title)) {
						contactGroups.push(g.title);
					}
				}
			}
			if (contactGroups.length > 0) data["Mesh Groups"] = contactGroups;
		}

		// Sources / integrations (direct -- which services this contact came from)
		if (contact.integrations?.length) {
			data["Mesh Sources"] = contact.integrations;
		}

		// Photo
		if (settings.syncPhotos && contact.avatarURL) {
			data.Photo = contact.avatarURL;
		}

		// ── Enriched data (potentially unreliable) ──

		// Bio (from LinkedIn profile -- enriched)
		// Collapse to single line for YAML frontmatter compatibility
		if (contact.bio) {
			data.Bio = contact.bio.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
		}

		// Company and Title from organizations
		const currentOrg = contact.organizations?.find((o) => !o.end)
			|| contact.organizations?.[0];
		if (currentOrg) {
			if (currentOrg.name) data.Company = currentOrg.name;
			if (currentOrg.title) data.Title = [currentOrg.title];
		} else if (contact.organization) {
			data.Company = contact.organization;
		}
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

		// Location
		const loc = contact.primaryLocation || contact.locations?.[0];
		if (loc) {
			if (loc.city) {
				data.City = loc.region ? `${loc.city}, ${loc.region}` : loc.city;
			} else if (loc.approximate) {
				data.City = loc.approximate;
			}
			if (loc.country) data.Country = loc.country;
		}

		return data;
	}

	/**
	 * Collapse multiple spaces into one
	 */
	private static normalize(s: string): string {
		return s.replace(/\s+/g, " ").trim();
	}

	/**
	 * Generate the display name for a file
	 */
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

		const email = contact.information?.find((i) => i.type === "email")?.value;
		if (email) return email;
		return `Mesh Contact ${contact.id}`;
	}

	/**
	 * Check if a contact from the list endpoint looks like a real person
	 */
	static isRealContact(contact: MeshContactList): boolean {
		const name = (contact.display_name || "").trim();
		const firstName = (contact.first_name || "").trim();
		const lastName = (contact.last_name || "").trim();

		if (!name || name === ".") return false;
		if (name.includes("@")) return false;
		if (/^[\d\s\-+().]+$/.test(name)) return false;
		if (/^['+\-]/.test(name)) return false;

		if (firstName && firstName !== "." && lastName && lastName !== ".") {
			return true;
		}

		if (name.length > 1) {
			return true;
		}

		return false;
	}
}
