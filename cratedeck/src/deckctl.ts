// deckctl.ts — CLI for CrateDeck (agents + humans).
//
// Talks to the CrateDeck HTTP server; auto-starts it if it's not running.
// All output is human-friendly by default (spinners, ETA, checklists) and
// machine-friendly with --json (single JSON object, no ANSI).
//
// Usage:
//   bun run cratedeck/src/deckctl.ts status [--json]
//   bun run cratedeck/src/deckctl.ts drives [--json]
//   bun run cratedeck/src/deckctl.ts report <drive> [--json]   # name or UUID
//   bun run cratedeck/src/deckctl.ts run <drive> <scan|verify|mirror|benchmark|checksum> [--wait] [--json]
//   bun run cratedeck/src/deckctl.ts jobs [--json]
//   bun run cratedeck/src/deckctl.ts explain [kind]            # what each job does
//   bun run cratedeck/src/deckctl.ts cancel <jobId>
//   bun run cratedeck/src/deckctl.ts stop
//
// Exit codes: 0 ok · 1 job failed/verify-fail · 2 usage · 3 interlock · 4 server unreachable.

import { VERIFY_HELP } from "./verify_help";

const PORT = 7742;
const BASE = `http://127.0.0.1:${PORT}`;

interface Job {
  id: string;
  drive_id: string;
  kind: string;
  status: string;
  progress: number;
  message: string | null;
  phase: string | null;
  eta_seconds: number | null;
  error: string | null;
  result_json: string | null;
}
interface Drive {
  id: string;
  name: string;
  nickname: string | null;
  mounted: boolean;
}
interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "unknown";
  detail: string;
  fix?: string;
}

// ---- output helpers ---------------------------------------------------------
const JSON_MODE = process.argv.includes("--json");
const IS_TTY = process.stderr.isTTY ?? false;

