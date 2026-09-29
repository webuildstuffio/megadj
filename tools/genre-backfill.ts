/**
 * genre-backfill.ts — targeted genre vote ladder for tracks that never
 * went through `megadj fetch`. Three strategies:
 *
 * 1. Source lookups (MB + BP + BC + SC) by artist/title
 * 2. Title parsing for "Artist - Track" patterns (splitArtistFromTitle)
 * 3. Embedding KNN — infer genre from nearest genre-known neighbors
 *
 * Usage: bun tools/genre-backfill.ts [--limit N] [--dry-run] [--json]
 *        [--embeddings-only] [--lookups-only]
 */
import { Database } from "bun:sqlite";
import { beatportLookup, bpGenre } from "../src/fulltags/sources/beatport";
import {
  bcSearch,
  bcFetchPage,
  bcGenre,
} from "../src/fulltags/sources/bandcamp";
import { mbGenreForArtist } from "../src/fulltags/sources/mb-lookup";
import { scSearch } from "../src/fulltags/sources/sc-search";
import {
  canonicalizeClaim as canonGenre,
  guessFromFreeText,
  SC_GENRE_CANON,
} from "../src/fulltags/genre/genre-vocab";
import {
  GENRE_VOTE_WEIGHTS,
  electGenre,
  serializeVotes,
  type GenreVote,
} from "../src/fulltags/genre/genre-vote";
import { splitArtistFromTitle } from "../src/fulltags/write/metadata-build";
import { nonEmptyEnv } from "../src/shared/leaf/guards";

const DB_PATH =
  nonEmptyEnv("MEGADJ_DB") ??
  `${process.env.HOME}/.local/state/megadj/archive.db`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const jsonOut = args.includes("--json");
const embeddingsOnly = args.includes("--embeddings-only");
const lookupsOnly = args.includes("--lookups-only");
const limitIdx = args.indexOf("--limit");
const limitRaw = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;
const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

interface TrackRow {
  video_id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
}

const db = new Database(DB_PATH);

const log = jsonOut ? () => {} : console.log;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse embedding from a JSON array string into a Float32Array. */
const parseEmb = (json: string): Float32Array => {
  try {
    return new Float32Array(JSON.parse(json) as number[]);
  } catch (e) {
    console.error("genre-backfill: corrupt embedding JSON", e);
    return new Float32Array(0);
  }
};

/** Cosine similarity between two same-length Float32Arrays. */
const cosine = (a: Float32Array, b: Float32Array): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
};

