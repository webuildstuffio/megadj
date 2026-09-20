import type { ChecksumResult } from "../bench";
import {
  apiPost,
  jobTerminal,
  pollJob,
  resolveDrive,
  type Job,
} from "../deckapi";
import { DRIVE_JOB_KINDS, type InterlockState } from "../../shared/types";
import { IS_TTY, JSON_MODE, emitJson, errOut, getJson, log } from "./runtime";

function spinFrame(): string {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return frames[Math.floor(Date.now() / 80) % frames.length] ?? "⠋";
}

function fmtEta(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function clearLine(): void {
  if (IS_TTY) process.stderr.write("\r\x1b[K");
}

function pollJobForCli(id: string): Promise<Job> {
  return pollJob(id, { onGiveUp: (message) => void errOut(message) });
}

async function finishLine(
  job: Job,
  driveName: string,
  elapsedSeconds: number,
): Promise<void> {
  if (job.status !== "done") {
    await errOut(
      `✕ ${job.kind} on ${driveName} ${job.status}: ${job.error ?? "no details"}`,
    );
    process.exit(1);
  }
  log(`✓ ${job.kind} on ${driveName} finished in ${fmtEta(elapsedSeconds)}`);
  let result: Record<string, unknown> | null = null;
  try {
    result = job.result_json
      ? (JSON.parse(job.result_json) as Record<string, unknown>)
      : null;
  } catch (error) {
    console.error("job result_json was not valid JSON", error);
  }
  if (job.kind === "verify" && result) {
    const checks = (result.checks ?? []) as {
      id: string;
      label: string;
      status: string;
      detail: string;
      meaning: string;
      fix?: string;
    }[];
    if (!checks.length) {
      log("  (no structured checks parsed — raw summary below)");
    } else {
      const failed = checks.filter((check) => check.status !== "pass");
      const passed = checks.filter((check) => check.status === "pass");
      log(`  ${passed.length} passed, ${failed.length} need attention:`);
      for (const check of checks) {
        const mark =
          check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✕";
        log(`  ${mark} ${check.label}`);
        log(`     ${check.detail}`);
        log(`     why it matters: ${check.meaning}`);
        if (check.status !== "pass" && check.fix) log(`     fix: ${check.fix}`);
      }
    }
  }
  if (job.kind === "checksum" && result) {
    const { hashed, changed } = result as Partial<ChecksumResult>;
    if (typeof hashed === "number" && Array.isArray(changed)) {
      log(
        changed.length
          ? `  ⚠ ${changed.length} file(s) differ from ledger:\n   ${changed.slice(0, 5).join("\n   ")}`
          : `  ${hashed.toLocaleString()} files clean`,
      );
    } else {
      console.error("checksum result_json had an unexpected shape");
    }
  }
  process.exit(0);
}

export async function cmdRun(
  nameOrId: string,
  kind: string,
  wait: boolean,
): Promise<void> {
  if (!(DRIVE_JOB_KINDS as readonly string[]).includes(kind)) {
    await errOut(`bad kind "${kind}" — one of: ${DRIVE_JOB_KINDS.join(", ")}`);
    process.exit(2);
  }
  const drive = await resolveDrive(nameOrId);
  if (!drive) {
    await errOut(`unknown drive: ${nameOrId}`);
    process.exit(2);
  }
  if (!drive.mounted) {
    await errOut(
      `drive ${drive.nickname ?? drive.name} is not mounted — plug it in first`,
    );
    process.exit(1);
  }
  const interlock = await getJson<InterlockState>("/api/interlock");
  if (interlock.rekordbox_running) {
    await errOut(
      `rekordbox is running (pid ${interlock.pid}) — operations locked to prevent library corruption. Quit rekordbox and retry.`,
    );
    process.exit(3);
  }
  const response = await apiPost(`/api/drives/${drive.id}/jobs`, {
    kind,
    origin: "deckctl",
  });
  const job = (await response.json()) as Job & { error?: string };
  if (!response.ok) {
    await errOut(`enqueue failed: ${job.error ?? response.status}`);
    process.exit(response.status === 423 ? 3 : 1);
  }
  if (JSON_MODE && !wait) {
    await emitJson(job);
    return;
  }
  log(
    `▶ ${kind} started on ${drive.nickname ?? drive.name} (job ${job.id.slice(0, 8)})`,
  );
  if (!wait) {
    log("poll with: deckctl jobs   (or re-run with --wait)");
    return;
  }

  const startedAt = Date.now();
  let lastRender = 0;
  let frame = 0;
  if (JSON_MODE) {
    let last = "";
    while (true) {
      const current = await pollJobForCli(job.id);
      const key = `${current.status}:${current.progress}:${current.message}`;
      if (key !== last) {
        await emitJson(current);
        last = key;
      }
      if (jobTerminal(current.status)) break;
      await Bun.sleep(1 - current.progress > 0.5 ? 3000 : 750);
    }
    return;
  }
  while (true) {
    const current = await pollJobForCli(job.id);
    const now = Date.now();
    if (jobTerminal(current.status)) {
      clearLine();
      await finishLine(current, drive.name, (now - startedAt) / 1000);
      return;
    }
    if (now - lastRender > 500) {
      lastRender = now;
      frame++;
      const percent = Math.round(current.progress * 100);
      const eta =
        current.eta_seconds !== null
          ? ` · ~${fmtEta(current.eta_seconds)} left`
          : "";
      const message = current.message ?? current.phase ?? "";
      if (IS_TTY)
        process.stderr.write(
          `\r\x1b[K${spinFrame()} ${kind} ${percent}% ${message}${eta}`,
        );
      else if (frame % 10 === 0)
        console.log(`${kind} ${percent}% ${message}${eta}`);
    }
    await Bun.sleep(750);
  }
}
