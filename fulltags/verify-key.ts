#!/usr/bin/env bun
/**
 * Key verification harness — the roadmap #3 gauntlet gate.
 *
 * Analyzes N tracks with OpenKeyScan and compares against existing key
 * tags in the files (MIK/rekordbox values as reference). Run BEFORE any
 * batch key write; the roadmap requires ≥80% agreement on 20+ tracks.
 *
 * Usage: bun run fulltags/verify-key.ts <folder|files...> [--limit N] [--json]
 *
 * Comparison is Camelot-aware: "9A" vs "A minor" style values normalize
 * through the same class map the analyzer uses; ±1 Camelot neighbor or
 * relative major/minor counts as "near" (listed separately from matches).
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { analyzeKeys } from "./src/analysis";
import { groundTruth } from "./src/readers";

const AUDIO = new Set([
  ".mp3",
  ".wav",
  ".aiff",
  ".aif",
  ".flac",
  ".m4a",
  ".m4b",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (AUDIO.has(extname(e).toLowerCase())) out.push(p);
  }
  return out;
}

// Camelot class map (matches the analyzer's: 0-11 minor=1A-12A, 12-23 major)
const CAMELOT_MINOR = [
  "12A",
  "7A",
  "2A",
  "9A",
  "4A",
  "11A",
  "6A",
  "1A",
  "8A",
  "3A",
  "10A",
  "5A",
];
const CAMELOT_MAJOR = [
  "8B",
  "3B",
  "10B",
  "5B",
  "12B",
  "7B",
  "2B",
  "9B",
  "4B",
  "11B",
  "6B",
  "1B",
];

/** Parse any key-ish string to Camelot ("9A") when possible. */
function toCamelot(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})([ABab])$/);
  if (m && m[1] && m[2]) return `${m[1]}${m[2].toUpperCase()}`;
  // Traditional: "E min", "C major", "F#m", "dbmaj" → camelot via circle
  const note = s.match(/^([A-G])([#b♭♯]?)/i);
  if (!note || !note[1]) return null;
  const semis: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  let idx = semis[note[1].toUpperCase()] ?? -1;
  const acc = (note[2] ?? "").toLowerCase();
  if (acc === "#" || acc === "♯") idx += 1;
  if (acc === "b" || acc === "♭") idx -= 1;
  if (idx < 0) idx += 12;
  if (idx > 11) idx -= 12;
  const isMinor = /min|m\b|[^a-z]m$/i.test(s) && !/maj/i.test(s);
  const table = isMinor ? CAMELOT_MINOR : CAMELOT_MAJOR;
  return table[((idx % 12) + 12) % 12] ?? null;
}

/** Distance on the camelot wheel: 0 same, 1 neighbor/relative, 99 far. */
function camelotDist(a: string, b: string): number {
  if (a === b) return 0;
  const na = parseInt(a.slice(0, -1), 10);
  const nb = parseInt(b.slice(0, -1), 10);
  const numDist = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));
  if (numDist === 0) return 1; // same number different letter = relative
  if (numDist === 1) return 1; // energy-adjacent
  return numDist;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(args[limIdx + 1] ?? "20", 10) : 20;
  const targets = args.filter((a) => !a.startsWith("--") && a !== String(limit));
  const files: string[] = [];
  for (const t of targets) {
    if (!existsSync(t)) continue;
    if (statSync(t).isDirectory()) files.push(...walk(t));
    else files.push(t);
  }
  const sample = files.slice(0, limit);
  if (!sample.length) {
    console.error(
      "usage: bun run fulltags/verify-key.ts <folder|files...> [--limit 20] [--json]",
    );
    process.exit(2);
  }

  // Reference = existing key tags on disk (MIK/rekordbox output)
  const refs = new Map<string, string | null>();
  for (const f of sample) refs.set(f, groundTruth(f).key);

  const withRefs = sample.filter((f) => refs.get(f));
  const t0 = Date.now();
  const results = withRefs.length
    ? analyzeKeys(withRefs)
    : Promise.resolve(new Map());
  void results.then((keys) => {
    const rows = withRefs.map((f) => {
      const ref = toCamelot(refs.get(f)!);
      const got = keys.get(f)?.camelot ?? null;
      const dist = ref && got ? camelotDist(ref, got) : 99;
      return {
        file: basename(f),
        ref: refs.get(f),
        refCamelot: ref,
        got,
        verdict:
          dist === 0 ? "match" : dist === 1 ? "near" : "mismatch",
      };
    });
    const match = rows.filter((r) => r.verdict === "match").length;
    const near = rows.filter((r) => r.verdict === "near").length;
    const mismatch = rows.filter((r) => r.verdict === "mismatch").length;
    const analyzed = rows.length;
    const agreement = analyzed ? match / analyzed : 0;
    const gate = agreement >= 0.8;
    if (json) {
      console.log(
        JSON.stringify(
          {
            analyzed,
            skippedNoRef: sample.length - analyzed,
            match,
            near,
            mismatch,
            agreement: Math.round(agreement * 1000) / 1000,
            gate: gate ? "PASS (≥80%)" : "FAIL (<80%)",
            elapsedMs: Date.now() - t0,
            rows,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`analyzed ${analyzed} (skipped ${sample.length - analyzed} without existing key tags)`);
      for (const r of rows) {
        const mark =
          r.verdict === "match"
            ? "✓"
            : r.verdict === "near"
              ? "~"
              : "✗";
        console.log(
          ` ${mark} ${r.file.padEnd(40)} ref=${String(r.ref).padEnd(8)} got=${String(r.got).padEnd(4)} (${r.verdict})`,
        );
      }
      console.log(
        `\nagreement: ${match}/${analyzed} exact + ${near} near = ${Math.round(((match + near) / Math.max(analyzed, 1)) * 100)}% combined · gate(≥80% exact): ${gate ? "PASS" : "FAIL"} · ${Date.now() - t0}ms`,
      );
    }
    process.exitCode = gate ? 0 : 1;
  });
}

main();
