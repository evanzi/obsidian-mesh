import { TFile, TFolder, normalizePath, Notice } from "obsidian";
import type MeshPlugin from "./main";
import { ContactMapper, MESH_MANAGED_FIELDS } from "./contact-mapper";
import type { MappedContactData } from "./contact-mapper";
import type { MeshContactList, MeshContactDetail, MeshGroup } from "./mesh-api";

export interface SyncResult {
	created: number;
	updated: number;
	skipped: number;
	filtered: number;
	errors: string[];
}

interface SyncMetadata {
	lastSync: string;
	contacts: Record<string, Record<string, unknown>>; // meshId -> last-synced field values
}

// Small delay between detail API calls to avoid rate limiting
const DETAIL_FETCH_DELAY_MS = 100;

export class SyncEngine {
	private plugin: MeshPlugin;

	constructor(plugin: MeshPlugin) {
		this.plugin = plugin;
	}

	async sync(): Promise<SyncResult> {
		const result: SyncResult = { created: 0, updated: 0, skipped: 0, filtered: 0, errors: [] };

		// Step 1: Fetch contact list (fast, paginated)
		this.log("Fetching contact list from Mesh...");
		const contactList = await this.plugin.api.getAllContacts();
		this.log(`Fetched ${contactList.length} contacts from list endpoint`);

		// Step 2: Filter out non-person entries
		const realContacts = contactList.filter((c) => ContactMapper.isRealContact(c));
		result.filtered = contactList.length - realContacts.length;
		this.log(`Filtered to ${realContacts.length} real contacts (${result.filtered} skipped)`);

		// Step 3: Fetch groups
		const groups = await this.plugin.api.getGroups();
		this.log(`Fetched ${groups.length} groups`);

		// Ensure target folder exists
		const folderPath = normalizePath(this.plugin.settings.peopleFolder);
		await this.ensureFolder(folderPath);

		// Load existing files and sync metadata
		const existingFiles = await this.getExistingPeopleFiles(folderPath);
		const syncMeta = await this.loadSyncMetadata();

		// Step 4: Fetch detail for each contact and sync
		for (let i = 0; i < realContacts.length; i++) {
			const listContact = realContacts[i];

			// Progress update every 50 contacts
			if (i > 0 && i % 50 === 0) {
				new Notice(`Mesh: Syncing ${i}/${realContacts.length}...`);
			}

			try {
				// Fetch full detail for this contact
				const detail = await this.plugin.api.getContactDetail(listContact.id);

				const mapped = ContactMapper.mapContactDetail(detail, groups, this.plugin.settings);
				const fileName = ContactMapper.getFileNameFromDetail(detail, this.plugin.settings.fileNameFormat);
				const filePath = normalizePath(`${folderPath}/${fileName}.md`);

				// Try to match to existing file
				const existingFile = this.findMatchingFile(existingFiles, detail, mapped);

				if (existingFile) {
					const updated = await this.updateFile(existingFile, mapped, syncMeta);
					if (updated) {
						result.updated++;
					} else {
						result.skipped++;
					}
				} else {
					await this.createFile(filePath, mapped);
					result.created++;
				}

				// Store sync metadata
				syncMeta.contacts[String(detail.id)] = { ...mapped } as Record<string, unknown>;

				// Rate limit delay
				if (i < realContacts.length - 1) {
					await this.delay(DETAIL_FETCH_DELAY_MS);
				}
			} catch (error) {
				const msg = `Failed to sync ${listContact.display_name}: ${error}`;
				this.log(msg);
				result.errors.push(msg);
			}
		}

		// Save sync metadata
		syncMeta.lastSync = new Date().toISOString();
		await this.saveSyncMetadata(syncMeta);

		this.log(`Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.filtered} filtered, ${result.errors.length} errors`);
		return result;
	}

	/**
	 * Find an existing file that matches a Mesh contact (detail endpoint)
	 */
	private findMatchingFile(
		files: Map<string, TFile>,
		contact: MeshContactDetail,
		mapped: MappedContactData
	): TFile | null {
		// Match by Mesh ID first
		for (const [_, file] of files) {
			const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm?.["Mesh ID"] === contact.id) return file;
		}

		// Match by email
		if (mapped["Email (Private)"]) {
			for (const [_, file] of files) {
				const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
				const existingEmail = fm?.["Email (Private)"];
				if (!existingEmail) continue;

				// Handle both single email and comma-separated emails
				const existingEmails = String(existingEmail).split(",").map((e) => e.trim().toLowerCase());
				if (existingEmails.includes(mapped["Email (Private)"]!.toLowerCase())) {
					return file;
				}
			}
		}

