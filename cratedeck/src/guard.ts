// guard.ts — THE write allow-list. Every disk write outside data/ goes
// through here; a repo test fails CI if any other file performs writes.
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { CrateConfig } from "./config";

export class Guard {
  private allowed: string[]; // prefixes that may be written

  constructor(cfg: CrateConfig) {
    this.allowed = [cfg.dataDir];
  }

  /** Register an extra writable prefix. Used for deliberate, structured
   *  writes onto a mounted drive (the CrateDeck photo dir) — everything
   *  else stays inside dataDir. */
  allow(prefix: string): void {
    if (!this.allowed.includes(prefix)) this.allowed.push(prefix);
  }

  /** Create a directory inside an allowed prefix. */
  mkdir(path: string): void {
    this.assertAllowed(path);
    mkdirSync(path, { recursive: true });
  }

  /** Structured write: only inside allowed prefixes. */
  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.assertAllowed(path);
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, data);
  }

  /** Structured copy: dest must be allowed; source unconstrained (read). */
  async copy(src: string, dest: string): Promise<void> {
    this.assertAllowed(dest);
    mkdirSync(dirname(dest), { recursive: true });
    await Bun.write(dest, Bun.file(src));
  }

  rm(path: string): void {
    this.assertAllowed(path);
    rmSync(path, { recursive: true, force: true });
  }

  assertAllowed(path: string): void {
    const ok = this.allowed.some(
      (p) =>
        path === p ||
        path.startsWith(p.endsWith("/") ? p : p + "/") ||
        // single-`*` segment = exactly one path segment of anything (the
        // per-volume stick allowance: vol/*/Contents/CrateDeck). No other
        // globbing — this stays a prefix allow-list, not a pattern matcher.
        (p.includes("*/") && this.globMatch(p.split("/"), path.split("/"))),
    );
    if (!ok) {
      throw new Error(
        `GUARD VIOLATION: write to '${path}' outside allowed prefixes [${this.allowed.join(", ")}]`,
      );
    }
  }

  /** Segment-wise prefix match where `*` consumes exactly one segment. */
  private globMatch(pat: string[], seg: string[]): boolean {
    if (seg.length < pat.length) return false;
    for (let i = 0; i < pat.length; i++) {
      const pp = pat[i]!;
      if (pp === "*") continue;
      if (pp !== seg[i]) return false;
    }
    return true;
  }
}
