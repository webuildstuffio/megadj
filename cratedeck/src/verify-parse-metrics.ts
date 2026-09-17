// verify-parse-metrics.ts — extraction stage 1 of parseVerifyReport
// (#88 item 1): pull the raw numbers + offender lists out of either the
// VERIFY_JSON structured payload or the human-output regex fallback.
// Pure data; no check assembly. verify_parse.ts turns this into checks.
// (#212) the generic grab helpers live INSIDE this module (grabNum/
// grab2Num are private — no other parser re-uses them yet) and the
// offender-cap helper moved to its only consumer, verify_parse.ts.

export interface VerifyJsonPayload {
  drives?: Record<
    string,
    {
      pdb_tracks?: number;
      onelibrary_tracks?: number;
      tracks?: number;
      playlists?: number;
      playlist_entries?: number;
      dangling_entries?: number;
      artist_fk_bad?: number;
      missing_files?: string[];
      missing_anlz?: string[];
      anlz_hash_missing?: string[];
      no_bpm?: string[];
      bad_length?: string[];
      anlz_consistency?: string[];
      /** Backward-compatible input from older usb_verify.py runs. */
      bad_grids?: string[];
    }
  >;
  db_identical?: boolean;
  anlz_total?: number;
  anlz_mismatches?: string[];
  audio_mismatches?: string[];
  fails?: string[];
}

export type DriveEntry = NonNullable<VerifyJsonPayload["drives"]>[string];

/** Grab the last integer match of `re` in `out`, or null. */
function grabNum(out: string, re: RegExp): number | null {
  const m = out.match(re);
  if (!m?.[1]) return null;
  const v = parseInt(m[1], 10);
  return Number.isNaN(v) ? null : v;
}

function grab2Num(out: string, re: RegExp): [number, number] | null {
  const m = out.match(re);
  if (!m?.[1] || !m[2]) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return [a, b];
}

/** The measured numbers + offender lists, source-agnostic: every field
 *  resolves from the JSON payload when usable, else the regex fallback.
 *  `useJson` says which; `j` is null when the payload was absent/malformed. */
export interface VerifyMetrics {
  j: VerifyJsonPayload | null;
  drives: DriveEntry[];
  useJson: boolean;
  stats: Record<string, number>;
  tracks: number | null;
  pdb: number | null;
  odb: number | null;
  playlists: number | null;
  entries: number | null;
  dangling: number | null;
  artistFk: number | null;
  pioneerVar: number | null;
  missingFiles: string[];
  missingAnlzList: string[];
  anlzHashList: string[];
  noBpmList: string[];
  badLenList: string[];
  badGridList: string[];
  missingAudio: number;
  missingAnlz: number;
  noBpm: number;
  badLen: number;
  badGrids: number;
  anlzHash: number;
  crossDrive: boolean;
  dbIdentical: boolean;
  anlzParity: [number, number] | null;
  anlzMismatchList: string[];
  audioMismatch: number | null;
  audioMismatchList: string[];
}

interface CountFields {
  tracks: number | null;
  pdb: number | null;
  odb: number | null;
  playlists: number | null;
  entries: number | null;
  dangling: number | null;
  artistFk: number | null;
  pioneerVar: number | null;
}

/** Track/playlist counts: JSON drive aggregation when usable, else the
 *  human-output regexes. */
function extractCounts(
  out: string,
  useJson: boolean,
  sum: (pick: (d: DriveEntry) => number | undefined) => number | null,
): CountFields {
  const tracks = useJson
    ? sum((d) => d.tracks)
    : grabNum(out, /^  tracks: (\d+)/m);
  const pdb = useJson
    ? sum((d) => d.pdb_tracks)
    : grabNum(out, /export\.pdb=(\d+) tracks/);
  const odb = useJson
    ? sum((d) => d.onelibrary_tracks)
    : grabNum(out, /OneLibrary DB=(\d+) tracks/);
  const playlists = useJson
    ? sum((d) => d.playlists)
    : grabNum(out, /playlists: (\d+)/);
  const entries = useJson
    ? sum((d) => d.playlist_entries)
    : grabNum(out, /entries: (\d+)/);
  const dangling = useJson
    ? sum((d) => d.dangling_entries)
    : (grabNum(out, /dangling: (\d+)/) ?? 0);
  const artistFk = useJson
    ? sum((d) => d.artist_fk_bad)
    : (grabNum(out, /artist FK bad: (\d+)/) ?? 0);
  const pioneerVar = grabNum(
    out,
    /pioneer-native variance \(informational\): (\d+)/,
  );
  return {
    tracks,
    pdb,
    odb,
    playlists,
    entries,
    dangling,
    artistFk,
    pioneerVar,
  };
}

