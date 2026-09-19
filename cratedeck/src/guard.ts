// guard.ts — THE write allow-list. Every disk write outside data/ goes
// through here; a repo test fails CI if any other file performs writes.
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import type { CrateConfig } from "./config";
import { errMessage as errorText } from "../../src/shared/leaf/fmt";

export class Guard {
  private allowed: string[]; // prefixes that may be written

  constructor(cfg: CrateConfig) {
    this.allowed = [this.normalizeAllowed(cfg.dataDir)];
  }

  /** Register an extra writable prefix. Used for deliberate, structured
   *  writes onto a mounted drive (the CrateDeck photo dir) — everything
   *  else stays inside dataDir. */
  allow(prefix: string): void {
    const normalized = this.normalizeAllowed(prefix);
    if (!this.allowed.includes(normalized)) this.allowed.push(normalized);
  }

  /** Create a directory inside an allowed prefix. */
  mkdir(path: string): void {
    const target = this.assertAllowed(path);
    mkdirSync(target, { recursive: true });
  }

  /** Structured write: only inside allowed prefixes. */
  async write(path: string, data: Uint8Array | string): Promise<void> {
    const target = this.assertAllowed(path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, data);
  }

  /** Structured copy: dest must be allowed; source unconstrained (read). */
  async copy(src: string, dest: string): Promise<void> {
    const target = this.assertAllowed(dest);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, Bun.file(src));
  }

  rm(path: string): void {
    const target = this.assertAllowed(path);
    rmSync(target, { recursive: true, force: true });
  }

  /** Return the normalized destination after both lexical and filesystem
   * checks pass. Existing ancestors are realpathed so an in-root symlink
   * cannot redirect a later write/copy/rm outside its matched allow root. */
  assertAllowed(path: string): string {
    if (!isAbsolute(path)) return this.violation(path, "path is not absolute");
    const candidate = resolve(path);
    const allowedMatch = this.allowed
      .map((pattern) => ({
        pattern,
        root: this.matchRoot(pattern, candidate),
      }))
      .find(
        (match): match is { pattern: string; root: string } =>
          match.root !== null,
      );
    if (!allowedMatch)
      return this.violation(path, "path is outside allowed prefixes");

    try {
      const realRoot = this.resolveExistingAncestors(allowedMatch.root);
      const realCandidate = this.resolveExistingAncestors(candidate);
      const wildcardAnchor = this.wildcardAnchor(allowedMatch.pattern);
      if (
        wildcardAnchor !== null &&
        !this.isWithin(this.resolveExistingAncestors(wildcardAnchor), realRoot)
      ) {
        return this.violation(
          path,
          "the wildcard match escapes its canonical parent",
        );
      }
      if (!this.isWithin(realRoot, realCandidate)) {
        return this.violation(path, "an existing symlink escapes its prefix");
      }
    } catch (error) {
      return this.violation(
        path,
        `path ancestry could not be resolved: ${errorText(error)}`,
      );
    }
    return candidate;
  }

  private normalizeAllowed(prefix: string): string {
    if (!isAbsolute(prefix)) {
      throw new Error(
        `GUARD CONFIG: allowed prefix '${prefix}' is not absolute`,
      );
    }
    const normalized = resolve(prefix);
    const wildcardSegments = this.parts(normalized).parts.filter((part) =>
      part.includes("*"),
    );
    if (
      wildcardSegments.length > 1 ||
      wildcardSegments.some((part) => part !== "*")
    ) {
      throw new Error(
        `GUARD CONFIG: allowed prefix '${prefix}' must contain at most one whole-segment '*' wildcard`,
      );
    }
    return normalized;
  }

  /** Return the concrete matched prefix. `*` consumes exactly one normalized
   * path segment; the candidate may then descend below that prefix. */
  private matchRoot(pattern: string, candidate: string): string | null {
    if (!pattern.includes("*"))
      return this.isWithin(pattern, candidate) ? pattern : null;
    const pat = this.parts(pattern);
    const got = this.parts(candidate);
    if (pat.root !== got.root || got.parts.length < pat.parts.length)
      return null;
    for (let i = 0; i < pat.parts.length; i++) {
      const expected = pat.parts[i]!;
      if (expected !== "*" && expected !== got.parts[i]) return null;
    }
    return resolve(got.root, ...got.parts.slice(0, pat.parts.length));
  }

  /** The fixed parent before `*` is the canonical boundary for wildcard
   * matches. A symlink may not impersonate a mounted volume outside it. */
  private wildcardAnchor(pattern: string): string | null {
    const parsed = this.parts(pattern);
    const wildcardIndex = parsed.parts.indexOf("*");
    if (wildcardIndex === -1) return null;
    return resolve(parsed.root, ...parsed.parts.slice(0, wildcardIndex));
  }

  private parts(path: string): { root: string; parts: string[] } {
    const root = parse(path).root;
    return {
      root,
      parts: path.slice(root.length).split(sep).filter(Boolean),
    };
  }

  private isWithin(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    );
  }

  /** Resolve the nearest existing ancestor, then append the missing tail.
   * This works for destinations that do not exist yet while still exposing
   * every existing symlink in their ancestry. */
  private resolveExistingAncestors(path: string): string {
    const missing: string[] = [];
    let cursor = path;
    while (!existsSync(cursor)) {
      const parent = dirname(cursor);
      if (parent === cursor) break;
      missing.unshift(basename(cursor));
      cursor = parent;
    }
    return resolve(realpathSync(cursor), ...missing);
  }

  private violation(path: string, reason: string): never {
    throw new Error(
      `GUARD VIOLATION: write to '${path}' ${reason} [${this.allowed.join(", ")}]`,
    );
  }
}
