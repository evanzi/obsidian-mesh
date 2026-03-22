import { Plugin, Notice } from "obsidian";
import { MeshSettingTab, MeshSettings, DEFAULT_SETTINGS } from "./settings";
import { MeshAuth } from "./mesh-auth";
import { MeshAPI } from "./mesh-api";
import { SyncEngine } from "./sync-engine";

export default class MeshPlugin extends Plugin {
	settings: MeshSettings;
	auth: MeshAuth;
	api: MeshAPI;
	syncEngine: SyncEngine;

	async onload() {
		await this.loadSettings();

		this.auth = new MeshAuth(this);
		this.api = new MeshAPI(this);
		this.syncEngine = new SyncEngine(this);

		// Ribbon icon for manual sync
		this.addRibbonIcon("refresh-cw", "Sync Me.sh", async () => {
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

		console.log("Me.sh Sync plugin loaded");
	}

	async runSync() {
		try {
			new Notice("Me.sh: Starting sync...");
			const result = await this.syncEngine.sync();
			const parts = [`${result.created} new`, `${result.updated} updated`];
			if (result.unmatched > 0) parts.push(`${result.unmatched} unmatched`);
			if (result.filtered > 0) parts.push(`${result.filtered} filtered`);
			if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
			new Notice(`Me.sh: ${parts.join(", ")}`);
		} catch (error) {
			console.error("Mesh sync failed:", error);
			if (error instanceof Error && error.message.includes("auth")) {
				new Notice("Me.sh: Please open the me.sh app and log in, then try again.");
			} else {
				new Notice(`Me.sh: Sync failed - ${error instanceof Error ? error.message : "unknown error"}`);
			}
		}
	}

	onunload() {
		console.log("Me.sh Sync plugin unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
