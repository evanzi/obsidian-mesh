import { requestUrl } from "obsidian";
import type MeshPlugin from "./main";

const API_BASE = "https://api.me.sh";

export interface MeshContact {
	id: number;
	objectID?: string;
	displayName: string;
	fullName: string;
	firstName: string;
	middleName?: string;
	lastName: string;
	nickname?: string;
	bio?: string;
	byline?: string;
	headline?: string;
	organizations?: MeshOrganization[];
	information?: MeshContactInfo[];
	notes?: MeshNote[];
	score?: number;
	relationship?: string;
	created?: string;
	avatar_url?: string;
	// Social profiles extracted from information[]
	linkedin?: string;
	twitter?: string;
	github?: string;
	instagram?: string;
	facebook?: string;
}

export interface MeshOrganization {
	name: string;
	title?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	current?: boolean;
}

export interface MeshContactInfo {
	type: string; // email, phone, url, social, location, etc.
	value: string;
	label?: string;
	source?: string;
}

export interface MeshNote {
	id: number;
	body: string;
	created: string;
	updated: string;
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
	 * Fetch all contacts with pagination
	 */
	async getAllContacts(limit = 100): Promise<MeshContact[]> {
		const allContacts: MeshContact[] = [];
		let offset = 0;
		let hasMore = true;

		while (hasMore) {
			const page = await this.request<PaginatedResponse<MeshContact>>(
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
	 * Fetch a single contact by ID
	 */
	async getContact(id: number): Promise<MeshContact> {
		return this.request<MeshContact>(`/api/v1/network/contacts/${id}/`);
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
