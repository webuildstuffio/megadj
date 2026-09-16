import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PY_CUE_SIG_BLOCK,
  PY_FIND_PLAYLIST_FN,
  PY_MATCH_TRACK_STEP,
  PY_RID_FN,
  pyContentMatchPreamble,
  pyCueSigBlock,
  pyDbOpen,
  pyDbOpenBlock,
  pyDbOpenImports,
  pyPathKeyFn,
} from "./rb-script-kit";

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

  // ---- #88 diet: the statement-level Python program fragments ----

  test("path_key composes nfc + casefold; the nfc-only variant omits the helper", () => {
    expect(pyPathKeyFn()).toBe(
      `def nfc(s):\n    return unicodedata.normalize("NFC", s) if s else s\n\ndef path_key(s):\n    return nfc(s).casefold()`,
    );
    expect(pyPathKeyFn(false)).toBe(
      `def path_key(s):\n    return nfc(s).casefold()`,
    );
  });

  test("rid + find_playlist keep the exact semantics the pinned scripts assert", () => {
    expect(PY_RID_FN).toContain('hasattr(db, "random_id")');
    expect(PY_RID_FN).toContain("& 0x7FFFFFFF");
    // root-only matching: parent coercion via str() so sqlite ints and
    // python ints can't disagree
    expect(PY_FIND_PLAYLIST_FN).toContain(
      "expected_parent_id = parent.ID if parent is not None else 0",
    );
    expect(PY_FIND_PLAYLIST_FN).toContain(
      "str(p.ParentID or 0) == str(expected_parent_id)",
    );
  });

  test("content-match preamble + per-track step are the unique basename rule", () => {
    const preamble = pyContentMatchPreamble();
    expect(preamble).toContain("by_path.setdefault(path, c.ID)");
    expect(preamble).toContain("by_base.setdefault(b, []).append(c.ID)");
    // the 60-char FileNameL clip tolerance, unique-only
    expect(PY_MATCH_TRACK_STEP).toContain(
      'candidates = by_base.get(base[:57] + "...", [])',
    );
    expect(PY_MATCH_TRACK_STEP).toContain(
      "if cid is None and len(candidates) == 1:",
    );
  });

  test("cue_sig block: delete and verify interpolate the SAME fragment", () => {
    expect(pyCueSigBlock()).toBe(PY_CUE_SIG_BLOCK);
    expect(PY_CUE_SIG_BLOCK).toContain("def cue_sig(cue):");
    expect(PY_CUE_SIG_BLOCK).toContain(
      'return hashlib.sha256(payload.encode("utf-8")).hexdigest()',
    );
  });

  test("census: program fragments live only in rb-script-kit.ts", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(REKORDBOX_DIR)) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      if (f === "rb-script-kit.ts") continue;
      const src = readFileSync(join(REKORDBOX_DIR, f), "utf8");
      if (
        src.includes("def nfc(s):") ||
        src.includes("def path_key(s):") ||
        src.includes("def find_playlist(name, attr, parent_id):") ||
        src.includes("def cue_sig(cue):") ||
        src.includes("by_base.setdefault(b, []).append(c.ID)") ||
        src.includes('hasattr(db, "random_id")')
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
