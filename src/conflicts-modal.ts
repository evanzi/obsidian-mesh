import { App, Modal } from "obsidian";
import type MeshPlugin from "./main";
import type { SyncConflict } from "./sync-engine";

const MAX_VALUE_LENGTH = 120;

function truncate(value: unknown): string {
	const str = String(value);
	return str.length > MAX_VALUE_LENGTH ? `${str.slice(0, MAX_VALUE_LENGTH)}…` : str;
}

function annotate(conflict: SyncConflict): string {
	if (conflict.type === "enriched") {
		return "kept yours; wrote parallel (Me.sh) field";
	}
	return conflict.resolution === "ask" ? "unresolved (Ask mode)" : "kept yours (Obsidian wins)";
}

export class ConflictsModal extends Modal {
	private plugin: MeshPlugin;

	constructor(app: App, plugin: MeshPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Me.sh sync conflicts" });

		const log = await this.plugin.syncEngine.loadConflictLog();

		if (!log || log.conflicts.length === 0) {
			const empty = contentEl.createEl("p", { text: "No conflicts in the last sync." });
			if (log) {
				empty.createEl("br");
				empty.createSpan({ text: `Last sync: ${log.timestamp}`, cls: "setting-item-description" });
			}
			return;
		}

		contentEl.createEl("p", {
			text: `Last sync: ${log.timestamp}`,
			cls: "setting-item-description",
		});

		const byFile = new Map<string, SyncConflict[]>();
		for (const conflict of log.conflicts) {
			const forFile = byFile.get(conflict.file);
			if (forFile) {
				forFile.push(conflict);
			} else {
				byFile.set(conflict.file, [conflict]);
			}
		}

		for (const [file, conflicts] of byFile) {
			const fileHeading = contentEl.createEl("h3", { text: file, cls: "mesh-conflict-file" });
			fileHeading.style.cursor = "pointer";
			fileHeading.addEventListener("click", () => {
				this.app.workspace.openLinkText(file, "", false);
				this.close();
			});

			const list = contentEl.createDiv();
			for (const conflict of conflicts) {
				const row = list.createDiv({ cls: "mesh-conflict-row" });
				row.createEl("strong", { text: conflict.field });
				row.createSpan({ text: ` kept: ${truncate(conflict.kept)} · me.sh: ${truncate(conflict.mesh)}` });
				row.createEl("br");
				row.createSpan({ text: annotate(conflict), cls: "setting-item-description" });
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
