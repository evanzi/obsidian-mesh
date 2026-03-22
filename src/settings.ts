import { App, PluginSettingTab, Setting } from "obsidian";
import type MeshPlugin from "./main";

export interface MeshSettings {
	peopleFolder: string;
	syncInterval: number; // hours, 0 = manual only
	syncOnStartup: boolean;
	fileNameFormat: "full" | "lastFirst" | "firstLast";
	conflictResolution: "obsidian" | "mesh" | "ask";
	updateOnly: boolean; // only update existing files, don't create new ones
	dryRun: boolean; // log what would change without writing
	syncSocialProfiles: boolean;
	syncRelationshipData: boolean;
	syncTagsAndGroups: boolean;
	syncPhotos: boolean;
	debugLogging: boolean;
}

export const DEFAULT_SETTINGS: MeshSettings = {
	peopleFolder: "People",
	syncInterval: 0,
	syncOnStartup: false,
	fileNameFormat: "full",
	conflictResolution: "obsidian",
	updateOnly: false,
	dryRun: false,
	syncSocialProfiles: true,
	syncRelationshipData: true,
	syncTagsAndGroups: true,
	syncPhotos: false,
	debugLogging: false,
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

		containerEl.createEl("h2", { text: "Me.sh Sync Settings" });

		// Connection status
		new Setting(containerEl)
			.setName("Connection status")
			.setDesc("Checking me.sh desktop app...")
			.then(async (setting) => {
				try {
					const connected = await this.plugin.auth.checkConnection();
					setting.setDesc(connected ? "Connected to me.sh" : "Not connected — open me.sh app and log in");
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
			.setName("Update only")
			.setDesc("Only update existing files — don't create new contacts. Useful for initial merge testing.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.updateOnly).onChange(async (value) => {
					this.plugin.settings.updateOnly = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Dry run")
			.setDesc("Log what would change to console without writing any files. Check console (Ctrl+Shift+I) for output.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange(async (value) => {
					this.plugin.settings.dryRun = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Conflict resolution")
			.setDesc("When me.sh data conflicts with manual edits in fields me.sh manages (Email, Company, Title, etc.)")
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

		// Debug
		containerEl.createEl("h3", { text: "Advanced" });

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Log detailed sync info to console")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
					this.plugin.settings.debugLogging = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