function plain(s: string): string {
  return JSON_MODE ? "" : s;
}
function spinFrame(): string {
  const t = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return t[Math.floor(Date.now() / 80) % t.length] ?? "⠋";
}
function fmtEta(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
function log(msg: string): void {
  if (JSON_MODE) return;
  console.log(msg);
}
function errOut(msg: string): void {
  if (JSON_MODE) console.log(JSON.stringify({ error: msg }));
  else console.error(msg);
}

// ---- server boot ------------------------------------------------------------
async function apiGet(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`);
}
async function ensureServer(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/interlock`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {}
  log(plain("cratedeck not running — starting it…"));
  try {
    const proc = Bun.spawn(["bun", "run", "cratedeck/src/index.ts"], {
      stdout: "ignore",
      stderr: "ignore",
      cwd: import.meta.dir + "/../..",
      detached: true,
    });
    proc.unref();
  } catch {
    return false;
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${BASE}/api/interlock`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

// ---- drive resolution -------------------------------------------------------
async function resolveDrive(nameOrId: string): Promise<Drive | null> {
  const drives = (await apiGet("/api/drives").then((r) => r.json())) as Drive[];
  const q = nameOrId.toLowerCase();
  return (
    drives.find((d) => d.id.toLowerCase() === q) ??
    drives.find((d) => d.name.toLowerCase() === q) ??
    drives.find((d) => (d.nickname ?? "").toLowerCase() === q) ??
    null
  );
}

// ---- commands ---------------------------------------------------------------
async function cmdStatus(): Promise<void> {
  const [interlock, drives, jobs] = await Promise.all([
    apiGet("/api/interlock").then((r) => r.json()),
    apiGet("/api/drives").then((r) => r.json()),
    apiGet("/api/jobs?active=1").then((r) => r.json()),
  ]);
  if (JSON_MODE) {
    console.log(JSON.stringify({ interlock, drives, jobs }, null, 2));
    return;
  }
  const il = interlock as { rekordbox_running: boolean; pid: number | null };
  const ds = drives as (Drive & {
    badges?: { label: string; tone: string }[];
  })[];
  const js = jobs as Job[];
  log(
    il.rekordbox_running
      ? `🔒 rekordbox RUNNING (pid ${il.pid}) — all drive operations locked`
      : "● rekordbox not running — drive operations unlocked",
  );
  log("");
  for (const d of ds) {
    const badges = (d.badges ?? []).map((b) => b.label).join(" ");
    log(
      `${d.mounted ? "🟢" : "⚫"} ${d.nickname ?? d.name}${d.nickname ? ` (${d.name})` : ""} ${badges}`,
    );
  }
  if (js.length) {
    log("");
    for (const j of js)
      log(`◌ ${j.kind} on ${j.drive_id}: ${j.message ?? j.phase ?? j.status}`);
  }
}

async function cmdDrives(): Promise<void> {
  const drives = (await apiGet("/api/drives").then((r) =>
    r.json(),
  )) as (Drive & {
    badges?: { label: string; tone: string }[];
  })[];
  if (JSON_MODE) {
    console.log(JSON.stringify(drives, null, 2));
    return;
  }
  for (const d of drives) {
    const badges = (d.badges ?? [])
      .map(
        (b) =>
          `${b.tone === "good" ? "✓" : b.tone === "warn" ? "▲" : b.tone === "bad" ? "✕" : "·"} ${b.label}`,
      )
      .join("  ");
    log(`${d.mounted ? "🟢" : "⚫"} ${d.nickname ?? d.name}  ${badges}`);
  }
}

async function cmdReport(nameOrId: string): Promise<void> {
  const d = await resolveDrive(nameOrId);
  if (!d) {
    errOut(`unknown drive: ${nameOrId}`);
    process.exit(2);
  }
  const r = await apiGet(`/api/drives/${d.id}/report`).then((res) =>
    res.json(),
  );
  if (JSON_MODE) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const checks = (r.checks ?? []) as HealthCheck[];
  const icon = { pass: "✓", warn: "▲", fail: "✕", unknown: "○" };
  log(`drive: ${d.nickname ?? d.name}  overall: ${r.overall ?? "?"}`);
  log("");
  for (const c of checks) {
    log(`${icon[c.status]} ${c.label}: ${c.detail}`);
    if (c.fix) log(`   → ${c.fix}`);
  }
}

async function cmdRun(
  nameOrId: string,
  kind: string,
  wait: boolean,
): Promise<void> {
  const kinds = ["scan", "verify", "mirror", "benchmark", "checksum"];
  if (!kinds.includes(kind)) {
    errOut(`bad kind "${kind}" — one of: ${kinds.join(", ")}`);
    process.exit(2);
  }
  const d = await resolveDrive(nameOrId);
  if (!d) {
    errOut(`unknown drive: ${nameOrId}`);
    process.exit(2);
  }
  if (!d.mounted) {
    errOut(`drive ${d.nickname ?? d.name} is not mounted — plug it in first`);
    process.exit(1);
  }
  const interlock = await apiGet("/api/interlock").then((r) => r.json());
  if ((interlock as { rekordbox_running: boolean }).rekordbox_running) {
    const pid = (interlock as { pid: number | null }).pid;
    errOut(
      `rekordbox is running (pid ${pid}) — operations locked to prevent library corruption. Quit rekordbox and retry.`,
    );
    process.exit(3);
  }

  const res = await fetch(`${BASE}/api/drives/${d.id}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  const body = await res.json();
  if (!res.ok) {
    errOut(
      `enqueue failed: ${(body as { error?: string }).error ?? res.status}`,
    );
    process.exit(res.status === 423 ? 3 : 1);
  }
  const job = body as Job;
  if (JSON_MODE && !wait) {
    console.log(JSON.stringify(job, null, 2));
    return;
  }
  log(
    `▶ ${kind} started on ${d.nickname ?? d.name} (job ${job.id.slice(0, 8)})`,
  );
  if (!wait) {
    log("poll with: deckctl jobs   (or re-run with --wait)");
    return;
  }
  // ---- live follow: redraw a status line ~2x/s with ETA --------------------
  const t0 = Date.now();
  let lastRender = 0;
  let frame = 0;
  if (JSON_MODE) {
    // machine mode: emit a JSON line per poll (state-change friendly)
    let last = "";
    while (true) {
      const j = (await apiGet(`/api/jobs/${job.id}`).then((r) =>
        r.json(),
      )) as Job;
      const key = `${j.status}:${j.progress}:${j.message}`;
      if (key !== last) {
        console.log(JSON.stringify(j));
        last = key;
      }
      if (terminal(j.status)) break;
      // adaptive poll: slow while idle-ish, fast near completion for a
      // snappy final line (fewer total requests than fixed 2s over long jobs)
      const remain = 1 - j.progress;
      await new Promise((r) => setTimeout(r, remain > 0.5 ? 3000 : 750));
    }
  } else {
    while (true) {
      const j = (await apiGet(`/api/jobs/${job.id}`).then((r) =>
        r.json(),
      )) as Job;
      const now = Date.now();
      if (terminal(j.status)) {
        clearLine();
        finishLine(j, d.name, (now - t0) / 1000);
        break;
      }
      if (now - lastRender > 500) {
        lastRender = now;
        frame++;
        const pct = Math.round(j.progress * 100);
        const eta =
          j.eta_seconds != null ? ` · ~${fmtEta(j.eta_seconds)} left` : "";
        const msg = j.message ?? j.phase ?? "";
        if (IS_TTY)
          process.stderr.write(
            `\r\x1b[K${spinFrame()} ${kind} ${pct}% ${msg}${eta}`,
          );
        else if (frame % 10 === 0) console.log(`${kind} ${pct}% ${msg}${eta}`);
      }
      // server throttles progress writes to 4/s; polling faster is waste
      await new Promise((r) => setTimeout(r, 750));
    }
  }
}

function terminal(status: string): boolean {
  return ["done", "failed", "cancelled", "interrupted"].includes(status);
}

function clearLine(): void {
  if (IS_TTY) process.stderr.write("\r\x1b[K");
}

function finishLine(j: Job, driveName: string, elapsedS: number): void {
  if (j.status === "done") {
    log(`✓ ${j.kind} on ${driveName} finished in ${fmtEta(elapsedS)}`);
    let result: Record<string, unknown> | null = null;
    try {
      result = j.result_json
        ? (JSON.parse(j.result_json) as Record<string, unknown>)
        : null;
    } catch {}
    if (j.kind === "verify" && result) {
      const checks = (result.checks ?? []) as {
        id: string;
        label: string;
        status: string;
        detail: string;
        meaning: string;
        fix?: string;
      }[];
      if (!checks.length) {
        log(
          "  (no structured checks parsed — raw summary below)",
        );
      } else {
        const bad = checks.filter((c) => c.status !== "pass");
        const good = checks.filter((c) => c.status === "pass");
        log(
          `  ${good.length} passed, ${bad.length} need attention:`,
        );
        for (const c of checks) {
          const mark =
            c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✕";
          log(`  ${mark} ${c.label}`);
          log(`     ${c.detail}`);
          log(`     why it matters: ${c.meaning}`);
          if (c.status !== "pass" && c.fix) log(`     fix: ${c.fix}`);
        }
      }
    }
    if (j.kind === "checksum" && result) {
      try {
        const r = result as unknown as {
          hashed: number;
          changed: string[];
        };
        log(
          r.changed.length
            ? `  ⚠ ${r.changed.length} file(s) differ from ledger:\n   ${r.changed.slice(0, 5).join("\n   ")}`
            : `  ${r.hashed.toLocaleString()} files clean`,
        );
      } catch {}
    }
    process.exit(0);
  }
  errOut(`✕ ${j.kind} on ${driveName} ${j.status}: ${j.error ?? "no details"}`);
  process.exit(1);
}

async function cmdJobs(): Promise<void> {
  const jobs = (await apiGet("/api/jobs").then((r) => r.json())) as Job[];
  if (JSON_MODE) {
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }
  for (const j of jobs.slice(0, 15)) {
    const pct = Math.round(j.progress * 100);
    const status =
      j.status === "running"
        ? "◌"
        : j.status === "done"
          ? "✓"
          : j.status === "failed"
            ? "✕"
            : "·";
    log(
      `${status} ${j.id.slice(0, 8)} ${j.kind} ${pct}% ${j.message ?? ""} ${j.error ?? ""}`.trimEnd(),
    );
  }
}

async function cmdCancel(jobId: string): Promise<void> {
  const r = await fetch(`${BASE}/api/jobs/${jobId}/cancel`, { method: "POST" });
  const body = (await r.json()) as { ok: boolean };
  log(
    body.ok
      ? `✓ cancelled ${jobId.slice(0, 8)}`
      : `could not cancel ${jobId.slice(0, 8)} (not active?)`,
  );
  process.exit(body.ok ? 0 : 1);
}

// ---- explain: what each job actually does, how long, why it matters ---------
interface KindDoc {
  what: string;
  checks?: string[];
  typical: string;
  safe: string;
  needs: string;
}

const KIND_DOCS: Record<string, KindDoc> = {
  scan: {
    what: "Inventory the drive. Walks every file (light) and reads the rekordbox device DB (full: tracks, playlists, beatgrid coverage, genres/BPM/artwork stats, free space).",
    typical: "10–60s (scales with library size)",
    safe: "Read-only. Always safe.",
    needs: "drive mounted",
  },
  mirror: {
    what: "Copy master → mirror so both USB drives are identical (files + both databases + ANLZ). Skips files that already match.",
    typical: "minutes–1h+ depending on how much changed",
    safe: "Writes ONLY to the mirror drive. Master is never written. rekordbox must be closed.",
    needs: "both drives mounted, rekordbox NOT running",
  },
  benchmark: {
    what: "Measure real read speed: sequential (big files) + random 4k. CDJ hardware needs sustained ≥30 MB/s or tracks stutter.",
    typical: "~10–30s",
    safe: "Read-only. Safe anytime.",
    needs: "drive mounted",
  },
  checksum: {
    what: "Hash every audio file into a corruption ledger. Later runs re-hash only files whose size/mtime changed and report any file whose CONTENT changed silently — that's bitrot/failing flash.",
    typical: "first run ~1–5 min (hashes everything); later runs seconds–1 min",
    safe: "Read-only (writes one small ledger DB on the host, never on the drive).",
    needs: "drive mounted",
  },
};

function cmdExplain(kind?: string): void {
  // verify gets the full treatment: rich shared doc from verify_help.ts
  const showVerify = !kind || kind === "verify";
  if (showVerify) {
    const v = VERIFY_HELP;
    if (JSON_MODE && kind === "verify") {
      console.log(JSON.stringify({ verify: v }, null, 2));
      return;
    }
    log("── verify ──");
    log(v.intro);
    log("");
    log("checks:");
    for (const c of v.checks) {
      log(`  • ${c.label} — ${c.what}`);
      log(`      why: ${c.why}`);
      log(`      if it fails: ${c.if_fail}`);
      log(`      fix: ${c.fix}`);
    }
    log("");
    log(`typical time: ${v.duration}`);
    log(`safety: ${v.safety}`);
    log("");
    if (kind === "verify") return;
  }
  if (JSON_MODE) {
    console.log(JSON.stringify(KIND_DOCS, null, 2));
    return;
  }
  if (!kind) {
    for (const [k, d] of Object.entries(KIND_DOCS)) {
      log(`── ${k} ──`);
      log(d.what);
      if (d.checks) {
        log("");
        log("checks:");
        for (const c of d.checks) log(`  • ${c}`);
      }
      log("");
      log(`typical time: ${d.typical}`);
      log(`safety: ${d.safe}`);
      log(`requires: ${d.needs}`);
      log("");
    }
    return;
  }
  const d = KIND_DOCS[kind];
  if (!d) {
    errOut(
      `unknown kind "${kind}" — one of: verify, ${Object.keys(KIND_DOCS).join(", ")}`,
    );
    process.exit(2);
  }
  log(`── ${kind} ──`);
  log(d.what);
  if (d.checks) {
    log("");
    log("checks:");
    for (const c of d.checks) log(`  • ${c}`);
  }
  log("");
  log(`typical time: ${d.typical}`);
  log(`safety: ${d.safe}`);
  log(`requires: ${d.needs}`);
}

// ---- main -------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const cmd = args[0];
  const up = await ensureServer();
  if (!up) {
    errOut("cratedeck server unreachable and could not be started");
    process.exit(4);
  }
  switch (cmd) {
    case "status":
      return cmdStatus();
    case "drives":
      return cmdDrives();
    case "report":
      return cmdReport(args[1] ?? usage());
    case "run":
      return cmdRun(
        args[1] ?? usage(),
        args[2] ?? usage(),
        !process.argv.includes("--no-wait"),
      );
    case "jobs":
      return cmdJobs();
    case "explain":
      return cmdExplain(args[1]);
    case "cancel":
      return cmdCancel(args[1] ?? usage());
    case "stop":
      log("stopping server…");
      await fetch(`${BASE}/api/stop`, { method: "POST" }).catch(() => {});
      return;
    default:
      usage();
  }
}
function usage(): never {
  errOut(
    [
      "usage: deckctl <command> [args] [--json]",
      "",
      "  status                        rekordbox lock + all drives + active jobs",
      "  drives                        list drives with badge verdicts",
      "  report <drive>                health-check dossier (drive = name, nickname, or UUID)",
      "  run <drive> <kind>            enqueue + follow a job (scan|verify|mirror|benchmark|checksum)",
      "  explain [kind]                what each job checks, typical duration, safety",
      "  jobs                          recent jobs",
      "  cancel <jobId>                cancel an active job",
      "",
      "--json  machine-readable output (single object, or one line per poll with run --wait)",
    ].join("\n"),
  );
  process.exit(2);
}
await main();
