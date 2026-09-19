import { apiPost, resolveDrive, type Drive, type Job } from "../deckapi";
import type { PreflightReport } from "../preflight";
import type { InterlockState } from "../../shared/types";
import { collectPlayers } from "./players";
import { JSON_MODE, emitJson, errOut, getJson, log } from "./runtime";

type DriveWithBadges = Drive & {
  badges?: { label: string; tone: string }[];
};

export async function cmdStatus(): Promise<void> {
  const [interlock, drives, jobs] = await Promise.all([
    getJson<InterlockState>("/api/interlock"),
    getJson<DriveWithBadges[]>("/api/drives"),
    getJson<Job[]>("/api/jobs?active=1"),
  ]);
  if (JSON_MODE) {
    await emitJson({ interlock, drives, jobs });
    return;
  }
  log(
    interlock.rekordbox_running
      ? `🔒 rekordbox RUNNING (pid ${interlock.pid}) — all drive operations locked`
      : "● rekordbox not running — drive operations unlocked",
  );
  log("");
  for (const drive of drives) {
    const badges = (drive.badges ?? []).map((badge) => badge.label).join(" ");
    log(
      `${drive.mounted ? "🟢" : "⚫"} ${drive.nickname ?? drive.name}${drive.nickname ? ` (${drive.name})` : ""} ${badges}`,
    );
  }
  if (jobs.length) {
    log("");
    for (const job of jobs)
      log(
        `◌ ${job.kind} on ${job.drive_id}: ${job.message ?? job.phase ?? job.status}`,
      );
  }
}

export async function cmdDrives(): Promise<void> {
  const drives = await getJson<DriveWithBadges[]>("/api/drives");
  if (JSON_MODE) {
    await emitJson(drives);
    return;
  }
  for (const drive of drives) {
    const badges = (drive.badges ?? [])
      .map(
        (badge) =>
          `${badge.tone === "good" ? "✓" : badge.tone === "warn" ? "▲" : badge.tone === "bad" ? "✕" : "·"} ${badge.label}`,
      )
      .join("  ");
    log(
      `${drive.mounted ? "🟢" : "⚫"} ${drive.nickname ?? drive.name}  ${badges}`,
    );
  }
}

export async function cmdPreflight(): Promise<void> {
  const report = await getJson<PreflightReport>("/api/preflight");
  if (JSON_MODE) {
    await emitJson(report);
    if (report.overall !== "ready") process.exit(1);
    return;
  }
  log(`preflight — ${report.summary}`);
  log("");
  const icon = { pass: "✓", warn: "▲", fail: "✕", unknown: "○" };
  for (const drive of report.drives) {
    if (!drive.drive.mounted) continue;
    const dot =
      drive.overall === "ready"
        ? "🟢"
        : drive.overall === "not-ready"
          ? "🔴"
          : drive.overall === "attention"
            ? "🟡"
            : "⚪";
    log(
      `${dot} ${drive.drive.nickname ?? drive.drive.name} — ${drive.overall}`,
    );
    for (const check of drive.checks) {
      log(`  ${icon[check.status]} ${check.label}: ${check.detail ?? ""}`);
      if (check.fix) log(`     → ${check.fix}`);
    }
  }
  for (const advisory of report.firmware_advisories ?? [])
    log(`ℹ firmware: ${advisory}`);
  if (report.overall !== "ready") process.exit(1);
}

export async function cmdPlayers(nameOrId: string | undefined): Promise<void> {
  const drives: { id: string; name: string; nickname: string | null }[] = [];
  if (nameOrId) {
    const drive = await resolveDrive(nameOrId);
    if (!drive) {
      await errOut(`unknown drive: ${nameOrId}`);
      process.exit(2);
    }
    drives.push(drive);
  } else {
    drives.push(
      ...(await getJson<
        { id: string; name: string; nickname: string | null }[]
      >("/api/drives")),
    );
  }
  const { players, skipped } = await collectPlayers(drives, getJson);
  if (JSON_MODE) {
    if (nameOrId) {
      if (!players[0]) {
        await errOut(
          `players lookup failed for ${nameOrId}: ${skipped[0]?.reason ?? "no payload"}`,
        );
        process.exit(1);
      }
      await emitJson(players[0]);
    } else {
      await emitJson({ players, skipped });
    }
    return;
  }
  for (const item of skipped)
    log(`⚠ ${item.drive}: players lookup failed (${item.reason}) — skipped`);
  for (const payload of players) {
    if (payload.unknown) {
      log(
        `${payload.drive.nickname ?? payload.drive.name}: no scan data — run a full scan`,
      );
      continue;
    }
    log(
      `${payload.drive.nickname ?? payload.drive.name}: works on ${payload.ok.length} player type(s)` +
        ` · pdb ${payload.measured.pdb_live_rows ?? "—"} · onelibrary ${payload.measured.onelibrary_rows ?? "—"}`,
    );
    log(`  ✓ ${payload.ok.map((player) => player.name).join(", ")}`);
    for (const blocked of payload.blocked)
      log(`  ✕ ${blocked.player.name} — ${blocked.reason}`);
  }
}

export async function cmdJobs(): Promise<void> {
  const jobs = await getJson<Job[]>("/api/jobs");
  if (JSON_MODE) {
    await emitJson(jobs);
    return;
  }
  for (const job of jobs.slice(0, 15)) {
    const percent = Math.round(job.progress * 100);
    const status =
      job.status === "running"
        ? "◌"
        : job.status === "done"
          ? "✓"
          : job.status === "failed"
            ? "✕"
            : "·";
    const origin = job.origin && job.origin !== "web" ? ` [${job.origin}]` : "";
    log(
      `${status} ${job.id.slice(0, 8)} ${job.kind} ${percent}%${origin} ${job.message ?? ""} ${job.error ?? ""}`.trimEnd(),
    );
  }
}

export async function cmdCancel(jobId: string): Promise<void> {
  const response = await apiPost(`/api/jobs/${jobId}/cancel`);
  const body = (await response.json()) as { ok: boolean };
  log(
    body.ok
      ? `✓ cancelled ${jobId.slice(0, 8)}`
      : `could not cancel ${jobId.slice(0, 8)} (not active?)`,
  );
  process.exit(body.ok ? 0 : 1);
}
