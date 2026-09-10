// drive_list.ts — the drive-list payload builder (extracted from index.ts,
// file-length cap). Deps injected as plain structural params so the module
// never imports the server wiring (the index stays wiring; this stays a
// leaf seam — same rule as report_types.ts).
import type { Drive } from "../shared/types";

/** The per-drive hygiene census shape (structurally = shared/hygiene.ts
 *  HygieneBadge; kept structural so this file imports nothing but types). */
interface HygieneBadge {
  open: number;
  safe: number;
  review: number;
  info: number;
}

/** Minimal structural views — the real types flow through unchanged. */
export interface DriveListDeps {
  registry: {
    list: () => Drive[];
  };
  latestSnapshots: () => Map<string, unknown>;
  sweeps: {
    latestPerDrive: () => Map<string, unknown>;
  };
  badges: (
    drive: Drive,
    snaps: Map<string, unknown>,
    masterName: string,
    mirrorName: string,
  ) => unknown[];
  /** one live `df` probe per mounted drive; resolves null on failure */
  liveFree: (mountPoint: string) => Promise<number | null>;
  masterDrive: string;
  mirrorDrive: string;
  shelfDrive: string;
  /** hygiene census for the shelf master (null when ledger unavailable) */
  hygieneBadge: () => HygieneBadge | null;
}

/** Build the /api/status + /api/drives drive rows: Drive flattened with
 *  snapshot_summary, badges, the shelf_sweep verdict and the hygiene
 *  census (shelf drive only — §4.3). Live `df` probes run in parallel;
 *  a df that throws (volume yanked mid-request) is a logged boundary,
 *  not a payload-killer. */
export async function buildDriveList(deps: DriveListDeps): Promise<Drive[]> {
  const { registry, latestSnapshots, sweeps } = deps;
  const snaps = latestSnapshots();
  const sweepMap = sweeps.latestPerDrive();
  const drives = registry.list();
  const liveFreeMap = new Map(
    await Promise.all(
      drives
        .filter((d) => d.mounted)
        .map(async (d) => {
          try {
            return [d.id, await deps.liveFree(`/Volumes/${d.name}`)] as const;
          } catch (e) {
            console.error(`live free-space probe failed for ${d.name}`, e);
            return [d.id, null] as const;
          }
        }),
    ),
  );
  return drives
    .map((d) => ({
      ...d,
      // strip the raw snapshot blob from list responses: cards only need
      // counts; the full snapshot goes MBs over the wire for nothing.
      last_snapshot_json: null as string | null,
      snapshot_summary: (() => {
        const s = snaps.get(d.id) as
          | {
              track_count?: number;
              file_count?: number;
              capacity_bytes?: number;
              free_bytes?: number | null;
            }
          | undefined;
        return s
          ? {
              track_count: s.track_count,
              file_count: s.file_count,
              capacity_bytes: s.capacity_bytes,
              free_bytes: s.free_bytes,
              live_free_bytes: d.mounted
                ? (liveFreeMap.get(d.id) ?? null)
                : null,
            }
          : {
              // never-scanned mounted drive: still show live free space
              capacity_bytes: d.capacity_bytes || undefined,
              free_bytes: null,
              live_free_bytes: d.mounted
                ? (liveFreeMap.get(d.id) ?? null)
                : null,
            };
      })(),
      badges: deps.badges(d, snaps, deps.masterDrive, deps.mirrorDrive),
    }))
    .map((d) => ({
      ...d,
      last_snapshot_json: null,
      shelf_sweep: sweepMap.get(d.name.toUpperCase()) ?? null,
      // hygiene census rides only the shelf drive (§4.3: the badge that
      // opens the queue); null elsewhere so cards don't render it
      hygiene:
        d.role === "shelf" &&
        d.name.toUpperCase() === deps.shelfDrive.toUpperCase()
          ? deps.hygieneBadge()
          : null,
    }));
}
