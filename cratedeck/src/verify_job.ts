// verify_job.ts — the `verify` job-kind runner (extracted from jobs.ts,
// file-length cap). Same seam shape as intake_job.ts/hygiene_jobs.ts: a
// plain function taking the engine context, so jobs.ts stays the queue/
// interlock owner and this module only renders the verify leg.
import { basename } from "node:path";
import { parseVerifyReport } from "./verify_report";
import { spawnVerify } from "./rb";
import type { CrateConfig } from "./config";

/** Where a line belongs in usb_verify.py's phase order → absolute progress.
 *
 * Phases are matched IN ORDER (once phase N fires, earlier phases are
 * skipped) so repeated/hashed noise lines can't rewind the bar. Returns the
 * absolute progress the phase starts at (not a from/to span — the old inline
 * mapping computed from/to as done/total and showed garbage percentages).
 *
 * Lines are matched UNTRIMMED: usb_verify.py indents per-drive output
 * ("  tracks: 3512"), and the previous trimmed-input regexes never matched,
 * leaving the bar at ~15% through the longest phase. */
export function verifyPhase(
  line: string,
  phaseIdx: number,
): { progress: number; message: string; nextIdx: number } | null {
  const PHASES: [RegExp, number, string][] = [
    [/^### /, 0.15, "checking hardware DB view (export.pdb)…"],
    [/^  tracks:/, 0.35, "checking every track: files, grids, BPM…"],
    [/^  playlists:/, 0.8, "checking playlists + relations…"],
    [/=== cross-drive ===/, 0.85, "comparing master ↔ mirror…"],
    [/^  hashed \d+\//, 0.9, "hashing ANLZ files on both drives…"],
    [/audio hash spot-check/, 0.95, "spot-hashing audio files…"],
    [/^FINAL:/, 0.99, "writing verdict…"],
  ];
  for (let i = phaseIdx; i < PHASES.length; i++) {
    const [re, progress, message] = PHASES[i]!;
    if (re.test(line)) {
      return { progress, message, nextIdx: i + 1 };
    }
  }
  return null;
}

export interface VerifyJobCtx {
  cfg: CrateConfig;
  verifyTimeoutMin: number;
  driveRole: string | undefined;
}

/** The engine's stream-drain contract (jobs.ts keeps the implementation —
 *  its byte-exact capture is regression-tested there). */
export type VerifyDrain = (
  proc: Bun.Subprocess | ReadableStream<Uint8Array> | number | undefined,
  onLine: (l: string) => void,
  handle?: { cancelled: boolean; proc?: Bun.Subprocess },
  timeoutMs?: number,
) => Promise<{ out: string }>;

export async function runVerify(
  ctx: VerifyJobCtx,
  mountPoint: string,
  handle: { cancelled: boolean; proc?: Bun.Subprocess },
  drain: VerifyDrain,
  drainText: (
    stream: ReadableStream<Uint8Array> | number | undefined,
  ) => Promise<string>,
  tick: (
    done: number,
    total: number,
    message: string,
    phase: string,
    force?: boolean,
  ) => void,
  log: (line: string, isError?: boolean) => void,
): Promise<unknown> {
  const name = basename(mountPoint);
  const startedAt = Date.now();
  tick(0, 1, `verifying ${name} — opening rekordbox DB…`, "1-databases", true);
  const proc = spawnVerify(ctx.cfg, [name]);
  handle.proc = proc;
  // Phase-driven progress off usb_verify.py's deterministic section
  // markers — see verifyPhase above for the absolute-progress contract.
  let phaseIdx = 0;
  const rawLine = (line: string) => {
    const m = verifyPhase(line, phaseIdx);
    if (m) {
      phaseIdx = m.nextIdx;
      tick(m.progress, 1, m.message, `phase-${phaseIdx}`, true);
    }
  };
  const [verdict, errText] = await Promise.all([
    drain(
      proc,
      (l) => {
        log(l);
        rawLine(l);
      },
      handle,
      ctx.verifyTimeoutMin * 60_000,
    ),
    drainText(proc.stderr),
  ]);
  const out = verdict.out + (errText ? `\n[stderr]\n${errText}` : "");
  // usb_verify.py prints `FINAL: ALL PASS` or `FINAL: FAILED: …`; trust
  // that line over the exit code (uv can exit non-zero on warnings) but
  // require the FINAL marker to exist at all.
  const finalLine = verdict.out.split("\n").find((l) => l.startsWith("FINAL:"));
  const pass =
    !!finalLine && /FINAL: ALL PASS/.test(finalLine) && proc.exitCode === 0;
  tick(
    1,
    1,
    pass
      ? "verify passed"
      : `verify FAILED — ${finalLine ?? "no FINAL line (crashed?)"}`.slice(
          0,
          200,
        ),
    "done",
    true,
  );
  return {
    verdict: pass ? "pass" : "fail",
    ...parseVerifyReport(
      out,
      pass,
      finalLine ?? null,
      Math.round((Date.now() - startedAt) / 1000),
      ctx.driveRole,
    ),
  };
}
