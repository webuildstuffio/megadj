/**
 * plugin-skills-mirror-census.test.ts — pins the plugin skills mirror
 * (#533). `plugin/skills/` is NOT a hand-maintained copy of
 * `.claude/skills/`: every file is a git symlink (mode 120000) into the
 * canonical tree, so `.claude/skills/` is the single source of truth and
 * content drift is impossible by construction. That topology is
 * load-bearing and invisible — a "helpful" copy-in, a dangling retarget,
 * or a stray untracked file would ship without any test noticing. This
 * census pins it:
 *
 *   1. every tracked file under plugin/skills is committed as a symlink
 *      (git mode 120000), never a regular-file copy;
 *   2. every symlink is relative, resolves into .claude/skills, and is
 *      not dangling;
 *   3. the mirrored set + link targets match the pin exactly — the
 *      plugin ships these three skills and nothing else; the usb-sync
 *      helper/parity/test scripts (mirror_plan.py, usb_mirror_parity.py,
 *      usb_mirror_plan_test.py) are deliberately NOT shipped;
 *   4. the working tree holds no non-symlink or unlisted entries under
 *      plugin/skills (a dropped-in copy would ship via --plugin-dir).
 *
 * Scanner note: jscpd, `diff -rq`, and `wc` over file content all follow
 * symlinks, so they double-count this mirror as ~2k duplicated lines —
 * issue #533 re-made the false claim the #208 audit corrected
 * (docs/agents/learned-history.md). Verify topology with
 * `git ls-files -s`, not content scans, before proposing a dedup here.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const MIRROR_ROOT = "plugin/skills";
const CANON_ROOT = ".claude/skills";

/** The shipped mirror, pinned: tracked path -> exact relative link target. */
const EXPECTED_MIRROR: readonly (readonly [string, string])[] = [
  [
    "plugin/skills/cratedeck-deckctl/SKILL.md",
    "../../../.claude/skills/cratedeck-deckctl/SKILL.md",
  ],
  [
    "plugin/skills/new-music-intake/SKILL.md",
    "../../../.claude/skills/new-music-intake/SKILL.md",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/SKILL.md",
    "../../../.claude/skills/rekordbox-usb-sync/SKILL.md",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/anlz_paths.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/anlz_paths.py",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/fix_anlz_paths.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/fix_anlz_paths.py",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/gen_full_xml.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/gen_full_xml.py",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/progress.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/progress.py",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/usb_mirror.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/usb_mirror.py",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/usb_sync.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/usb_sync.py",
  ],
  [
    "plugin/skills/rekordbox-usb-sync/scripts/usb_verify.py",
    "../../../../.claude/skills/rekordbox-usb-sync/scripts/usb_verify.py",
  ],
];

interface IndexEntry {
  mode: string;
  path: string;
}

/** `git ls-files -s` rows under the mirror — git errors propagate (fail loud). */
function trackedMirrorEntries(): IndexEntry[] {
  const out = execFileSync("git", ["ls-files", "-s", "--", MIRROR_ROOT], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return { mode: meta!.split(" ")[0]!, path: path! };
    });
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(child));
    else out.push(child);
  }
  return out;
}

describe("plugin skills mirror census (#533)", () => {
  const tracked = trackedMirrorEntries();
  const canonAbs = realpathSync(join(ROOT, CANON_ROOT));

  test("every tracked plugin/skills file is a git symlink (mode 120000)", () => {
    expect(tracked.length).toBeGreaterThan(0);
    const copies = tracked
      .filter((entry) => entry.mode !== "120000")
      .map((entry) => `${entry.mode} ${entry.path}`);
    expect(
      copies,
      `plugin/skills must be committed as symlinks, never copies — recreate with ln -s (see plugin/README.md):\n${copies.join("\n")}`,
    ).toEqual([]);
  });

  test("every mirror symlink resolves to a live .claude/skills file", () => {
    const broken: string[] = [];
    for (const [relPath, target] of EXPECTED_MIRROR) {
      const link = join(ROOT, relPath);
      if (!existsSync(link)) {
        broken.push(`${relPath}: dangling (${target} missing)`);
        continue;
      }
      const resolved = resolve(dirname(link), readlinkSync(link));
      const real = realpathSync(resolved);
      if (!real.startsWith(`${canonAbs}/`)) {
        broken.push(`${relPath}: escapes ${CANON_ROOT} -> ${target}`);
      } else if (!statSync(real).isFile()) {
        broken.push(`${relPath}: target is not a regular file`);
      }
    }
    expect(
      broken,
      `mirror links must resolve into ${CANON_ROOT}:\n${broken.join("\n")}`,
    ).toEqual([]);
  });

  test("the mirrored set and link targets match the pin exactly", () => {
    const actual = new Map(
      tracked.map((entry) => [
        entry.path,
        readlinkSync(join(ROOT, entry.path)),
      ]),
    );
    const expected = new Map(EXPECTED_MIRROR);
    const missing = [...expected.keys()].filter((p) => !actual.has(p));
    const extra = [...actual.keys()].filter((p) => !expected.has(p));
    const retargeted = [...expected]
      .filter(([p, t]) => actual.get(p) !== undefined && actual.get(p) !== t)
      .map(([p, t]) => `${p}: expected -> ${t}, got -> ${actual.get(p)}`);
    const problems = [
      ...missing.map((p) => `missing from mirror: ${p}`),
      ...extra.map((p) => `not in the shipped-skill pin: ${p}`),
      ...retargeted,
    ];
    expect(
      problems,
      `mirror drift — packaging changes are conscious edits to this pin:\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  test("the working tree holds no non-symlink or unlisted entries", () => {
    const rels = walkFiles(join(ROOT, MIRROR_ROOT)).map((f) =>
      relative(ROOT, f),
    );
    const unlisted = rels.filter(
      (rel) => !EXPECTED_MIRROR.some(([p]) => p === rel),
    );
    const copies = rels.filter(
      (rel) =>
        EXPECTED_MIRROR.some(([p]) => p === rel) &&
        !lstatSync(join(ROOT, rel)).isSymbolicLink(),
    );
    expect(
      unlisted,
      `unexpected entries under plugin/skills (stray or copy-in):\n${unlisted.join("\n")}`,
    ).toEqual([]);
    expect(
      copies,
      `regular-file copies under plugin/skills would ship via --plugin-dir (statSync follows symlinks — check with lstat / git ls-files -s):\n${copies.join("\n")}`,
    ).toEqual([]);
  });
});
