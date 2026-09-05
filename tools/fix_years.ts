/**
 * fix_years.ts — correct every track's year using the REAL upload date from
 * its SoundCloud page (`display_date` in the page's JSON), falling back to
 * yt-dlp's %(timestamp)s, then AI as last resort. Overwrites the AI guess
 * of 2023 that flash-lite defaulted to.
 *
 * usage: as CLI → `bun tools/fix_years.ts [--dry-run]`
 *        as lib  → `runFixYears({ dryRun })` from `megadj years` (src/cli.ts)
 */
import { Database } from "bun:sqlite";
import { setFileTags, groundTruth, ARCH } from "./fetch_lib";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const DRY = process.argv.includes("--dry-run");

interface Row {
  video_id: string;
  title: string;
  artist: string | null;
  file_path: string;
  format_id: string | null;
  year: string | null;
}

const rows = db
  .query(
    "SELECT video_id, title, artist, file_path, format_id, year FROM tracks WHERE status='downloaded' AND file_path LIKE ?",
  )
  .all(`${ARCH}/%`) as Row[];

function parseScPageDates(html: string): number | null {
  const m = html.match(/"display_date":"(\d{4})-\d{2}-\d{2}T/);
  if (m?.[1]) return Number(m[1]);
  const r2 = html.match(/"release_date":"(\d{4})-/);
  if (r2?.[1]) return Number(r2[1]);
  const r3 = html.match(/"created_at":"(\d{4})-\d{2}-\d{2}T/);
  if (r3?.[1]) return Number(r3[1]);
  return null;
}

/** Fetch one SC page's year. Bun's fetch — no curl spawn, 8 at a time. */
async function scPageYear(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
      signal: AbortSignal.timeout(12_000),
    });
    const year = parseScPageDates(await res.text());
    if (year === null) console.error(`sc page year: no date field in ${url}`);
    return year;
  } catch (e) {
    console.error(`sc page year fetch failed for ${url}`, e);
    return null;
  }
}

/**
 * Batch yt-dlp year lookup: one invocation answers N URLs (each spawn is
 * ~1-2s of interpreter boot; batching amortizes it across the whole run).
 * Returns url → year for the ones yt-dlp could resolve.
 */
async function ytdlpYearsBatch(urls: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!urls.length) return out;
  const pr = Bun.spawnSync({
    cmd: [
      "yt-dlp",
      "--no-download",
      "--print",
      "%(webpage_url)s|%(timestamp)s|%(upload_date)s",
      ...urls,
    ],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  const lines = new TextDecoder().decode(pr.stdout).trim().split("\n");
  for (const line of lines) {
    const [url, ts, ud] = line.split("|");
    if (!url) continue;
    const tsN = Number(ts);
    let year: number | null = null;
    if (Number.isFinite(tsN) && tsN > 946_684_800)
      year = new Date(tsN * 1000).getUTCFullYear();
    else if (ud && /^\d{8}$/.test(ud)) year = Number(ud.slice(0, 4));
    if (year !== null) out.set(url, year);
  }
  return out;
}

export interface FixYearsStats {
  scPage: number;
  ytdlp: number;
  kept: number;
  failed: number;
}

/** Year-verification pass (SC page date → yt-dlp timestamp). */
export async function runFixYears(
  opts: { dryRun?: boolean; json?: boolean } = {},
): Promise<FixYearsStats> {
  const dry = opts.dryRun ?? false;
  let scPage = 0;
  let ytdlp = 0;
  let kept = 0;
  const failed: Row[] = [];

  // Phase 1 — resolve years for every SC-sourced track concurrently
  // (network-bound: Bun fetch, 8 in flight; no per-track curl spawn).
  const scUrls = rows
    .filter((r) => r.format_id?.startsWith("sc:"))
    .map((r) => r.format_id!.slice(3));
  const resolved = new Map<string, { year: number; source: string }>();
  {
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, scUrls.length) }, async () => {
        while (i < scUrls.length) {
          const url = scUrls[i++]!;
          const pageYear = await scPageYear(url);
          if (pageYear !== null) {
            resolved.set(url, { year: pageYear, source: "sc-page" });
            continue;
          }
          const viaYtdlp = (await ytdlpYearsBatch([url])).get(url);
          if (viaYtdlp !== undefined)
            resolved.set(url, { year: viaYtdlp, source: "yt-dlp" });
        }
      }),
    );
  }

  // Phase 2 — apply resolutions against ground truth (local, fast).
  for (const r of rows) {
    let year: number | null = null;
    let source = "";
    if (r.format_id?.startsWith("sc:")) {
      const hit = resolved.get(r.format_id.slice(3));
      if (hit) {
        year = hit.year;
        source = hit.source;
      }
    }
    // keep existing non-2023 year (probably intentional)
    if (!year && r.year && r.year !== "2023") {
      kept++;
      continue;
    }
    if (!year) {
      failed.push(r);
      continue;
    }

    const current = groundTruth(r.file_path).year ?? r.year;
    if (current === String(year)) {
      kept++;
      continue;
    }
    if (!dry) {
      setFileTags(r.file_path, { year });
      db.query("UPDATE tracks SET year=? WHERE video_id=?").run(
        String(year),
        r.video_id,
      );
    }
    if (source === "sc-page") scPage++;
    else ytdlp++;
    if (!opts.json) {
      console.log(
        `  ${current ?? "?"} → ${year} (${source}) — ${r.artist ?? "?"}: ${r.title.slice(0, 45)}`,
      );
    }
  }

  if (opts.json) {
    // P1 (--json on every command): one summary object on stdout, last.
    console.log(
      JSON.stringify({
        command: "years",
        dryRun: dry,
        scPage,
        ytdlp,
        kept,
        unresolved: failed.length,
        unresolvedTitles: failed.map((f) => f.title),
      }),
    );
  } else {
    console.log(
      `\n${dry ? "DRY " : ""}DONE — sc-page: ${scPage} | yt-dlp: ${ytdlp} | kept: ${kept} | unresolved: ${failed.length}`,
    );
    for (const f of failed) console.log(`  ? ${f.title.slice(0, 60)}`);
  }
  return { scPage, ytdlp, kept, failed: failed.length };
}

// direct CLI entry (megadj years is the supported path; keep back-compat)
if (import.meta.main) {
  await runFixYears({ dryRun: DRY });
  db.close();
}
