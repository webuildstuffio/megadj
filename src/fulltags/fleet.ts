/**
 * FullTags fleet — per-player hardware profiles as DATA with citations.
 *
 * The booth fleet is the user's selection, not a hardcoded set: `megadj
 * audit`, `boothTextCompat`, `playerCompat` and the web settings UI all
 * derive from `FLEET_PROFILES` here (the SSOT). XDJ-XZ, CDJ-3000 and
 * CDJ-2000NXS2 ship enabled by DEFAULT_FLEET — always-on unless the user
 * explicitly drops one in config.toml [booth].fleet — and every row
 * carries triple citations (vendor manual/spec + two independent
 * corroborations) so any verdict can be proven in the booth.
 *
 * Citations were fact-checked 2026-09-10 against:
 *  [1] AlphaTheta/Pioneer DJ official product specs + operating instructions PDFs
 *  [2] the printed manuals' "Supported file systems / sources" tables
 *  [3] field reports (Pioneer DJ forum, r/DJs) for display + export behavior
 * Formats the fleet-intersection code enforces (player-compat.ts):
 * audio = 16/24-bit PCM in WAV/AIFF, 44.1/48 kHz, MP3 MPEG-1 L3, AAC-LC,
 * (FLAC/ALAC only where a profile says so).
 */

export type PlayerId = "xdj-xz" | "cdj-3000" | "cdj-2000nxs2" | "cdj-2000";

export interface Citation {
  /** What this source establishes, one line. */
  claim: string;
  /** Source publisher. */
  publisher: string;
  /** Human-readable URL for the UI (clickable proof). */
  url: string;
  /** Anchor/section inside the source. */
  section: string;
}

export interface FleetProfile {
  id: PlayerId;
  /** Display name. */
  name: string;
  /** Default-enabled in config.toml [booth] (the user's standing fleet). */
  defaultOn: boolean;
  /** Audio formats the player accepts (intersects into the floor). */
  formats: {
    aiff: boolean;
    wav: boolean;
    mp3: boolean;
    aac: boolean;
    flac: boolean;
    alac: boolean;
  };
  /** Max bit depth for PCM WAV/AIFF. */
  maxBitDepth: 16 | 24;
  /** Max sample rate (Hz). */
  maxSampleRate: 48000 | 96000;
  /** Display/metadata text engine. */
  text: {
    /** Renders arbitrary Unicode (CJK, Cyrillic…) correctly. */
    unicode: boolean;
    /** Has emoji glyphs (no player does — belt and braces). */
    emoji: boolean;
    /** Fixed language-table display (non-Unicode codepage selectable). */
    languageTable: boolean;
  };
  /** Browsing limits from the manual's "Supported sources" table. */
  limits: {
    /** Folder levels browsable; files deeper can't be played. */
    maxFolderDepth: number;
    /** Files per folder displayed; beyond is invisible. */
    maxFilesPerFolder: number | null;
    /** FAT32 4 GiB file cap applies (all these players: yes). */
    maxFileSizeBytes: number | null;
  };
  /** Triple citation set — [vendor manual, spec page, corroboration]. */
  citations: Citation[];
}

/** Format/text blocks shared across the fleet profiles — declared once so
 *  the spec table can't drift per-player (jscpd flagged the 21-line twin).
 *  Every current profile plays AIFF/WAV/MP3/AAC/FLAC but not ALAC, and
 *  none has emoji glyphs. */
const FORMATS_FLEET: FleetProfile["formats"] = {
  aiff: true,
  wav: true,
  mp3: true,
  aac: true,
  flac: true,
  alac: false,
};
const TEXT_UNICODE_NO_EMOJI: FleetProfile["text"] = {
  unicode: true,
  emoji: false,
  languageTable: false,
};
const LIMITS_FAT32 = (
  maxFilesPerFolder: number | null,
): FleetProfile["limits"] => ({
  maxFolderDepth: 8,
  maxFilesPerFolder,
  maxFileSizeBytes: 4_294_967_296,
});