		// Match by file name (full name)
		const possibleNames = [
			contact.fullName,
			contact.displayName,
			`${contact.firstName} ${contact.lastName}`,
		].filter((n) => n && n.trim() && n.trim() !== ".");

		for (const name of possibleNames) {
			const file = files.get(name!.trim());
			if (file) return file;
		}

		return null;
	}

	/**
	 * Update an existing file with Mesh data, respecting conflict resolution
	 */
	private async updateFile(
		file: TFile,
		mapped: MappedContactData,
		syncMeta: SyncMetadata
	): Promise<boolean> {
		let updated = false;

		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			const contactId = String(mapped["Mesh ID"]);
			const lastSynced = syncMeta.contacts[contactId] || {};

			for (const [key, newValue] of Object.entries(mapped)) {
				if (newValue === undefined) continue;

				const currentValue = fm[key];
				const lastSyncedValue = lastSynced[key];

				// Always update Mesh-managed metadata fields
				if (key === "Mesh Last Synced" || key === "Mesh URL" || key === "Mesh ID") {
					if (fm[key] !== newValue) {
						fm[key] = newValue;
						updated = true;
					}
					continue;
				}

				// Field doesn't exist in Obsidian yet -- add it
				if (currentValue === undefined || currentValue === null || currentValue === "") {
					fm[key] = newValue;
					updated = true;
					continue;
				}

				// Field exists and hasn't been manually edited (matches last sync)
				if (JSON.stringify(currentValue) === JSON.stringify(lastSyncedValue)) {
					if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
						fm[key] = newValue;
						updated = true;
					}
					continue;
				}

				// Field was manually edited -- apply conflict resolution
				if (this.plugin.settings.conflictResolution === "mesh") {
					fm[key] = newValue;
					updated = true;
				} else if (this.plugin.settings.conflictResolution === "ask") {
					this.log(`Conflict on ${file.basename}.${key}: Obsidian="${currentValue}" vs Mesh="${newValue}"`);
				}
				// "obsidian" mode: keep current value (do nothing)
			}

			// Update source field
			if (fm["Source"] === "Google Contacts") {
				fm["Source"] = "Mesh";
				updated = true;
			}
		});

		return updated;
	}

	/**
	 * Create a new contact file
	 */
	private async createFile(filePath: string, mapped: MappedContactData): Promise<void> {
		const lines: string[] = ["---"];
		const fieldOrder = [
			"Prof. Contact",
			"Conn. type",
			"Nickname",
			"Title",
			"Email (Private)",
			"Phone",
			"Profession / Position",
			"Met?",
			"Last Update",
			"Company",
			"Birthday",
			"City",
			"Country",
			"Source",
			"Mesh ID",
			"Mesh URL",
			"Mesh Last Synced",
			"LinkedIn",
			"Twitter",
			"GitHub",
			"Instagram",
			"Last Contacted",
			"Relationship Strength",
			"Mesh Tags",
			"Mesh Groups",
			"Photo",
		];

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
			} else if (typeof value === "string" && value.startsWith("http")) {
				lines.push(`${key}: "${value}"`);
			} else {
				lines.push(`${key}: ${value}`);
			}
		}

		lines.push("---");
		lines.push("");

		await this.plugin.app.vault.create(filePath, lines.join("\n"));
	}

	private async ensureFolder(path: string): Promise<void> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!folder) {
			await this.plugin.app.vault.createFolder(path);
		}
	}

	private async getExistingPeopleFiles(folderPath: string): Promise<Map<string, TFile>> {
		const files = new Map<string, TFile>();
		const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);

		if (folder instanceof TFolder) {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === "md") {
					files.set(child.basename, child);
				}
			}
		}

		return files;
	}

	private async loadSyncMetadata(): Promise<SyncMetadata> {
		const data = await this.plugin.loadData();
		return data?.syncMeta || { lastSync: "", contacts: {} };
	}

	private async saveSyncMetadata(meta: SyncMetadata): Promise<void> {
		const data = (await this.plugin.loadData()) || {};
		data.syncMeta = meta;
		await this.plugin.saveData(data);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private log(message: string) {
		if (this.plugin.settings.debugLogging) {
			console.log("[Mesh Sync]", message);
		}
	}
}
