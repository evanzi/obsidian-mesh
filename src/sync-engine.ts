import { TFile, TFolder, normalizePath, Notice } from "obsidian";
import type MeshPlugin from "./main";
import { ContactMapper, ENRICHED_FIELDS } from "./contact-mapper";
import type { MappedContactData } from "./contact-mapper";
import type { MeshContactList, MeshContactDetail, MeshGroup } from "./mesh-api";

export interface SyncResult {
	created: number;
	updated: number;
	skipped: number;
	filtered: number;
	unmatched: number; // contacts in me.sh with no existing file (when updateOnly)
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
		const result: SyncResult = {
			created: 0, updated: 0, skipped: 0,
			filtered: 0, unmatched: 0, errors: [],
		};
		const isDryRun = this.plugin.settings.dryRun;
		const isUpdateOnly = this.plugin.settings.updateOnly;

		if (isDryRun) this.log("=== DRY RUN MODE — no files will be written ===");
		if (isUpdateOnly) this.log("=== UPDATE ONLY — no new files will be created ===");

		// Step 1: Fetch contact list (fast, paginated)
		this.log("Fetching contact list from me.sh...");
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
		if (!isDryRun) await this.ensureFolder(folderPath);

		// Load existing files and sync metadata
		const existingFiles = await this.getExistingPeopleFiles(folderPath);
		const syncMeta = isDryRun ? { lastSync: "", contacts: {} } : await this.loadSyncMetadata();

		this.log(`Found ${existingFiles.size} existing files in ${folderPath}`);

		// Step 4: Fetch detail for each contact and sync
		for (let i = 0; i < realContacts.length; i++) {
			const listContact = realContacts[i];

			// Progress update every 50 contacts
			if (i > 0 && i % 50 === 0) {
				new Notice(`Me.sh: Syncing ${i}/${realContacts.length}...`);
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
					if (isDryRun) {
						this.logDryRunUpdate(existingFile, mapped, syncMeta);
						result.updated++;
					} else {
						const updated = await this.updateFile(existingFile, mapped, syncMeta);
						if (updated) {
							result.updated++;
						} else {
							result.skipped++;
						}
					}
				} else if (isUpdateOnly) {
					this.log(`[unmatched] ${detail.displayName} — no existing file found`);
					result.unmatched++;
				} else {
					if (isDryRun) {
						this.log(`[dry-run] Would create: ${filePath}`);
						result.created++;
					} else {
						await this.createFile(filePath, mapped);
						result.created++;
					}
				}

				// Store sync metadata (skip in dry run)
				if (!isDryRun) {
					syncMeta.contacts[String(detail.id)] = { ...mapped } as Record<string, unknown>;
				}

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

		// Save sync metadata (skip in dry run)
		if (!isDryRun) {
			syncMeta.lastSync = new Date().toISOString();
			await this.saveSyncMetadata(syncMeta);
		}

		this.log(`Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged, ${result.filtered} filtered, ${result.unmatched} unmatched, ${result.errors.length} errors`);
		return result;
	}

	/**
	 * Find an existing file that matches a Mesh contact.
	 * Priority: Mesh ID > email (all emails, both sides) > filename
	 */
	private findMatchingFile(
		files: Map<string, TFile>,
		contact: MeshContactDetail,
		mapped: MappedContactData
	): TFile | null {
		// Match by Mesh ID first (fastest for subsequent syncs)
		for (const [_, file] of files) {
			const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm?.["Mesh ID"] === contact.id) return file;
		}

		// Collect ALL emails from the Mesh contact (not just primary)
		const meshEmails = (contact.information || [])
			.filter((i) => i.type === "email")
			.map((i) => i.value.toLowerCase());

		if (meshEmails.length > 0) {
			for (const [_, file] of files) {
				const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
				const existingEmail = fm?.["Email (Private)"];
				if (!existingEmail) continue;

				// Split comma-separated emails in the Obsidian file
				const obsidianEmails = String(existingEmail).split(",").map((e) => e.trim().toLowerCase());

				// Check if ANY Mesh email matches ANY Obsidian email
				if (meshEmails.some((me) => obsidianEmails.includes(me))) {
					return file;
				}
			}
		}

		// Match by file name
		// Normalize: collapse whitespace, case-insensitive
		const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

		// Build a case-insensitive lookup from existing files
		const filesLower = new Map<string, TFile>();
		for (const [name, file] of files) {
			filesLower.set(name.toLowerCase(), file);
		}

		const possibleNames = [
			contact.fullName,
			contact.displayName,
			`${contact.firstName} ${contact.lastName}`,
		]
			.filter((n) => n && n.trim() && n.trim() !== ".")
			.map((n) => normalize(n!));

