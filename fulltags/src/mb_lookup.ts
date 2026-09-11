// mb_lookup.ts — the MusicBrainz recording lookup (1 rps, in-process
// cache), split from pipeline.ts at the complexity guard. The wire parse
// (recordings[0] → {title, artist, album, year, mbid}) is one named unit;
// pipeline just calls it.

/** The one-row truth shape an MB hit fills. */
export interface MbTruth {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  mbid: string | null;
}

const mbCache = new Map<string, MbTruth | null>();

/** MusicBrainz recording lookup — fills missing artist/album/date (1 rps). */
export async function mbRecording(
  artist: string | null,
  title: string,
): Promise<{
  artist: string | null;
  album: string | null;
  date: string | null;
  artistTags: string;
  mbid: string | null;
}> {
  const q = artist
    ? `artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"`
    : `recording:"${encodeURIComponent(title)}"`;
  try {
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`,
      {
        headers: {
          "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
        },
      },
    );
    if (!res.ok)
      return {
        artist: null,
        album: null,
        date: null,
        artistTags: "",
        mbid: null,
      };
    const data = (await res.json()) as {
      recordings?: {
        id?: string;
        "artist-credit"?: Array<{
          name?: string;
          artist?: {
            name?: string;
            tags?: Array<{ name: string; count: number }>;
          };
        }>;
        releases?: Array<{ title?: string; date?: string }>;
      }[];
    };
    const rec = data.recordings?.[0];
    const credit = rec?.["artist-credit"]?.[0];
    const tags = (credit?.artist?.tags ?? [])
      .toSorted((a, b) => b.count - a.count)
      .map((t) => t.name)
      .slice(0, 3);
    return {
      artist: credit?.artist?.name ?? credit?.name ?? null,
      album: rec?.releases?.[0]?.title ?? null,
      date: rec?.releases?.[0]?.date ?? null,
      artistTags: tags.join(","),
      mbid: rec?.id ?? null,
    };
  } catch {
    return {
      artist: null,
      album: null,
      date: null,
      artistTags: "",
      mbid: null,
    };
  }
}

/** Cached MusicBrainz recording lookup (artist + title → one truth row or
 *  null). Results (including verified misses) are memoized for the process
 *  lifetime; requests are rate-limited to ~1 rps so the public MB API stays
 *  happy. Failures degrade to null but are logged, never swallowed — MB
 *  fill is one optional hint among many (filename + SC tags come first). */
export async function mbLookupCached(
  artist: string | null,
  title: string,
): Promise<MbTruth | null> {
  const key = `${artist ?? ""}::${title.toLowerCase()}`;
  if (mbCache.has(key)) return mbCache.get(key) ?? null;
  const q = artist
    ? `artist:"${encodeURIComponent(artist)}" AND recording:"${encodeURIComponent(title)}"`
    : `recording:"${encodeURIComponent(title)}"`;
  try {
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=1`,
      {
        headers: {
          "User-Agent": "megadj/0.1 (https://github.com/megadj/megadj)",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    let out: MbTruth | null = null;
    if (res.ok) {
      const data = (await res.json()) as { recordings?: MbRecording[] };
      const rec = data.recordings?.[0];
      if (rec) out = recordingToTruth(rec);
    }
    mbCache.set(key, out);
    // Be polite to MusicBrainz: 1 rps even for misses.
    await new Promise((r) => setTimeout(r, 1050));
    return out;
  } catch (e) {
    console.error(`MusicBrainz lookup failed for ${key}`, e);
    return null;
  }
}
/** One MB search-response recording row (only the fields we read). */
interface MbRecording {
  title?: string;
  id?: string;
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
  releases?: { title?: string; date?: string }[];
}

/** Parse one recording row from the MB search response. */
function recordingToTruth(rec: MbRecording): MbTruth {
  const first = rec.releases?.[0];
  const credit = rec["artist-credit"]?.[0];
  const date = first?.date ?? null;
  const yearNum = date ? Number(date.match(/\d\d\d\d/)?.[0]) : NaN;
  return {
    title: rec.title ?? null,
    artist: credit?.artist?.name ?? credit?.name ?? null,
    album: first?.title ?? null,
    year: Number.isInteger(yearNum) && yearNum > 1900 ? yearNum : null,
    mbid: rec.id ?? null,
  };
}
