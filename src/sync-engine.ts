import { TFile, TFolder, normalizePath, Notice, stringifyYaml } from "obsidian";
import type MeshPlugin from "./main";
import { ContactMapper } from "./contact-mapper";
import type { MappedContactData } from "./contact-mapper";
import type { MeshContactList, MeshContactDetail, MeshGroup } from "./mesh-api";
import { orderFrontmatter, FIELD_ORDER } from "./frontmatter";
import { computeFieldActions } from "./field-merge";
import type { FieldAction } from "./field-merge";

export interface SyncResult {
	created: number;
	updated: number;
	skipped: number;
	filtered: number;
	unmatched: number; // contacts in me.sh with no existing file (when updateOnly)
	errors: string[];
	conflicts: number;
}

interface SyncMetadata {
	lastSync: string;
	contacts: Record<string, Record<string, unknown>>; // meshId -> last-synced field values
}

export interface SyncConflict {
	file: string; // vault path of the note
	field: string;
	kept: unknown; // the value that stayed in the note
	mesh: unknown; // the differing me.sh value
	type: "direct" | "enriched";
	resolution: "obsidian" | "ask"; // direct only; enriched entries use "obsidian"
}

interface ConflictLog {
	timestamp: string; // ISO, when the sync ran
	conflicts: SyncConflict[];
}

// Small delay between detail API calls to avoid rate limiting
const DETAIL_FETCH_DELAY_MS = 100;

interface FileIndex {
	byMeshId: Map<number, TFile>;
	byEmail: Map<string, TFile>; // lowercased email -> file
	byLowerName: Map<string, TFile>; // lowercased basename -> file
}

export class SyncEngine {
	private plugin: MeshPlugin;

	constructor(plugin: MeshPlugin) {
		this.plugin = plugin;
	}

	async sync(): Promise<SyncResult> {
		const result: SyncResult = {
			created: 0, updated: 0, skipped: 0,
			filtered: 0, unmatched: 0, errors: [], conflicts: 0,
		};
		const conflicts: SyncConflict[] = [];
		const isDryRun = this.plugin.settings.dryRun;
		const isUpdateOnly = this.plugin.settings.updateOnly;

		if (isDryRun) this.log("=== DRY RUN MODE — no files will be written ===");
		if (isUpdateOnly) this.log("=== UPDATE ONLY — no new files will be created ===");

		// Step 1: Fetch contact list (fast, paginated)
		this.log("Fetching contact list from me.sh...", true);
		const contactList = await this.plugin.api.getAllContacts();
		this.log(`Fetched ${contactList.length} contacts from list endpoint`, true);

		// Step 2: Filter out non-person entries
		const realContacts = contactList.filter((c) => ContactMapper.isRealContact(c));
		result.filtered = contactList.length - realContacts.length;
		this.log(`Filtered to ${realContacts.length} real contacts (${result.filtered} skipped)`, true);

		// Step 3: Fetch groups
		const groups = await this.plugin.api.getGroups();
		this.log(`Fetched ${groups.length} groups`, true);

		// Ensure target folder exists
		const folderPath = normalizePath(this.plugin.settings.peopleFolder);
		if (!isDryRun) await this.ensureFolder(folderPath);

		// Load existing files and sync metadata
		const existingFiles = await this.getExistingPeopleFiles(folderPath);
		const fileIndex = this.buildFileIndex(existingFiles);
		const syncMeta = await this.loadSyncMetadata();

		this.log(`Found ${existingFiles.size} existing files in ${folderPath}`, true);

		// Pre-index group membership: contactId -> group titles
		const groupsByContact = new Map<number, string[]>();
		for (const g of groups) {
			for (const contactId of g.contact_ids || []) {
				const titles = groupsByContact.get(contactId);
				if (titles) {
					titles.push(g.title);
				} else {
					groupsByContact.set(contactId, [g.title]);
				}
			}
		}

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

				const groupTitles = groupsByContact.get(detail.id) || [];
				const mapped = ContactMapper.mapContactDetail(detail, groupTitles, this.plugin.settings);
				const fileName = ContactMapper.getFileNameFromDetail(detail, this.plugin.settings.fileNameFormat);
				const filePath = normalizePath(`${folderPath}/${fileName}.md`);

				// Try to match to existing file
				const existingFile = this.findMatchingFile(fileIndex, detail);

				if (existingFile) {
					if (isDryRun) {
						const actions = this.logDryRunUpdate(existingFile, mapped, syncMeta);
						if (actions.length > 0) {
							result.updated++;
						} else {
							result.skipped++;
						}
					} else {
						const updated = await this.updateFile(existingFile, mapped, syncMeta, conflicts);
						if (updated) {
							await this.reorderFrontmatter(existingFile);
							result.updated++;
						} else {
							result.skipped++;
						}
					}
				} else if (isUpdateOnly) {
					this.log(`[unmatched] ${detail.displayName} — no existing file found`, true);
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
			await this.saveConflictLog({ timestamp: new Date().toISOString(), conflicts });
		}

		result.conflicts = conflicts.length;

		this.log(`Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged, ${result.filtered} filtered, ${result.unmatched} unmatched, ${result.errors.length} errors`);
		return result;
	}

