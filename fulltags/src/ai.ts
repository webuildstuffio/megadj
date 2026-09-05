/**
 * FullTags AI — OpenRouter-backed genre + remix-year classification (the
 * last-resort rung when SoundCloud tags are missing). Confidence-gated
 * (≥ 0.7). Migrated from tools/fetch_ai.ts; flash-lite tends to guess 2023
 * for years — verify with the years stage / fix_years before trusting.
 */
import { basename } from "node:path";
import { DJ_GENRES } from "./schema";

export const AI_MODEL = "google/gemini-2.5-flash-lite"; // cheapest solid

export type AiTagResult = Map<
  string,
  [genre: string | null, year: number | null]
>;

export interface AiRow {
  video_id: string;
  artist: string | null;
  title: string;
  file_path: string;
}

/** OpenRouter classifier. With withYear=true, asks for the remix/edit year
 * (the year THIS version came out, not the original track's) alongside genre. */
export async function aiGenres(
  batch: AiRow[],
  withYear = false,
): Promise<AiTagResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const out: AiTagResult = new Map();
  if (!key || !batch.length) return out;
  const yearLine = withYear
    ? `\nAlso include "year": your best-estimate integer year this SPECIFIC version (remix/edit/bootleg) was released — the SoundCloud/YouTube upload era, NOT the original song's year. Always answer with an integer; use the filename's version markers (v4.51, MASTER dates, remix-era cues) to infer.`
    : "";
  const yearSchema = withYear ? `,"year":<int>` : "";
  const prompt = `You are a DJ music genre classifier. Assign ONE genre per track from: ${DJ_GENRES}.
Use "Edits / Bootlegs" for remixes/flips/edits/mashups of other artists' tracks. If genuinely unsure use "Unknown".${yearLine}
Tracks:
${batch.map((r, i) => `${i}. file: ${basename(r.file_path)} | title: ${r.title} | artist: ${r.artist ?? "?"}`).join("\n")}
Respond with ONLY a JSON array: [{"id":<index>,"genre":"<genre>","confidence":0.0-1.0${yearSchema}}]`;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });
    if (!res.ok) return out;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed: unknown = JSON.parse(
      json.choices?.[0]?.message?.content?.match(/\[[\s\S]*\]/)?.[0] ?? "[]",
    );
    if (!Array.isArray(parsed)) return out;
    interface AiItem {
      id?: number;
      genre?: string;
      confidence?: number;
      year?: number;
    }
    const isItem = (x: unknown): x is AiItem =>
      typeof x === "object" && x !== null;
    const items = parsed.filter(isItem);
    for (const item of items) {
      const row = batch[item.id ?? -1];
      if (!row) continue;
      const genre =
        item.genre && item.genre !== "Unknown" && (item.confidence ?? 0) >= 0.7
          ? item.genre
          : null;
      const yearNum = Number(item.year);
      const year =
        withYear &&
        Number.isInteger(yearNum) &&
        yearNum >= 1990 &&
        yearNum <= new Date().getFullYear()
          ? yearNum
          : null;
      if (genre || year) out.set(row.video_id, [genre, year]);
    }
  } catch {}
  return out;
}

/** Album fallback for pack tracks: "Artist remixes/flips/edits — Singles". */
export const albumHeuristic = (artist: string, fname: string): string => {
  const a0 = artist.split(/[,&]/)[0]?.trim() ?? artist;
  if (/remix/i.test(fname)) return `${a0} remixes`;
  if (/flip/i.test(fname)) return `${a0} flips`;
  if (/edit|mash|bootleg|rework|re-?work/i.test(fname)) return `${a0} edits`;
  return `${a0} — Singles`;
};