		// Exact match (case-insensitive)
		for (const name of possibleNames) {
			const file = filesLower.get(name);
			if (file) return file;
		}

		// Partial match: me.sh name may have credentials appended
		// e.g., "Lori McLeese, GPHR, SHRM-SCP" should match "Lori Mcleese"
		// Try matching just "FirstName LastName" against existing filenames
		const firstName = (contact.firstName || "").trim().toLowerCase();
		const lastName = (contact.lastName || "").split(",")[0].trim().toLowerCase(); // strip credentials
		if (firstName && lastName) {
			const baseName = `${firstName} ${lastName}`;
			const file = filesLower.get(baseName);
			if (file) return file;
		}

		return null;
	}

	/**
	 * Update an existing file with me.sh data.
	 *
	 * Direct fields: standard sync behavior (fill empty, conflict resolution).
	 * Enriched fields (Company, Title, City, Country, Birthday): never overwrite
	 * existing data. When me.sh has different data, write to a parallel
	 * "Field (Me.sh)" field so the user can compare both values.
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

				// Always update me.sh metadata fields
				if (key === "Mesh Last Synced" || key === "Mesh URL" || key === "Mesh ID") {
					if (fm[key] !== newValue) {
						fm[key] = newValue;
						updated = true;
					}
					continue;
				}

				const currentValue = fm[key];
				const isEnriched = ContactMapper.isEnrichedField(key);

				if (isEnriched) {
					// ── Enriched field handling ──
					// Empty in Obsidian → fill it
					if (currentValue === undefined || currentValue === null || currentValue === "") {
						fm[key] = newValue;
						updated = true;
						continue;
					}

					// Same value → nothing to do
					if (JSON.stringify(currentValue) === JSON.stringify(newValue)) {
						continue;
					}

					// Different value → write to parallel "(Me.sh)" field, keep original
					const meshKey = `${key} (Me.sh)`;
					const existingMeshValue = fm[meshKey];

					// Only update the (Me.sh) field if the value changed
					if (JSON.stringify(existingMeshValue) !== JSON.stringify(newValue)) {
						fm[meshKey] = newValue;
						updated = true;
						this.log(`[enriched conflict] ${file.basename} / ${key}: keeping "${currentValue}", adding "${key} (Me.sh)": "${newValue}"`);
					}
				} else {
					// ── Direct field handling ──
					const lastSyncedValue = lastSynced[key];

					// Empty in Obsidian → fill it
					if (currentValue === undefined || currentValue === null || currentValue === "") {
						fm[key] = newValue;
						updated = true;
						continue;
					}

					// Same as last sync → safe to update from me.sh
					if (JSON.stringify(currentValue) === JSON.stringify(lastSyncedValue)) {
						if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
							fm[key] = newValue;
							updated = true;
						}
						continue;
					}

					// Manually edited → apply conflict resolution
					if (this.plugin.settings.conflictResolution === "mesh") {
						fm[key] = newValue;
						updated = true;
					} else if (this.plugin.settings.conflictResolution === "ask") {
						this.log(`[conflict] ${file.basename} / ${key}: obsidian="${currentValue}" vs me.sh="${newValue}"`);
					}
				}
			}

			// Update source field if migrating from Google Contacts
			if (fm["Source"] === "Google Contacts") {
				fm["Source"] = "Mesh";
				updated = true;
			}
		});

		return updated;
	}

	/**
	 * Log what would change for a file (dry-run mode)
	 */
	private logDryRunUpdate(
		file: TFile,
		mapped: MappedContactData,
		syncMeta: SyncMetadata
	): void {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {};
		const changes: string[] = [];

		for (const [key, newValue] of Object.entries(mapped)) {
			if (newValue === undefined) continue;
			if (key === "Mesh Last Synced") continue;

			const currentValue = fm[key];
			const isEmpty = currentValue === undefined || currentValue === null || currentValue === "";
			const isEnriched = ContactMapper.isEnrichedField(key);

			if (isEmpty) {
				changes.push(`  + ${key}: ${JSON.stringify(newValue)}`);
			} else if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
				if (isEnriched) {
					changes.push(`  ≠ ${key}: keeping "${currentValue}" | would add "${key} (Me.sh)": ${JSON.stringify(newValue)}`);
				} else {
					changes.push(`  ~ ${key}: ${JSON.stringify(currentValue)} → ${JSON.stringify(newValue)}`);
				}
			}
		}

		if (changes.length > 0) {
			this.log(`[dry-run] ${file.basename}:\n${changes.join("\n")}`);
		}
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
			"Mesh Sources",
			"Bio",
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
			console.log("[Me.sh Sync]", message);
		}
	}
}
