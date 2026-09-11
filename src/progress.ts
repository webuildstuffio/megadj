/**
 * Terminal progress reporting for megadj: one line per item plus a live
 * bar with rate + ETA when stdout is a TTY, plain milestone lines otherwise.
 */

const BAR_WIDTH = 24;
// stderr, always: stdout belongs to the data (--json must stay parseable,
// piped output must stay clean). TTY detection follows stderr accordingly.
const isTty = process.stderr.isTTY ?? false;

export function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return u === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${units[u]}`;
}

export function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Live single-line progress bar with rate and ETA. */
export class ProgressBar {
  private readonly start = Date.now();
  private done = 0;
  private bytes = 0;
  private lastRender = 0;
  private lastPct = -1;

  constructor(
    private readonly total: number,
    private readonly label: string,
    private readonly unit = "tracks",
  ) {}

  update(n = 1, bytes = 0): void {
    this.done += n;
    this.bytes += bytes;
    this.render();
  }

  private render(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastRender < 250) return;
    this.lastRender = now;
    const elapsed = (now - this.start) / 1000;
    const pct = this.total > 0 ? this.done / this.total : 0;

    if (!isTty) {
      const pctInt = Math.floor(pct * 100);
      if (pctInt >= this.lastPct + 5 || force) {
        this.lastPct = pctInt;
        process.stderr.write(
          `[${this.label}] ${this.done}/${this.total} ${this.unit} · ${pctInt}% · ${this.suffix(elapsed)}\n`,
        );
      }
      return;
    }

    const filled = Math.round(BAR_WIDTH * Math.min(pct, 1));
    const bar = "#".repeat(filled) + "-".repeat(BAR_WIDTH - filled);
    const line = `[${this.label}] [${bar}] ${this.done}/${this.total} ${this.unit} · ${Math.min(Math.round(pct * 100), 100)}% · ${this.suffix(elapsed)}`;
    process.stderr.write(`\r\u001b[K${line.slice(0, 120)}`);
  }

  private suffix(elapsed: number): string {
    const parts: string[] = [];
    if (this.bytes > 0 && elapsed > 1)
      parts.push(`${fmtBytes(this.bytes / elapsed)}/s`);
    if (this.done > 0 && elapsed > 2) {
      const remaining = (elapsed / this.done) * (this.total - this.done);
      parts.push(`ETA ${fmtDur(remaining)}`);
    }
    return parts.join(" · ");
  }

  close(summary?: string): void {
    const elapsed = (Date.now() - this.start) / 1000;
    this.render(true);
    if (isTty) process.stderr.write("\n");
    const parts = [
      `[${this.label}] ${this.done}/${this.total} ${this.unit} in ${fmtDur(elapsed)}`,
    ];
    if (this.bytes > 0)
      parts.push(
        `(${fmtBytes(this.bytes)} at ${fmtBytes(this.bytes / Math.max(elapsed, 0.001))}/s)`,
      );
    process.stderr.write(`${parts.join(" ")}\n`);
    if (summary) console.log(summary); // explicit caller-provided summary: stdout
  }
}

/** The standard command log function (P1 --json contract): human progress
 * goes to stdout via console.log normally; in --json mode stdout carries
 * exactly one summary object, so the human log moves to STDERR (never
 * silent — the CrateDeck intake job streams these lines as its live phase
 * progress, and a swallowed log made a run look frozen at 0%).
 * `onProgress` still owns routing when the caller injected one. Every
 * command's `const log = ...` preamble was this exact three-liner — now
 * one call. */
export function commandLog(opts: {
  json?: boolean | undefined;
  onProgress?: ((msg: string) => void) | undefined;
}): (msg: string) => void {
  if (opts.onProgress) return opts.onProgress;
  if (opts.json) return (m) => process.stderr.write(`${m}\n`);
  return (m: string) => console.log(m);
}