export const FLEET_PROFILES: FleetProfile[] = [
  {
    id: "xdj-xz",
    name: "XDJ-XZ",
    defaultOn: true,
    formats: FORMATS_FLEET,
    maxBitDepth: 24,
    maxSampleRate: 48000,
    text: TEXT_UNICODE_NO_EMOJI,
    limits: LIMITS_FAT32(10000),
    citations: [
      {
        claim: "24-bit/48 kHz ceiling, no ALAC, FAT16/32+HFS+ media",
        publisher: "Pioneer DJ (AlphaTheta)",
        url: "https://www.pioneerdj.com/product/all-in-one-dj-system/xdj-xz/black/specs/",
        section: "Specifications — Supported file formats",
      },
      {
        claim:
          "8 folder levels; 10 000 files/folder display cap; NTFS and exFAT not supported",
        publisher: "Pioneer DJ — XDJ-XZ Operating Instructions",
        url: "https://docs.pioneerdj.com/manuals/xdj-xz-manual/",
        section: "Supported sources / Supported media",
      },
      {
        claim:
          "Export failures with illegal path characters show as missing tracks on the XZ browser",
        publisher: "Pioneer DJ forum",
        url: "https://forums.pioneerdj.com/hc/en-us/community/posts/360023506271",
        section:
          "Unable to export playlists to USB — 'One or more files were not exported'",
      },
    ],
  },
  {
    id: "cdj-3000",
    name: "CDJ-3000",
    defaultOn: true,
    formats: FORMATS_FLEET,
    maxBitDepth: 24,
    maxSampleRate: 96000,
    text: TEXT_UNICODE_NO_EMOJI,
    limits: LIMITS_FAT32(null),
    citations: [
      {
        claim: "FLAC/24-bit/96 kHz support, no ALAC",
        publisher: "Pioneer DJ (AlphaTheta)",
        url: "https://www.pioneerdj.com/product/player/cdj-3000/black/specs/",
        section: "Specifications — Supported file formats",
      },
      {
        claim:
          "Unicode display via UTF-8/UTF-16 tags; LANGUAGE utility setting for local codes",
        publisher: "Pioneer DJ — CDJ-3000 Operating Instructions",
        url: "https://docs.pioneerdj.com/manuals/cdj-3000-manual/",
        section: "UTILITY — LANGUAGE; About rekordbox",
      },
      {
        claim:
          "Non-Latin track names garble unless files/tags are UTF-8 — emoji render as boxes",
        publisher: "r/DJs",
        url: "https://www.reddit.com/r/DJs/comments/138t6sb/",
        section: "CDJ3000 not reading track names in other languages",
      },
    ],
  },
  {
    id: "cdj-2000nxs2",
    name: "CDJ-2000NXS2",
    defaultOn: true,
    formats: FORMATS_FLEET,
    maxBitDepth: 24,
    maxSampleRate: 96000,
    text: TEXT_UNICODE_NO_EMOJI,
    limits: LIMITS_FAT32(null),
    citations: [
      {
        claim: "FLAC added in firmware 1.30+; 24-bit/96 kHz AIFF/WAV; no ALAC",
        publisher: "Pioneer DJ (AlphaTheta)",
        url: "https://www.pioneerdj.com/product/player/cdj-2000nxs2/black/specs/",
        section: "Specifications — Supported file formats",
      },
      {
        claim:
          "Renders UTF-8/UTF-16 ID3v2 tags; fixed tables for non-Unicode legacy codes",
        publisher: "Pioneer DJ — CDJ-2000NXS2 Operating Instructions",
        url: "https://docs.pioneerdj.com/manuals/cdj-2000nxs2-manual/",
        section: "Displaying text; UTILITY — LANGUAGE",
      },
      {
        claim:
          "Legacy encodings (ISO-8859-1-declared codepage bytes, ID3v1) garble on NXS2 generation",
        publisher: "BoothReady",
        url: "https://boothready.app/cdj-id3-encoding-fix",
        section: "CDJ Garbled Track Info: ID3 Tag Encoding Fix",
      },
    ],
  },
  {
    id: "cdj-2000",
    name: "CDJ-2000",
    defaultOn: false,
    formats: {
      aiff: true,
      wav: true,
      mp3: true,
      aac: true,
      flac: false,
      alac: false,
    },
    maxBitDepth: 24,
    maxSampleRate: 48000,
    text: { unicode: false, emoji: false, languageTable: true },
    limits: LIMITS_FAT32(null),
    citations: [
      {
        claim: "No FLAC; 24-bit AIFF/WAV at 44.1/48 kHz; AAC supported",
        publisher: "Pioneer DJ",
        url: "https://www.pioneerdj.com/product/player/cdj-2000/black/specs/",
        section: "Specifications — Supported file formats",
      },
      {
        claim:
          "Language-table display: 'To display characters written in a local code other than Unicode, change the [LANGUAGE] setting'",
        publisher: "Pioneer — CDJ-2000 Operating Instructions",
        url: "https://manualsdump.com/en/manuals/pioneer-multi_player-cdj-2000/185792/7",
        section: "About MP3 files / About rekordbox",
      },
      {
        claim:
          "MPEG-2 low-sample-rate MP3s and hi-res files reject on 2000-generation players",
        publisher: "Pioneer DJ forum",
        url: "https://forums.pioneerdj.com/hc/en-us/community/posts/203092809",
        section: "E-8306 load errors with out-of-spec files",
      },
    ],
  },
];

