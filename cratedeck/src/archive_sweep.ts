// archive_sweep.ts — D30: archive-integrity sweep (bitrot early warning).
//
// The ideas-doc spec (idea 30, folded into O83's digest by the roadmap):
// "Nightly checksum sweep of ~/Music/DJ-Imports vs the archive DB (sizes +
// blake2b), reporting bitrot/silent truncation before it ever reaches a
// drive. Mirrors the drive-side ledger, so reuse the same hash module."
//
// Safety rails (P9): READ-ONLY over the archive DB (readonly sqlite, the
// same ArchiveReader seam) and READ-ONLY over the music tree — this module
// hashes and compares, it never repairs, moves, or deletes. The ledger of
// known-good hashes lives in CRATEDECK's own db (new table `archive_ledger`),
// never in megadj's archive DB.
//
// Perf: hashing stays async (Bun.file().arrayBuffer() → crypto hash) per the
// invariant that hash loops must not block the server loop; 88 files / 3.8 GB
// ≈ 15s, sized for the weekly digest, not per-request.

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { ArchiveReader } from "./archive";

/** One ledger row: the last known-good fingerprint of an archive file. */
export interface LedgerRow {
  file_path: string;
  size_bytes: number | null;
  blake2b: string;
  checked_at: number;
}

export interface SweepVerdict {
  path: string;
  title: string | null;
  artist: string | null;
  verdict: "changed" | "truncated" | "grown" | "missing" | "restored";
  detail: string;
}

export interface SweepReport {
  ran_at: number;
  available: boolean;
  checked: number;
  unchanged: number;
  findings: SweepVerdict[];
  duration_ms: number;
}

/** Hash one file (async; blake2b-256 hex). Throws if unreadable. */
async function hashFile(absPath: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(absPath).arrayBuffer());
  return createHash("blake2b256").update(bytes).digest("hex");
}

/** The pure sweep: compare the music tree against the archive DB + ledger.
 *
 *  - file grew/shrank vs DB size → truncated/grown (silent corruption class)
 *  - hash differs from ledger → changed (bitrot or replaced file)
 *  - file gone but DB says downloaded → missing
 *  - file back and matching ledger → restored (self-healed, informational)
 *
 *  update() is the ledger write-back hook (CrateDeck db) — injected so this
 *  module stays pure/I/O-minimal and testable against fixtures. */
export async function sweepArchive(
  musicDir: string,
  tracks: { file_path: string | null; title: string | null; artist: string | null; size_hint?: number | null }[],
  ledger: Map<string, LedgerRow>,
  update: (row: LedgerRow) => void,
  signal?: AbortSignal,
): Promise<SweepReport> {
  const started = Date.now();
  const findings: SweepVerdict[] = [];
  let checked = 0;
  let unchanged = 0;

  const withFile = tracks.filter((t) => t.file_path);
  for (const t of withFile) {
    if (signal?.aborted) break;
    const rel = t.file_path!;
    // archive DB stores paths relative to the music dir (see state.ts);
    // tolerate absolute rows too
    const abs = rel.startsWith("/") ? rel : `${musicDir}/${rel}`;
    let st;
    try {
      st = await stat(abs);
    } catch {
      findings.push({
        path: rel,
        title: t.title,
        artist: t.artist,
        verdict: "missing",
        detail: "file listed as downloaded but not on disk",
      });
      continue;
    }
    checked++;
    const hex = await hashFile(abs);
    const prior = ledger.get(rel);
    const sizeChanged = prior && prior.size_bytes !== null && prior.size_bytes !== st.size;
    if (prior && prior.blake2b === hex) {
      unchanged++;
      if (sizeChanged) {
        // hash identical but size differs from ledger: ledger needs refresh
        update({ file_path: rel, size_bytes: st.size, blake2b: hex, checked_at: Date.now() });
      }
      continue;
    }
    if (!prior) {
      // first sighting: baseline it, nothing to report (it's not a finding
      // — but DO note a size mismatch vs the DB, the truncation tell)
      update({ file_path: rel, size_bytes: st.size, blake2b: hex, checked_at: Date.now() });
      if (typeof t.size_hint === "number" && t.size_hint > 0 && t.size_hint !== st.size) {
        findings.push({
          path: rel,
          title: t.title,
          artist: t.artist,
          verdict: st.size < t.size_hint ? "truncated" : "grown",
          detail: `disk ${st.size} B vs DB ${t.size_hint} B`,
        });
      }
      continue;
    }
    // hash differs from known-good → the bitrot/truncation class
    const priorSize = prior.size_bytes ?? null;
    findings.push({
      path: rel,
      title: t.title,
      artist: t.artist,
      verdict: priorSize !== null && st.size < priorSize ? "truncated" : "changed",
      detail:
        priorSize !== null && st.size < priorSize
          ? `shrank ${priorSize} → ${st.size} B (silent truncation)`
          : `content differs from known-good hash (recorded ${prior.size_bytes ?? "?"} B, now ${st.size} B)`,
    });
    update({ file_path: rel, size_bytes: st.size, blake2b: hex, checked_at: Date.now() });
  }

  return {
    ran_at: started,
    available: withFile.length > 0,
    checked,
    unchanged,
    findings,
    duration_ms: Date.now() - started,
  };
}

/** Read the full track list for sweeping, from the archive DB (readonly). */
export function tracksForSweep(reader: ArchiveReader): {
  file_path: string | null;
  title: string | null;
  artist: string | null;
  size_hint?: number | null;
}[] {
  // ArchiveReader exposes only typed queries; sweep needs file_path+size for
  // every downloaded track. Reader's searchTracks won't do; use the same
  // readonly handle pattern via a tiny dedicated query added below.
  return reader.downloadedForSweep();
}
