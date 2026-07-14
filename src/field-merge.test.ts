import { describe, expect, it } from "vitest";
import { computeFieldActions } from "./field-merge";

const isEnrichedField = (key: string) =>
	["Company", "Title", "City", "Country", "Birthday", "Bio"].includes(key);

describe("computeFieldActions", () => {
	it("fills an empty direct field", () => {
		const actions = computeFieldActions(
			{ Phone: "" },
			{ Phone: "555-1234" },
			{},
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([{ kind: "fill", key: "Phone", value: "555-1234" }]);
	});

	it("updates a direct field unchanged since last sync when mesh differs", () => {
		const actions = computeFieldActions(
			{ Phone: "555-1234" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([{ kind: "update", key: "Phone", value: "555-9999" }]);
	});

	it("takes no action on a manually edited field when resolution is obsidian", () => {
		const actions = computeFieldActions(
			{ Phone: "555-MANUAL" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([]);
	});

	it("updates a manually edited field when resolution is mesh", () => {
		const actions = computeFieldActions(
			{ Phone: "555-MANUAL" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"mesh",
			isEnrichedField
		);
		expect(actions).toEqual([{ kind: "update", key: "Phone", value: "555-9999" }]);
	});

	it("reports a conflict on a manually edited field when resolution is ask", () => {
		const actions = computeFieldActions(
			{ Phone: "555-MANUAL" },
			{ Phone: "555-9999" },
			{ Phone: "555-1234" },
			"ask",
			isEnrichedField
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
			isEnrichedField
		);
		expect(actions).toEqual([{ kind: "fill", key: "Company", value: "Acme" }]);
	});

	it("takes no action when an enriched field already matches", () => {
		const actions = computeFieldActions(
			{ Company: "Acme" },
			{ Company: "Acme" },
			{},
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([]);
	});

	it("writes a parallel (Me.sh) field for a differing enriched field", () => {
		const actions = computeFieldActions(
			{ Company: "Acme Corp" },
			{ Company: "Acme Inc" },
			{},
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([
			{ kind: "parallel", key: "Company", meshKey: "Company (Me.sh)", value: "Acme Inc" },
		]);
	});

	it("takes no action when the parallel (Me.sh) field already equals the incoming value", () => {
		const actions = computeFieldActions(
			{ Company: "Acme Corp", "Company (Me.sh)": "Acme Inc" },
			{ Company: "Acme Inc" },
			{},
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([]);
	});

	it("never produces actions for metadata keys", () => {
		const actions = computeFieldActions(
			{},
			{ "Mesh ID": 42, "Mesh URL": "https://me.sh/c/42", "Mesh Last Synced": "2026-07-14T00:00" },
			{},
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([]);
	});

	it("skips undefined incoming values", () => {
		const actions = computeFieldActions(
			{ Phone: "" },
			{ Phone: undefined },
			{},
			"obsidian",
			isEnrichedField
		);
		expect(actions).toEqual([]);
	});
});
