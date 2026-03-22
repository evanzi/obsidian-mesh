import { Platform } from "obsidian";
import { requestUrl } from "obsidian";
import type MeshPlugin from "./main";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const API_BASE = "https://api.me.sh";
const TOKEN_REFRESH_ENDPOINT = `${API_BASE}/api/token/refresh/`;

// Buffer before token expiry (in seconds) to trigger refresh
const EXPIRY_BUFFER_SECONDS = 60;

interface TokenCache {
	accessToken: string;
	refreshToken: string;
	expiresAt: number; // unix timestamp in seconds
}

export class MeshAuth {
	private plugin: MeshPlugin;
	private tokenCache: TokenCache | null = null;

	constructor(plugin: MeshPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Get Mesh's Local Storage path based on platform
	 */
	private getLocalStoragePath(): string {
		const home = os.homedir();
		if (Platform.isMacOS) {
			return path.join(home, "Library", "Application Support", "Mesh", "Local Storage", "leveldb");
		} else if (Platform.isWin) {
			return path.join(home, "AppData", "Roaming", "Mesh", "Local Storage", "leveldb");
		} else {
			// Linux
			return path.join(home, ".config", "Mesh", "Local Storage", "leveldb");
		}
	}

	/**
	 * Extract JWT tokens from Mesh's Local Storage LevelDB files.
	 *
	 * Reads .ldb and .log files as raw text and searches for JWT patterns.
	 * This is a pragmatic approach that avoids requiring native LevelDB bindings
	 * (which cause issues with Obsidian's Electron environment).
	 */
	async extractTokensFromLevelDB(): Promise<{ access: string; refresh: string } | null> {
		const ldbPath = this.getLocalStoragePath();

		if (!fs.existsSync(ldbPath)) {
			this.log("Mesh Local Storage directory not found at: " + ldbPath);
			return null;
		}

		const files = fs.readdirSync(ldbPath).filter((f) => f.endsWith(".ldb") || f.endsWith(".log"));

		let accessToken: string | null = null;
		let refreshToken: string | null = null;

		// JWT pattern: three base64url segments separated by dots
		const jwtPattern = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

		for (const file of files) {
			try {
				const content = fs.readFileSync(path.join(ldbPath, file), "latin1");
				const matches = content.match(jwtPattern);
				if (!matches) continue;

				for (const token of matches) {
					try {
						// Decode the payload (second segment) to check token_type
						const payload = JSON.parse(
							Buffer.from(token.split(".")[1], "base64url").toString("utf-8")
						);

						if (payload.token_type === "access" && payload.user_id) {
							accessToken = token;
						} else if (payload.token_type === "refresh" && payload.user_id) {
							refreshToken = token;
						}
					} catch {
						// Not a valid JWT payload, skip
					}
				}
			} catch {
				// Can't read file, skip
			}
		}

		if (accessToken && refreshToken) {
			return { access: accessToken, refresh: refreshToken };
		}

		// Try just access token if refresh not found
		if (accessToken) {
			return { access: accessToken, refresh: "" };
		}

		return null;
	}

	/**
	 * Decode JWT payload to extract expiry and other claims
	 */
	private decodeJwtPayload(token: string): Record<string, unknown> | null {
		try {
			const payload = token.split(".")[1];
			return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
		} catch {
			return null;
		}
	}

	/**
	 * Check if a token is expired (or about to expire)
	 */
	private isTokenExpired(token: string): boolean {
		const payload = this.decodeJwtPayload(token);
		if (!payload || typeof payload.exp !== "number") return true;
		return Date.now() / 1000 >= payload.exp - EXPIRY_BUFFER_SECONDS;
	}

	/**
	 * Refresh the access token using the refresh token
	 */
	async refreshAccessToken(refreshToken: string): Promise<TokenCache | null> {
		try {
			const response = await requestUrl({
				url: TOKEN_REFRESH_ENDPOINT,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refresh: refreshToken }),
			});

			if (response.status === 200) {
				const data = response.json;
				const payload = this.decodeJwtPayload(data.access);
				const expiresAt = typeof payload?.exp === "number" ? payload.exp : Date.now() / 1000 + 300;

				return {
					accessToken: data.access,
					refreshToken: data.refresh || refreshToken,
					expiresAt,
				};
			}
		} catch (error) {
			this.log("Token refresh failed: " + error);
		}
		return null;
	}

	/**
	 * Get a valid access token, refreshing if necessary
	 */
	async getAccessToken(): Promise<string> {
		// Check cached token first
		if (this.tokenCache && !this.isTokenExpired(this.tokenCache.accessToken)) {
			return this.tokenCache.accessToken;
		}

		// Try refreshing with cached refresh token
		if (this.tokenCache?.refreshToken) {
			const refreshed = await this.refreshAccessToken(this.tokenCache.refreshToken);
			if (refreshed) {
				this.tokenCache = refreshed;
				return refreshed.accessToken;
			}
		}

		// Fall back to reading fresh tokens from LevelDB
		const tokens = await this.extractTokensFromLevelDB();
		if (!tokens) {
			throw new Error("Mesh auth: Could not find tokens. Is the Mesh app installed and logged in?");
		}

		// If access token is still valid, use it
		if (!this.isTokenExpired(tokens.access)) {
			const payload = this.decodeJwtPayload(tokens.access);
			this.tokenCache = {
				accessToken: tokens.access,
				refreshToken: tokens.refresh,
				expiresAt: typeof payload?.exp === "number" ? payload.exp : Date.now() / 1000 + 300,
			};
			return tokens.access;
		}

		// Access token expired, try refresh
		if (tokens.refresh) {
			const refreshed = await this.refreshAccessToken(tokens.refresh);
			if (refreshed) {
				this.tokenCache = refreshed;
				return refreshed.accessToken;
			}
		}

		throw new Error("Mesh auth: Tokens expired. Please open the Mesh app and log in.");
	}

	/**
	 * Check if we can connect to Mesh
	 */
	async checkConnection(): Promise<boolean> {
		try {
			await this.getAccessToken();
			return true;
		} catch {
			return false;
		}
	}

	private log(message: string) {
		console.log("[Me.sh Auth]", message);
	}
}
