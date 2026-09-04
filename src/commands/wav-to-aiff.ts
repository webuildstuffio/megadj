/**
 * WAV → AIFF lossless conversion for rekordbox compatibility.
 *
 * Why: rekordbox cannot read embedded artwork from WAV files (RIFF INFO has
 * no art field; the ID3 APIC chunk is ignored). AIFF is the same lossless
 * PCM audio and rekordbox reads ID3v2 embedded art from AIFF natively.
 * Converting at ingest means every future WAV arrives AIFF with working
 * covers in rekordbox + CDJs/XDJ — zero DB surgery, zero manual art drags.
 *
 * Two-step because ffmpeg's aiff muxer DROPS the WAV's ID3 chunk (title
 * becomes an annotation; artist/APIC are lost — verified empirically):
 *  1. ffmpeg stream-copies the audio (`-c:a copy`, bit-identical PCM).
 *  2. mutagen copies every ID3 frame (TIT2/TPE1/APIC/…) from the WAV's
 *     ID3 chunk into a fresh ID3 chunk on the AIFF.
 *
 * Docs: docs/rekordbox-wav-artwork.md (Option B — chosen for future ingests)
 */
import { $ } from "bun";

/** Convert a .wav to .aiff in place (stream copy + full ID3 frame copy,
 * artwork included). Returns the AIFF path on success, null on failure
 * (caller keeps the WAV and proceeds normally). */
export async function wavToAiff(wavPath: string): Promise<string | null> {
  if (!wavPath.toLowerCase().endsWith(".wav")) return null;
  const aiffPath = wavPath.replace(/\.wav$/i, ".aiff");
  const proc =
    await $`ffmpeg -y -hide_banner -loglevel error -i ${wavPath} -map 0:a -c:a copy ${aiffPath}`
      .quiet()
      .nothrow();
  if (proc.exitCode !== 0) {
    await $`rm -f ${aiffPath}`.quiet().nothrow();
    return null;
  }
  // mutagen: copy all ID3 frames (title, artist, APIC art, …) onto the AIFF
  const script = [
    "from mutagen.wave import WAVE",
    "from mutagen.aiff import AIFF",
    `src = WAVE(${JSON.stringify(wavPath)})`,
    "frames = list(src.tags.values()) if src.tags else []",
    `dst = AIFF(${JSON.stringify(aiffPath)})`,
    "if dst.tags: dst.delete()",
    "dst.add_tags()",
    "for f in frames: dst.tags.add(f)",
    "dst.save()",
    'print("ok")',
  ].join("\n");
  const py = await $`uv run --with mutagen python -c ${script}`
    .quiet()
    .nothrow();
  if (py.exitCode !== 0 || !py.stdout.toString().trim().includes("ok")) {
    await $`rm -f ${aiffPath}`.quiet().nothrow();
    return null;
  }
  // Sanity: AIFF must be ≈ WAV size (headers differ by bytes); a tiny file
  // means ffmpeg/mutagen silently produced garbage — bail out, keep WAV.
  const [w, a] = await Promise.all([
    Bun.file(wavPath).stat(),
    Bun.file(aiffPath).stat(),
  ]);
  if (!a || a.size < w.size * 0.5) {
    await $`rm -f ${aiffPath}`.quiet().nothrow();
    return null;
  }
  await $`rm -f ${wavPath}`.quiet().nothrow();
  return aiffPath;
}
