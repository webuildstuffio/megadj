import type { CommandDocEntry } from "./command-doc-types";

export const GETDAT_COMMAND_DOCS: readonly CommandDocEntry[] = [
  {
    name: "sync",
    group: "getdat",
    block: [
      "  megadj sync    [--limit N] [--dry-run] [--music-only] [--target-total N] [--sources LM,LL,sc-user:NAME,sc-likes:NAME] [--sc-url <soundcloud-url>] [--force-rip] [--repair-identity] [--json]",
      "                                               download from YouTube Music playlists and SoundCloud",
      "                                               (tracks/sets/user pages); link-first on SC, resumable, rate-limited",
      "                                               --repair-identity: backfill empty title/artist on terminal SC rows",
    ],
  },
  {
    name: "status",
    group: "getdat",
    block: [
      "  megadj status [--json]                       archive summary + recent runs",
    ],
  },
  {
    name: "list",
    group: "getdat",
    block: [
      "  megadj list    [filter] [--json]             list tracks (by status or text)",
    ],
  },
  {
    name: "adopt",
    group: "getdat",
    block: [
      "  megadj adopt   [--shelf --apply] [--json]     register existing files in the DB;",
      "                                                --shelf repoints rows whose local file",
      "                                                moved to the shelf (dry-run by default)",
    ],
  },
  {
    name: "retry",
    group: "getdat",
    block: [
      "  megadj retry   [--json]                      reset failure counters, then `megadj sync` to retry",
    ],
  },
  {
    name: "skip",
    group: "getdat",
    block: [
      "  megadj skip    <video_id…> [--json]          mark pending rows not-YouTube-music — sync never downloads them",
    ],
  },
  {
    name: "intake-status",
    group: "getdat",
    block: [
      "  megadj intake-status [drive] [--json]        one reconciled census: files ↔ archive.db (NFC+casefold);",
      "                                               exit 1 on drift; the [drive] leg adds master.db counts",
    ],
  },
];
