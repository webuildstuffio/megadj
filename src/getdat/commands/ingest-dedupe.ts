/**
 * GetDat ingest — dedupe half (#88 item 3): the three within-folder passes
 * (identity → MD5 content → acoustic fingerprint) plus the Phase C archive
 * collision check. Highest quality wins; losers are quarantined, never
 * deleted.
 *
 * Pass ordering is cost-ordered (identity is free, MD5 is cheap, fpcalc is
 * ~1s/file) and each pass feeds survivors to the next. The traps that
 * shaped each pass are documented at the pass.
 */
import { basename } from "node:path";
import { md5FileStream } from "../../shared/hash";
import { pickScoredKeeper } from "../../shared/keeper";
import type { ArchiveState, TrackRow } from "../../core/state";
import {
  compareFingerprint,
  nameSimilarityTokens,
} from "../../fulltags/analysis/fingerprint-dedupe";
import { probeFile, qualityScore } from "../../fulltags/media-probe";
import { identityKey } from "../../fulltags/identity";
import { quarantine, type Record_ } from "./ingest-probe";

const md5File = md5FileStream;

/** Filename stem, lowercased and stripped to alphanumerics — the same-stem
 *  pair key for the mp3↔lossless dupe pass. Pure — module-level. */
const stemOf = (f: string): string =>
  basename(f)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** The shared keep/drop decision: pickScoredKeeper pinned to this module's
 * record shape (file identity + quality score). One table instead of the
 * three hand-inlined ternaries. */
function keepDrop(a: Record_, b: Record_): { keep: Record_; drop: Record_ } {
  const keep =
    pickScoredKeeper(
      a,
      b,
      (r) => r.file,
      (r) => r.score,
    ) === "a"
      ? a
      : b;
  return { keep, drop: keep === a ? b : a };
}

/** Remove a loser from the survivors list (it may have entered earlier as
 * first-seen — leaving it in meant Phase D tried to copy an already
 * quarantined file, ENOENT mid-batch, Sep 10 2026). */
function dropFrom(survivors: Record_[], drop: Record_): void {
  const idx = survivors.indexOf(drop);
  if (idx !== -1) survivors.splice(idx, 1);
}

/** Phase B: within-folder dedupe — highest quality wins, losers quarantined. */
export async function dedupeWithinFolder(
  records: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (msg: string) => void,
): Promise<{ survivors: Record_[]; folderDupes: number }> {
  const byIdentity = new Map<string, Record_>();
  const survivors: Record_[] = [];
  let folderDupes = 0;
  for (const rec of records) {
    const incumbent = byIdentity.get(rec.identity);
    if (!incumbent) {
      byIdentity.set(rec.identity, rec);
      survivors.push(rec);
      continue;
    }
    const { keep, drop } = keepDrop(incumbent, rec);
    byIdentity.set(keep.identity, keep);
    dropFrom(survivors, drop);
    if (!survivors.includes(keep)) survivors.push(keep);
    folderDupes++;
    log(
      `  [dupe] ${basename(drop.file)} — keeping higher-quality ${basename(keep.file)}` +
        ` (${(keep.score / 1e3).toFixed(0)} vs ${(drop.score / 1e3).toFixed(0)})`,
    );
    await quarantine(drop.file, quarantineDir, dryRun, log);
  }
  // Content-hash pass over the survivors (Back To Friends trap, Sep 9
  // 2026): a mislabeled "Extended Mix" was a byte-identical copy of the
  // Radio Edit — different filename + title tag → different identity →
  // both got ingested. Same size is the cheap trigger; MD5 confirms
  // before anything quarantines. Different content at the same size is
  // KEPT (size alone is not a dupe — AGENTS.md).
  folderDupes += await dedupeByContent(survivors, quarantineDir, dryRun, log);
  // Acoustic pass (name-blind, the shelf-dupescan guarantee at intake):
  // same recording re-rip under a different name/container/bitrate.
  // fp-equal + name-similar → dupe; fp-equal + name-dissimilar → possible
  // long-mix fp collision, kept for human review (never auto-quarantined).
  folderDupes += await dedupeByFingerprint(
    survivors,
    quarantineDir,
    dryRun,
    log,
  );
  return { survivors, folderDupes };
}

/** MD5-verified twin pass over the identity-dedupe survivors. */
async function dedupeByContent(
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<number> {
  let contentDupes = 0;
  const bySize = new Map<number, Record_[]>();
  for (const rec of survivors) {
    const list = bySize.get(rec.size) ?? [];
    list.push(rec);
    bySize.set(rec.size, list);
  }
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const hashes = new Map<string, Record_>();
    for (const rec of group) {
      const digest = await md5File(rec.file);
      const twin = hashes.get(digest);
      if (!twin) {
        hashes.set(digest, rec);
        continue;
      }
      const { keep, drop } = keepDrop(twin, rec);
      contentDupes++;
      log(
        `  [dupe] ${basename(drop.file)} — byte-identical twin of ${basename(keep.file)} (md5)`,
      );
      dropFrom(survivors, drop);
      await quarantine(drop.file, quarantineDir, dryRun, log);
      if (hashes.get(digest) === drop) hashes.set(digest, keep);
    }
  }
  return contentDupes;
}