interface OffenderLists {
  missingFiles: string[];
  missingAnlzList: string[];
  anlzHashList: string[];
  noBpmList: string[];
  badLenList: string[];
  badGridList: string[];
}

interface OffenderCounts {
  missingAudio: number;
  missingAnlz: number;
  noBpm: number;
  badLen: number;
  badGrids: number;
  anlzHash: number;
}

/** Offender lists (JSON) + their counts (list length when the JSON
 *  carried complete lists, else the human-output count regexes). */
function extractOffenders(
  out: string,
  drives: DriveEntry[],
  useJson: boolean,
): { lists: OffenderLists; counts: OffenderCounts } {
  // offenders: JSON gives exact lists; regex fallback has counts only
  const allOff = (pick: (d: DriveEntry) => string[] | undefined): string[] =>
    useJson ? drives.flatMap((d) => pick(d) ?? []) : [];
  const lists: OffenderLists = {
    missingFiles: allOff((d) => d.missing_files),
    missingAnlzList: allOff((d) => d.missing_anlz),
    anlzHashList: allOff((d) => d.anlz_hash_missing),
    noBpmList: allOff((d) => d.no_bpm),
    badLenList: allOff((d) => d.bad_length),
    badGridList: allOff((d) => d.anlz_consistency ?? d.bad_grids),
  };

  const hasList = (pick: (d: DriveEntry) => string[] | undefined): boolean =>
    useJson && drives.every((d) => Array.isArray(pick(d)));

  const counts: OffenderCounts = {
    missingAudio: hasList((d) => d.missing_files)
      ? lists.missingFiles.length
      : (grabNum(out, /missing audio: (\d+)/) ?? 0),
    missingAnlz: hasList((d) => d.missing_anlz)
      ? lists.missingAnlzList.length
      : (grabNum(out, /missing analysis: (\d+)/) ?? 0),
    noBpm: hasList((d) => d.no_bpm)
      ? lists.noBpmList.length
      : (grabNum(out, /no BPM: (\d+)/) ?? 0),
    badLen: hasList((d) => d.bad_length)
      ? lists.badLenList.length
      : (grabNum(out, /bad length: (\d+)/) ?? 0),
    badGrids: hasList((d) => d.anlz_consistency ?? d.bad_grids)
      ? lists.badGridList.length
      : (grabNum(out, /ANLZ consistency failures \(generated\): (\d+)/) ??
        grabNum(out, /bad grids \(generated\): (\d+)/) ??
        0),
    anlzHash: hasList((d) => d.anlz_hash_missing)
      ? lists.anlzHashList.length
      : (grabNum(out, /ANLZ missing at hash path AND at DB path: (\d+)/) ?? 0),
  };
  return { lists, counts };
}

interface ParityFields {
  crossDrive: boolean;
  dbIdentical: boolean;
  anlzParity: [number, number] | null;
  anlzMismatchList: string[];
  audioMismatch: number | null;
  audioMismatchList: string[];
}

