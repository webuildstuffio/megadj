import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function tableKeys(source: string): string[] {
  // quoted keys of an exported domain command record ("verb": handler)
  const keys: string[] = [];
  for (const tbl of source.matchAll(
    /export const \w+_COMMANDS(?::[^=]*)?= \{[\s\S]*?\n\};/g,
  )) {
    for (const m of (tbl[0] ?? "").matchAll(/"([a-z-]+)":\s*\w+/g))
      if (m[1]) keys.push(m[1]);
  }
  return keys;
}

/** #235: the maintenance grab-bag dissolved into the domain command
 *  records — shelf arms in shelf/cli-commands.ts, rb-* arms in
 *  rekordbox/cli-commands.ts. The 14 former MAINTENANCE_VERBS must all
 *  be reachable, each with exactly one arm. */
const FORMER_MAINTENANCE_VERBS = [
  "shelf-hygiene",
  "intake-status",
  "shelf-restore",
  "tmp-purge",
  "rb-fix-paths",
  "rb-unmatched",
  "rb-adopt",
  "rb-import",
  "rb-playlist",
  "rb-cues",
  "rb-dedup",
  "rb-comment-sync",
  "rb-anlz-spike",
  "rb-grid-triage",
] as const;

describe("issue #32 → #235: maintenance command census", () => {
  test("every former maintenance verb has exactly one arm in the domain records", async () => {
    const shelf = tableKeys(read("src/shelf/cli-commands.ts"));
    const rb = tableKeys(read("src/rekordbox/cli-commands.ts"));
    const all = [...shelf, ...rb];
    const dupes = all.filter((v, i) => all.indexOf(v) !== i);
    expect(dupes).toEqual([]);
    for (const verb of FORMER_MAINTENANCE_VERBS) expect(all).toContain(verb);
    // domain fit: shelf verbs live in shelf, rb verbs in rekordbox
    expect(shelf).toEqual(
      expect.arrayContaining([
        "shelf-hygiene",
        "intake-status",
        "shelf-restore",
        "tmp-purge",
      ]),
    );
    expect(rb).toEqual(
      expect.arrayContaining(["rb-import", "rb-anlz-spike", "rb-grid-triage"]),
    );
    expect(rb).not.toContain("shelf-hygiene");
    expect(shelf).not.toContain("rb-import");
  });

  test("the grab-bag is gone: no maintenance-cmds module or verb list remains", () => {
    expect(() => read("src/shared/maintenance-cmds.ts")).toThrow();
    // the old CLI-side maintenance branch (a second dispatch surface) is dead
    const cliSource = read("src/cli.ts");
    expect(cliSource).not.toContain("MAINTENANCE_VERBS");
    expect(cliSource).not.toContain("runMaintenanceCommand");
  });

  test("the dispatch is still table lookup, not a switch (#88)", () => {
    for (const f of [
      "src/shelf/cli-commands.ts",
      "src/rekordbox/cli-commands.ts",
    ]) {
      const source = read(f);
      expect(source).not.toMatch(/^\s*case "[a-z-]+":/m);
    }
    const dispatch = read("src/cli-dispatch.ts");
    expect(dispatch).toContain("REKORDBOX_COMMANDS");
    expect(dispatch).toMatch(/\.\.\.REKORDBOX_COMMANDS/);
  });

  test("cli.ts routes every verb through the one dispatch table", () => {
    const cliSource = read("src/cli.ts");
    expect(cliSource).toContain("dispatchCommand(command, rest");
    // no verb-class special case ahead of the table
    expect(cliSource).not.toMatch(/includes\(command\)[\s\S]{0,80}run/);
  });
});
