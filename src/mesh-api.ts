import { requestUrl } from "obsidian";
import type MeshPlugin from "./main";

const API_BASE = "https://api.me.sh";

/**
 * Contact shape from the LIST endpoint (/api/v1/network/contacts/?limit=N&offset=N).
 * Uses snake_case. For richer data, use the detail endpoint.
 */
export interface MeshContactList {
	id: number;
	created: string;
	display_name: string;
	first_name: string;
	last_name: string;
	full_name: string;
	avatar_url?: string;
	avatar_blur?: string;
	source: string; // "LI", "EM", "GC", etc.
	score: number;
	relationship?: string | null;
	information: MeshContactInfo[];
	notes: MeshNote[];
	is_clay_user: boolean;
	reminder?: unknown;
	skip_enrichment: boolean;
	is_restricted: boolean;
	interaction_type?: string;
	person?: {
		first_name: string;
		last_name: string;
		full_name: string;
		avatar_url?: string;
		hits: number;
	};
}

/**
 * Contact shape from the DETAIL endpoint (/api/v1/network/contacts/{id}/).
 * Uses camelCase. Has richer data (orgs, social URLs, interaction dates, etc.)
 */
export interface MeshContactDetail {
	id: number;
	objectID: string;
	created: number; // unix timestamp
	displayName: string;
	fullName: string;
	firstName: string;
	middleName: string;
	lastName: string;
	nickname: string;
	bio: string;
	byline: string;
	headline: string;
	organization: string;
	organizations: MeshOrganization[];
	title: string;
	avatarURL: string | null;
	primaryLocation: string | null;
	locations: unknown[];
	birthday: { month: number | null; day: number | null; year: number | null };
	linkedinURL: string;
	twitterURL: string;
	twitterHandle: string;
	githubURL: string;
	instagramURL: string;
	facebookURL: string;
	website: string;
	websites: string[];
	information: MeshContactInfo[];
	notes: MeshNote[];
	score: number;
	relationship: string | null;
	isClayUser: boolean;
	interactionType: string;
	integrations: string[];
	lastInteractionDate: number | null; // unix timestamp
	firstInteractionDate: number | null;
	lastEmailDate: number | null;
	lastMeetingDate: number | null;
	lists: MeshListMembership[];
	starred: boolean;
}

export interface MeshOrganization {
	name?: string;
	title?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	current?: boolean;
}

export interface MeshContactInfo {
	id?: number;
	type: string; // "email", "phone", "linkedin", "twitter", etc.
	value: string;
	source?: string;
	label?: string | null;
	primary?: boolean;
}

export interface MeshNote {
	id: number;
	body: string;
	created: string;
	updated: string;
}

export interface MeshListMembership {
	id: number;
	title: string;
	slug?: string;
	color?: string;
}

export interface MeshGroup {
	id: number;
	title: string;
	slug?: string;
	color?: string;
	contact_ids?: number[];
}

interface PaginatedResponse<T> {
	count: number;
	next: string | null;
	previous: string | null;
	results: T[];
}

export class MeshAPI {
	private plugin: MeshPlugin;

	constructor(plugin: MeshPlugin) {
		this.plugin = plugin;
	}

	private async request<T>(path: string, method = "GET"): Promise<T> {
		const token = await this.plugin.auth.getAccessToken();
		const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

		this.log(`${method} ${url}`);

		const response = await requestUrl({
			url,
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});

		if (response.status >= 400) {
			throw new Error(`Mesh API error ${response.status}: ${response.text}`);
		}

		return response.json as T;
	}

	/**
	 * Fetch all contacts (list endpoint, snake_case) with pagination
	 */
	async getAllContacts(limit = 100): Promise<MeshContactList[]> {
		const allContacts: MeshContactList[] = [];
		let offset = 0;
		let hasMore = true;

		while (hasMore) {
			const page = await this.request<PaginatedResponse<MeshContactList>>(
				`/api/v1/network/contacts/?limit=${limit}&offset=${offset}`
			);

			allContacts.push(...page.results);
			this.log(`Fetched ${allContacts.length} / ${page.count} contacts`);

			hasMore = page.next !== null;
			offset += limit;
		}

		return allContacts;
	}

	/**
	 * Fetch a single contact detail (camelCase, richer data)
	 */
	async getContactDetail(id: number): Promise<MeshContactDetail> {
		return this.request<MeshContactDetail>(`/api/v1/network/contacts/${id}/`);
	}

	/**
	 * Fetch notes for a contact
	 */
	async getContactNotes(id: number): Promise<MeshNote[]> {
		return this.request<MeshNote[]>(`/api/v1/network/contacts/${id}/notes`);
	}

	/**
	 * Fetch all groups
	 */
	async getGroups(includeContactIds = true): Promise<MeshGroup[]> {
		const response = await this.request<MeshGroup[]>(
			`/api/v2/groups/?include_contact_ids=${includeContactIds}`
		);
		return response;
	}

	/**
	 * Fetch current user info
	 */
	async getSelf(): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>("/api/v1/users/self/");
	}

	private log(message: string) {
		if (this.plugin.settings.debugLogging) {
			console.log("[Mesh API]", message);
		}
	}
}
