import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { SyncEngine } from "./sync-engine";
import type { MeshContactDetail } from "./mesh-api";

/**
 * `TFile` is `import type`-only here (never constructed) so this file never
 * touches the real, types-only `obsidian` package at runtime -- only
 * `sync-engine.ts` does, and vitest aliases that to `src/__mocks__/obsidian.ts`.
 * A plain object with `path`/`basename` is all buildFileIndex/findMatchingFile
 * ever read off a TFile.
 */
function makeFile(path: string): TFile {
	const basename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	return { path, basename } as unknown as TFile;
}

/**
 * Minimal plugin stub: SyncEngine's private buildFileIndex/findMatchingFile
 * only touch `plugin.app.metadataCache.getFileCache`.
 */
function makePluginStub(frontmatterByPath: Record<string, Record<string, unknown> | undefined>) {
	return {
		app: {
			metadataCache: {
				getFileCache: (file: TFile) => ({ frontmatter: frontmatterByPath[file.path] }),
			},
		},
	} as unknown as ConstructorParameters<typeof SyncEngine>[0];
}

function makeContactDetail(overrides: Partial<MeshContactDetail> = {}): MeshContactDetail {
	return {
		id: 1,
		objectID: "obj-1",
		created: 0,
		displayName: "",
		fullName: "",
		firstName: "",
		middleName: "",
		lastName: "",
		nickname: "",
		bio: "",
		byline: "",
		headline: "",
		organization: "",
		organizations: [],
		title: "",
		avatarURL: null,
		primaryLocation: null,
		locations: [],
		birthday: { month: null, day: null, year: null },
		linkedinURL: "",
		twitterURL: "",
		twitterHandle: "",
		githubURL: "",
		instagramURL: "",
		facebookURL: "",
		website: "",
		websites: [],
		information: [],
		notes: [],
		score: 0,
		relationship: null,
		isClayUser: false,
		interactionType: "",
		integrations: [],
		lastInteractionDate: null,
		firstInteractionDate: null,
		lastEmailDate: null,
		lastMeetingDate: null,
		lists: [],
		starred: false,
		...overrides,
	};
}

/** Reach into SyncEngine's private methods for focused testing. */
type SyncEngineInternals = {
	buildFileIndex: (files: Map<string, TFile>) => {
		byMeshId: Map<number, TFile>;
		byEmail: Map<string, TFile>;
		byLowerName: Map<string, TFile>;
	};
	findMatchingFile: (
		index: ReturnType<SyncEngineInternals["buildFileIndex"]>,
		contact: MeshContactDetail
	) => TFile | null;
};

describe("SyncEngine.buildFileIndex / findMatchingFile", () => {
	it("matches by Mesh ID over email and name", () => {
		const idFile = makeFile("People/Id Match.md");
		const emailFile = makeFile("People/Email Match.md");
		const nameFile = makeFile("People/Jane Doe.md");
		const files = new Map([
			[idFile.basename, idFile],
			[emailFile.basename, emailFile],
			[nameFile.basename, nameFile],
		]);
		const plugin = makePluginStub({
			[idFile.path]: { "Mesh ID": 42 },
			[emailFile.path]: { "Email (Private)": "jane@example.com" },
			[nameFile.path]: {},
		});
		const engine = new SyncEngine(plugin) as unknown as SyncEngineInternals;
		const index = engine.buildFileIndex(files);

		const contact = makeContactDetail({
			id: 42,
			fullName: "Jane Doe",
			information: [{ type: "email", value: "jane@example.com" }],
		});

		expect(engine.findMatchingFile(index, contact)).toBe(idFile);
	});

	it("matches by email when Mesh ID does not match, splitting comma-separated emails", () => {
		const emailFile = makeFile("People/Email Match.md");
		const files = new Map([[emailFile.basename, emailFile]]);
		const plugin = makePluginStub({
			[emailFile.path]: { "Email (Private)": "old@example.com, jane@example.com" },
		});
		const engine = new SyncEngine(plugin) as unknown as SyncEngineInternals;
		const index = engine.buildFileIndex(files);

		const contact = makeContactDetail({
			id: 99,
			information: [{ type: "email", value: "JANE@EXAMPLE.COM" }],
		});

		expect(engine.findMatchingFile(index, contact)).toBe(emailFile);
	});

	it("matches by case-insensitive, whitespace-collapsed name when no ID/email match", () => {
		const nameFile = makeFile("People/Jane Doe.md");
		const files = new Map([[nameFile.basename, nameFile]]);
		const plugin = makePluginStub({ [nameFile.path]: {} });
		const engine = new SyncEngine(plugin) as unknown as SyncEngineInternals;
		const index = engine.buildFileIndex(files);

		const contact = makeContactDetail({ id: 7, fullName: "  jane   DOE  " });

		expect(engine.findMatchingFile(index, contact)).toBe(nameFile);
	});

	it("falls back to credential-stripped first/last name", () => {
		const nameFile = makeFile("People/Lori Mcleese.md");
		const files = new Map([[nameFile.basename, nameFile]]);
		const plugin = makePluginStub({ [nameFile.path]: {} });
		const engine = new SyncEngine(plugin) as unknown as SyncEngineInternals;
		const index = engine.buildFileIndex(files);

		const contact = makeContactDetail({
			id: 8,
			firstName: "Lori",
			lastName: "McLeese, GPHR, SHRM-SCP",
			fullName: "Lori McLeese, GPHR, SHRM-SCP",
			displayName: "Lori McLeese, GPHR, SHRM-SCP",
		});

		expect(engine.findMatchingFile(index, contact)).toBe(nameFile);
	});

	it("returns null when nothing matches", () => {
		const nameFile = makeFile("People/Someone Else.md");
		const files = new Map([[nameFile.basename, nameFile]]);
		const plugin = makePluginStub({ [nameFile.path]: {} });
		const engine = new SyncEngine(plugin) as unknown as SyncEngineInternals;
		const index = engine.buildFileIndex(files);

		const contact = makeContactDetail({ id: 123, fullName: "Nobody Here" });

		expect(engine.findMatchingFile(index, contact)).toBeNull();
	});

	it("ignores a dot-only candidate name (empty-name guard preserved)", () => {
		const nameFile = makeFile("People/Dot.md");
		const files = new Map([[nameFile.basename, nameFile]]);
		const plugin = makePluginStub({ [nameFile.path]: {} });
		const engine = new SyncEngine(plugin) as unknown as SyncEngineInternals;
		const index = engine.buildFileIndex(files);

		// fullName "." must be filtered out by the `n.trim() !== "."` guard,
		// and firstName/lastName are both empty so the credential-stripped
		// fallback never runs either -- overall this must not match "Dot".
		const contact = makeContactDetail({ id: 456, fullName: "." });

		expect(engine.findMatchingFile(index, contact)).toBeNull();
	});
});
