/**
 * Intake folders — every ingest batch lands in its OWN subfolder under the
 * archive, so separate dumps never mix and a dump's contents are visible
 * at a glance (user request, Sep 10 2026).
 *
 * Layout: `<archive>/<YYYY-MM-DD slug>/track.aiff` …
 *   e.g. `~/Music/DJ-Imports/2026-09-09 new dump/…`
 * Same-day re-ingests reuse the SAME folder (idempotent); a later dump on
 * the same day gets `-2`. The folder name comes from the SOURCE folder's
 * name (what the human calls the dump), falling back to "intake".
 *
 * Invariants:
 *  - Quarantine stays at `<archive>/.ingest-duplicates/` (hidden → every
 *    walker skips it; NOT inside the batch folder — quarantined files are
 *    rejects, not imports).
 *  - Zip staging and `__MACOSX`-style dot-entries never surface: walkers
 *    skip dot-folders, and the batch folder is created only when the first
 *    real file registers.
 *  - `organize` treats a batch folder as already-organized (a file inside
 *    one is left alone; genre-folder layout is a separate, opt-in flow).
 */
import { basename, join } from "node:path";

/** Extract the batch slug from a source folder name: date-prefixed dumps
 * ("new dump sept 9") → date "2026-09-09" + slug "new dump" (the month/day
 * text is consumed by the date); generic folders ("Downloads") →
 * "2026-09-09 intake". */
export function intakeFolderName(
  sourceFolder: string,
  now = new Date(),
): string {
  const raw = basename(sourceFolder).replace(/\.+$/, "").trim();
  const slug =
    raw && !/^(downloads?|desktop|ingest|music)$/i.test(raw) ? raw : "intake";
  const fromName = dumpDateFromNameParts(raw);
  const date = fromName?.date ?? isoDate(now);
  const cleanSlug = (fromName ? fromName.rest || "intake" : slug).trim();
  return `${date} ${cleanSlug}`.replace(/\s+/g, " ").trim();
}

interface DateParts {
  date: string;
  /** Folder name with the month/day text removed. */
  rest: string;
}

/** Last month-name + day in a folder name ("new dump sept 9"). Null when no
 *  month is present. */
export function dumpDateFromName(name: string): string | null {
  return dumpDateFromNameParts(name)?.date ?? null;
}

function dumpDateFromNameParts(name: string): DateParts | null {
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const lower = name.toLowerCase();
  for (let i = 0; i < months.length; i++) {
    const m = new RegExp(`${months[i]}[a-z]*\\s+(\\d{1,2})`, "i").exec(lower);
    if (!m || m.index === undefined) continue;
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    const rest = (
      name.slice(0, m.index) +
      " " +
      name.slice(m.index + m[0].length)
    )
      .replace(/[-–_\s]+/g, " ")
      .trim();
    return {
      date: `${yearFor(i, day)}-${String(i + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      rest,
    };
  }
  return null;
}

/** Same-year inference: a month/day in the future by ≤6 months is this
 *  year; more than 6 months in the future wraps to NEXT year ("dec 20"
 *  ingested in early January); anything else is this year. */
function yearFor(monthIdx: number, day: number): number {
  const now = new Date();
  const year = now.getFullYear();
  const diffDays =
    (new Date(year, monthIdx, day).getTime() - now.getTime()) /
    (24 * 3600 * 1000);
  return diffDays > 180 ? year + 1 : year;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve the batch folder under the archive: `<archive>/<name>`, always.
 *  The name derives from the SOURCE folder's own name + its dump date, so
 *  it is stable across re-runs of the same dump — an existing folder IS
 *  that batch's folder (re-ingest adds files to it, never forks a "- 2"
 *  sibling). Distinct dumps get distinct names via their own folder names
 *  or dates. Same-run stability is the caller's job (compute once). */
export function resolveIntakeDir(archiveDir: string, name: string): string {
  return join(archiveDir, name);
}
