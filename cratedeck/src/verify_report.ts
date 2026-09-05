// verify_report.ts — turning usb_verify.py output into explained verdicts.
// Split from jobs.ts: the JobEngine runs jobs; THIS file owns the contract
// between usb_verify.py's human/JSON output and the structured report the
// UI, CLI, and tests consume. Pure functions only — no I/O, no engine.
import { VERIFY_HELP } from "./verify_help";
import type { VerifyCheck, VerifyDelta, VerifyReport } from "../shared/types";

export function lastLines(text: string, n: number): string {
  return text.split("\n").filter(Boolean).slice(-n).join("\n");
}

/** The failed checks of a verify report — callers read VerifyCheck directly
 *  (see verify_report.test.ts for the meaning+fix contract). */

/** The usb_verify.py structured payload (the "VERIFY_JSON: {...}" line). */
interface VerifyJsonPayload {
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
      bad_grids?: string[];
    }
  >;
  db_identical?: boolean;
  anlz_total?: number;
  anlz_mismatches?: string[];
  audio_mismatches?: string[];
  fails?: string[];
}

/** Longest offender list kept per check (full list stays in the log). */
const MAX_OFFENDERS = 50;

/** Check doc lookup from the shared help SSOT: meaning + fix stay in one place. */
const DOC = new Map(VERIFY_HELP.checks.map((c) => [c.id, c]));

function cap(list: string[] | undefined): {
  offenders?: string[];
  offender_count?: number;
} {
  if (!list?.length) return {};
  return {
    offenders: list.slice(0, MAX_OFFENDERS),
    offender_count: list.length,
  };
}

/** Parse usb_verify.py output into a full structured verify report.
 *
 *  Preferred input: the script's machine-readable "VERIFY_JSON: {...}" line
 *  (has exact counts + offending track paths). Falls back to regexing the
 *  human output for older script versions. Every check gets a status
 *  (pass/fail/warn), plain-English meaning, and a fix when failing. Passes
 *  are included — silence about 3500 good tracks is exactly the confusion
 *  we're fixing. */
