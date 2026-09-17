// archive_tagcompare.ts — the ONE-track three-source tag comparison
// (#89 diet extraction from archive_tagcensus.ts): file live tags (the
// FILE is truth) vs the archive mirror columns vs the rb-adopt mirror
// row, plus the difference table the UI renders. The fleet-wide census
// stays in archive_tagcensus.ts.
import { groundTruth } from "../../fulltags/src/exports";
import type { ArchiveTrackTagCompare } from "../shared/archive-wire";
import type { ArchiveQuery } from "./archive_types";

/** The rb-adopt mirror row for one track (newest first), parsed from its
 *  metadata_json snapshot. Corrupt mirror JSON → null (the DB row stays
 *  untouched; rb-adopt re-adopt rewrites it). */
function readRekordboxMirror(
  reader: ArchiveQuery,
  videoId: string,
): ArchiveTrackTagCompare["rekordbox"] {
  const rbMeta = reader.row<{ metadata_json: string }>(
    `SELECT metadata_json FROM rekordbox_content rc
     WHERE rc.video_id = ?
     ORDER BY rc.updated_at DESC, rc.content_id DESC LIMIT 1`,
    videoId,
  );
  if (!rbMeta || !rbMeta.metadata_json) return null;
  try {
    const m = JSON.parse(rbMeta.metadata_json) as Record<string, unknown>;
    const s = (k: string): string | null => {
      const v = m[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const bpmRaw = m["BPM"];
    const bpm =
      typeof bpmRaw === "number" && Number.isFinite(bpmRaw) && bpmRaw > 0
        ? bpmRaw / 100
        : null;
    const yearRaw = s("ReleaseYear");
    const year =
      yearRaw && yearRaw !== "0" && /^\d{4}$/.test(yearRaw) ? yearRaw : null;
    return {
      contentId: s("ID") ?? videoId,
      title: s("Title"),
      artist: s("ArtistName"),
      album: s("AlbumName"),
      genre: s("GenreName"),
      key: s("KeyName"),
      bpm,
      year,
      label: s("LabelName"),
      comment: s("Commnt"),
      metadata: m,
    };
  } catch {
    return null;
  }
}

/** LIVE ground truth — null on missing/unreadable, never a throw. */
function readFileTags(filePath: string | null): ArchiveTrackTagCompare["file"] {
  if (!filePath) return null;
  try {
    const g = groundTruth(filePath);
    return {
      readable: true,
      title: g.title,
      artist: g.artist,
      genre: g.genre,
      year: g.year,
      bpm: g.bpm,
      key: g.key,
      label: g.label,
      mixName: g.mixName,
      remixer: g.remixer,
      energy: g.energy,
      mood: g.mood,
      comment: g.comment,
      art: g.art,
    };
  } catch {
    return null; // unreadable file → the mirror views stand alone
  }
}

/** Headline difference check: push the field when the three-way values
 *  disagree (trim-equal strings are equal). */
function makeDifferFn(
  diffs: ArchiveTrackTagCompare["differences"],
): (field: string, vals: (string | number | null)[]) => void {
  return (field, vals) => {
    const present = vals.filter((v) => v !== null);
    const allSame =
      present.length < 2 ||
      present.every((v) =>
        typeof v === "string"
          ? (present[0] as string).trim().toLowerCase() ===
            (v as string).trim().toLowerCase()
          : v === present[0],
      );
    if (!allSame)
      diffs.push({
        field,
        file: vals[0] ?? null,
        archive: vals[1] ?? null,
        rekordbox: vals[2] ?? null,
      });
  };
}

/** The three-way comparison fields: [field name, file, archive, rb].
 *  The remixer value is special — the RB side keeps it in metadata, not
 *  a top-level mirror column — so it carries its own getter. Data-driven:
 *  the diff loop walks this table, so a new compared field is one row,
 *  not another hand-copied push line. */
type CompareTrio = [
  file: string | number | null,
  archive: string | number | null,
  rekordbox: string | number | null,
];

function compareFields(
  t: {
    title: string | null;
    artist: string | null;
    genre: string | null;
    archive_key: string | null;
    bpm_folded: number | null;
  },
  file: NonNullable<ArchiveTrackTagCompare["file"]> | null,
  rekordbox: NonNullable<ArchiveTrackTagCompare["rekordbox"]> | null,
): [string, CompareTrio][] {
  const rbRemixer =
    rekordbox === null
      ? null
      : ((rekordbox.metadata["RemixerName"] as string | null) ?? null);
  return [
    ["title", [file?.title ?? null, t.title, rekordbox?.title ?? null]],
    ["artist", [file?.artist ?? null, t.artist, rekordbox?.artist ?? null]],
    ["genre", [file?.genre ?? null, t.genre, rekordbox?.genre ?? null]],
    ["key", [file?.key ?? null, t.archive_key, rekordbox?.key ?? null]],
    ["bpm", [file?.bpm ?? null, t.bpm_folded, rekordbox?.bpm ?? null]],
    ["year", [file?.year ?? null, null, rekordbox?.year ?? null]],
    ["label", [file?.label ?? null, null, rekordbox?.label ?? null]],
    ["mix", [file?.mixName ?? null, null, null]],
    ["remixer", [file?.remixer ?? null, null, rbRemixer]],
  ];
}

/** Three-source read of ONE track. The file is read LIVE (ground truth:
 *  one ffprobe+mutagen read per request); mirrors come from the DBs. */
export function trackTagCompare(
  reader: ArchiveQuery,
  videoId: string,
): ArchiveTrackTagCompare {
  const base: ArchiveTrackTagCompare = {
    available: reader.available(),
    videoId,
    title: null,
    artist: null,
    album: null,
    file: null,
    pipeline: {
      genre: null,
      genreFlag: null,
      energy: null,
      bpmFolded: null,
      key: null,
      valence: null,
      arousal: null,
      analyzedAt: null,
    },
    rekordbox: null,
    differences: [],
  };
  if (!reader.available()) return base;

  const t = reader.row<{
    title: string | null;
    artist: string | null;
    album: string | null;
    genre: string | null;
    genre_flag: string | null;
    energy: number | null;
    file_path: string | null;
    bpm_folded: number | null;
    archive_key: string | null;
    valence: number | null;
    arousal: number | null;
    analyzed_at: string | null;
  }>(
    `SELECT t.title, t.artist, t.album, t.genre, t.genre_flag, t.energy,
       t.file_path, b.bpm_folded, k.key AS archive_key,
       m.valence, m.arousal, m.analyzed_at
     FROM tracks t
     LEFT JOIN beats b ON b.video_id = t.video_id
     LEFT JOIN track_keys k ON k.video_id = t.video_id
     LEFT JOIN mood m ON m.video_id = t.video_id
     WHERE t.video_id = ?`,
    videoId,
  );
  if (!t) return base;

  const rekordbox = readRekordboxMirror(reader, videoId);
  const file = readFileTags(t.file_path);

  const pipeline = {
    genre: t.genre,
    genreFlag: t.genre_flag,
    energy: t.energy,
    bpmFolded: t.bpm_folded,
    key: t.archive_key,
    valence: t.valence,
    arousal: t.arousal,
    analyzedAt: t.analyzed_at,
  };

  // headline differences: three-way where possible (file wins truth;
  // file-vs-archive and file-vs-rb and archive-vs-rb are all checked
  // through the same trim-equal rule)
  const diffs: ArchiveTrackTagCompare["differences"] = [];
  const push = makeDifferFn(diffs);
  for (const [field, vals] of compareFields(t, file, rekordbox)) {
    push(field, vals);
  }

  return {
    available: true,
    videoId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    file,
    pipeline,
    rekordbox,
    differences: diffs,
  };
}
