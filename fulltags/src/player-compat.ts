/**
 * FullTags player-compat — the Pioneer playback-compatibility gate.
 *
 * Every file that enters the archive must PLAY on the whole booth fleet:
 * XDJ-XZ, CDJ-3000, CDJ-2000NXS2, and the original CDJ-2000. Specs are
 * from Pioneer's official documentation (pioneerdj.com product pages +
 * the printed manuals); the gate enforces the INTERSECTION ("strictest
 * fleet floor"), not the union — a file the XDJ-XZ rejects is a failed
 * set no matter what the CDJ-3000 can do.
 *
 * The traps this encodes (all four players reject unless noted):
 *  - 32-bit (int or float) PCM WAV — DAW exports (Ableton/Logic). The
 *    float variant is the classic "why won't the CDJ load my bounce".
 *  - 88.2/96 kHz lossless — rejected by XDJ-XZ (48 kHz cap) and CDJ-2000.
 *  - FLAC / ALAC — rejected by the plain CDJ-2000 (no FLAC) and the
 *    XDJ-XZ (no ALAC; FLAC needs firmware ≥1.10).
 *  - ADPCM / compressed WAV ("WAV" ≠ always PCM) — rejected everywhere.
 *  - MPEG-2/2.5 low-sample-rate MP3 (16/22.05/24 kHz rips) — outside the
 *    XDJ-XZ's MPEG-1 Layer-3 envelope; MPEG-2 is CDJ-2000-only territory.
 *
 * Audio compat is NOT art compat: WAV plays everywhere but its art is
 * unreadable (RIFF has no art field) — that stays wavToAiff's job. This
 * module answers "will it PLAY"; convert.ts answers "will it SHOW".
 */
import type { Probe } from "./probes";
import { resolveFleet, DEFAULT_FLEET, fleetFloor } from "./fleet";
import type { FleetProfile } from "./fleet";
/** The configured booth fleet (player ids) — set once by the entrypoint
 *  from config.toml [booth].fleet; defaults to the three always-on
 *  players. Both gates (playerCompat + boothTextCompat) read this, so
 *  the selection reflects everywhere the user actually plays. */
let configuredFleet: readonly string[] = DEFAULT_FLEET;

export function setBoothFleet(ids: readonly string[]): void {
  configuredFleet = ids;
}

export function getBoothFleet(): readonly string[] {
  return configuredFleet;
}

/** Resolved profiles for the current fleet selection. */
export function boothFleetProfiles(): FleetProfile[] {
  return resolveFleet(configuredFleet);
}

/** Lossless PCM codecs (uncompressed, per ffprobe codec_name). */
const PCM_CODECS = new Set([
  "pcm_s16le",
  "pcm_s16be",
  "pcm_s24le",
  "pcm_s24be",
  "pcm_s32le",
  "pcm_s32be",
  "pcm_f32le",
  "pcm_f32be",
  "pcm_f64le",
  "pcm_f64be",
  "pcm_u8",
]);

/** Sample rates the hi-res players add on top (CDJ-3000, CDJ-2000NXS2).
 * The every-player set (44.1/48 kHz) is implicit — a probe below it never
 * produces a sample-rate reason. */
export const HIRES_SAMPLE_RATES = new Set([88200, 96000]);

/** The fleet-floor verdict for one probed file. */
export interface CompatResult {
  /** Plays on the whole fleet (XDJ-XZ + 3000 + 2000NXS2 + 2000). */
  ok: boolean;
  /** Short machine reason(s) — stable identifiers for tests/JSON. */
  reasons: string[];
  /** Human sentence for logs/audit output. */
  detail: string;
  /** True when the file plays on SOME fleet players but not all. */
  partial?: boolean;
}

function mp3Reason(sampleRate: number | null): string | null {
  if (sampleRate === null) return null;
  // MPEG-1 Layer 3 is the universally-supported MP3 flavour.
  if ([44100, 48000, 32000].includes(sampleRate)) return null;
  // 16/22.05/24 kHz = MPEG-2 Layer 3 rips (voice memos, legacy rips).
  return "mp3-mpeg2-unsupported";
}

