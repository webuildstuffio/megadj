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
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { analyzeKeys } from "./src/analysis";
import { groundTruth } from "./src/readers";

const AUDIO = new Set([".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".m4b"]);

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

// Note→Camelot maps, extracted from the analyzer's own camelot_output()
// (authoritative — a generic circle-of-fifths table disagrees with it).
// Verified against openkeyscan_analyzer_server.py, 2026-09-05:
//   minor: Ab=1A D#=2A A#=3A F=4A C=5A G=6A D=7A A=8A E=9A B=10A F#=11A C#=12A
//   major: B=1B F#=2B C#=3B Ab=4B D#=5B A#=6B F=7B C=8B G=9B D=10B A=11B E=12B
const NOTE_MINOR: Record<string, string> = {
  "G#": "1A",
  Ab: "1A",
  "D#": "2A",
  Eb: "2A",
  "A#": "3A",
  Bb: "3A",
  F: "4A",
  C: "5A",
  G: "6A",
  D: "7A",
  A: "8A",
  E: "9A",
  B: "10A",
  "F#": "11A",
  Gb: "11A",
  "C#": "12A",
  Db: "12A",
};
const NOTE_MAJOR: Record<string, string> = {
  B: "1B",
  "F#": "2B",
  Gb: "2B",
  "C#": "3B",
  Db: "3B",
  "G#": "4B",
  Ab: "4B",
  "D#": "5B",
  Eb: "5B",
  "A#": "6B",
  Bb: "6B",
  F: "7B",
  C: "8B",
  G: "9B",
  D: "10B",
  A: "11B",
  E: "12B",
};

/** Parse any key-ish string to Camelot ("9A") when possible. */
function toCamelot(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})([ABab])$/);
  if (m && m[1] && m[2]) return `${m[1]}${m[2].toUpperCase()}`;
  // Traditional: "E min", "C major", "F#m", "dbmaj" → note name lookup
  const note = s.match(/^([A-G])([#b♯♭]?)/i);
  if (!note || !note[1]) return null;
  const acc = (note[2] ?? "").toLowerCase();
  const keyName =
    note[1].toUpperCase() +
    (acc === "#" || acc === "♯" ? "#" : acc === "b" || acc === "♭" ? "b" : "");
  const isMinor = /min|m\b|[^a-z]m$/i.test(s) && !/maj/i.test(s);
  return (isMinor ? NOTE_MINOR : NOTE_MAJOR)[keyName] ?? null;
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
  const refsIdx = args.indexOf("--refs");
  const targets = args.filter(
    (a) => !a.startsWith("--") && a !== String(limit) && (refsIdx < 0 || a !== args[refsIdx + 1]),
  );
  const files: string[] = [];
  for (const t of targets) {
    if (!existsSync(t)) continue;
    if (statSync(t).isDirectory()) files.push(...walk(t));
    else files.push(t);
  }
  const sample = files.slice(0, limit);
  if (!sample.length) {
    console.error(
      "usage: bun run fulltags/verify-key.ts <folder|files...> [--limit 20] [--refs map.json] [--json]\n" +
        '  --refs: JSON {"<basename>": "Ebm"} — external reference keys\n        (e.g. rekordbox master.db ScaleName via pyrekordbox) used when\n        the file itself carries no key tag',
    );
    process.exit(2);
  }

  // Reference = existing key tags on disk (MIK/rekordbox output), or an
  // external --refs JSON map {basename: "Ebm"} — e.g. rekordbox master.db
  // ScaleName values extracted via pyrekordbox. This is the real-world path:
  // archive files often carry NO key tags yet (that's why they're being
  // verified before write), while rekordbox has already analyzed them.
  let externalRefs: Record<string, string> | null = null;
  if (refsIdx >= 0) {
    const p = args[refsIdx + 1];
    if (!p || !existsSync(p)) {
      console.error(`--refs: file not found: ${p}`);
      process.exit(2);
    }
    externalRefs = JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
  }

  const refs = new Map<string, string | null>();
  for (const f of sample) {
    refs.set(f, groundTruth(f).key ?? externalRefs?.[basename(f)] ?? null);
  }

  const withRefs = sample.filter((f) => refs.get(f));
  const t0 = Date.now();
  const results = withRefs.length ? analyzeKeys(withRefs) : Promise.resolve(new Map());
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
        verdict: dist === 0 ? "match" : dist === 1 ? "near" : "mismatch",
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
      console.log(
        `analyzed ${analyzed} (skipped ${sample.length - analyzed} without existing key tags)`,
      );
      for (const r of rows) {
        const mark = r.verdict === "match" ? "✓" : r.verdict === "near" ? "~" : "✗";
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
