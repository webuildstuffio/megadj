// comment-sync-unreadable.test.ts — issue #229 regression: the kit's
// read_txxx must distinguish a CORRUPT tag block ("unreadable") from a
// readable file with no usable frames (None → "no tag data"). A corrupt
// tag block is a data-integrity signal; collapsing it into the untagged
// skip bucket mislabels it as absence. Also pins the narrowed mood-float
// except (TypeError/ValueError only — a broad `except Exception: pass`
// hid boundary bugs).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kitPath = join(import.meta.dir, "rb-scripts", "comment-sync.kit.py");
const script = () => readFileSync(kitPath, "utf8");

describe("comment-sync kit tag-read honesty (#229)", () => {
  test("read_txxx returns a distinct UNREADABLE sentinel on parse failure", () => {
    const s = script();
    // the sentinel is defined at module level (distinct object, not None)
    expect(s).toMatch(/^UNREADABLE = object\(\)$/m);
    // the mutagen parse failure path returns the sentinel, not None
    expect(s).toContain("    except Exception:\n        return UNREADABLE");
  });

  test("the skip decision reports 'unreadable', never 'no tag data', for corrupt", () => {
    const s = script();
    // the caller checks the sentinel BEFORE the (tags or {}) fallthrough —
    // `tags is UNREADABLE` (identity), not a truthiness check that None
    // and the sentinel would both survive
    expect(s).toContain("if tags is UNREADABLE:");
    expect(s).toContain('out["skipped"].append([p[-70:], "unreadable"])');
    // "no tag data" stays reserved for the genuinely-untagged case (the
    // `not (energy or mood or key)` arm)
    expect(s).toContain('"no tag data"');
  });

  test("the mood-float except is narrowed to (TypeError, ValueError)", () => {
    const s = script();
    // bounded worst case per #229: a malformed score drops that mood head;
    // a broad `except Exception: pass` around float() is banned shape
    expect(s).toContain("except (TypeError, ValueError):");
    expect(s).not.toMatch(/float\(m\.get\(head\) or 0\)[^}]*except Exception/s);
  });
});
