/**
 * ai_genres.ts — OpenRouter mini-model genre classifier for archive tracks.
 *
 * Batches 20 tracks per request: sends current metadata (title, artist,
 * filename, existing genre hints, duration) and asks for a strict JSON
 * response mapping each id → {genre, confidence}. Cheap (~1k tokens/req,
 * nano-tier model), scales to hundreds of tracks in seconds.
 *
 * Only updates rows where confidence >= 0.7 to avoid junk labels.
 *
 * Usage: bun tools/ai_genres.ts [--model google/gemini-2.5-flash-lite] [--min-conf 0.7]
 */
import { Database } from "bun:sqlite";

const home = process.env.HOME!;
const db = new Database(`${home}/.local/state/megadj/archive.db`);
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = (() => {
  const i = process.argv.indexOf("--model");
  return i > -1 ? process.argv[i + 1] : "google/gemini-2.5-flash-lite";
})();
const MIN_CONF = (() => {
  const i = process.argv.indexOf("--min-conf");
  return i > -1 ? Number(process.argv[i + 1]) : 0.7;
})();

if (!API_KEY) {
  console.error("OPENROUTER_API_KEY not set");
  process.exit(1);
}

const GENRES = [
  "House",
  "Tech House",
  "Deep House",
  "Progressive House",
  "Afro House",
  "Bass House",
  "Tech House Bounce",
  "Techno",
  "Trance",
  "Progressive Trance",
  "Drum & Bass",
  "Dubstep",
  "Trap",
  "Future Bass",
  "Garage",
  "Speed Garage",
  "Hip-Hop",
  "Trap (Hip-Hop)",
  "Pop",
  "R&B",
  "Soul",
  "Funk",
  "Disco",
  "Nu-Disco",
  "Rock",
  "Edits / Bootlegs",
  "Ambient",
  "Hard Techno",
];

interface Row {
  video_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  file_path: string;
  duration_s: number | null;
}

const rows = db
  .query(
    "SELECT video_id, title, artist, album, genre, file_path, duration_s FROM tracks WHERE status='downloaded' AND file_path LIKE '~/Music/DJ-Imports/%'",
  )
  .all() as Row[];

// only rows with real files and no confident genre yet
const todo = rows.filter((r) => existsSync2(r.file_path));
function existsSync2(p: string): boolean {
  try {
    return require("node:fs").existsSync(p);
  } catch {
    return false;
  }
}

console.log(`tracks to classify: ${todo.length} (model: ${MODEL})`);

function buildPrompt(batch: Row[]): string {
  const list = batch
    .map(
      (r, i) =>
        `${i}. id=${r.video_id} | file: ${r.file_path.split("/").pop()} | title: ${r.title} | artist: ${r.artist ?? "?"} | existing genre: ${r.genre ?? "none"} | duration: ${r.duration_s ?? "?"}s`,
    )
    .join("\n");
  return `You are a DJ music genre classifier. For each track below, assign ONE genre from this list:
${GENRES.join(", ")}

Use "Edits / Bootlegs" for remixes/flips/edits/mashups of other artists' tracks. Prefer specific house/techno subgenres when confident. If genuinely unsure, use "Unknown".

Tracks:
${list}

Respond with ONLY a JSON array like:
[{"id":"<video_id>","genre":"<genre>","confidence":0.0-1.0}]`;
}

async function classifyBatch(
  batch: Row[],
): Promise<Array<{ id: string; genre: string; confidence: number }> | null> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: buildPrompt(batch) }],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    console.error(
      `API error ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
    return null;
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

const BATCH = 20;
let updated = 0;
let lowConf = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const results = await classifyBatch(batch);
  if (!results) {
    console.log(`batch ${i / BATCH + 1}: failed`);
    continue;
  }
  for (const res of results) {
    if (!res.genre || res.genre === "Unknown") continue;
    if (res.confidence < MIN_CONF) {
      lowConf++;
      continue;
    }
    db.query("UPDATE tracks SET genre=? WHERE video_id=?").run(
      res.genre,
      res.id,
    );
    updated++;
    console.log(
      `  ${res.genre} (${res.confidence}): ${batch.find((b) => b.video_id === res.id)?.title ?? res.id}`,
    );
  }
}

console.log(`\nupdated: ${updated} | low-confidence skipped: ${lowConf}`);
db.close();