	/**
	 * Build lookup indexes over existing files once per sync, so matching a
	 * contact is O(1) instead of an O(files) scan per contact.
	 */
	private buildFileIndex(files: Map<string, TFile>): FileIndex {
		const byMeshId = new Map<number, TFile>();
		const byEmail = new Map<string, TFile>();
		const byLowerName = new Map<string, TFile>();
		for (const [name, file] of files) {
			byLowerName.set(name.toLowerCase(), file);
			const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (typeof fm?.["Mesh ID"] === "number") byMeshId.set(fm["Mesh ID"], file);
			const emails = fm?.["Email (Private)"];
			if (emails) {
				for (const e of String(emails).split(",")) {
					byEmail.set(e.trim().toLowerCase(), file);
				}
			}
		}
		return { byMeshId, byEmail, byLowerName };
	}

	/**
	 * Find an existing file that matches a Mesh contact.
	 * Priority: Mesh ID > email (all emails, both sides) > filename
	 */
	private findMatchingFile(index: FileIndex, contact: MeshContactDetail): TFile | null {
		// Match by Mesh ID first (fastest for subsequent syncs)
		const byId = index.byMeshId.get(contact.id);
		if (byId) return byId;

		// Collect ALL emails from the Mesh contact (not just primary)
		const meshEmails = (contact.information || [])
			.filter((i) => i.type === "email")
			.map((i) => i.value.toLowerCase());

		for (const email of meshEmails) {
			const byEmail = index.byEmail.get(email);
			if (byEmail) return byEmail;
		}

		// Match by file name
		// Normalize: collapse whitespace, case-insensitive
		const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

		const possibleNames = [
			contact.fullName,
			contact.displayName,
			`${contact.firstName} ${contact.lastName}`,
		]
			.filter((n) => n && n.trim() && n.trim() !== ".")
			.map((n) => normalize(n!));

		// Exact match (case-insensitive)
		for (const name of possibleNames) {
			const file = index.byLowerName.get(name);
			if (file) return file;
		}

		// Partial match: me.sh name may have credentials appended
		// e.g., "Lori McLeese, GPHR, SHRM-SCP" should match "Lori Mcleese"
		// Try matching just "FirstName LastName" against existing filenames
		const firstName = (contact.firstName || "").trim().toLowerCase();
		const lastName = (contact.lastName || "").split(",")[0].trim().toLowerCase(); // strip credentials
		if (firstName && lastName) {
			const baseName = `${firstName} ${lastName}`;
			const file = index.byLowerName.get(baseName);
			if (file) return file;
		}

		return null;
	}

