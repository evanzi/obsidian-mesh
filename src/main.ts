import { Plugin, Notice, addIcon } from "obsidian";
import { MeshSettingTab, MeshSettings, DEFAULT_SETTINGS } from "./settings";
import { MeshAuth } from "./mesh-auth";
import { MeshAPI } from "./mesh-api";
import { SyncEngine } from "./sync-engine";

// Me.sh logo -- uses currentColor to adapt to light/dark mode
const MESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 26" fill="currentColor" stroke="none"><path d="M32.03 0C36.44 0 40 3.43 40 7.68v13.33A4.94 4.94 0 0 1 35.13 26a4.9 4.9 0 0 1-4.83-4.99V7.68c0-.92.77-1.67 1.73-1.67s1.74.75 1.74 1.67v13.33c0 .9.61 1.65 1.36 1.65s1.4-.75 1.4-1.65V7.68c0-2.4-2-4.34-4.5-4.34a4.43 4.43 0 0 0-4.5 4.34v13.33A4.94 4.94 0 0 1 22.66 26a4.9 4.9 0 0 1-4.83-4.99V7.68c0-.92.77-1.67 1.73-1.67s1.74.75 1.74 1.67v13.33c0 .9.61 1.65 1.36 1.65s1.4-.75 1.4-1.65V7.68c0-2.4-2-4.34-4.5-4.34a4.43 4.43 0 0 0-4.5 4.34v13.33A4.9 4.9 0 0 1 10.23 26a4.9 4.9 0 0 1-4.83-4.99V7.68c0-.92.77-1.67 1.73-1.67s1.74.75 1.74 1.67v13.33c0 .91.62 1.65 1.36 1.65s1.37-.74 1.37-1.65V7.68c0-2.4-1.99-4.34-4.47-4.34-1.6 0-3.07.82-3.9 2.17a1.77 1.77 0 0 1-2.37.61 1.64 1.64 0 0 1-.63-2.28A8 8 0 0 1 7.13 0a8 8 0 0 1 6.01 2.69l.19.21.19-.21a8.1 8.1 0 0 1 12.09 0l.19.21.19-.21A8 8 0 0 1 32.03 0"/></svg>`;

export default class MeshPlugin extends Plugin {
	settings: MeshSettings;
	auth: MeshAuth;
	api: MeshAPI;
	syncEngine: SyncEngine;
	private autoSyncInterval: number | null = null;
	private isSyncing = false;

	async onload() {
		await this.loadSettings();

		this.auth = new MeshAuth(this);
		this.api = new MeshAPI(this);
		this.syncEngine = new SyncEngine(this);

		// Register me.sh logo icon
		addIcon("mesh-logo", MESH_ICON);

		// Ribbon icon for manual sync
		this.addRibbonIcon("mesh-logo", "Sync Me.sh", async () => {
			await this.runSync();
		});

		// Command palette
		this.addCommand({
			id: "sync-now",
			name: "Sync contacts from me.sh",
			callback: async () => {
				await this.runSync();
			},
		});

		this.addCommand({
			id: "open-in-mesh",
			name: "Open current contact in me.sh",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
					if (fm?.["Mesh ID"]) {
						if (!checking) {
							window.open(`https://app.me.sh/contact/${fm["Mesh ID"]}`);
						}
						return true;
					}
				}
				return false;
			},
		});

		this.addSettingTab(new MeshSettingTab(this.app, this));

		// Start auto-sync if enabled
		this.startAutoSync();
	}

	/**
	 * Start or restart the auto-sync interval timer.
	 * Called on load and whenever settings change.
	 */
	startAutoSync() {
		// Clear any existing timer
		this.stopAutoSync();

		if (!this.settings.autoSync || this.settings.syncInterval <= 0) {
			return;
		}

		const intervalMs = this.settings.syncInterval * 60 * 1000;
		this.autoSyncInterval = window.setInterval(async () => {
			await this.runBackgroundSync();
		}, intervalMs);

		// Register with Obsidian so it cleans up on unload
		this.registerInterval(this.autoSyncInterval);
	}

	/**
	 * Stop the auto-sync interval timer.
	 */
	private stopAutoSync() {
		if (this.autoSyncInterval !== null) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	/**
	 * Manual sync -- shows notices for progress and results.
	 */
	async runSync() {
		if (this.isSyncing) {
			new Notice("Me.sh: Sync already in progress");
			return;
		}

		this.isSyncing = true;
		try {
			new Notice("Me.sh: Starting sync...");
			const result = await this.syncEngine.sync();
			const parts = [`${result.created} new`, `${result.updated} updated`];
			if (result.unmatched > 0) parts.push(`${result.unmatched} unmatched`);
			if (result.filtered > 0) parts.push(`${result.filtered} filtered`);
			if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
			new Notice(`Me.sh: ${parts.join(", ")}`);
		} catch (error) {
			console.error("[Me.sh Sync] failed:", error);
			if (error instanceof Error && error.message.includes("auth")) {
				new Notice("Me.sh: Please open the me.sh app and log in, then try again.");
			} else {
				new Notice(`Me.sh: Sync failed - ${error instanceof Error ? error.message : "unknown error"}`);
			}
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Background sync -- silent on success, only shows notice on errors.
	 */
	private async runBackgroundSync() {
		if (this.isSyncing) return;

		this.isSyncing = true;
		try {
			const result = await this.syncEngine.sync();
			if (result.errors.length > 0) {
				new Notice(`Me.sh: Background sync completed with ${result.errors.length} errors`);
			}
		} catch (error) {
			console.error("[Me.sh Sync] background sync failed:", error);
			// Don't show auth errors on background sync -- just log them
		} finally {
			this.isSyncing = false;
		}
	}

	onunload() {
		this.stopAutoSync();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