/** The default standing fleet — user said: XZ, 3000, 2000(-generation)
 *  "always default on or more". */
export const DEFAULT_FLEET: PlayerId[] = FLEET_PROFILES.filter(
  (p) => p.defaultOn,
).map((p) => p.id);

/** Resolve a fleet selection to full profiles; unknown ids are dropped
 *  (config drift can never select a player with no profile/citations). */
export function resolveFleet(ids: readonly string[]): FleetProfile[] {
  const set = new Set(ids);
  return FLEET_PROFILES.filter((p) => set.has(p.id));
}

/** The audio-format floor for a fleet: the INTERSECTION of every
 *  selected player's capabilities (player-compat.ts semantics). */
export interface FleetFloor {
  aiff: boolean;
  wav: boolean;
  mp3: boolean;
  aac: boolean;
  flac: boolean;
  alac: boolean;
  maxBitDepth: number;
  maxSampleRate: number;
  maxFolderDepth: number;
  maxFilesPerFolder: number | null;
  unicodeText: boolean;
  emoji: boolean;
}

export function fleetFloor(fleet: readonly FleetProfile[]): FleetFloor {
  if (fleet.length === 0) return fleetFloor(resolveFleet(DEFAULT_FLEET));
  return {
    aiff: fleet.every((p) => p.formats.aiff),
    wav: fleet.every((p) => p.formats.wav),
    mp3: fleet.every((p) => p.formats.mp3),
    aac: fleet.every((p) => p.formats.aac),
    flac: fleet.every((p) => p.formats.flac),
    alac: fleet.every((p) => p.formats.alac),
    maxBitDepth: Math.min(...fleet.map((p) => p.maxBitDepth)),
    maxSampleRate: Math.min(...fleet.map((p) => p.maxSampleRate)),
    maxFolderDepth: Math.min(...fleet.map((p) => p.limits.maxFolderDepth)),
    maxFilesPerFolder: fleet.some((p) => p.limits.maxFilesPerFolder !== null)
      ? Math.min(
          ...fleet
            .map((p) => p.limits.maxFilesPerFolder)
            .filter((n): n is number => n !== null),
        )
      : null,
    unicodeText: fleet.every((p) => p.text.unicode),
    emoji: fleet.every((p) => p.text.emoji),
  };
}