/** Acoustic-fingerprint pass over the identity+MD5 survivors (name-blind
 *  dupe class: same recording, different rip). fpcalc per file is ~1s, so
 *  this runs only for pairs the cheaper passes couldn't resolve. Loser =
 *  lower quality score, then longer name — same tiebreaks as everywhere. */
async function dedupeByFingerprint(
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<number> {
  let fpDupes = 0;
  const byFp = new Map<string, Record_>();
  fpDupes += await quarantineMp3Twins(survivors, quarantineDir, dryRun, log);
  for (const rec of survivors) {
    // One fpcalc call per file — compareFingerprint hashes the second file
    // again; group sequentially so each file is hashed at most twice.
    const v = await compareFingerprint(rec.file, rec.file);
    if (!v.fp) continue;
    const seen = byFp.get(v.fp);
    if (!seen) {
      byFp.set(v.fp, rec);
      continue;
    }
    const similar =
      nameSimilarityTokens(basename(rec.file), basename(seen.file)) >= 0.5;
    if (!similar) {
      // fp collision across dissimilar names → likely different recordings
      // (long-mix), never auto-quarantine — surface it and keep both.
      log(
        `  [fp] same fingerprint, dissimilar names — kept for review: ${basename(rec.file)} ≈ ${basename(seen.file)}`,
      );
      continue;
    }
    const { keep, drop } = keepDrop(seen, rec);
    fpDupes++;
    log(
      `  [dupe] ${basename(drop.file)} — same recording as ${basename(keep.file)} (acoustic fingerprint)`,
    );
    dropFrom(survivors, drop);
    await quarantine(drop.file, quarantineDir, dryRun, log);
    if (byFp.get(v.fp) === drop) byFp.set(v.fp, keep);
  }
  return fpDupes;
}

/** SAME-STEM PAIR pass (the Play Hard trap, Sep 10 2026): pools ship
 * mp3+wav pairs whose fingerprints differ slightly (lossy vs lossless
 * decode), so the fp equality check can never match them — and both copies
 * ingested. A same-stem mp3↔lossless pair IS one recording by convention
 * (the skill's zip rule); the lossless side always wins, regardless of
 * what qualityScore says (an mp3's nominal bitrate must never beat the
 * lossless file it shipped with). */
async function quarantineMp3Twins(
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (m: string) => void,
): Promise<number> {
  let twins = 0;
  const LOSSLESS_RE = /\.(wav|aiff?|flac)$/i;
  const losslessStems = new Set<string>();
  for (const rec of survivors) {
    if (LOSSLESS_RE.test(rec.file)) losslessStems.add(stemOf(rec.file));
  }
  const mp3Losers = survivors.filter(
    (rec) => /\.mp3$/i.test(rec.file) && losslessStems.has(stemOf(rec.file)),
  );
  for (const loser of mp3Losers) {
    log(
      `  [dupe] ${basename(loser.file)} — mp3 twin of the same-stem lossless copy`,
    );
    dropFrom(survivors, loser);
    await quarantine(loser.file, quarantineDir, dryRun, log);
    twins++;
  }
  return twins;
}

/** Phase C: archive collision check — archive dupes quarantine unless the new
 *  copy beats the stored one by >5% quality (a "quality upgrade"). */
export async function dedupeAgainstArchive(
  state: ArchiveState,
  survivors: Record_[],
  quarantineDir: string,
  dryRun: boolean | undefined,
  log: (msg: string) => void,
): Promise<{ toIngest: Record_[]; archiveDupes: number; upgrades: number }> {
  const archiveTracks = state.downloadedWithFiles();
  const archiveByIdentity = new Map<string, TrackRow>();
  for (const t of archiveTracks) {
    if (!t.title) continue;
    const key = identityKey(t.artist, t.title);
    if (!archiveByIdentity.has(key)) archiveByIdentity.set(key, t);
  }
  let archiveDupes = 0;
  let upgrades = 0;
  const toIngest: Record_[] = [];
  for (const rec of survivors) {
    const existing = archiveByIdentity.get(rec.identity);
    if (!existing?.file_path) {
      toIngest.push(rec);
      continue;
    }
    // SELF-MATCH GUARD: the "existing" row may point at THIS VERY FILE.
    // Every batch folder lives inside musicDir, so last night's ingest of
    // this folder registered rows whose file_path is the file we're now
    // looking at. Quarantining here would rename the archive's only copy
    // into ingest-duplicates and leave the row pointing at a missing path
    // (the Sep 10 14:29 UI re-run did exactly that to 14 rows — the file
    // survived in quarantine, but the archive pointer broke). A self-match
    // means "already ingested, nothing to do": skip in place.
    if (existing.file_path === rec.file) {
      log(
        `  [dupe] already in archive (self): ${basename(rec.file)} — unchanged`,
      );
      archiveDupes++;
      continue;
    }
    archiveDupes++;
    const existingProbe = await probeFile(existing.file_path);
    const existingScore = existingProbe.ok ? qualityScore(existingProbe) : -1;
    if (rec.score > existingScore * 1.05) {
      upgrades++;
      log(
        `  [upgrade] ${basename(rec.file)} beats archive copy of "${existing.title}"` +
          ` — will replace`,
      );
      toIngest.push(rec);
    } else {
      log(`  [dupe] already in archive: ${basename(rec.file)} — quarantining`);
      await quarantine(rec.file, quarantineDir, dryRun, log);
    }
  }
  return { toIngest, archiveDupes, upgrades };
}