/**
 * Check a probed file against the strictest-fleet playback floor.
 * `probe` is FullTags' shared ffprobe shape (probeFile) so ingest/audit
 * callers pass what they already have. Note: ffprobe does not surface
 * AIFF-C (compressed AIFF) distinctly for our needs — AIFF from any
 * normal encoder is AIFF-C-sound (big-endian PCM) and plays fine; the
 * known hardware killers are the ones enumerated below.
 */
export function playerCompat(probe: Probe): CompatResult {
  const reasons: string[] = [];
  const codec = probe.codec ?? null;
  const rate = probe.sampleRate;
  // The floor is the fleet intersection: with the default trio (XZ +
  // 3000 + NXS2) hi-res stays "partial"; add CDJ-2000 and FLAC/hi-res
  // become hard fails; drop the XZ and 96 kHz passes everywhere.
  const floor = fleetFloor(boothFleetProfiles());

  // Container/codec gate. By the time a file reaches the archive it is
  // one of .wav/.aiff/.mp3/.flac/.m4a (FullTags walker's set), so this
  // keys off the ffprobe codec inside the container, not the extension.
  const fleetSampleRates = new Set<number>([44100, 48000, 32000]);
  if (floor.maxSampleRate >= 88200) {
    fleetSampleRates.add(88200);
    fleetSampleRates.add(96000);
  }
  if (codec === "mp3") {
    const mp2 = mp3Reason(rate);
    if (mp2) reasons.push(mp2);
  } else if (codec === "aac") {
    // HE-AAC (SBR) is rejected by the players even in .m4a; LC is fine.
    // ffprobe reports profile via a different field — Probe carries only
    // codec_name, so anything Probe calls "aac" we treat as LC (ingest
    // sources never produce HE-AAC) but flag ultra-low rates.
    if (rate !== null && !fleetSampleRates.has(rate) && rate < 88200) {
      reasons.push("aac-sample-rate-unsupported");
    }
  } else if (codec && PCM_CODECS.has(codec)) {
    if (codec.includes("f32") || codec.includes("f64")) {
      reasons.push("float-pcm-unsupported");
    } else if (codec.includes("s32") || codec === "pcm_u8") {
      reasons.push("bit-depth-unsupported");
    } else if (rate !== null && !fleetSampleRates.has(rate)) {
      // 16/24-bit PCM at 88.2/96 — plays on the hi-res players only.
      reasons.push(
        HIRES_SAMPLE_RATES.has(rate)
          ? "sample-rate-hires"
          : "sample-rate-unsupported",
      );
    }
  } else if (codec === "flac") {
    if (rate !== null && !fleetSampleRates.has(rate)) {
      reasons.push(
        HIRES_SAMPLE_RATES.has(rate)
          ? "sample-rate-hires"
          : "sample-rate-unsupported",
      );
    }
    // FLAC is only universal when EVERY selected player takes it
    // (the plain CDJ-2000 never does).
    if (!floor.flac) reasons.push("flac-not-universal");
  } else if (codec === "alac") {
    if (!floor.alac) reasons.push("alac-not-universal"); // no player takes ALAC
  } else if (codec && (codec.startsWith("adpcm") || codec.includes("_at3"))) {
    reasons.push("compressed-wav-unsupported");
  } else if (!codec) {
    reasons.push("no-audio-stream");
  }

  const partial =
    reasons.length > 0 &&
    reasons.every((r) =>
      [
        "sample-rate-hires",
        "flac-not-universal",
        "alac-not-universal",
      ].includes(r),
    );

  return {
    ok: reasons.length === 0,
    reasons,
    detail: reasons.length
      ? `${codec ?? "unknown"} @ ${rate ?? "?"}Hz: ${reasons.join(", ")}`
      : `${codec} @ ${rate}Hz — plays on the whole booth fleet`,
    partial,
  };
}

/** Non-fatal when true: plays on the hi-res players, not the whole fleet. */
export function isHiresOnly(r: CompatResult): boolean {
  return r.partial === true;
}
