/**
 * shelf-dupescan — whole-shelf acoustic duplicate scan.
 *
 * The twin pass (shelf-dedupe) only resolves "<stem> [<drive>]" pairs the
 * archive sweeps created. It cannot see the other duplicate class: the SAME
 * recording filed under DIFFERENT artist folders or filenames (ripped twice,
 * organized differently) — the ANOTR case. This pass fingerprints EVERY
 * audio file on the shelf (chromaprint, name-blind) and groups by
 * fingerprint equality, so dupes surface no matter what they're called or
 * where they live.
 *
 * Report-only by default (fingerprints cached in the archive DB). `--apply`
 * is intentionally absent: groups feed the same human-gated quarantine flow
 * as shelf-dedupe. Parallel worker pool; fp cache makes re-runs fast.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const AUDIO = new Set([".mp3", ".wav", ".aif", ".aiff", ".m4a", ".flac"]);

export function walkAudio(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith("._") || e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const dot = e.name.lastIndexOf(".");
        const ext = dot > 0 ? e.name.slice(dot).toLowerCase() : "";
        if (AUDIO.has(ext)) out.push(abs);
      }
    }
  };
  walk(root);
  return out;
}

function fingerprint(path: string): string | null {
  const r = spawnSync("fpcalc", ["-length", "120", path]);
  if (r.status !== 0) return null;
  const m = r.stdout.toString().match(/FINGERPRINT=([A-Za-z0-9=/]+)/);
  return m?.[1] ?? null;
}

/** Persistent fp cache — one row per file path (re-runs only decode new/changed files). */
export class FpCache {
  constructor(private db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shelf_fingerprints (
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        fingerprint TEXT,
        computed_at TEXT NOT NULL
      )
    `);
  }
  get(path: string, size: number): string | null | undefined {
    const row = this.db
      .query(
        "SELECT fingerprint FROM shelf_fingerprints WHERE path = ? AND size = ?",
      )
      .get(path, size) as { fingerprint: string | null } | null;
    return row ? row.fingerprint : undefined; // undefined = not cached
  }
  put(path: string, size: number, fp: string | null): void {
    this.db
      .query(
        `INSERT INTO shelf_fingerprints (path, size, fingerprint, computed_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(path) DO UPDATE SET size=excluded.size, fingerprint=excluded.fingerprint, computed_at=excluded.computed_at`,
      )
      .run(path, size, fp);
  }
}

export interface DupGroup {
  fingerprint: string;
  files: Array<{ path: string; bytes: number }>;
  keep: string;
  reason: string;
}

export interface DupScanOptions {
  shelfVolume?: string;
  jobs?: number;
  json?: boolean;
  log?: (s: string) => void;
  dbPath?: string;
}

export async function shelfDupescan(opts: DupScanOptions = {}): Promise<void> {
  const {
    shelfVolume = process.env.MEGADJ_SHELF ?? "/Volumes/SHELF1",
    jobs = 8,
    json = false,
    log = (s) => console.log(s),
    dbPath = process.env.MEGADJ_DB ??
      `${process.env.HOME}/.local/state/megadj/archive.db`,
  } = opts;

  const contents = join(shelfVolume, "Contents");
  if (!existsSync(contents)) {
    if (json) console.log(JSON.stringify({ error: "shelf not mounted" }));
    else log(`shelf not mounted: ${shelfVolume}`);
    process.exitCode = 1;
    return;
  }

  const db = new Database(dbPath);
  const cache = new FpCache(db);
  const files = walkAudio(contents);
  log(`shelf-dupescan: ${files.length} audio files on ${shelfVolume}`);

  // compute missing fingerprints with a small parallel pool
  const missing = files.filter((f) => {
    try {
      return cache.get(f, statSync(f).size) === undefined;
    } catch {
      return false;
    }
  });
  log(
    `fingerprints cached: ${files.length - missing.length} · to compute: ${missing.length}`,
  );
  let done = 0;
  const workers = Array.from(
    { length: Math.min(jobs, missing.length || 1) },
    async () => {
      for (;;) {
        const f = missing[done];
        if (f === undefined) break;
        done++;
        const size = statSync(f).size;
        cache.put(f, size, fingerprint(f));
        if (done % 250 === 0) log(`  ${done}/${missing.length} fingerprints…`);
      }
    },
  );
  await Promise.all(workers);

  // group by fingerprint (skip nulls/unfingerprintable)
  const groups = new Map<string, Array<{ path: string; bytes: number }>>();
  for (const f of files) {
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      continue;
    }
    const fp = cache.get(f, size);
    if (!fp) continue;
    const arr = groups.get(fp) ?? [];
    arr.push({ path: f, bytes: size });
    groups.set(fp, arr);
  }

  // a duplicate group = >=2 files with the same fingerprint
  const dupes: DupGroup[] = [];
  for (const [fp, arr] of groups) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => b.bytes - a.bytes);
    dupes.push({
      fingerprint: fp,
      files: arr,
      keep: arr[0]!.path,
      reason: `largest of ${arr.length} identical-fingerprint copies`,
    });
  }
  dupes.sort((a, b) => b.files.length - a.files.length);

  const redundantBytes = dupes.reduce(
    (sum, g) => sum + g.files.slice(1).reduce((s, f) => s + f.bytes, 0),
    0,
  );

  if (json) {
    console.log(
      JSON.stringify(
        {
          command: "shelf-dupescan",
          shelf: shelfVolume,
          scanned: files.length,
          duplicateGroups: dupes.length,
          redundantFiles: dupes.reduce((s, g) => s + g.files.length - 1, 0),
          redundantBytes,
          groups: dupes,
        },
        null,
        2,
      ),
    );
  } else {
    log(
      `duplicate groups: ${dupes.length} (redundant copies: ${dupes.reduce((s, g) => s + g.files.length - 1, 0)}, ${(redundantBytes / 1e9).toFixed(2)} GB)`,
    );
    for (const g of dupes.slice(0, 40)) {
      log(
        `\n  group of ${g.files.length} — keep: ${g.keep.replace(contents, "")}`,
      );
      for (const f of g.files.slice(1))
        log(
          `    dupe: ${f.path.replace(contents, "")} (${(f.bytes / 1e6).toFixed(1)} MB)`,
        );
    }
    if (dupes.length > 40)
      log(`\n  …and ${dupes.length - 40} more groups (--json for full list)`);
  }
  db.close();
}
