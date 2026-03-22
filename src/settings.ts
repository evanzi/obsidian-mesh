import { App, PluginSettingTab, Setting } from "obsidian";
import type MeshPlugin from "./main";

export interface MeshSettings {
	peopleFolder: string;
	syncInterval: number; // hours, 0 = manual only
	syncOnStartup: boolean;
	fileNameFormat: "full" | "lastFirst" | "firstLast";
	conflictResolution: "obsidian" | "mesh" | "ask";
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

		containerEl.createEl("h2", { text: "Mesh Settings" });

		// Connection status
		new Setting(containerEl)
			.setName("Connection Status")
			.setDesc("Checking Mesh desktop app...")
			.then(async (setting) => {
				try {
					const connected = await this.plugin.auth.checkConnection();
					setting.setDesc(connected ? "Connected" : "Not connected - open Mesh app and log in");
				} catch {
					setting.setDesc("Unable to detect Mesh app");
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

		// Conflict resolution
		new Setting(containerEl)
			.setName("Conflict resolution")
			.setDesc("When Mesh data conflicts with manual edits in Obsidian")
			.addDropdown((drop) =>
				drop
					.addOption("obsidian", "Obsidian wins (keep manual edits)")
					.addOption("mesh", "Mesh wins (overwrite with Mesh data)")
					.addOption("ask", "Ask (flag for review)")
					.setValue(this.plugin.settings.conflictResolution)
					.onChange(async (value) => {
						this.plugin.settings.conflictResolution = value as MeshSettings["conflictResolution"];
						await this.plugin.saveSettings();
					})
			);

		// Sync options
		containerEl.createEl("h3", { text: "Sync Options" });

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
			.setDesc("Sync Mesh tags and group memberships")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTagsAndGroups).onChange(async (value) => {
					this.plugin.settings.syncTagsAndGroups = value;
					await this.plugin.saveSettings();
				})
			);

		// Debug
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
