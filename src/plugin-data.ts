// Pure, obsidian-free helpers for reading/writing the plugin's persisted
// data.json. Kept separate from settings.ts (which imports the `obsidian`
// module at runtime) so these can be unit tested with vitest.

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
	syncNotes: boolean;
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
	syncNotes: false,
	syncPhotos: false,
};

/** Extract only settings keys from a raw data.json object. */
export function settingsFromData(data: unknown): MeshSettings {
	const raw = (data ?? {}) as Record<string, unknown>;
	const settings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof MeshSettings)[]) {
		if (raw[key] !== undefined) (settings as Record<string, unknown>)[key] = raw[key];
	}
	return settings;
}

/** Merge settings into a raw data.json object, preserving all other keys (syncMeta). */
export function dataWithSettings(data: unknown, settings: MeshSettings): Record<string, unknown> {
	return { ...((data ?? {}) as Record<string, unknown>), ...settings };
}
