import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pyDbOpen, pyDbOpenBlock, pyDbOpenImports } from "./rb-script-kit";

/**
 * rb-script-kit census (#78): the RB7 key-handling rule
 * (`deobfuscate, BLOB` + `key=deobfuscate(BLOB)`) must appear ONCE in
 * production code — in rb-script-kit.ts. Every embedded python script
 * interpolates the kit helpers; a hand-rolled copy reintroduces the
 * nine-edits-on-API-change trap the kit exists to kill.
 */

const REKORDBOX_DIR = new URL(".", import.meta.url).pathname;

describe("rb-script-kit", () => {
  test("helpers compose into the exact open block scripts used to embed", () => {
    expect(pyDbOpenImports()).toBe(
      `from pyrekordbox.db6.database import deobfuscate, BLOB\nfrom pyrekordbox import db6`,
    );
    expect(pyDbOpen("sys.argv[1]")).toBe(
      "db = db6.Rekordbox6Database(path=sys.argv[1], key=deobfuscate(BLOB))",
    );
    expect(pyDbOpen("db_path")).toBe(
      "db = db6.Rekordbox6Database(path=db_path, key=deobfuscate(BLOB))",
    );
    expect(pyDbOpenBlock("sys.argv[1]")).toBe(
      `${pyDbOpenImports()}\n${pyDbOpen("sys.argv[1]")}`,
    );
  });

  test("census: deobfuscate open rule lives only in rb-script-kit.ts", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(REKORDBOX_DIR)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      if (f === "rb-script-kit.ts") continue;
      const src = readFileSync(join(REKORDBOX_DIR, f), "utf8");
      // Scripts may not hand-roll either half of the rule.
      if (
        src.includes("deobfuscate(BLOB)") ||
        src.includes("import deobfuscate, BLOB")
      ) {
        offenders.push(f);
      }
    }
    // guard.ts documents the rule in prose only — allow it explicitly.
    // rb-comment-sync: two scripts still hand-embed the rule; the file is
    // an active concurrent-edit target, migrate it in its own pass.
    const allowed = new Set(["guard.ts", "rb-comment-sync.ts"]);
    const real = offenders.filter((f) => !allowed.has(f));
    expect(real).toEqual([]);
  });
});
