#!/usr/bin/env bun
/**
 * deck-install.ts — `bun run deck:install` (#247).
 *
 * Idempotent installer for the com.nick.megadj-deck launchd service:
 *   1. render the plist from ops/deck-service.ts with THIS machine's
 *      repo root + resolved bun path (never commit a baked path),
 *   2. write it to ~/Library/LaunchAgents/,
 *   3. bootstrap (or bootout+bootstrap when already loaded — the
 *      idempotent re-install path),
 *   4. kickstart, then HTTP-probe /api/interlock until healthy,
 *   5. print the #247 state verdict (same classifier doctor uses).
 *
 * An already-running ORPHAN server (the #247 incident) is replaced, not
 * duplicated: the orphan listens on the resolved port, so the probe
 * against the SERVICE would otherwise report the orphan's health. The
 * installer kills bare `bun ... src/deck/index.ts` processes that
 * launchd does not own before kickstarting the real service.
 *
 * Exit codes: 0 healthy · 1 installed-but-unhealthy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DECK_SERVICE_LABEL,
  classifyDeckService,
  plistPath,
  renderPlist,
} from "./deck-service";
import { DEFAULT_PORT, resolveServerPort } from "../deck/server/server-port";

// ops/ sits at <repo>/src/ops (the Sep 2026 cratedeck fold) — the repo
// root is TWO levels up. A single `..` here baked WorkingDirectory=<repo>/src
// into the launchd plist and crash-looped the service (`bun run
// src/deck/index.ts` cannot resolve under <repo>/src).
const REPO_ROOT = join(import.meta.dir, "..", "..");
const STATE_DIR = join(homedir(), ".local", "state", "megadj");

function sh(cmd: string[], quiet = true): { code: number; out: string } {
  const p = Bun.spawnSync({
    cmd,
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const out =
    `${new TextDecoder().decode(p.stdout)}${new TextDecoder().decode(p.stderr)}`.trim();
  if (!quiet && p.exitCode !== 0) console.error(out);
  return { code: p.exitCode ?? 0, out };
}

/** Resolve the bun binary: env → the repo's pinned real binary (the
 *  shell-config `bun` on PATH is a wrapper script — launchd has no login
 *  shell, so it needs the real executable). */
function resolveBunPath(): string {
  const candidates = [
    process.env.MEGADJ_DECK_BUN,
    join(homedir(), ".bun", "bin", "bun"),
  ].filter((p): p is string => Boolean(p) && existsSync(p as string));
  const bun = candidates[0];
  if (!bun) {
    console.error("deck:install: no bun binary found (~/.bun/bin/bun missing)");
    process.exit(1);
  }
  return bun;
}

/** Probe the HTTP health endpoint. */
async function probe(port: number, timeoutMs = 1200): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/interlock`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Pids of deck servers running BEFORE bootstrap. Everything launchd's
 *  gui domain does not know about yet is an orphan by construction: this
 *  runs right after bootout and BEFORE `bootstrap`, so the service cannot
 *  have children of its own at this point — a pgrep hit is a bare server
 *  to replace (the #247 orphan), never our own child. */
function orphanDeckProcesses(): number[] {
  const r = sh(["pgrep", "-f", "src/deck/index.ts"]);
  if (r.code !== 0) return [];
  return r.out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 1);
}

async function main(): Promise<void> {
  const bunPath = resolveBunPath();
  // Real posix uid (id -u) — launchctl's gui domain wants the numeric
  // uid, never the username.
  const uid = sh(["id", "-u"]).out.trim();
  const target = plistPath(homedir());
  const configPath = join(REPO_ROOT, "src", "deck", "config.toml");
  const port = resolveServerPort(
    process.env.CRATEDECK_PORT,
    existsSync(configPath)
      ? configPath
      : join(REPO_ROOT, "src", "deck", "config.sample.toml"),
  );

  // 1-2. Render + write the plist (idempotent: same bytes → same file).
  const plist = renderPlist({
    repoRoot: REPO_ROOT,
    bunPath,
    stateDir: STATE_DIR,
    port,
    defaultPort: DEFAULT_PORT,
  });
  mkdirSync(STATE_DIR, { recursive: true });
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (existing !== plist) {
    writeFileSync(target, plist);
    console.log(`wrote ${target}`);
  } else {
    console.log(`plist unchanged: ${target}`);
  }

  // 3. Replace any ORPHAN server first (it would steal the health probe).
  const bootout = sh([
    "/bin/launchctl",
    "bootout",
    `gui/${uid}/${DECK_SERVICE_LABEL}`,
  ]);
  const wasLoaded = bootout.code === 0;
  if (wasLoaded) console.log("removed previously loaded service");
  for (const pid of orphanDeckProcesses()) {
    // A pre-existing bare server: SIGTERM, then verify gone (KeepAlive-
    // class pid reuse is impossible pre-bootstrap).
    sh(["kill", String(pid)]);
    console.log(`terminated orphan deck server pid ${pid}`);
  }

  // 4. Bootstrap + kickstart.
  const bootstrap = sh(["/bin/launchctl", "bootstrap", `gui/${uid}`, target]);
  if (bootstrap.code !== 0) {
    // EEXIST (already bootstrapped by a concurrent run) is fine — the
    // kickstart below still converges us to healthy.
    if (
      !bootstrap.out.includes("already bootstrapped") &&
      !bootstrap.out.includes("EBUSY")
    ) {
      console.error(`bootstrap failed: ${bootstrap.out}`);
      process.exit(1);
    }
  }
  const kick = sh([
    "/bin/launchctl",
    "kickstart",
    "-k",
    `gui/${uid}/${DECK_SERVICE_LABEL}`,
  ]);
  if (kick.code !== 0) console.error(`kickstart: ${kick.out}`);

  // 5. Wait for health (launchd needs a beat to spawn; budget ~20s).
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await probe(port)) {
      healthy = true;
      break;
    }
  }

  // Verdict via the SHARED classifier (the same one doctor uses). The
  // pid regex mirrors deckServiceStatus in doctor-checks: launchd prints
  // `pid = N` when the job is running.
  const print = sh([
    "/bin/launchctl",
    "print",
    `gui/${uid}/${DECK_SERVICE_LABEL}`,
  ]);
  const serviceLoaded = print.code === 0;
  const pidMatch = /pid = (\d+)/.exec(print.out);
  // finite-gated parse (boundary-number census hygiene).
  const parsedPid =
    pidMatch?.[1] !== undefined ? Number(pidMatch[1]) : Number.NaN;
  const verdict = classifyDeckService({
    serviceLoaded,
    servicePid: Number.isFinite(parsedPid) ? parsedPid : null,
    probeOk: healthy,
    orphanProbeOk: false,
  });
  console.log(`${verdict.ok ? "✓" : "✕"} ${verdict.state}: ${verdict.detail}`);
  if (verdict.fix) console.log(`  → ${verdict.fix}`);
  if (!verdict.ok) {
    console.log(`  server log: ${join(STATE_DIR, "deck.log")}`);
    process.exit(1);
  }
  console.log(
    `deck server: http://127.0.0.1:${port} (launchd-managed, KeepAlive on)`,
  );
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
}
