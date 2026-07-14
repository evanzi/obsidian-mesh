// Minimal test-only stand-in for the parts of the `obsidian` API this
// plugin's non-UI code touches. The real `obsidian` package is types-only
// (no runtime build), so it can't be imported in tests; vitest aliases
// `obsidian` to this file instead (see vitest.config.ts).

export class TFile {
	path: string;
	basename: string;
	extension: string;

	constructor(path: string) {
		this.path = path;
		const slash = path.lastIndexOf("/");
		const base = slash >= 0 ? path.slice(slash + 1) : path;
		const dot = base.lastIndexOf(".");
		this.basename = dot > 0 ? base.slice(0, dot) : base;
		this.extension = dot > 0 ? base.slice(dot + 1) : "";
	}
}

export class TFolder {
	path: string;
	children: unknown[] = [];

	constructor(path: string) {
		this.path = path;
	}
}

export class Notice {
	constructor(_message?: string) {}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

export function stringifyYaml(data: unknown): string {
	return JSON.stringify(data);
}
