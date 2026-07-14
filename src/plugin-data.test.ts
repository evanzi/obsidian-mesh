import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, dataWithSettings, settingsFromData } from "./plugin-data";

describe("settingsFromData", () => {
	it("extracts only settings keys, ignoring syncMeta and other unknown keys", () => {
		const result = settingsFromData({
			peopleFolder: "X",
			syncMeta: { lastSync: "T", contacts: { "1": {} } },
		});

		expect(result.peopleFolder).toBe("X");
		expect(result.autoSync).toBe(DEFAULT_SETTINGS.autoSync);
		expect(result.syncInterval).toBe(DEFAULT_SETTINGS.syncInterval);
		expect("syncMeta" in result).toBe(false);
	});

	it("returns DEFAULT_SETTINGS when data is null", () => {
		expect(settingsFromData(null)).toEqual(DEFAULT_SETTINGS);
	});
});

describe("dataWithSettings", () => {
	it("preserves syncMeta unchanged and includes all settings keys", () => {
		const syncMeta = { lastSync: "T", contacts: { "1": {} } };
		const settings = { ...DEFAULT_SETTINGS, peopleFolder: "Contacts" };

		const result = dataWithSettings({ syncMeta }, settings);

		expect(result.syncMeta).toBe(syncMeta);
		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
			expect(result[key]).toBe(settings[key]);
		}
	});

	it("round-trip: a syncMeta write to disk after settings were loaded is not clobbered by a later settings save", () => {
		// 1. Plugin loads with an old settings snapshot (data.json has syncMeta v1).
		const settings = settingsFromData({ peopleFolder: "People", syncMeta: { lastSync: "v1", contacts: {} } });

		// 2. A sync completes and writes syncMeta v2 to disk (independent of `settings`).
		const diskAfterSync = { peopleFolder: "People", syncMeta: { lastSync: "v2", contacts: { "1": {} } } };

		// 3. The user toggles a setting and saveSettings() re-reads disk before writing.
		settings.peopleFolder = "Contacts";
		const result = dataWithSettings(diskAfterSync, settings);

		// The NEW syncMeta (v2) must survive, not the stale v1 snapshot held in `settings`.
		expect(result.syncMeta).toEqual({ lastSync: "v2", contacts: { "1": {} } });
		expect(result.peopleFolder).toBe("Contacts");
	});
});
