import { describe, expect, it } from "vitest";
import { computeFieldActions } from "./field-merge";

const isEnrichedField = (key: string) =>
	["Company", "Title", "City", "Country", "Birthday", "Bio"].includes(key);
const isManagedField = (key: string) => key === "Me.sh Notes";
const noManagedFields = () => false;

describe("computeFieldActions", () => {
	it("fills an empty direct field", () => {
		const actions = computeFieldActions(
			{ Phone: "" },
			{ Phone: "555-1234" },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([{ kind: "fill", key: "Phone", value: "555-1234" }]);
	});

	it("updates a direct field unchanged since last sync when mesh differs", () => {
		const actions = computeFieldActions(
			{ Phone: "555-1234" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([{ kind: "update", key: "Phone", value: "555-9999" }]);
	});

	it("reports a conflict on a manually edited field when resolution is obsidian (user value kept)", () => {
		const actions = computeFieldActions(
			{ Phone: "555-MANUAL" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([
			{ kind: "conflict", key: "Phone", current: "555-MANUAL", incoming: "555-9999" },
		]);
	});

	it("updates a manually edited field when resolution is mesh", () => {
		const actions = computeFieldActions(
			{ Phone: "555-MANUAL" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"mesh",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([{ kind: "update", key: "Phone", value: "555-9999" }]);
	});

	it("reports a conflict on a manually edited field when resolution is ask", () => {
		const actions = computeFieldActions(
			{ Phone: "555-MANUAL" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"ask",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([
			{ kind: "conflict", key: "Phone", current: "555-MANUAL", incoming: "555-9999" },
		]);
	});

	it("fills an empty enriched field", () => {
		const actions = computeFieldActions(
			{ Company: "" },
			{ Company: "Acme" },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([{ kind: "fill", key: "Company", value: "Acme" }]);
	});

	it("takes no action when an enriched field already matches", () => {
		const actions = computeFieldActions(
			{ Company: "Acme" },
			{ Company: "Acme" },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([]);
	});

	it("writes a parallel (Me.sh) field for a differing enriched field", () => {
		const actions = computeFieldActions(
			{ Company: "Acme Corp" },
			{ Company: "Acme Inc" },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([
			{ kind: "parallel", key: "Company", meshKey: "Company (Me.sh)", value: "Acme Inc" },
		]);
	});

	it("emits a parallel-existing action when the parallel (Me.sh) field already equals the incoming value", () => {
		const actions = computeFieldActions(
			{ Company: "Acme Corp", "Company (Me.sh)": "Acme Inc" },
			{ Company: "Acme Inc" },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([
			{ kind: "parallel-existing", key: "Company", meshKey: "Company (Me.sh)", value: "Acme Inc" },
		]);
	});

	it("never produces actions for metadata keys", () => {
		const actions = computeFieldActions(
			{},
			{ "Mesh ID": 42, "Mesh URL": "https://me.sh/c/42", "Mesh Last Synced": "2026-07-14T00:00" },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([]);
	});

	it("skips undefined incoming values", () => {
		const actions = computeFieldActions(
			{ Phone: "" },
			{ Phone: undefined },
			{},
			"obsidian",
			isEnrichedField,
			noManagedFields
		);
		expect(actions).toEqual([]);
	});

	describe("managed fields (e.g. Me.sh Notes)", () => {
		it("fills an empty managed field", () => {
			const actions = computeFieldActions(
				{ "Me.sh Notes": "" },
				{ "Me.sh Notes": ["2026-01-01: hello"] },
				{},
				"obsidian",
				isEnrichedField,
				isManagedField
			);
			expect(actions).toEqual([
				{ kind: "fill", key: "Me.sh Notes", value: ["2026-01-01: hello"] },
			]);
		});

		it("takes no action when a managed field already matches", () => {
			const actions = computeFieldActions(
				{ "Me.sh Notes": ["2026-01-01: hello"] },
				{ "Me.sh Notes": ["2026-01-01: hello"] },
				{},
				"obsidian",
				isEnrichedField,
				isManagedField
			);
			expect(actions).toEqual([]);
		});

		it.each(["obsidian", "mesh", "ask"] as const)(
			"overwrites a user-edited managed field with the incoming value regardless of resolution mode (%s)",
			(conflictResolution) => {
				const actions = computeFieldActions(
					{ "Me.sh Notes": ["user edited this"] },
					{ "Me.sh Notes": ["2026-01-01: hello"] },
					{},
					conflictResolution,
					isEnrichedField,
					isManagedField
				);
				expect(actions).toEqual([
					{ kind: "update", key: "Me.sh Notes", value: ["2026-01-01: hello"] },
				]);
			}
		);
	});
});
