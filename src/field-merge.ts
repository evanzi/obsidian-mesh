/**
 * Pure per-field merge decision logic, shared by the real sync write path
 * (`updateFile`) and the dry-run reporter (`logDryRunUpdate`) in
 * `sync-engine.ts`. No obsidian imports -- this is exercised directly in
 * tests without a runtime stub.
 */

export type FieldAction =
	| { kind: "fill"; key: string; value: unknown } // empty -> fill
	| { kind: "update"; key: string; value: unknown } // unchanged since last sync, or mesh-wins
	| { kind: "parallel"; key: string; meshKey: string; value: unknown } // enriched conflict
	| { kind: "conflict"; key: string; current: unknown; incoming: unknown }; // ask-mode log

const METADATA_KEYS = new Set(["Mesh Last Synced", "Mesh URL", "Mesh ID"]);

/**
 * Compute the list of field-level actions a sync would take, given the
 * current frontmatter, the incoming mesh-mapped values, and the last-synced
 * snapshot used as the three-way merge base.
 *
 * Ported unchanged from `updateFile`'s per-field logic (task 006): same
 * JSON.stringify equality checks, same metadata-key skip list, same
 * "only write the (Me.sh) parallel field when its value actually changed"
 * rule. Does not include the `Source: Google Contacts` migration or the
 * metadata-field writes -- those stay in `updateFile`.
 */
export function computeFieldActions(
	current: Record<string, unknown>,
	mapped: Record<string, unknown>,
	lastSynced: Record<string, unknown>,
	conflictResolution: "obsidian" | "mesh" | "ask",
	isEnrichedField: (key: string) => boolean
): FieldAction[] {
	const actions: FieldAction[] = [];

	for (const [key, newValue] of Object.entries(mapped)) {
		if (newValue === undefined) continue;
		if (METADATA_KEYS.has(key)) continue;

		const currentValue = current[key];
		const isEnriched = isEnrichedField(key);

		if (isEnriched) {
			// ── Enriched field handling ──
			// Empty in Obsidian -> fill it
			if (currentValue === undefined || currentValue === null || currentValue === "") {
				actions.push({ kind: "fill", key, value: newValue });
				continue;
			}

			// Same value -> nothing to do
			if (JSON.stringify(currentValue) === JSON.stringify(newValue)) {
				continue;
			}

			// Different value -> write to parallel "(Me.sh)" field, keep original
			const meshKey = `${key} (Me.sh)`;
			const existingMeshValue = current[meshKey];

			// Only update the (Me.sh) field if the value changed
			if (JSON.stringify(existingMeshValue) !== JSON.stringify(newValue)) {
				actions.push({ kind: "parallel", key, meshKey, value: newValue });
			}
		} else {
			// ── Direct field handling ──
			const lastSyncedValue = lastSynced[key];

			// Empty in Obsidian -> fill it
			if (currentValue === undefined || currentValue === null || currentValue === "") {
				actions.push({ kind: "fill", key, value: newValue });
				continue;
			}

			// Same as last sync -> safe to update from me.sh
			if (JSON.stringify(currentValue) === JSON.stringify(lastSyncedValue)) {
				if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
					actions.push({ kind: "update", key, value: newValue });
				}
				continue;
			}

			// Manually edited -> apply conflict resolution
			if (conflictResolution === "mesh") {
				actions.push({ kind: "update", key, value: newValue });
			} else if (conflictResolution === "ask") {
				actions.push({ kind: "conflict", key, current: currentValue, incoming: newValue });
			}
			// conflictResolution === "obsidian" -> no action
		}
	}

	return actions;
}
