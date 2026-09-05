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
import type { ChecksumResult } from "./bench";
import {
  apiGet,
  apiPost,
  ensureServer,
  resolveDrive,
  jobTerminal,
  type Job,
  type Drive,
} from "./deckapi";
import type {
  CoverageResponse,
  HealthCheck,
  InterlockState,
  RedundancyResult,
} from "../shared/types";

// ---- output helpers ---------------------------------------------------------
const JSON_MODE = process.argv.includes("--json");
const IS_TTY = process.stderr.isTTY ?? false;

/** Typed JSON reader: `const d = await getJson<Drive[]>(res)`. */
async function getJson<T>(p: string): Promise<T> {
  const res = await apiGet(p);
  return (await res.json()) as T;
}

type DriveWithBadges = Drive & {
  badges?: { label: string; tone: string }[];
};
interface ReportPayload {
  overall?: string;
  checks?: HealthCheck[];
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

// ---- server boot / drive resolution ----------------------------------------
// apiGet / ensureServer / resolveDrive / jobTerminal live in deckapi.ts —
// one implementation shared with mcp.ts (the MCP server over these calls).

// ---- commands ---------------------------------------------------------------
async function cmdStatus(): Promise<void> {
  const [interlock, drives, jobs] = await Promise.all([
    getJson<InterlockState>("/api/interlock"),
    getJson<DriveWithBadges[]>("/api/drives"),
    getJson<Job[]>("/api/jobs?active=1"),
  ]);
  if (JSON_MODE) {
    console.log(JSON.stringify({ interlock, drives, jobs }, null, 2));
    return;
  }
  const il = interlock;
  const ds = drives;
  const js = jobs;
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
  const drives = await getJson<DriveWithBadges[]>("/api/drives");
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
  const r = await getJson<ReportPayload>(`/api/drives/${d.id}/report`);
  if (JSON_MODE) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const checks = r.checks ?? [];
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
  const interlock = await getJson<InterlockState>("/api/interlock");
  if (interlock.rekordbox_running) {
    const pid = interlock.pid;
    errOut(
      `rekordbox is running (pid ${pid}) — operations locked to prevent library corruption. Quit rekordbox and retry.`,
    );
    process.exit(3);
  }

  const res = await apiPost(`/api/drives/${d.id}/jobs`, { kind });
  const body = (await res.json()) as Job & { error?: string };
  if (!res.ok) {
    errOut(`enqueue failed: ${body.error ?? res.status}`);
    process.exit(res.status === 423 ? 3 : 1);
  }
  const job = body;
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
  return jobTerminal(status);
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
    } catch (e) {
      // job finished; only the pretty summary is lost — the status line
      // above is the truth. Corrupt payload gets called out, not hidden.
      console.error("job result_json was not valid JSON", e);
    }
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
        log("  (no structured checks parsed — raw summary below)");
      } else {
        const bad = checks.filter((c) => c.status !== "pass");
        const good = checks.filter((c) => c.status === "pass");
        log(`  ${good.length} passed, ${bad.length} need attention:`);
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
      // result_json is untrusted JSON from the wire — narrow at runtime
      // instead of casting, so a shape change can't print garbage.
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

// ---- fleet superpowers (§B6 coverage / §B7 redundancy / §B8 diff) -----------
// Response types come from shared/types.ts — the same wire shapes the API
// emits, so CLI drift is a type error, not a runtime surprise.

async function cmdCoverage(minCopies?: string): Promise<void> {
  const n = minCopies ? parseInt(minCopies, 10) : undefined;
  const qs = n && n > 0 ? `?min_copies=${n}` : "";
  const r = (await apiGet(`/api/fleet/coverage${qs}`).then((res) =>
    res.json(),
  )) as CoverageResponse;
  if (JSON_MODE) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  log(
    `fleet coverage — ${r.totals.unique_tracks.toLocaleString()} unique tracks across ${r.drives.length} drive(s)`,
  );
  for (const d of r.drives)
    log(`  ${d.name}: ${d.tracks.toLocaleString()} tracks`);
  if (!r.at_risk.length) {
    log(`✓ no at-risk tracks — everything lives on ≥${r.min_copies} drive(s)`);
    return;
  }
  log(
    `⚠ ${r.at_risk.length} track(s) below ${r.min_copies} copies (first 50):`,
  );
  for (const t of r.at_risk.slice(0, 50)) {
    const name = t.identity.title ?? t.identity.path;
    const artist = t.identity.artist ? ` — ${t.identity.artist}` : "";
    log(`  ${t.copies}· ${name}${artist}  [${t.drives.join(", ")}]`);
  }
}

async function cmdRedundancy(minCopies?: string): Promise<void> {
  const n = minCopies ? parseInt(minCopies, 10) : undefined;
  const qs = n && n > 0 ? `?min_copies=${n}` : "";
  const r = (await apiGet(`/api/fleet/redundancy${qs}`).then((res) =>
    res.json(),
  )) as RedundancyResult;
  if (JSON_MODE) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  log(`redundancy audit — ${r.summary}`);
  for (const p of r.playlists) {
    const mark =
      p.verdict === "pass"
        ? "✓"
        : p.verdict === "fail"
          ? "✕"
          : p.verdict === "warn"
            ? "▲"
            : "○";
    log(
      `${mark} ${p.playlist}: ${p.protected_tracks}/${p.unique_tracks} protected — ${p.detail}`,
    );
  }
}

async function cmdDiff(a?: string, b?: string): Promise<void> {
  if (!a || !b) {
    errOut("usage: deckctl diff <driveA> <driveB>  (name, nickname, or UUID)");
    process.exit(2);
  }
  const da = await resolveDrive(a);
  const dbb = await resolveDrive(b);
  if (!da) {
    errOut(`unknown drive: ${a}`);
    process.exit(2);
  }
  if (!dbb) {
    errOut(`unknown drive: ${b}`);
    process.exit(2);
  }
  const r = (await apiGet(
    `/api/fleet/diff?a=${encodeURIComponent(da.id)}&b=${encodeURIComponent(dbb.id)}`,
  ).then((res) => res.json())) as {
    a: string;
    b: string;
    summary: string;
    added: { path: string; title: string | null; artist: string | null }[];
    removed: { path: string; title: string | null; artist: string | null }[];
    changed: { path: string; title: string | null }[];
  };
  if (JSON_MODE) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  log(`${r.a} → ${r.b}: ${r.summary}`);
  const show = (rows: { title: string | null; path: string }[]) =>
    rows.slice(0, 30).forEach((x) => log(`    ${x.title ?? x.path}`));
  if (r.added.length) {
    log(`  + added (${r.added.length}):`);
    show(r.added);
  }
  if (r.removed.length) {
    log(`  − missing (${r.removed.length}):`);
    show(r.removed);
  }
  if (r.changed.length) {
    log(`  ~ changed bytes (${r.changed.length}):`);
    show(r.changed);
  }
  if (r.added.length + r.removed.length + r.changed.length === 0)
    log("  identical inventories");
}

async function cmdCancel(jobId: string): Promise<void> {
  const r = await apiPost(`/api/jobs/${jobId}/cancel`);
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
    case "coverage":
      return cmdCoverage();
    case "redundancy":
      return cmdRedundancy();
    case "diff":
      return cmdDiff(args[1], args[2]);
    case "explain":
      return cmdExplain(args[1]);
    case "cancel":
      return cmdCancel(args[1] ?? usage());
    case "stop":
      log("stopping server…");
      await apiPost("/api/stop").catch((e: unknown) => {
        // stop tolerates an already-dead server (that's the goal state),
        // but anything else (refused, malformed) is reported, not hidden.
        console.error(
          "stop request failed (server may already be down):",
          e instanceof Error ? e.message : e,
        );
      });
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
      "  coverage [min-copies]         which tracks live on which drives + at-risk list",
      "  redundancy [min-copies]       per-playlist audit: every track on ≥N drives?",
      "  diff <driveA> <driveB>        added / removed / changed between two drives",
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
