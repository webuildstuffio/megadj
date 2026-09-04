// guard.ts — THE write allow-list. Every disk write outside data/ goes
// through here; a repo test fails CI if any other file performs writes.
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { CrateConfig } from "./config";

export class Guard {
  private allowed: string[]; // prefixes that may be written

  constructor(private cfg: CrateConfig) {
    this.allowed = [cfg.dataDir];
  }

  /** Register an extra writable prefix (scratch dirs for DB copies). */
  allow(prefix: string): void {
    this.allowed.push(prefix);
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
      (p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"),
    );
    if (!ok) {
      throw new Error(
        `GUARD VIOLATION: write to '${path}' outside allowed prefixes [${this.allowed.join(", ")}]`,
      );
    }
  }
}
