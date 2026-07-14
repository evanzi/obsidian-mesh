import { describe, expect, it } from "vitest";
import { ContactMapper } from "./contact-mapper";
import type { MeshContactDetail, MeshContactList } from "./mesh-api";
import type { MeshSettings } from "./settings";

// Local fixture -- `./settings` imports `obsidian` (types-only package, no
// runtime) at module scope, so it can't be imported here. `MeshSettings` is
// imported with `import type` only, which is erased at compile time.
const TEST_SETTINGS: MeshSettings = {
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

function makeContactList(overrides: Partial<MeshContactList> = {}): MeshContactList {
	return {
		id: 1,
		created: "2026-01-01T00:00:00Z",
		display_name: "",
		first_name: "",
		last_name: "",
		full_name: "",
		source: "EM",
		score: 0,
		information: [],
		notes: [],
		is_clay_user: false,
		skip_enrichment: false,
		is_restricted: false,
		...overrides,
	};
}

describe("ContactMapper.isRealContact", () => {
	it("rejects an empty name", () => {
		expect(ContactMapper.isRealContact(makeContactList({ display_name: "" }))).toBe(false);
	});

	it("rejects a name that is just '.'", () => {
		expect(ContactMapper.isRealContact(makeContactList({ display_name: "." }))).toBe(false);
	});

	it("rejects names containing '@'", () => {
		expect(
			ContactMapper.isRealContact(makeContactList({ display_name: "someone@example.com" }))
		).toBe(false);
	});

	it("rejects pure-phone-number names", () => {
		expect(
			ContactMapper.isRealContact(makeContactList({ display_name: "+1 (555) 123-4567" }))
		).toBe(false);
	});

	it("accepts a normal first+last contact", () => {
		expect(
			ContactMapper.isRealContact(
				makeContactList({ display_name: "Jane Doe", first_name: "Jane", last_name: "Doe" })
			)
		).toBe(true);
	});
});

describe("ContactMapper.getFileNameFromDetail", () => {
	it("returns normalized fullName for format 'full'", () => {
		const contact = makeContactDetail({ fullName: "  Jane   Doe  " });
		expect(ContactMapper.getFileNameFromDetail(contact, "full")).toBe("Jane Doe");
	});

	it("returns 'Last, First' for format 'lastFirst'", () => {
		const contact = makeContactDetail({ firstName: "Jane", lastName: "Doe", fullName: "Jane Doe" });
		expect(ContactMapper.getFileNameFromDetail(contact, "lastFirst")).toBe("Doe, Jane");
	});

	it("falls back to displayName when names are missing", () => {
		const contact = makeContactDetail({ displayName: "Jane D." });
		expect(ContactMapper.getFileNameFromDetail(contact, "full")).toBe("Jane D.");
	});

	it("falls back to email when names and displayName are missing", () => {
		const contact = makeContactDetail({
			information: [{ type: "email", value: "jane@example.com" }],
		});
		expect(ContactMapper.getFileNameFromDetail(contact, "full")).toBe("jane@example.com");
	});

	it("falls back to 'Mesh Contact {id}' when no name data exists", () => {
		const contact = makeContactDetail({ id: 42 });
		expect(ContactMapper.getFileNameFromDetail(contact, "full")).toBe("Mesh Contact 42");
	});

	it("treats '.' fullName/firstName/lastName as missing", () => {
		const contact = makeContactDetail({
			firstName: ".",
			lastName: ".",
			fullName: ".",
			displayName: "Jane D.",
		});
		expect(ContactMapper.getFileNameFromDetail(contact, "full")).toBe("Jane D.");
	});
});

describe("ContactMapper.mapContactDetail", () => {
	it("builds Mesh ID and Mesh URL", () => {
		const contact = makeContactDetail({ id: 123 });
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data["Mesh ID"]).toBe(123);
		expect(data["Mesh URL"]).toBe("https://app.me.sh/contact/123");
	});

	it("picks the first email and phone from information[]", () => {
		const contact = makeContactDetail({
			information: [
				{ type: "email", value: "first@example.com" },
				{ type: "email", value: "second@example.com" },
				{ type: "phone", value: "+15551234567" },
			],
		});
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data["Email (Private)"]).toBe("first@example.com");
		expect(data.Phone).toBe("+15551234567");
	});

	it("builds a github URL from a bare handle fallback", () => {
		const contact = makeContactDetail({
			information: [{ type: "github", value: "octocat" }],
		});
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data.GitHub).toBe("https://github.com/octocat");
	});

	it("uses the information[] value as-is when it is already a URL", () => {
		const contact = makeContactDetail({
			information: [{ type: "github", value: "https://github.com/octocat" }],
		});
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data.GitHub).toBe("https://github.com/octocat");
	});

	it.each([
		[85, "Strong"],
		[70, "Strong"],
		[55, "Medium"],
		[40, "Medium"],
		[10, "Weak"],
	])("maps score %d to Relationship Strength %s", (score, expected) => {
		const contact = makeContactDetail({ score });
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data["Relationship Strength"]).toBe(expected);
	});

	it("omits Relationship Strength when score is 0", () => {
		const contact = makeContactDetail({ score: 0 });
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data["Relationship Strength"]).toBeUndefined();
	});

	it("formats a birthday with no year as '0000-MM-DD'", () => {
		const contact = makeContactDetail({ birthday: { month: 5, day: 7, year: null } });
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data.Birthday).toBe("0000-05-07");
	});

	it("collapses bio newlines into single spaces", () => {
		const contact = makeContactDetail({ bio: "Line one\nLine two\n\nLine three" });
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data.Bio).toBe("Line one Line two Line three");
	});

	it("uses the first organization with no end date as the current org", () => {
		const contact = makeContactDetail({
			organizations: [
				{ name: "Old Co", title: "Engineer", end: { year: 2020 } },
				{ name: "Current Co", title: "Senior Engineer" },
				{ name: "Another Co", title: "Something Else" },
			],
		});
		const data = ContactMapper.mapContactDetail(contact, [], TEST_SETTINGS);
		expect(data.Company).toBe("Current Co");
		expect(data.Title).toEqual(["Senior Engineer"]);
	});
});

describe("ContactMapper.isEnrichedField", () => {
	it("returns true for 'Company'", () => {
		expect(ContactMapper.isEnrichedField("Company")).toBe(true);
	});

	it("returns false for 'Email (Private)'", () => {
		expect(ContactMapper.isEnrichedField("Email (Private)")).toBe(false);
	});
});
