// empty-catch-census.test.ts — #318's durable guard: every `catch {}` /
// `catch { /* only comments */ }` / `.catch(() => {})` in `src/` must
// carry a JUSTIFYING comment in its body (or real code — a log, a
// rethrow, a fallback assignment). The silent-catch purge happened by
// hand three times (Sep 7-8 silent-fallback purge, the fold, #318);
// this census keeps it true without a human sweep. Comments count as
// the justification because the repo's convention (mirrored in every
// commented site) is a one-line "why swallowing is correct" — a bare
// swallow with no words is the phantom-bug factory.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { TS_EXTS, walkFiles } from "../test-support/census-walk";

/** The repo root as seen from THIS file (src/census/ → repo root). */
const ROOT = join(import.meta.dir, "../..");
/** The census file itself contains pattern literals of the shapes it
 *  judges — skipped (they would self-flag). */
const SELF = relative(ROOT, import.meta.path);

describe("#318 empty-catch census", () => {
  test("every empty catch body carries a justifying comment", () => {
    const offenders: string[] = [];
    for (const file of walkFiles(ROOT, TS_EXTS)) {
      const rel = relative(ROOT, file);
      if (rel === SELF) continue; // the census's own pattern literals
      const rawText = readFileSync(file, "utf8");
      // Doc-comments MENTIONING the shapes (players.ts:4 keeps the Sep 7-8
      // incident in prose) must not self-flag: run the scans over
      // comment-stripped text, but keep positions — the JUSTIFICATION
      // check reads the raw text at the same offsets (comment stripping
      // is length-preserving below). A comments-only catch body or an
      // inline `//` after a swallow survives this: they live in CODE
      // positions, never inside prose.
      const text = rawText
        .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
        .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
      // catch { … } with any optional binding — non-greedy to the first
      // close brace at nesting level 0 of the body (bodies never contain
      // braces when empty-or-comment-only, so this is exact for the
      // shapes this census judges; real-code bodies with braces simply
      // fail the emptiness test below and are skipped, which can only
      // OVER-allow a code body, never flag a commented one).
      const re = /catch\s*(\([^)]*\))?\s*\{([^{}]*)\}/g;
      for (const m of text.matchAll(re)) {
        const start = m.index ?? 0;
        // the body, from the RAW text (the stripped copy blanked it)
        const bodyStart = start + (m[0]?.indexOf("{") ?? 0) + 1;
        const raw = rawText.slice(bodyStart, bodyStart + (m[2]?.length ?? 0));
        const code = raw
          .replace(/\/\/[^\n]*/g, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim();
        // a body with REAL code is out of scope; an empty-or-comments-only
        // body needs words (the justification) — a TRULY bare swallow
        // (raw.trim() === "") is always the phantom-bug factory
        if (code === "" && raw.trim() === "")
          offenders.push(`${rel}: silent catch`);
      }
      // arrow-swallow: .catch(() => {}) — must carry an inline `//` on
      // the same line (the repo convention: "quiet: … self-heals") or a
      // comment on the preceding line. Detection on the stripped text
      // (a prose mention must not flag); justification read from the
      // RAW text at the same offsets.
      const arrow = /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g;
      for (const m of text.matchAll(arrow)) {
        const idx = m.index ?? 0;
        const matchEnd = idx + (m[0]?.length ?? 0);
        const lineStart = text.lastIndexOf("\n", idx) + 1;
        const lineEnd = text.indexOf("\n", matchEnd);
        const line = rawText.slice(
          lineStart,
          lineEnd === -1 ? undefined : lineEnd,
        );
        const prevLineStart = rawText.lastIndexOf("\n", lineStart - 2) + 1;
        const prevLine = rawText.slice(prevLineStart, lineStart - 1);
        // everything after the swallow on the same line — the inline
        // justification lives HERE (`.catch(() => {}); // quiet: …`)
        const inline = line.slice(line.indexOf("}", idx - lineStart) + 1);
        const commented =
          prevLine.trim().startsWith("//") || inline.includes("//");
        if (!commented) offenders.push(`${rel}: bare .catch(() => {})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