// ---- Phase 1: Source lookups ----
async function runLookups(): Promise<{
  resolved: number;
  missed: number;
  errors: number;
  remaining: number;
}> {
  const rows = db
    .query(
      `SELECT video_id, title, artist, genre, file_path FROM tracks
       WHERE status='downloaded' AND file_path IS NOT NULL
         AND (genre_votes IS NULL OR genre_votes = '' OR genre_votes = '[]')
       ORDER BY artist IS NOT NULL AND artist != '' AND artist != 'UnknownArtist' DESC, title
       ${limit !== undefined ? `LIMIT ${limit}` : ""}`,
    )
    .all() as TrackRow[];

  log(`\n--- Phase 1: Source lookups (${rows.length} tracks) ---`);

  let resolved = 0;
  let missed = 0;
  const errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let artist = row.artist ?? "";
    let title = row.title;

    // Parse "Artist - Track" from title when artist is missing/same-as-title
    if (!artist || artist === "UnknownArtist" || artist === title) {
      const split = splitArtistFromTitle(title);
      if (split) {
        artist = split.artist;
        title = split.track;
      }
    }

    // Strip common YouTube suffixes for cleaner lookups
    title = title
      .replace(/\s*\[archive(?:\s+\d+)?\]\s*$/i, "")
      .replace(/\s*\[BACKUP\d*\]\s*$/i, "")
      .replace(
        /\s*\(Official (?:Video|Audio|Music Video|Lyric Video)\)\s*$/i,
        "",
      )
      .replace(/\s*\(Official\)\s*$/i, "")
      .replace(/\s*\[Official (?:Video|Audio)\]\s*$/i, "")
      .trim();

    const label = `[${i + 1}/${rows.length}]`;

    if (!artist || artist.length < 2) {
      log(`  ${label} ✗ no parseable artist — ${row.title.slice(0, 60)}`);
      missed++;
      continue;
    }

    const votes: GenreVote[] = [];

    // ---- Beatport (W3, 0.6) ----
    try {
      const bpHit = await beatportLookup({
        artist,
        title,
      });
      if (bpHit) {
        const g = bpGenre(bpHit);
        if (g)
          votes.push({ rung: "bp", genre: g, weight: GENRE_VOTE_WEIGHTS.bp });
      }
    } catch {
      /* degrade */
    }

    // ---- MusicBrainz folksonomy (W5, 0.4) ----
    try {
      const mbGenre = await mbGenreForArtist(artist);
      if (mbGenre)
        votes.push({
          rung: "mb",
          genre: mbGenre,
          weight: GENRE_VOTE_WEIGHTS.mb,
        });
    } catch {
      /* degrade */
    }

    // ---- Bandcamp (W2b, 0.5) ----
    try {
      const bcHit = await bcSearch({ artist, title });
      if (bcHit) {
        const page = await bcFetchPage(bcHit.url);
        if (page) {
          const g = bcGenre(page, canonGenre);
          if (g)
            votes.push({
              rung: "bc",
              genre: g,
              weight: GENRE_VOTE_WEIGHTS.bc,
            });
        }
      }
    } catch {
      /* degrade */
    }

    // ---- SoundCloud (W2, 0.35) ----
    try {
      const scHits = scSearch({
        title: `${artist} - ${title}`,
        artist,
        file_path: row.file_path,
      });
      const best = scHits[0];
      if (best?.genre) {
        const canon = canonGenre(best.genre);
        if (canon && canon !== "Music")
          votes.push({
            rung: "sc",
            genre: canon,
            weight: GENRE_VOTE_WEIGHTS.sc,
          });
      }
    } catch {
      /* degrade */
    }

    // ---- Election ----
    if (votes.length === 0) {
      log(`  ${label} ✗ no votes — ${artist} - ${title.slice(0, 40)}`);
      missed++;
      continue;
    }

    const result = electGenre(votes);
    if (!result.genre) {
      missed++;
      continue;
    }

    log(
      `  ${label} ✓ ${result.genre} (${result.winnerRungs.join("+")}, ${votes.length}v) — ${artist} - ${title.slice(0, 40)}`,
    );

    if (!dryRun) {
      db.query(
        `UPDATE tracks SET genre = COALESCE(?, genre),
         genre_secondary = COALESCE(?, genre_secondary),
         genre_votes = ? WHERE video_id = ?`,
      ).run(
        result.genre,
        result.secondaryGenre,
        serializeVotes(votes),
        row.video_id,
      );
    }
    resolved++;

    if (i < rows.length - 1) await sleep(200);
  }

  const remaining = (
    db
      .query(
        `SELECT COUNT(*) AS cnt FROM tracks
         WHERE status='downloaded' AND file_path IS NOT NULL
           AND (genre_votes IS NULL OR genre_votes = '' OR genre_votes = '[]')`,
      )
      .get() as { cnt: number }
  ).cnt;

  return { resolved, missed, errors, remaining };
}

