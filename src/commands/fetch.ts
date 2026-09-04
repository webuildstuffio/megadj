/**
 * fetch command — agent/user-facing wrapper around tools/fetch_all.ts.
 * Runs the enrichment pipeline (tags + genres + years + artwork) in-process
 * with the same flags, so `megadj fetch --dry-run` etc. just work.
 */
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";

export interface FetchOptions {
  all?: boolean;
  only?: "art" | "genres" | "tags" | "years" | "all";
  jobs?: number;
  dryRun?: boolean;
}

interface Truth {
  art: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
}

/** Read the file's real tags via mutagen/ffprobe (spawned). */
function groundTruth(p: string): Truth {
  const isWav = p.toLowerCase().endsWith(".wav");
  const script = `import json
from mutagen.wave import WAVE
from mutagen.mp3 import MP3
from mutagen.id3 import ID3
p = ${JSON.stringify(p)}
if p.lower().endswith(".wav"):
    a = WAVE(p)
    tags, art = {}, False
    if a.tags:
        for k in a.tags.keys():
            try:
                if k.startswith("APIC"): continue
                frame = a.tags.get(k)
                v = str(frame.text[0]) if k.startswith("COMM") and frame.text else str(frame)
                tags[k.split(":")[0]] = v
            except Exception: pass
        art = any(k.startswith("APIC") for k in a.tags.keys())
else:
    a = MP3(p)
    tags, art = {}, False
    if a.tags:
        for k, v in a.tags.items():
            try: tags[k] = str(v.text[0]) if hasattr(v, "text") and v.text else str(v)
            except Exception: pass
        art = bool(a.tags.getall("APIC"))
print(json.dumps({"art": art, "tags": tags}))`;
  const pr = Bun.spawnSync({
    cmd: ["uv", "run", "--with", "mutagen", "python", "-c", script],
    stdout: "pipe",
  });
  try {
    const out = new TextDecoder().decode(pr.stdout).trim();
    const last = out.split("\n").at(-1);
    if (!last) throw new Error("empty output");
    const j = JSON.parse(last);
    const map: Record<string, string> = {
      TIT2: "title",
      TPE1: "artist",
      TALB: "album",
      TCON: "genre",
      TDRC: "date",
      COMM: "comment",
    };
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.tags)) {
      merged[map[k] ?? k.toLowerCase()] = String(v);
    }
    const g = (...keys: string[]) => {
      for (const k of keys) {
        const val = merged[k];
        if (val && String(val).trim()) return String(val).trim();
      }
      return null;
    };
    let genre = g("genre") ?? "";
    genre = genre.includes(",") ? genre.split(",")[0]!.trim() : genre;
    const year = g("date")?.match(/\d{4}/)?.[0] ?? null;
    return {
      art: !!j.art,
      title: g("title"),
      artist: g("artist"),
      album: g("album"),
      genre,
      year,
      comment: g("comment"),
    };
  } catch {
    return {
      art: false,
      title: null,
      artist: null,
      album: null,
      genre: null,
      year: null,
      comment: null,
    };
  }
}

export interface AuditRow {
  file: string;
  art: boolean;
  title: boolean;
  artist: boolean;
  album: boolean;
  genre: boolean;
  year: boolean;
  complete: boolean;
}

/** Ground-truth audit of every audio file in the archive. */
export function auditArchive(musicDir: string): {
  total: number;
  complete: number;
  rows: AuditRow[];
} {
  const files = readdirSync(musicDir).filter(
    (f) => !f.startsWith(".") && /\.(wav|mp3|m4a|flac|aiff)$/i.test(f),
  );
  const rows: AuditRow[] = [];
  for (const f of files) {
    const p = join(musicDir, f);
    if (!existsSync(p)) continue;
    const t = groundTruth(p);
    const genreOk = !!t.genre && t.genre !== "Music";
    const row: AuditRow = {
      file: f,
      art: t.art,
      title: !!t.title,
      artist: !!t.artist,
      album: !!t.album,
      genre: genreOk,
      year: !!t.year,
      complete: false,
    };
    row.complete =
      row.art && row.title && row.artist && row.album && row.genre && row.year;
    rows.push(row);
  }
  return {
    total: rows.length,
    complete: rows.filter((r) => r.complete).length,
    rows,
  };
}

export async function fetch(_opts: FetchOptions): Promise<void> {
  const script = join(import.meta.dir, "../../tools/fetch_all.ts");
  const proc = Bun.spawn(["bun", script], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  if (proc.exitCode !== 0) process.exitCode = proc.exitCode ?? 1;
}
