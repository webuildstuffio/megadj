// git-identity-census.test.ts — pins the commit-identity surface (the
// tripwire class: a wrong repo-local `user.email` silently attributes every
// commit to whoever owns that email on GitHub — Sep 19 2026: 13 megadj
// commits went out as a stranger's `nick <nick@users.noreply.github.com>`
// because a repo-local override beat the global config). GitHub attribution
// is keyed on the commit EMAIL, not the name — a name mismatch is cosmetic,
// a wrong email is a hijack.
import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");

/** The only identity allowed to author commits in this repo. */
const ALLOWED_NAME = "Nicholas Montgomery";
const CANON_EMAIL = "1810803+nichm@users.noreply.github.com";
const ALLOWED_EMAILS: readonly string[] = [CANON_EMAIL];

/** Emails known-bad: the nick@users.noreply.github.com incident class. */
const BANNED_EMAILS: readonly string[] = [
  "nick@users.noreply.github.com", // legacy-format noreply → stranger "nick"
  "your-email@example.com", // shell-config template placeholder
];

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

describe("git identity census", () => {
  test("effective repo identity resolves to the allowed identity", () => {
    expect(git("config user.email")).toBe(CANON_EMAIL);
    expect(git("config user.name")).toBe(ALLOWED_NAME);
  });

  test("no banned email in any config scope (local, global, system)", () => {
    for (const scope of ["local", "global", "system"]) {
      const out = execSync(`git config --${scope} --list 2>/dev/null || true`, {
        cwd: ROOT,
        encoding: "utf8",
      });
      for (const banned of BANNED_EMAILS) {
        expect(out).not.toContain(banned);
      }
    }
  });

  test("every commit on main has an allowed author and committer email", () => {
    const rows = git(`log --format='%H|%ae|%ce' main`).split("\n");
    expect(rows.length).toBeGreaterThan(800);
    for (const row of rows) {
      const [sha, ae = "", ce = ""] = row.split("|");
      const ok = ALLOWED_EMAILS.includes(ae) && ALLOWED_EMAILS.includes(ce);
      if (!ok)
        throw new Error(`commit ${sha} authored/committed as ${ae} / ${ce}`);
    }
  });
});