// ---- Phase 2: Embedding KNN genre inference ----
async function runEmbeddingInference(): Promise<{
  resolved: number;
  missed: number;
}> {
  // Get all tracks with embeddings + genre
  const genreKnown = db
    .query(
      `SELECT t.video_id, t.genre, e.vec_json
       FROM tracks t JOIN embeddings e ON e.video_id = t.video_id
       WHERE t.genre IS NOT NULL AND t.genre != '' AND t.genre != 'Music'
         AND t.genre != 'Unknown Genre'
         AND t.genre_votes IS NOT NULL AND t.genre_votes != ''`,
    )
    .all() as { video_id: string; genre: string; vec_json: string }[];

  // Get tracks needing genre that have embeddings
  const needGenre = db
    .query(
      `SELECT t.video_id, t.title, t.artist, e.vec_json
       FROM tracks t JOIN embeddings e ON e.video_id = t.video_id
       WHERE t.status='downloaded' AND t.file_path IS NOT NULL
         AND (t.genre_votes IS NULL OR t.genre_votes = '' OR t.genre_votes = '[]')`,
    )
    .all() as {
    video_id: string;
    title: string;
    artist: string | null;
    vec_json: string;
  }[];

  log(
    `\n--- Phase 2: Embedding KNN (${needGenre.length} tracks, ${genreKnown.length} references) ---`,
  );

  if (genreKnown.length === 0 || needGenre.length === 0) {
    log("  ✗ no embedding pairs — skip");
    return { resolved: 0, missed: needGenre.length };
  }

  const refs = genreKnown.map((r) => ({
    genre: r.genre,
    emb: parseEmb(r.vec_json),
  }));

  let resolved = 0;
  let missed = 0;
  const K = 7; // KNN neighbors
  const MIN_SIM = 0.7; // minimum cosine similarity
  const MIN_AGREEMENT = 0.5; // 50% of K must agree (4/7 = 57% passes)

  for (let i = 0; i < needGenre.length; i++) {
    const track = needGenre[i]!;
    const emb = parseEmb(track.vec_json);

    // Find K nearest neighbors
    const sims: { genre: string; sim: number }[] = [];
    for (const ref of refs) {
      if (ref.emb.length !== emb.length) continue;
      const sim = cosine(emb, ref.emb);
      if (sim >= MIN_SIM) sims.push({ genre: ref.genre, sim });
    }
    sims.sort((a, b) => b.sim - a.sim);
    const knn = sims.slice(0, K);

    if (knn.length < 3) {
      missed++;
      continue;
    }

    // Vote by genre — weighted by similarity
    const genreScore = new Map<string, number>();
    for (const n of knn) {
      genreScore.set(n.genre, (genreScore.get(n.genre) ?? 0) + n.sim);
    }
    let best = "";
    let bestScore = 0;
    let bestCount = 0;
    for (const [genre, score] of genreScore) {
      const count = knn.filter((n) => n.genre === genre).length;
      if (score > bestScore) {
        best = genre;
        bestScore = score;
        bestCount = count;
      }
    }

    // Require minimum agreement
    if (bestCount / knn.length < MIN_AGREEMENT) {
      log(
        `  [${i + 1}/${needGenre.length}] ✗ low agreement (${bestCount}/${knn.length} = ${best}) — ${track.artist ?? ""} - ${track.title.slice(0, 40)}`,
      );
      missed++;
      continue;
    }

    const rawBest = best;
    best = canonGenre(best);
    const avgSim = (
      knn.filter((n) => n.genre === rawBest).reduce((s, n) => s + n.sim, 0) /
      bestCount
    ).toFixed(3);

    log(
      `  [${i + 1}/${needGenre.length}] ✓ ${best} (${bestCount}/${knn.length} agree, avg sim ${avgSim}) — ${track.artist ?? ""} - ${track.title.slice(0, 40)}`,
    );

    // Runner-up genre from KNN (second-most-voted, if different)
    let knnSecondary: string | null = null;
    if (genreScore.size >= 2) {
      let secondBest = "";
      let secondScore = 0;
      for (const [genre, score] of genreScore) {
        if (genre === best) continue;
        if (score > secondScore) {
          secondBest = genre;
          secondScore = score;
        }
      }
      if (secondBest) knnSecondary = canonGenre(secondBest);
    }

    if (!dryRun) {
      const votes: GenreVote[] = [
        {
          rung: "mb" as const,
          genre: best,
          weight: 0.3,
          detail: `embedding-knn:${bestCount}/${knn.length}@${avgSim}`,
        },
      ];
      db.query(
        `UPDATE tracks SET genre = COALESCE(?, genre),
         genre_secondary = COALESCE(?, genre_secondary),
         genre_votes = ? WHERE video_id = ?`,
      ).run(best, knnSecondary, serializeVotes(votes), track.video_id);
    }
    resolved++;
  }

  return { resolved, missed };
}

// ---- Main ----
const lookupResult = embeddingsOnly
  ? { resolved: 0, missed: 0, errors: 0, remaining: 0 }
  : await runLookups();

const embResult = lookupsOnly
  ? { resolved: 0, missed: 0 }
  : await runEmbeddingInference();

