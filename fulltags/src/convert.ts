/**
 * FullTags convert — WAV → AIFF lossless conversion for rekordbox covers.
 * Migrated from src/commands/wav-to-aiff.ts, then FIXED (Sep 10 2026):
 *
 * Why: rekordbox cannot read embedded artwork from WAV files (RIFF INFO has
 * no art field; the ID3 APIC chunk is ignored). AIFF is the same lossless
 * PCM audio and rekordbox reads ID3v2 embedded art from AIFF natively.
 *
 * Two-step: (1) ffmpeg re-maps the PCM into the AIFF's REQUIRED big-endian
 * layout (pcm_s16be/pcm_s24be — the sample VALUES are identical, this is a
 * container-level byte-order fix, not a re-encode); (2) mutagen copies
 * every ID3 frame from the WAV into the AIFF.
 *
 * TRAP (encoded by the -c:a pcm_sNNbe choice): `-c:a copy` of little-
 * endian PCM (every WAV is LE) makes ffmpeg's aiff muxer emit a
 * MALFORMED file — 24-byte AIFC-style COMM chunk (sowt/compression-type
 * tail) inside a FORM declared as plain `AIFF`. Strict parsers reject it:
 * ffprobe says `could not find COMM tag or invalid block_align value`,
 * and booth hardware chokes the same way. BE re-mapping yields the spec
 * 18-byte COMM and plays everywhere. Found via the Sep 9 2026 dump
 * (Chicane Offshore) when ingest crashed on its own converted file.
 *
 * Docs: docs/rekordbox-wav-artwork.md
 */
import { $ } from "bun";
import { basename, dirname, join } from "node:path";

/** Pick the big-endian PCM target codec from the source WAV's stream.
 * 16-bit → pcm_s16be, 24-bit → pcm_s24be (32-bit float/int sources are
 * floored to 24-bit — inside every player's envelope, lossless vs their
 * real content is not possible in AIFF anyway). Null on probe failure —
 * the caller falls back to pcm_s16be. */
async function sourcePcmCodec(wavPath: string): Promise<string | null> {
  const pr =
    await $`ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 ${wavPath}`
      .quiet()
      .nothrow();
  if (pr.exitCode !== 0) return null;
  const codec = pr.stdout.toString().trim();
  if (codec === "pcm_s24le" || codec === "pcm_s32le" || codec === "pcm_f32le")
    return "pcm_s24be";
  return "pcm_s16be";
}

/** Convert a .wav to .aiff in place (BE re-map + full ID3 frame copy,
 * artwork included). Returns the AIFF path on success, null on failure
 * (caller keeps the WAV and proceeds normally). */
export async function wavToAiff(wavPath: string): Promise<string | null> {
  if (!wavPath.toLowerCase().endsWith(".wav")) return null;
  let aiffPath = wavPath.replace(/\.wav$/i, ".aiff");
  // Never clobber an existing AIFF: a same-named file may be a previous
  // conversion, or an entirely different track. Disambiguate instead.
  if (await Bun.file(aiffPath).exists()) {
    const ext = ".aiff";
    const stem = basename(aiffPath, ext);
    let n = 1;
    do {
      aiffPath = `${join(dirname(wavPath), `${stem} [wavconv-${n++}]`)}${ext}`;
    } while (await Bun.file(aiffPath).exists());
  }
  // Big-endian re-map, NOT -c:a copy: LE PCM stream-copied into the aiff
  // muxer produces a malformed AIFC-COMM inside an AIFF FORM (see header
  // comment) — strict parsers and booth players reject it. pcm_sNNbe
  // swaps the container byte order; the decoded samples are identical.
  // Bit depth follows the source: s16 for 16-bit-and-under, s24 for
  // 24-bit sources (s32 is outside the players' 24-bit envelope).
  const codec = await sourcePcmCodec(wavPath);
  const target = codec ?? "pcm_s16be"; // unknown → safest common floor
  const proc =
    await $`ffmpeg -y -hide_banner -loglevel error -i ${wavPath} -map 0:a -c:a ${target} ${aiffPath}`
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
    // `is None`, NOT falsy: a fresh ffmpeg AIFF carries an EMPTY ID3
    // chunk — frameless _IFFID3 is falsy, and add_tags() on an existing
    // chunk throws `an ID3 tag already exists`.
    "if dst.tags is None: dst.add_tags()",
    "if dst.tags: dst.delete()",
    "for f in frames: dst.tags.add(f)",
    // v2_version=3: mutagen's default save() on an AIFF whose source WAV
    // carried a v2.4 tag re-writes it as ID3v2.4 — and the Sep 11 pool
    // batch proved a v2.4 tag on these files can corrupt the container
    // walk (InvalidChunk 'ID3\\x04'). v2.3 is the writer's house format
    // everywhere else; keep the conversion on it too.
    "dst.save(v2_version=3)",
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
  // ALSO: the output must ffprobe as VALID — this is the gate that would
  // have caught the malformed AIFC-COMM output (see header) had it existed
  // when the converter was written.
  const [w, a] = await Promise.all([
    Bun.file(wavPath).stat(),
    Bun.file(aiffPath).stat(),
  ]);
  if (!a || !w || a.size < w.size * 0.5) {
    await $`rm -f ${aiffPath}`.quiet().nothrow();
    return null;
  }
  const check =
    await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${aiffPath}`
      .quiet()
      .nothrow();
  if (check.exitCode !== 0 || !check.stdout.toString().trim()) {
    await $`rm -f ${aiffPath}`.quiet().nothrow();
    return null;
  }
  // mutagen-level validity gate: a FORM walk must succeed. This is the
  // check that catches the Sep 11 header-destroyed outputs (file began
  // with a raw ID3 chunk — ffprobe tolerated it, mutagen did not).
  const walk = [
    "from mutagen.aiff import AIFF",
    `AIFF(${JSON.stringify(aiffPath)})`,
    'print("ok")',
  ].join("\n");
  const wv = await $`uv run --with mutagen python -c ${walk}`.quiet().nothrow();
  if (wv.exitCode !== 0 || !wv.stdout.toString().trim().includes("ok")) {
    await $`rm -f ${aiffPath}`.quiet().nothrow();
    return null;
  }
  await $`rm -f ${wavPath}`.quiet().nothrow();
  return aiffPath;
}
