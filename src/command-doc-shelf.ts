import type { CommandDocEntry } from "./command-doc-types";

export const SHELF_COMMAND_DOCS: readonly CommandDocEntry[] = [
  {
    name: "shelf-sync",
    group: "fulltags",
    block: [
      "  megadj shelf-sync [--dry-run] [--json]       copy archive music onto the shelf master",
      "                                               (+ mounted sticks) — additive, resumable",
    ],
  },
  {
    name: "shelf-archive",
    group: "fulltags",
    block: [
      "  megadj shelf-archive [volume ...] [--into F] [--trashes] [--deep] [--json]",
      "                                               pull everything from drive(s) INTO the",
      "                                               shelf — additive, junk-filtered, MD5-verified,",
      "                                               divergent copies preserved (never overwritten)",
    ],
  },
  {
    name: "shelf-sweeps",
    group: "fulltags",
    block: [
      "  megadj shelf-sweeps [--json]                 DB ledger: every drive→shelf sweep, its",
      "                                               verdict and counters (latest per drive)",
    ],
  },
  {
    name: "shelf-dedupe",
    group: "fulltags",
    block: [
      "  megadj shelf-dedupe [--apply --yes] [--json] resolve [drive] twins: MD5 + fingerprint,",
      "                                               report first; --apply moves losers to",
      "                                               quarantine on the shelf (never deletes)",
    ],
  },
  {
    name: "shelf-dupescan",
    group: "fulltags",
    block: [
      "  megadj shelf-dupescan [--json]               fingerprint EVERY shelf audio file; group",
      "                                               identical recordings regardless of filename",
      "                                               or folder (cross-folder duplicate hunt)",
      "                                               [--quarantine --yes] moves group losers to",
      "                                               the shelf quarantine (never deletes)",
      "                                               [--only-identical] restricts quarantine to",
      "                                               byte-verified md5-equal copies",
    ],
  },
  {
    name: "dedupe-archive",
    group: "fulltags",
    block: [
      "  megadj dedupe-archive [--apply --yes] [--json]",
      "                                               same fingerprint pass, over the DJ-Imports",
      "                                               archive: cross-batch duplicate hunt",
      "                                               (--apply moves losers to the archive",
      "                                               quarantine, never deletes)",
    ],
  },
  {
    name: "shelf-hygiene",
    group: "fulltags",
    block: [
      "  megadj shelf-hygiene [--shelf V] [--kind K] [--json]         the hygiene sweep: byte/fp/junk checks →",
      "                                               findings ledger (--json = census);",
      "                                               [--confirm ID | --dismiss ID] decide one;",
      "                                               [--bucket NAME] batch-confirm one SAFE",
      "                                               acoustic subcategory (metadata-diff |",
      "                                               re-encode | safe-batch) — quality-diff,",
      "                                               oddball, ear-check are listen-first and",
      "                                               refuse batch-confirm (A/B compare them",
      "                                               in the Hygiene tab);",
      "                                               [--apply --yes] executes CONFIRMED losers",
      "                                               into the shelf quarantine (never deletes)",
    ],
  },
  {
    name: "shelf-restore",
    group: "fulltags",
    block: [
      "  megadj shelf-restore <finding-id|path> [--into F] [--json]",
      "                                               restore an applied ledger-owned quarantine",
      "                                               source; MD5-verified, never overwrites",
    ],
  },
  {
    name: "shelf-restore-all",
    group: "fulltags",
    block: [
      "  megadj shelf-restore-all [--into F] [--json]",
      "                                               restore EVERY applied finding's quarantine",
      "                                               copy (per-row failures report, never fatal)",
    ],
  },
  {
    name: "shelf-quarantine",
    group: "fulltags",
    block: [
      "  megadj shelf-quarantine [--shelf V] [--json]",
      "                                               quarantine census: N files / X GB of",
      "                                               recoverable copies (read-only; --shelf",
      "                                               names the shelf volume to scan)",
    ],
  },
  {
    name: "shelf-quarantine-empty",
    group: "fulltags",
    block: [
      "  megadj shelf-quarantine-empty [--shelf V] --yes [--json]",
      "                                               delete every recoverable copy and flip the",
      "                                               rows to archived — the undo window closes",
      "                                               (--yes required; --shelf names the volume;",
      "                                               never touches keepers)",
    ],
  },
];