// ---- Phase 3: Propagation pass (archive copies inherit from base) ----
if (!dryRun) {
  const propResult = db
    .query(
      `
    UPDATE tracks SET
      genre = (SELECT t2.genre FROM tracks t2
               WHERE t2.artist = tracks.artist
                 AND replace(replace(replace(t2.title, ' [archive]',''), ' [archive 2]',''), ' [BACKUP2]','') =
                     replace(replace(replace(tracks.title, ' [archive]',''), ' [archive 2]',''), ' [BACKUP2]','')
                 AND t2.genre IS NOT NULL AND t2.genre != ''
                 AND t2.video_id != tracks.video_id
               LIMIT 1),
      genre_secondary = COALESCE(genre_secondary,
        (SELECT t2.genre_secondary FROM tracks t2
         WHERE t2.artist = tracks.artist
           AND replace(replace(replace(t2.title, ' [archive]',''), ' [archive 2]',''), ' [BACKUP2]','') =
               replace(replace(replace(tracks.title, ' [archive]',''), ' [archive 2]',''), ' [BACKUP2]','')
           AND t2.genre_secondary IS NOT NULL AND t2.genre_secondary != ''
           AND t2.video_id != tracks.video_id
         LIMIT 1))
    WHERE (genre IS NULL OR genre = '')
      AND artist IS NOT NULL AND artist != ''
  `,
    )
    .run();
  log(`\n--- Phase 3: Propagation — ${propResult.changes} copies filled ---`);
}

// ---- Phase 4: Canonicalize secondary genres ----
if (!dryRun) {
  const badSecondary = db
    .query(
      `SELECT DISTINCT genre_secondary FROM tracks
       WHERE status='downloaded'
         AND genre_secondary IS NOT NULL AND genre_secondary != ''`,
    )
    .all() as { genre_secondary: string }[];
  let canonFixed = 0;
  const knownCanon = new Set(Object.values(SC_GENRE_CANON));
  for (const { genre_secondary: raw } of badSecondary) {
    let canon = canonGenre(raw);
    // If the canon result isn't in the known vocabulary, try regex guessing
    if (!knownCanon.has(canon)) {
      const guessed = guessFromFreeText([raw]);
      if (guessed) canon = guessed;
    }
    if (canon !== raw) {
      db.query(
        `UPDATE tracks SET genre_secondary = ? WHERE genre_secondary = ?`,
      ).run(canon, raw);
      canonFixed++;
    }
  }
  // Null out secondary that equals primary (redundant)
  const redResult = db
    .query(
      `UPDATE tracks SET genre_secondary = NULL
       WHERE genre_secondary IS NOT NULL AND genre_secondary = genre`,
    )
    .run();
  log(
    `\n--- Phase 4: Canonicalized ${canonFixed} secondary genre variants, cleared ${redResult.changes} redundant (same as primary) ---`,
  );
}

const finalCount = db
  .query(
    `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN genre_votes IS NOT NULL AND genre_votes != '' AND genre_votes != '[]' THEN 1 ELSE 0 END) AS has_votes,
         SUM(CASE WHEN genre_secondary IS NOT NULL AND genre_secondary != '' THEN 1 ELSE 0 END) AS has_secondary
       FROM tracks WHERE status='downloaded' AND file_path IS NOT NULL`,
  )
  .get() as { total: number; has_votes: number; has_secondary: number };

const coverage = ((finalCount.has_votes / finalCount.total) * 100).toFixed(1);
const secCoverage = (
  (finalCount.has_secondary / finalCount.total) *
  100
).toFixed(1);

const summary = {
  command: "genre-backfill",
  lookups: lookupResult,
  embeddings: embResult,
  final: {
    total: finalCount.total,
    withVotes: finalCount.has_votes,
    coverage: `${coverage}%`,
    withSecondary: finalCount.has_secondary,
    secondaryCoverage: `${secCoverage}%`,
  },
  dryRun,
};

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} else {
  log(
    `\n=== FINAL: ${finalCount.has_votes}/${finalCount.total} tracks with genre votes (${coverage}%) ===`,
  );
  log(
    `=== SECONDARY: ${finalCount.has_secondary}/${finalCount.total} tracks with secondary genre (${secCoverage}%) ===`,
  );
}

db.close();