	/**
	 * Reorder frontmatter fields to match canonical order.
	 * Fields not in the order list are appended at the end.
	 */
	private async reorderFrontmatter(file: TFile): Promise<void> {
		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			const allKeys = Object.keys(fm);
			const ordered = orderFrontmatter(fm, FIELD_ORDER);

			// Clear and rewrite in order
			for (const key of allKeys) {
				delete fm[key];
			}
			for (const [key, value] of Object.entries(ordered)) {
				fm[key] = value;
			}
		});
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
		syncMeta: SyncMetadata,
		collector: SyncConflict[]
	): Promise<boolean> {
		let updated = false;

		await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			const contactId = String(mapped["Mesh ID"]);
			const lastSynced = syncMeta.contacts[contactId] || {};

			const actions = computeFieldActions(
				fm,
				{ ...mapped } as Record<string, unknown>,
				lastSynced,
				this.plugin.settings.conflictResolution,
				ContactMapper.isEnrichedField
			);

			for (const action of actions) {
				switch (action.kind) {
					case "fill":
					case "update":
						fm[action.key] = action.value;
						updated = true;
						break;
					case "parallel": {
						const currentValue = fm[action.key];
						fm[action.meshKey] = action.value;
						updated = true;
						this.log(`[enriched conflict] ${file.basename} / ${action.key}: keeping "${currentValue}", adding "${action.meshKey}": "${action.value}"`);
						collector.push({
							file: file.path,
							field: action.key,
							kept: currentValue,
							mesh: action.value,
							type: "enriched",
							resolution: "obsidian",
						});
						break;
					}
					case "conflict":
						if (this.plugin.settings.conflictResolution === "ask") {
							this.log(`[conflict] ${file.basename} / ${action.key}: obsidian="${action.current}" vs me.sh="${action.incoming}"`);
						}
						collector.push({
							file: file.path,
							field: action.key,
							kept: action.current,
							mesh: action.incoming,
							type: "direct",
							resolution: this.plugin.settings.conflictResolution as "obsidian" | "ask",
						});
						break;
				}
			}

			// Update source field if migrating from Google Contacts
			if (fm["Source"] === "Google Contacts") {
				fm["Source"] = "Mesh";
				updated = true;
			}

			// Only write metadata fields when actual data changed
			if (updated) {
				fm["Mesh ID"] = mapped["Mesh ID"];
				fm["Mesh URL"] = mapped["Mesh URL"];
				fm["Mesh Last Synced"] = mapped["Mesh Last Synced"];
			} else {
				// Still set Mesh ID/URL on first sync (when they don't exist yet)
				if (!fm["Mesh ID"]) {
					fm["Mesh ID"] = mapped["Mesh ID"];
					fm["Mesh URL"] = mapped["Mesh URL"];
					fm["Mesh Last Synced"] = mapped["Mesh Last Synced"];
					updated = true;
				}
			}
		});

		return updated;
	}

	/**
	 * Log what would change for a file (dry-run mode).
	 *
	 * Drives the report from the same `computeFieldActions` decision logic
	 * `updateFile` uses for a real sync, so dry run reflects `lastSynced`
	 * and `conflictResolution` instead of flagging every raw difference.
	 */
	private logDryRunUpdate(
		file: TFile,
		mapped: MappedContactData,
		syncMeta: SyncMetadata
	): FieldAction[] {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {};
		const contactId = String(mapped["Mesh ID"]);
		const lastSynced = syncMeta.contacts[contactId] || {};

		const actions = computeFieldActions(
			fm,
			{ ...mapped } as Record<string, unknown>,
			lastSynced,
			this.plugin.settings.conflictResolution,
			ContactMapper.isEnrichedField
		);

		// Conflict actions never count as changes in the real path (updateFile
		// never sets `updated` for them), so filter them out here too --
		// otherwise a file whose only actions are conflicts would be counted
		// as "updated" in dry run while the real sync would skip it.
		const changeActions = actions.filter((action) => action.kind !== "conflict");

		const changes = actions
			.map((action) => {
				switch (action.kind) {
					case "fill":
						return `  + ${action.key}: ${JSON.stringify(action.value)}`;
					case "update":
						return `  ~ ${action.key}: ${JSON.stringify(fm[action.key])} → ${JSON.stringify(action.value)}`;
					case "parallel":
						return `  ≠ ${action.key}: keeping current | would add "${action.key} (Me.sh)": ${JSON.stringify(action.value)}`;
					case "conflict":
						// Ask-mode-only, mirroring the real path's silent
						// handling of conflicts in obsidian mode.
						return this.plugin.settings.conflictResolution === "ask"
							? `  ! ${action.key}: conflict (ask mode — no change)`
							: undefined;
				}
			})
			.filter((line): line is string => line !== undefined);

		if (changes.length > 0) {
			this.log(`[dry-run] ${file.basename}:\n${changes.join("\n")}`);
		}

		return changeActions;
	}

	/**
	 * Create a new contact file
	 */
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

	private async saveConflictLog(log: ConflictLog): Promise<void> {
		const data = (await this.plugin.loadData()) || {};
		data.lastConflicts = log;
		await this.plugin.saveData(data);
	}

	async loadConflictLog(): Promise<ConflictLog | null> {
		const data = await this.plugin.loadData();
		return data?.lastConflicts || null;
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** Log to console. Always logs summaries and errors. Detail logs only in dry run. */
	private log(message: string, detailOnly = false) {
		if (detailOnly && !this.plugin.settings.dryRun) return;
		console.log("[Me.sh Sync]", message);
	}
}
