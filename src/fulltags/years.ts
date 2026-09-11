/** Verify SoundCloud-sourced years from page metadata, then yt-dlp. */
import { DB_PATH, MUSIC_DIR } from "../cli-env";
import { ArchiveState } from "../archive/state";
import { groundTruth, writePatchSync } from "../../fulltags/src/exports";

interface Row {
  video_id: string;
  title: string | null;
  artist: string | null;
  file_path: string;
  format_id: string | null;
  year: string | null;
}

function parseScPageDates(html: string): number | null {
  for (const pattern of [
    /"display_date":"(\d{4})-\d{2}-\d{2}T/u,
    /"release_date":"(\d{4})-/u,
    /"created_at":"(\d{4})-\d{2}-\d{2}T/u,
  ]) {
    const year = pattern.exec(html)?.[1];
    if (year !== undefined) return Number(year);
  }
  return null;
}

async function scPageYear(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
      signal: AbortSignal.timeout(12_000),
    });
    return parseScPageDates(await response.text());
  } catch (error) {
    console.error(`sc page year fetch failed for ${url}`, error);
    return null;
  }
}

async function ytdlpYearsBatch(urls: string[]): Promise<[string, number][]> {
  if (!urls.length) return [];
  const result = Bun.spawnSync({
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
  const resolved: [string, number][] = [];
  for (const line of new TextDecoder()
    .decode(result.stdout)
    .trim()
    .split("\n")) {
    const [resolvedUrl, timestamp, uploadDate] = line.split("|");
    if (!resolvedUrl) continue;
    const timestampNumber = Number(timestamp);
    const year =
      Number.isFinite(timestampNumber) && timestampNumber > 946_684_800
        ? new Date(timestampNumber * 1000).getUTCFullYear()
        : uploadDate && /^\d{8}$/u.test(uploadDate)
          ? Number(uploadDate.slice(0, 4))
          : null;
    if (year !== null) resolved.push([resolvedUrl, year]);
  }
  return resolved;
}

export interface FixYearsStats {
  scPage: number;
  ytdlp: number;
  kept: number;
  failed: number;
}

export async function runFixYears(
  opts: { dryRun?: boolean; json?: boolean } = {},
): Promise<FixYearsStats> {
  const dryRun = opts.dryRun ?? false;
  let scPage = 0;
  let ytdlp = 0;
  let kept = 0;
  const failed: Row[] = [];
  const state = new ArchiveState(DB_PATH);
  try {
    const rows = state.db
      .query(
        "SELECT video_id, title, artist, file_path, format_id, year FROM tracks WHERE status='downloaded' AND file_path LIKE ?",
      )
      .all(`${MUSIC_DIR}/%`) as Row[];
    const urls = rows
      .filter((row) => row.format_id?.startsWith("sc:"))
      .map((row) => row.format_id!.slice(3));
    const resolved = new Map<string, { year: number; source: string }>();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, urls.length) }, async () => {
        while (next < urls.length) {
          const url = urls[next++]!;
          const year = await scPageYear(url);
          if (year !== null) resolved.set(url, { year, source: "sc-page" });
        }
      }),
    );
    for (const [resolvedUrl, year] of await ytdlpYearsBatch(
      urls.filter((url) => !resolved.has(url)),
    ))
      resolved.set(resolvedUrl, { year, source: "yt-dlp" });
    for (const row of rows) {
      const hit = row.format_id?.startsWith("sc:")
        ? resolved.get(row.format_id.slice(3))
        : undefined;
      if (!hit && row.year && row.year !== "2023") {
        kept++;
        continue;
      }
      if (!hit) {
        failed.push(row);
        continue;
      }
      const current = groundTruth(row.file_path).year ?? row.year;
      if (current === String(hit.year)) {
        kept++;
        continue;
      }
      if (!dryRun) {
        if (!writePatchSync(row.file_path, { year: hit.year })) {
          failed.push(row);
          continue;
        }
        state.db
          .query("UPDATE tracks SET year=? WHERE video_id=?")
          .run(String(hit.year), row.video_id);
      }
      if (hit.source === "sc-page") scPage++;
      else ytdlp++;
      if (!opts.json)
        console.log(
          `  ${current ?? "?"} → ${hit.year} (${hit.source}) — ${row.artist ?? "?"}: ${(row.title ?? "?").slice(0, 45)}`,
        );
    }
  } finally {
    state.close();
  }
  if (opts.json)
    console.log(
      JSON.stringify({
        command: "years",
        dryRun,
        scPage,
        ytdlp,
        kept,
        unresolved: failed.length,
      }),
    );
  else
    console.log(
      `\n${dryRun ? "DRY " : ""}DONE — sc-page: ${scPage} | yt-dlp: ${ytdlp} | kept: ${kept} | unresolved: ${failed.length}`,
    );
  return { scPage, ytdlp, kept, failed: failed.length };
}
