import { describe, expect, it } from "vitest";
import { FIELD_ORDER, orderFrontmatter } from "./frontmatter";

describe("orderFrontmatter", () => {
	it("emits keys in FIELD_ORDER order", () => {
		const data = {
			"Last Update": "2026-07-14T00:00",
			"Prof. Contact": false,
			"Company": "Acme",
		};
		const ordered = orderFrontmatter(data, FIELD_ORDER);
		expect(Object.keys(ordered)).toEqual(["Prof. Contact", "Last Update", "Company"]);
	});

	it("appends unknown keys after known ones, preserving original order", () => {
		const data = {
			"Zzz Custom": "z",
			"Prof. Contact": true,
			"Aaa Custom": "a",
			"Source": "Mesh",
		};
		const ordered = orderFrontmatter(data, FIELD_ORDER);
		expect(Object.keys(ordered)).toEqual(["Prof. Contact", "Source", "Zzz Custom", "Aaa Custom"]);
	});

	it("drops undefined values", () => {
		const data = {
			"Prof. Contact": false,
			"Company": undefined,
			"Custom Undefined": undefined,
		};
		const ordered = orderFrontmatter(data, FIELD_ORDER);
		expect(ordered).toEqual({ "Prof. Contact": false });
	});

	it("keeps falsy-but-defined values: false, 0, empty string", () => {
		const data = {
			"Prof. Contact": false,
			"Relationship Strength": 0,
			"Bio": "",
		};
		const ordered = orderFrontmatter(data, FIELD_ORDER);
		expect(ordered).toEqual({
			"Prof. Contact": false,
			"Bio": "",
			"Relationship Strength": 0,
		});
	});

	it("passes arrays and strings through unchanged", () => {
		const data = {
			"Mesh Groups": ["Friends", "a: b"],
			"Company": "Acme, Inc.",
		};
		const ordered = orderFrontmatter(data, FIELD_ORDER);
		expect(ordered["Mesh Groups"]).toEqual(["Friends", "a: b"]);
		expect(ordered["Company"]).toBe("Acme, Inc.");
	});

	it("returns an empty object for empty input", () => {
		expect(orderFrontmatter({}, FIELD_ORDER)).toEqual({});
	});
});
