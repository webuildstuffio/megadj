import { apiPost, resolveDrive } from "../deckapi";
import type {
  BoothFleetPayload,
  CoverageResponse,
  FleetDiff,
  FleetRadar,
  RedundancyResult,
} from "../shared/types";
import { JSON_MODE, emitJson, errOut, getJson, log } from "./runtime";

function showRows(rows: { title: string | null; path: string }[]): void {
  for (const row of rows.slice(0, 30)) log(`    ${row.title ?? row.path}`);
}

export async function cmdCoverage(minCopies?: string): Promise<void> {
  const parsed = minCopies ? parseInt(minCopies, 10) : undefined;
  const query = parsed && parsed > 0 ? `?min_copies=${parsed}` : "";
  const result = await getJson<CoverageResponse>(`/api/fleet/coverage${query}`);
  if (JSON_MODE) {
    await emitJson(result);
    return;
  }
  log(
    `fleet coverage — ${result.totals.unique_tracks.toLocaleString()} unique tracks across ${result.drives.length} drive(s)`,
  );
  for (const drive of result.drives)
    log(`  ${drive.name}: ${drive.tracks.toLocaleString()} tracks`);
  if (!result.at_risk.length) {
    log(
      `✓ no at-risk tracks — everything lives on ≥${result.min_copies} drive(s)`,
    );
    return;
  }
  log(
    `⚠ ${result.at_risk.length} track(s) below ${result.min_copies} copies (first 50):`,
  );
  for (const track of result.at_risk.slice(0, 50)) {
    const name = track.identity.title ?? track.identity.path;
    const artist = track.identity.artist ? ` — ${track.identity.artist}` : "";
    log(`  ${track.copies}· ${name}${artist}  [${track.drives.join(", ")}]`);
  }
}

export async function cmdRedundancy(minCopies?: string): Promise<void> {
  const parsed = minCopies ? parseInt(minCopies, 10) : undefined;
  const query = parsed && parsed > 0 ? `?min_copies=${parsed}` : "";
  const result = await getJson<RedundancyResult>(
    `/api/fleet/redundancy${query}`,
  );
  if (JSON_MODE) {
    await emitJson(result);
    return;
  }
  log(`redundancy audit — ${result.summary}`);
  for (const playlist of result.playlists) {
    const mark =
      playlist.verdict === "pass"
        ? "✓"
        : playlist.verdict === "fail"
          ? "✕"
          : playlist.verdict === "warn"
            ? "▲"
            : "○";
    log(
      `${mark} ${playlist.playlist}: ${playlist.protected_tracks}/${playlist.unique_tracks} protected — ${playlist.detail}`,
    );
  }
}

export async function cmdDiff(a?: string, b?: string): Promise<void> {
  if (!a || !b) {
    await errOut(
      "usage: deckctl diff <driveA> <driveB>  (name, nickname, or UUID)",
    );
    process.exit(2);
  }
  const driveA = await resolveDrive(a);
  const driveB = await resolveDrive(b);
  if (!driveA) {
    await errOut(`unknown drive: ${a}`);
    process.exit(2);
  }
  if (!driveB) {
    await errOut(`unknown drive: ${b}`);
    process.exit(2);
  }
  const result = await getJson<FleetDiff>(
    `/api/fleet/diff?a=${encodeURIComponent(driveA.id)}&b=${encodeURIComponent(driveB.id)}`,
  );
  if (JSON_MODE) {
    await emitJson(result);
    return;
  }
  log(`${result.a} → ${result.b}: ${result.summary}`);
  if (result.added.length) {
    log(`  + added (${result.added.length}):`);
    showRows(result.added);
  }
  if (result.removed.length) {
    log(`  − missing (${result.removed.length}):`);
    showRows(result.removed);
  }
  if (result.changed.length) {
    log(`  ~ changed bytes (${result.changed.length}):`);
    showRows(result.changed);
  }
  if (!result.added.length && !result.removed.length && !result.changed.length)
    log("  identical inventories");
}

/** deckctl radar (#148): archive rows each drive's snapshot lacks, with the
 *  copyable sync command. v1 is copy-only — never an automatic write. */
export async function cmdRadar(drive?: string): Promise<void> {
  const result = await getJson<FleetRadar>("/api/fleet/radar");
  if (JSON_MODE) {
    await emitJson(result);
    return;
  }
  log(`new-music radar — ${result.summary}`);
  const wants = drive
    ? result.drives.filter((d) => d.driveId === drive)
    : result.drives;
  if (drive && wants.length === 0) {
    await errOut(`unknown drive: ${drive}`);
    process.exit(2);
  }
  for (const r of wants) {
    const snap = r.snapshotAt
      ? ` · snapshot ${r.snapshotAt.slice(0, 10)}`
      : " · never scanned";
    log(`  ${r.driveName}: ${r.summary}${snap}`);
    for (const row of r.missing.slice(0, 10))
      log(
        `    ${row.artist ? `${row.artist} — ` : ""}${row.title ?? row.path}`,
      );
    if (r.missing.length > 10)
      log(`    … and ${r.missingCount - 10} more (web Radar tab or --json)`);
  }
  if (result.totalMissing > 0)
    log(
      `  fix: megadj shelf-sync (additive, MD5-verified) — then re-scan the drive`,
    );
}

async function reportFleet(data: BoothFleetPayload): Promise<void> {
  if (JSON_MODE) {
    await emitJson(data);
    return;
  }
  log(`booth fleet: ${data.selected.join(", ")}`);
  log(
    `floor: ${data.floor.flac ? "FLAC ok" : "no FLAC"} · ${data.floor.maxBitDepth}-bit · ${data.floor.maxSampleRate / 1000} kHz · ${data.floor.unicodeText ? "Unicode" : "ASCII-only"} text`,
  );
  for (const profile of data.profiles) {
    const mark = data.selected.includes(profile.id) ? "x" : " ";
    log(
      `  [${mark}] ${profile.name} (${profile.id})${profile.defaultOn ? " — default on" : ""}`,
    );
  }
  log("set with: deckctl booth set <id ...>");
}

export async function cmdBoothFleet(
  setCmd: string | undefined,
  ids: string[] | undefined,
): Promise<void> {
  if (setCmd !== undefined && setCmd !== "set") {
    await errOut(
      `unknown booth subcommand "${setCmd}" — usage: booth [set ID ...]`,
    );
    process.exit(2);
  }
  if (setCmd === "set") {
    if (!ids?.length) {
      await errOut(
        "booth set needs at least one player id (e.g. xdj-xz cdj-3000 cdj-2000nxs2)",
      );
      process.exit(2);
    }
    const response = await apiPost("/api/booth/fleet", { selected: ids });
    if (!response.ok) {
      await errOut(`booth-fleet set failed: HTTP ${response.status}`);
      process.exit(1);
    }
    await reportFleet((await response.json()) as BoothFleetPayload);
    return;
  }
  await reportFleet(await getJson<BoothFleetPayload>("/api/booth/fleet"));
}