/** Cross-drive parity fields (2-drive runs only). */
function extractParity(
  out: string,
  j: VerifyJsonPayload | null,
  useJson: boolean,
): ParityFields {
  const crossDrive = useJson
    ? typeof j!.db_identical === "boolean" ||
      j!.anlz_mismatches !== undefined ||
      j!.audio_mismatches !== undefined
    : out.includes("=== cross-drive ===");
  const dbIdentical = useJson
    ? (j!.db_identical ?? false)
    : out.includes("DB byte-identical: true");
  const anlzMismatchList = useJson ? (j!.anlz_mismatches ?? []) : [];
  const anlzParity: [number, number] | null = useJson
    ? j!.anlz_total !== undefined || anlzMismatchList.length
      ? [j!.anlz_mismatches?.length ?? 0, j!.anlz_total ?? 0]
      : null
    : grab2Num(out, /ANLZ full hash parity: (\d+)\/(\d+) mismatches/);
  const audioMismatchList = useJson ? (j!.audio_mismatches ?? []) : [];
  const audioMismatch = useJson
    ? audioMismatchList.length
    : grabNum(out, /audio hash spot-check \(40\): (\d+) mismatches/);
  return {
    crossDrive,
    dbIdentical,
    anlzParity,
    anlzMismatchList,
    audioMismatch,
    audioMismatchList,
  };
}

export function extractVerifyMetrics(out: string): VerifyMetrics {
  // ---- structured payload first ------------------------------------------
  const jsonLine = out.split("\n").find((l) => l.startsWith("VERIFY_JSON: "));
  let j: VerifyJsonPayload | null = null;
  if (jsonLine) {
    try {
      j = JSON.parse(
        jsonLine.slice("VERIFY_JSON: ".length),
      ) as VerifyJsonPayload;
    } catch (error) {
      console.warn(
        "usb_verify.py VERIFY_JSON payload is malformed; using human-output fallback",
        error,
      );
      j = null; // malformed payload → regex fallback below
    }
  }

  const stats: Record<string, number> = {};
  // sanitize: a structurally-broken payload (e.g. {"drives":{"DJX":null}})
  // must degrade to regex fallback, not throw away the whole verdict.
  const drives: DriveEntry[] = j?.drives
    ? (Object.values(j.drives).filter(
        (d): d is DriveEntry => Boolean(d) && typeof d === "object",
      ) as DriveEntry[])
    : [];
  if (j !== null && drives.length === 0) {
    console.warn(
      "usb_verify.py VERIFY_JSON has no usable drive entries; using human-output fallback",
    );
  }

  // script may verify 1 or 2 drives; per-drive metrics aggregate when 2
  const sum = (pick: (d: DriveEntry) => number | undefined): number | null => {
    const vals = drives
      .map(pick)
      .filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  // When the payload parsed but yielded no usable drive entries (drift,
  // truncation), fall back to the human-text regexes instead of reporting
  // an all-undefined (and all-empty-offender) report.
  const useJson = j !== null && drives.length > 0;
  const counts = extractCounts(out, useJson, sum);
  const offenders = extractOffenders(out, drives, useJson);

  const { tracks, pdb, odb, playlists, entries, dangling, artistFk } = counts;
  const pioneerVar = counts.pioneerVar;
  const {
    missingFiles,
    missingAnlzList,
    anlzHashList,
    noBpmList,
    badLenList,
    badGridList,
  } = offenders.lists;
  const { missingAudio, missingAnlz, noBpm, badLen, badGrids, anlzHash } =
    offenders.counts;

  if (pdb !== null) stats.pdb_tracks = pdb;
  if (odb !== null) stats.onelibrary_tracks = odb;
  if (tracks !== null) stats.tracks = tracks;
  if (playlists !== null) stats.playlists = playlists;
  if (entries !== null) stats.playlist_entries = entries;
  if (pioneerVar !== null) stats.pioneer_variance = pioneerVar;

  const parity = extractParity(out, j, useJson);
  const { crossDrive, dbIdentical, anlzParity } = parity;
  const { anlzMismatchList, audioMismatch, audioMismatchList } = parity;
  if (anlzParity) stats.anlz_hash_mismatches = anlzParity[0];

  return {
    j,
    drives,
    useJson,
    stats,
    tracks,
    pdb,
    odb,
    playlists,
    entries,
    dangling,
    artistFk,
    pioneerVar,
    missingFiles,
    missingAnlzList,
    anlzHashList,
    noBpmList,
    badLenList,
    badGridList,
    missingAudio,
    missingAnlz,
    noBpm,
    badLen,
    badGrids,
    anlzHash,
    crossDrive,
    dbIdentical,
    anlzParity,
    anlzMismatchList,
    audioMismatch,
    audioMismatchList,
  };
}