export function parseVerifyReport(
  out: string,
  ok: boolean,
  finalLine: string | null,
  durationS: number | null,
): VerifyReport {
  // ---- structured payload first ------------------------------------------
  const jsonLine = out.split("\n").find((l) => l.startsWith("VERIFY_JSON: "));
  let j: VerifyJsonPayload | null = null;
  if (jsonLine) {
    try {
      j = JSON.parse(
        jsonLine.slice("VERIFY_JSON: ".length),
      ) as VerifyJsonPayload;
    } catch {
      j = null; // malformed payload → regex fallback below
    }
  }

  const stats: Record<string, number> = {};
  const checks: VerifyCheck[] = [];
  const drives = j?.drives ? Object.values(j.drives) : [];

  // script may verify 1 or 2 drives; per-drive metrics aggregate when 2
  const sum = (
    pick: (
      d: NonNullable<VerifyJsonPayload["drives"]>[string],
    ) => number | undefined,
  ): number | null => {
    const vals = drives
      .map(pick)
      .filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const tracks = j ? sum((d) => d.tracks) : grabNum(out, /^  tracks: (\d+)/m);
  const pdb = j
    ? sum((d) => d.pdb_tracks)
    : grabNum(out, /export\.pdb=(\d+) tracks/);
  const odb = j
    ? sum((d) => d.onelibrary_tracks)
    : grabNum(out, /OneLibrary DB=(\d+) tracks/);
  const playlists = j
    ? sum((d) => d.playlists)
    : grabNum(out, /playlists: (\d+)/);
  const entries = j
    ? sum((d) => d.playlist_entries)
    : grabNum(out, /entries: (\d+)/);
  const dangling = j
    ? sum((d) => d.dangling_entries)
    : (grabNum(out, /dangling: (\d+)/) ?? 0);
  const artistFk = j
    ? sum((d) => d.artist_fk_bad)
    : (grabNum(out, /artist FK bad: (\d+)/) ?? 0);
  const pioneerVar = grabNum(
    out,
    /pioneer-native variance \(informational\): (\d+)/,
  );

  // offenders: JSON gives exact lists; regex fallback has counts only
  const allOff = (
    pick: (
      d: NonNullable<VerifyJsonPayload["drives"]>[string],
    ) => string[] | undefined,
  ): string[] => (j ? drives.flatMap((d) => pick(d) ?? []) : []);
  const missingFiles = allOff((d) => d.missing_files);
  const missingAnlzList = allOff((d) => d.missing_anlz);
  const anlzHashList = allOff((d) => d.anlz_hash_missing);
  const noBpmList = allOff((d) => d.no_bpm);
  const badLenList = allOff((d) => d.bad_length);
  const badGridList = allOff((d) => d.bad_grids);

  const missingAudio = j
    ? missingFiles.length
    : (grabNum(out, /missing audio: (\d+)/) ?? 0);
  const missingAnlz = j
    ? missingAnlzList.length
    : (grabNum(out, /missing analysis: (\d+)/) ?? 0);
  const noBpm = j ? noBpmList.length : (grabNum(out, /no BPM: (\d+)/) ?? 0);
  const badLen = j
    ? badLenList.length
    : (grabNum(out, /bad length: (\d+)/) ?? 0);
  const badGrids = j
    ? badGridList.length
    : (grabNum(out, /bad grids \(generated\): (\d+)/) ?? 0);
  const anlzHash = j
    ? anlzHashList.length
    : (grabNum(out, /ANLZ missing at hash path AND at DB path: (\d+)/) ?? 0);

  if (pdb !== null) stats.pdb_tracks = pdb;
  if (odb !== null) stats.onelibrary_tracks = odb;
  if (tracks !== null) stats.tracks = tracks;
  if (playlists !== null) stats.playlists = playlists;
  if (entries !== null) stats.playlist_entries = entries;
  if (pioneerVar !== null) stats.pioneer_variance = pioneerVar;

  const crossDrive = j
    ? typeof j.db_identical === "boolean" ||
      j.anlz_mismatches !== undefined ||
      j.audio_mismatches !== undefined
    : out.includes("=== cross-drive ===");
  const dbIdentical = j
    ? (j.db_identical ?? false)
    : out.includes("DB byte-identical: true");
  const anlzMismatchList = j?.anlz_mismatches ?? [];
  const anlzParity: [number, number] | null = j
    ? j.anlz_total !== undefined || anlzMismatchList.length
      ? [j.anlz_mismatches?.length ?? 0, j.anlz_total ?? 0]
      : null
    : grab2Num(out, /ANLZ full hash parity: (\d+)\/(\d+) mismatches/);
  if (anlzParity) stats.anlz_hash_mismatches = anlzParity[0];
  const audioMismatchList = j?.audio_mismatches ?? [];
  const audioMismatch = j
    ? audioMismatchList.length
    : grabNum(out, /audio hash spot-check \(40\): (\d+) mismatches/);

  const mk = (
    id: string,
    status: VerifyCheck["status"],
    detail: string,
    off?: { offenders?: string[]; offender_count?: number },
  ): VerifyCheck => {
    const doc = DOC.get(id);
    return {
      id,
      label: doc?.label ?? id,
      status,
      detail,
      meaning: doc?.why ?? "See deckctl explain verify.",
      fix: status === "pass" ? undefined : doc?.fix,
      ...off,
    };
  };

  // 1 — dual-DB agreement
  if (pdb !== null && odb !== null) {
    checks.push(
      mk(
        "dual-db",
        pdb === odb ? "pass" : "fail",
        pdb === odb
          ? `${odb} tracks in both databases`
          : `export.pdb ${pdb} vs OneLibrary ${odb} (${
              odb > pdb
                ? `${odb - pdb} newer tracks invisible to hardware`
                : `${pdb - odb} stale rows hardware will show but rekordbox won't`
            })`,
      ),
    );
  }

  // 2 — audio files present
  if (tracks !== null) {
    checks.push(
      mk(
        "audio-files",
        missingAudio === 0 ? "pass" : "fail",
        missingAudio === 0
          ? `all ${tracks} DB tracks have their file on disk`
          : `${missingAudio} of ${tracks} DB tracks have NO file on disk`,
        cap(missingFiles),
      ),
    );
  }

  // 3 — analysis files (waveforms + beatgrids)
  const anlzTotal = missingAnlz + anlzHash;
  if (tracks !== null) {
    checks.push(
      mk(
        "anlz",
        anlzTotal === 0 ? "pass" : anlzTotal < 20 ? "warn" : "fail",
        anlzTotal === 0
          ? `all ${tracks} tracks have analysis at both the DB and hardware hash path`
          : `${anlzTotal} track(s) missing analysis (${missingAnlz} at DB path, ${anlzHash} at hardware hash path)`,
        cap([...missingAnlzList, ...anlzHashList]),
      ),
    );
  }

  // 4 — field sanity (BPM / duration)
  checks.push(
    mk(
      "fields",
      noBpm + badLen === 0 ? "pass" : "warn",
      noBpm + badLen === 0
        ? `all ${tracks ?? "?"} tracks have plausible BPM and length`
        : `${noBpm} without BPM, ${badLen} with implausible length`,
      cap([...noBpmList, ...badLenList]),
    ),
  );

  // 5 — grid plausibility
  if (tracks !== null) {
    checks.push(
      mk(
        "grids",
        badGrids === 0 ? "pass" : "warn",
        badGrids === 0
          ? `all generated grids consistent with track length + BPM`
          : `${badGrids} generated track(s) with grids that don't match length/BPM`,
        cap(badGridList),
      ),
    );
  }
  if (pioneerVar !== null && pioneerVar > 0) {
    checks.push(
      mk(
        "pioneer-variance",
        "pass",
        `${pioneerVar} Pioneer-shipped tracks have loose grids — informational, not an error`,
      ),
    );
  }

  // 6 — playlists + relations
  if (playlists !== null) {
    const dang = dangling ?? 0;
    const fk = artistFk ?? 0;
    checks.push(
      mk(
        "relations",
        dang + fk === 0 ? "pass" : "fail",
        dang + fk === 0
          ? `${playlists} playlists, ${entries ?? "?"} entries, no dangling rows`
          : `${playlists} playlists · ${dang} dangling entries · ${fk} broken artist links`,
      ),
    );
  }

  // 7..9 — cross-drive parity (only present in 2-drive runs)
  if (crossDrive) {
    checks.push(
      mk(
        "db-parity",
        dbIdentical ? "pass" : "fail",
        dbIdentical
          ? "exportLibrary.db byte-identical on both drives"
          : "exportLibrary.db differs between drives",
      ),
    );
    if (anlzParity) {
      checks.push(
        mk(
          "anlz-parity",
          anlzParity[0] === 0 ? "pass" : "fail",
          `${anlzParity[0]} of ${anlzParity[1]} analysis files differ between drives`,
          cap(anlzMismatchList),
        ),
      );
    }
    if (j || audioMismatch !== null) {
      checks.push(
        mk(
          "audio-parity",
          audioMismatch === 0 ? "pass" : "fail",
          audioMismatch === 0
            ? "40 random tracks hash-identical across drives"
            : `${audioMismatch}/40 sampled tracks DIFFER between drives (different rips)`,
          cap(audioMismatchList),
        ),
      );
    }
  }

  return {
    ran_at: Date.now(),
    ok,
    final: finalLine,
    duration_s: durationS,
    checks,
    stats,
    summary: lastLines(out, 25),
  };
}

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

/** Compare a fresh verify report against the previously stored one:
 *  per-check offender-count deltas so the UI can show "2 new broken grids
 *  since last run" instead of making the user re-derive that themselves. */
export function verifyDeltas(
  prev: VerifyReport | null,
  next: VerifyReport,
): VerifyDelta[] {
  if (!prev) return [];
  const prevBy = new Map(prev.checks.map((c) => [c.id, c]));
  const deltas: VerifyDelta[] = [];
  for (const c of next.checks) {
    if (c.id === "pioneer-variance") continue; // informational, not tracked
    const p = prevBy.get(c.id);
    const count = c.offender_count ?? 0;
    const prevCount =
      p?.offender_count ??
      // legacy reports had no offender_count — derive from detail via status
      (p ? (p.status === "pass" ? 0 : NaN) : NaN);
    if (Number.isNaN(prevCount)) continue; // can't compare legacy fails
    if (count !== prevCount || p?.status !== c.status) {
      deltas.push({
        check_id: c.id,
        label: c.label,
        delta: count - prevCount,
        prev_status: p?.status ?? null,
        prev_count: prevCount,
        count,
      });
    }
  }
  return deltas;
}
