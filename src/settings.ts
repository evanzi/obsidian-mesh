import { App, PluginSettingTab, Setting } from "obsidian";
import type MeshPlugin from "./main";

export interface MeshSettings {
	peopleFolder: string;
	autoSync: boolean;
	syncInterval: number; // minutes
	fileNameFormat: "full" | "lastFirst" | "firstLast";
	conflictResolution: "obsidian" | "mesh" | "ask";
	updateOnly: boolean;
	dryRun: boolean;
	syncSocialProfiles: boolean;
	syncRelationshipData: boolean;
	syncTagsAndGroups: boolean;
	syncPhotos: boolean;
}

export const DEFAULT_SETTINGS: MeshSettings = {
	peopleFolder: "People",
	autoSync: false,
	syncInterval: 60,
	fileNameFormat: "full",
	conflictResolution: "obsidian",
	updateOnly: false,
	dryRun: false,
	syncSocialProfiles: true,
	syncRelationshipData: true,
	syncTagsAndGroups: true,
	syncPhotos: false,
};

export class MeshSettingTab extends PluginSettingTab {
	plugin: MeshPlugin;

	constructor(app: App, plugin: MeshPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Me.sh Sync for Obsidian" });

		// Connection status
		new Setting(containerEl)
			.setName("Connection status")
			.setDesc("Checking me.sh desktop app...")
			.then(async (setting) => {
				try {
					const connected = await this.plugin.auth.checkConnection();
					setting.setDesc(connected ? "Connected to me.sh" : "Not connected -- open me.sh app and log in");
				} catch {
					setting.setDesc("Unable to detect me.sh app");
				}
			});

		// People folder
		new Setting(containerEl)
			.setName("People folder")
			.setDesc("Folder where contact files are stored")
			.addText((text) =>
				text
					.setPlaceholder("People")
					.setValue(this.plugin.settings.peopleFolder)
					.onChange(async (value) => {
						this.plugin.settings.peopleFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// Sync behavior
		containerEl.createEl("h3", { text: "Sync Behavior" });

		new Setting(containerEl)
			.setName("Auto sync")
			.setDesc("Automatically sync contacts in the background")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
					this.plugin.startAutoSync();
					this.display(); // refresh to show/hide interval
				})
			);

		if (this.plugin.settings.autoSync) {
			new Setting(containerEl)
				.setName("Sync interval")
				.setDesc("Minutes between automatic syncs")
				.addDropdown((drop) =>
					drop
						.addOption("30", "Every 30 minutes")
						.addOption("60", "Every hour")
						.addOption("120", "Every 2 hours")
						.addOption("360", "Every 6 hours")
						.addOption("720", "Every 12 hours")
						.addOption("1440", "Every 24 hours")
						.setValue(String(this.plugin.settings.syncInterval))
						.onChange(async (value) => {
							this.plugin.settings.syncInterval = Number(value);
							await this.plugin.saveSettings();
							this.plugin.startAutoSync();
						})
				);
		}

		new Setting(containerEl)
			.setName("Update only")
			.setDesc("Only update existing files -- don't create new contacts. Useful for initial merge testing.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.updateOnly).onChange(async (value) => {
					this.plugin.settings.updateOnly = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Dry run")
			.setDesc("Log what would change to console without writing any files. Open console with Cmd+Option+I.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange(async (value) => {
					this.plugin.settings.dryRun = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Conflict resolution")
			.setDesc("When me.sh data conflicts with manual edits in direct fields (Email, Phone, etc.)")
			.addDropdown((drop) =>
				drop
					.addOption("obsidian", "Obsidian wins (keep manual edits)")
					.addOption("mesh", "Me.sh wins (overwrite with me.sh data)")
					.addOption("ask", "Ask (log conflicts for review)")
					.setValue(this.plugin.settings.conflictResolution)
					.onChange(async (value) => {
						this.plugin.settings.conflictResolution = value as MeshSettings["conflictResolution"];
						await this.plugin.saveSettings();
					})
			);

		// Data options
		containerEl.createEl("h3", { text: "Data Options" });

		new Setting(containerEl)
			.setName("Sync social profiles")
			.setDesc("Sync LinkedIn, Twitter, GitHub, etc.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncSocialProfiles).onChange(async (value) => {
					this.plugin.settings.syncSocialProfiles = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Sync relationship data")
			.setDesc("Sync last contacted date, relationship strength")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncRelationshipData).onChange(async (value) => {
					this.plugin.settings.syncRelationshipData = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Sync tags & groups")
			.setDesc("Sync me.sh tags and group memberships")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTagsAndGroups).onChange(async (value) => {
					this.plugin.settings.syncTagsAndGroups = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
