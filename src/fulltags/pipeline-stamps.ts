/**
 * FullTags pipeline — stamp half (#90 diet): the mutagen TXXX readers
 * that make every analysis stage idempotent (an existing stamp means a
 * re-run skips the stage instead of rewriting the container), plus the
 * MOOD stamp round-trip parser.
 *
 * Idempotency contract: energy/fingerprint/key/mood probes call
 * `readStamp` before doing work; the REGRESSION NOTE in readTxxx is the
 * reason WAV/AIFF stamps are read at all (the original branches opened
 * the file and read NOTHING, so re-runs rewrote 73 archive WAVs forever).
 */
import type { MoodResult } from "./analysis/models";
import { mutagenJson } from "./write/mutagen";

/**
 * Read TXXX frames (mutagen) in one spawn: pass descriptions, get values.
 * Shared by the energy stamp and AI-provenance reads — same format
 * dispatch, one python script, never throws.
 */
export function readTxxx(
  p: string,
  descs: string[],
): Record<string, string | null> {
  const script = `import json
p = ${JSON.stringify(p)}
wanted = ${JSON.stringify(descs)}
vals = {d: None for d in wanted}
try:
    a = None
    if p.lower().endswith(".wav"):
        from mutagen.wave import WAVE
        a = WAVE(p)
    elif p.lower().endswith((".aiff", ".aif")):
        from mutagen.aiff import AIFF
        a = AIFF(p)
    elif p.lower().endswith((".m4a", ".m4b")):
        from mutagen.mp4 import MP4
        a = MP4(p)
        tags = a.tags
        if tags is not None:
            for key, v in tags.items():
                if not key.startswith("----:"):
                    continue
                desc = key.rsplit(":", 1)[-1]
                if desc in vals and vals[desc] is None:
                    try:
                        vals[desc] = bytes(v[0]).decode("utf-8")
                    except Exception:
                        pass
    elif p.lower().endswith(".flac"):
        from mutagen.flac import FLAC
        a = FLAC(p)
        tags = a.tags
        if tags is not None:
            # ffmpeg writes these as Vorbis comments in lowercase
            # (energy=6), never TXXX — match keys case-insensitively
            # and unwrap the single-element list mutagen returns.
            upper = {k.upper(): k for k in tags.keys()}
            for d in wanted:
                k = upper.get(d.upper())
                if k is not None and vals[d] is None:
                    v = tags.get(k)
                    vals[d] = str(v[0]) if isinstance(v, list) and v else str(v)
    else:
        from mutagen.mp3 import MP3
        a = MP3(p)
    # ID3-family containers (WAV RIFF/INFO:ID3 chunk, AIFF ID3 chunk, MP3):
    # all expose a.tags as an ID3 dict with TXXX frames keyed by desc.
    # REGRESSION NOTE: the WAV/AIFF branches used to open the file and read
    # NOTHING — every stamp probe (ACOUSTID/CAMELOT/ENERGY/AI-*) returned
    # null on 73 archive WAVs, so fingerprint/key/energy re-runs rewrote
    # all of them forever (idempotency was mp3/flac/m4a-only).
    if a is not None and getattr(a, "tags", None) is not None:
        tags = a.tags
        try:
            for k in tags.keys():
                if str(k).startswith("TXXX"):
                    desc = getattr(tags.get(k), "desc", "")
                    if desc in vals and vals[desc] is None:
                        vals[desc] = str(tags.get(k).text[0])
        except Exception:
            pass
except Exception:
    pass
print(json.dumps(vals))`;
  return mutagenJson<Record<string, string | null>>(
    script,
    Object.fromEntries(descs.map((d) => [d, null])),
  );
}

/** Read the TXXX:ENERGY stamp (mutagen) — null when absent. */
export function readEnergyStamp(p: string): number | null {
  const { ENERGY: v } = readTxxx(p, ["ENERGY"]);
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Generic stamp read: any TXXX/freeform/vorbis stamp by description
 * (ACOUSTID, CAMELOT, …). Null when absent. */
export function readStamp(p: string, desc: string): string | null {
  const out = readTxxx(p, [desc]);
  return out[desc] ?? null;
}

/** AI provenance stamps on a file: {aiGenre, aiYear} = "value|confidence",
 * null when not AI-filled (mutagen TXXX read; never throws). */
export function readAiStamps(p: string): {
  aiGenre: string | null;
  aiYear: string | null;
} {
  const { "AI-GENRE": genre, "AI-YEAR": year } = readTxxx(p, [
    "AI-GENRE",
    "AI-YEAR",
  ]);
  return { aiGenre: genre ?? null, aiYear: year ?? null };
}

/** Parse a TXXX:MOOD stamp ("dance=0.155; …; valence=4.04; arousal=4.61")
 * into a MoodResult. Null when the stamp is malformed. */
export function parseMoodStamp(s: string): MoodResult | null {
  const parts = s
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const kv: Record<string, number> = {};
  for (const p of parts) {
    const m = /^([a-zA-Z]+)=([\d.]+)$/.exec(p);
    if (!m?.[1] || !m[2]) return null;
    kv[m[1].toLowerCase()] = Number(m[2]);
  }
  const need = (k: string, min: number, max: number): number => {
    const v = kv[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      throw new Error(`invalid ${k}`);
    }
    return v;
  };
  try {
    return {
      danceability: need("dance", 0, 1),
      moodAggressive: need("aggressive", 0, 1),
      moodHappy: need("happy", 0, 1),
      moodElectronic: need("electronic", 0, 1),
      moodParty: need("party", 0, 1),
      valence: need("valence", 1, 9),
      arousal: need("arousal", 1, 9),
    };
  } catch {
    return null;
  }
}
