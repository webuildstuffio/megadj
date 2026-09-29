/**
 * write-plan.ts — Plan/apply for all RB writes (B10.3).
 *
 * Collects all pending writes (comment, colour, My Tag, genre, BPM, key)
 * into a single diff view. The user reviews the plan, then confirms
 * or rejects it before any DB writes happen.
 *
 * This replaces the per-field write pattern with a unified diff.
 */

/** One field change in the write plan. */
export interface WriteChange {
  readonly trackId: string;
  readonly title: string;
  readonly artist: string;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/** Summary of the write plan. */
export interface WritePlan {
  /** All proposed changes. */
  readonly changes: readonly WriteChange[];
  /** Number of tracks affected. */
  readonly tracksAffected: number;
  /** Changes grouped by field. */
  readonly byField: ReadonlyMap<string, number>;
  /** Changes grouped by track. */
  readonly byTrack: ReadonlyMap<string, readonly WriteChange[]>;
}

/**
 * Build a write plan from proposed changes.
 * Filters out no-op changes (old === new) and deduplicates.
 */
export function buildWritePlan(changes: readonly WriteChange[]): WritePlan {
  // Filter out no-ops
  const filtered = changes.filter((c) => c.oldValue !== c.newValue);

  // Group by field
  const byField = new Map<string, number>();
  for (const c of filtered) {
    byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
  }

  // Group by track
  const byTrack = new Map<string, WriteChange[]>();
  for (const c of filtered) {
    const arr = byTrack.get(c.trackId) ?? [];
    arr.push(c);
    byTrack.set(c.trackId, arr);
  }

  return {
    changes: filtered,
    tracksAffected: byTrack.size,
    byField,
    byTrack,
  };
}

/**
 * Format the write plan as human-readable diff lines.
 */
export function formatWritePlan(plan: WritePlan): string[] {
  const lines: string[] = [];
  lines.push(
    `Write plan: ${plan.changes.length} changes across ${plan.tracksAffected} tracks`,
  );
  lines.push("");

  // Summary by field
  for (const [field, count] of plan.byField) {
    lines.push(`  ${field}: ${count} changes`);
  }
  lines.push("");

  // Per-track detail
  for (const [trackId, trackChanges] of plan.byTrack) {
    const first = trackChanges[0];
    lines.push(`${first?.title ?? trackId} — ${first?.artist ?? ""}`);
    for (const c of trackChanges) {
      lines.push(`  ${c.field}: "${c.oldValue ?? ""}" → "${c.newValue ?? ""}"`);
    }
  }

  return lines;
}
