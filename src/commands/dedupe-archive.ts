/**
 * dedupe-archive — fingerprint EVERY archive audio file (chromaprint,
 * name-blind) and resolve same-recording groups: title identity, MD5 and
 * the acoustic pass at intake can only see files in the SAME dump folder;
 * this pass catches cross-batch dupes (the same rip landed in two dated
 * batch folders, or re-added months apart).
 *
 * Reports first; `--apply` quarantines group losers (never deletes) after
 * re-verifying byte/md5 equality where sizes match — the shelf-dupescan
 * safety rules apply verbatim: fp-equal + same-size + md5-equal → safe;
 * fp-equal + dissimilar names + different sizes → left for review.
 *
 * Fingerprints cache in the archive DB (file_archive_fingerprints) keyed
 * by path+size, so re-runs only compute new/changed files.
 */
import { Database } from "bun:sqlite";
import { basename, join } from "node:path";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import {
  walkAudioFiles,
  fingerprintFile,
  nameSimilarityTokens,
} from "../../fulltags/src/exports";
import { commandLog } from "../progress";

export interface DedupeArchiveOptions {
  musicDir: string;
  dbPath: string;
  /** move group losers into the archive quarantine */
  apply?: boolean;
  /** two-step safety with --apply */
  yes?: boolean;
  json?: boolean;
  log?: (m: string) => void;
}

export interface DupeGroup {
  fingerprint: string;
  files: Array<{ path: string; bytes: number }>;
  keep: string;
  reason: string;
}

export interface DedupeArchiveResult {
  scanned: number;
  fingerprinted: number;
  cached: number;
  groups: DupeGroup[];
  redundantBytes: number;
  quarantined: number;
  skippedForReview: number;
  errors: string[];
  applied: boolean;
}

import { DupFpCache, groupByFingerprint } from "./dupescan_shared";

class FpCache extends DupFpCache {
  constructor(db: Database) {
    super(db, "file_archive_fingerprints");
  }
}

function md5sum(path: string): string | null {
  const r = Bun.spawnSync(["md5", "-q", path]);
  if (r.exitCode !== 0) return null;
  const h = r.stdout.toString().trim();
  return h.length > 0 ? h : null;
}

export async function dedupeArchive(
  opts: DedupeArchiveOptions,
): Promise<DedupeArchiveResult> {
  const log = commandLog(opts);
  const db = new Database(opts.dbPath, { create: true });
  const cache = new FpCache(db);
  const res: DedupeArchiveResult = {
    scanned: 0,
    fingerprinted: 0,
    cached: 0,
    groups: [],
    redundantBytes: 0,
    quarantined: 0,
    skippedForReview: 0,
    errors: [],
    applied: false,
  };

  const files = walkAudioFiles(opts.musicDir).filter(
    (p) => !p.includes("/ingest-duplicates/"),
  );
  res.scanned = files.length;
  log(`dedupe-archive: ${files.length} files in ${basename(opts.musicDir)}/`);

  // ---- fingerprint (cached by path+size) ---------------------------------
  let done = 0;
  for (const f of files) {
    done++;
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      continue; // vanished mid-scan
    }
    const hit = cache.get(f, size);
    if (hit !== undefined) {
      res.cached++;
      continue;
    }
    cache.put(f, size, fingerprintFile(f));
    res.fingerprinted++;
    if (res.fingerprinted % 25 === 0)
      log(`  ${res.fingerprinted} new fingerprints (${done}/${files.length})…`);
  }
  log(`fingerprints: ${res.cached} cached, ${res.fingerprinted} computed`);

  // ---- group by fingerprint ----------------------------------------------
  const groups = groupByFingerprint(files, cache);
  for (const [fp, arr] of groups) {
    if (arr.length < 2) continue;
    // keeper = biggest lossless-leaning pick: size is a good proxy inside
    // one recording group (AIFF > MP3 of the same audio), then shorter name
    arr.sort(
      (a, b) =>
        b.bytes - a.bytes || basename(a.path).length - basename(b.path).length,
    );
    const nameRatio = Math.min(
      ...arr
        .slice(1)
        .map((f) =>
          nameSimilarityTokens(basename(f.path), basename(arr[0]!.path)),
        ),
    );
    res.groups.push({
      fingerprint: fp,
      files: arr,
      keep: arr[0]!.path,
      reason:
        nameRatio >= 0.5
          ? `largest of ${arr.length} identical-recording copies`
          : `largest of ${arr.length} fp-equal copies (dissimilar names — review)`,
    });
  }
  res.groups.sort((a, b) => b.files.length - a.files.length);
  res.redundantBytes = res.groups.reduce(
    (sum, g) => sum + g.files.slice(1).reduce((s, f) => s + f.bytes, 0),
    0,
  );
  for (const g of res.groups) {
    log(
      `  [group] ${g.files.length} copies · keep ${basename(g.keep)} · ${g.reason}`,
    );
    for (const f of g.files.slice(1))
      log(`      twin: ${f.path.slice(opts.musicDir.length + 1)}`);
  }

  // ---- apply stage (only with --apply --yes) ------------------------------
  const applied = opts.apply === true && opts.yes === true;
  if (opts.apply && !opts.yes) {
    log("--apply requires --yes (two-step safety — nothing moved)");
  }
  if (applied) {
    const qDir = join(opts.musicDir, ".dupescan-quarantine");
    mkdirSync(qDir, { recursive: true });
    for (const g of res.groups) {
      const keeper = g.files[0]!;
      const keeperMd5 = md5sum(keeper.path);
      for (const loser of g.files.slice(1)) {
        if (!existsSync(loser.path)) continue;
        if (loser.bytes === keeper.bytes) {
          // same fp + same size: require byte-equality before moving
          const lm = md5sum(loser.path);
          if (keeperMd5 && lm !== keeperMd5) {
            res.errors.push(
              `md5 mismatch inside same-size group: ${loser.path}`,
            );
            res.skippedForReview++;
            continue;
          }
        } else {
          // different size + fp-equal: only move when names agree (a real
          // re-rip); dissimilar names = possible collision → review
          const ratio = nameSimilarityTokens(
            basename(loser.path),
            basename(keeper.path),
          );
          if (ratio < 0.5) {
            res.skippedForReview++;
            continue;
          }
        }
        const dest = join(qDir, basename(loser.path));
        if (existsSync(dest)) {
          res.errors.push(`quarantine name collision: ${loser.path}`);
          res.skippedForReview++;
          continue;
        }
        try {
          renameSync(loser.path, dest);
          res.quarantined++;
          log(`  → quarantined: ${basename(loser.path)}`);
        } catch (e) {
          res.errors.push(
            `move failed: ${loser.path} (${e instanceof Error ? e.message : e})`,
          );
        }
      }
    }
  }
  res.applied = applied;
  db.close();
  return res;
}
