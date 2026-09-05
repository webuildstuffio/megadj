/**
 * Test helper: read any TXXX/freeform/vorbis stamp by description via the
 * same mutagen path the pipeline's idempotency checks use (mirrors
 * readTxxx in src/pipeline.ts for the container formats the archive
 * carries: mp3/wav/aiff/m4a/flac).
 */
const SCRIPT_HEAD = `import json
p = `;
const SCRIPT_TAIL = `
wanted = __DESCS__
vals = {d: None for d in wanted}
try:
    if p.lower().endswith((".m4a", ".m4b")):
        from mutagen.mp4 import MP4
        a = MP4(p)
        tags = a.tags
        if tags is not None:
            for key, v in tags.items():
                if not key.startswith("----:"):
                    continue
                d = key.rsplit(":", 1)[-1]
                if d in vals and vals[d] is None:
                    try:
                        vals[d] = bytes(v[0]).decode("utf-8")
                    except Exception:
                        pass
    elif p.lower().endswith(".flac"):
        from mutagen.flac import FLAC
        a = FLAC(p)
        if a.tags is not None:
            upper = {k.upper(): k for k in a.tags.keys()}
            for d in wanted:
                k = upper.get(d.upper())
                if k is not None and vals[d] is None:
                    v = a.tags.get(k)
                    vals[d] = str(v[0]) if isinstance(v, list) and v else str(v)
    else:
        from mutagen.mp3 import MP3
        from mutagen.wave import WAVE
        from mutagen.aiff import AIFF
        if p.lower().endswith(".wav"):
            a = WAVE(p)
        elif p.lower().endswith((".aiff", ".aif")):
            a = AIFF(p)
        else:
            a = MP3(p)
        tags = a.tags
        if tags is not None:
            for k in tags.keys():
                if k.startswith("TXXX"):
                    fr = tags.get(k)
                    if getattr(fr, "desc", "") in vals and vals[fr.desc] is None:
                        vals[fr.desc] = str(fr.text[0])
except Exception:
    pass
print(json.dumps(vals))`;

/** Read one stamp by description. Null when absent/unreadable. */
export function readStampGuard(p: string, desc: string): string | null {
  const script = SCRIPT_HEAD + JSON.stringify(p) + SCRIPT_TAIL.replace("__DESCS__", JSON.stringify([desc]));
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  try {
    const last = new TextDecoder().decode(pr.stdout).trim().split("\n").at(-1);
    if (!last) return null;
    const j = JSON.parse(last) as Record<string, string | null>;
    return j[desc] ?? null;
  } catch {
    return null;
  }
}
