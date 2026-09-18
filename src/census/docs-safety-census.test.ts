/**
 * docs-safety-census.test.ts — the executable #57 regression gate: active
 * agent-facing text must never re-earn the storage-safety failures that
 * issue #57 fixed. The rules it pins (AGENTS.md is the authority):
 *
 *   1. rsync may appear in agent-facing docs ONLY as a prohibition — every
 *      mention must sit on a forbidding line ("Never use…"). Whole-volume
 *      ExFAT rsync wedges; per-directory foreground tar-pipes are the only
 *      sanctioned bulk copy.
 *   2. No skill prose pairs a playing-USB name (DJMASTER/DJMIRROR/
 *      flip-master) with a write verb. Historical scripts keep their
 *      defaults — the census reads SKILL.md prose, never `scripts/`.
 *   3. The playing-USB policy page (`docs/getdat/usb-sync.md`) exists, is
 *      CURRENT, and assigns the playing USB to the user.
 *   4. `new-music-intake` stops at the handoff: the user exports, agents
 *      never write that device.
 *
 * A new violation is a red build, not a doc TODO.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** Skill prose files (never scripts/ — historical tool defaults are out). */
function skillFiles(): string[] {
  const out: string[] = [];
  for (const root of [".claude/skills", "plugin/skills"]) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const skill = join(dir, name.name, "SKILL.md");
      if (existsSync(skill)) out.push(skill);
    }
  }
  return out;
}

describe("docs safety census (issue #57 regression gate)", () => {
  const skills = skillFiles();
  const runbooks = [
    "docs/runbooks/0a-evacuate-extra.md",
    "docs/getdat/usb-sync.md",
  ].map((p) => join(ROOT, p));

  test("the census actually found the active skill prose", () => {
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((p) => p.includes("rekordbox-usb-sync"))).toBeTrue();
  });

  test("rsync appears only as a prohibition in agent-facing docs", () => {
    const hits: string[] = [];
    for (const p of [...skills, ...runbooks]) {
      if (!existsSync(p)) continue;
      const lines = readFileSync(p, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (!/\brsync\b/u.test(line)) continue;
        // Sanctioned form: the line (or its sentence) forbids the tool.
        const window = [lines[i - 1], line, lines[i + 1]]
          .filter((l): l is string => l !== undefined)
          .join(" ");
        const forbids =
          /\bnever\b|\bdo not\b|\bdon't\b|\bnot use\b|\binstead\b|\bavoid\b/iu.test(
            window,
          );
        if (!forbids) hits.push(`${p}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(
      hits,
      `rsync must appear only as a prohibition (whole-volume ExFAT hazard):\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  test("no skill pairs a playing-USB name with a write verb", () => {
    const hits: string[] = [];
    for (const p of skills) {
      const lines = readFileSync(p, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        const targetsPlaying =
          /DJMASTER|DJMIRROR|flip-master/u.test(line) &&
          /\b(cp|mv|rsync|tar|dd|write|sync|copy|export|mirror)\b/iu.test(line);
        if (targetsPlaying) hits.push(`${p}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(
      hits,
      `skill prose must never pair a playing-USB name with a write verb:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  test("the playing-USB policy page is current and user-owned", () => {
    const p = join(ROOT, "docs/getdat/usb-sync.md");
    expect(existsSync(p)).toBeTrue();
    const text = readFileSync(p, "utf8");
    expect(text).toMatch(/\*\*Status:\*\* ✅ CURRENT/u);
    expect(text).toMatch(/playing USB.*User only|User only.*playing USB/su);
    expect(text).toMatch(/Never use a whole-volume rsync/u);
  });

  test("new-music-intake stops at the user handoff", () => {
    const p = join(ROOT, ".claude/skills/new-music-intake/SKILL.md");
    expect(existsSync(p)).toBeTrue();
    const text = readFileSync(p, "utf8");
    expect(text).toMatch(/the user exports to the\s*\n?\s*playing USB/u);
    expect(text).toMatch(/Agents never sync, mirror, or write that device/u);
    expect(text).not.toMatch(/export to .*(DJMASTER|DJMIRROR)/iu);
  });

  test("the runbook copy path is foreground tar-pipe, not rsync", () => {
    const text = readFileSync(
      join(ROOT, "docs/runbooks/0a-evacuate-extra.md"),
      "utf8",
    );
    expect(text).toMatch(/foreground tar-pipe/u);
    expect(text).toMatch(/Do not use whole-volume rsync/u);
    expect(text).toMatch(/background jobs may be reaped/u);
  });
});
