export interface FetchOptions {
  all?: boolean;
  only?: string;
  aiFallback?: boolean;
  dryRun?: boolean;
  jobs?: number;
}

export function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function finiteOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse one @fetch-start line's payload. */
export function parseFetchStart(
  payload: unknown,
): { total: number; tasks: number; jobs: number; dry: boolean } | null {
  if (!isRecord(payload)) return null;
  const total = finiteOf(payload.total);
  const tasks = finiteOf(payload.tasks);
  const jobs = finiteOf(payload.jobs);
  if (total === null || tasks === null || jobs === null) return null;
  return { total, tasks, jobs, dry: payload.dry === true };
}

/** Parse one @task-done payload into the wire shape. */
export function parseFetchTask(payload: unknown): {
  done: number;
  total: number;
  name: string;
  notes: string[];
  votes: { rung: string; genre: string; weight: number }[];
  elected: {
    genre: string;
    weight: number;
    winnerRungs: string[];
  } | null;
} | null {
  if (!isRecord(payload)) return null;
  const done = finiteOf(payload.done);
  const total = finiteOf(payload.total);
  if (done === null || total === null) return null;
  const name = typeof payload.name === "string" ? payload.name : "";
  const notes = Array.isArray(payload.notes)
    ? payload.notes.filter((n: unknown): n is string => typeof n === "string")
    : [];
  const votes = Array.isArray(payload.votes)
    ? payload.votes.flatMap((v: unknown) => {
        if (!isRecord(v)) return [];
        const weight = finiteOf(v.weight);
        if (
          typeof v.rung !== "string" ||
          typeof v.genre !== "string" ||
          weight === null
        )
          return [];
        return [{ rung: v.rung, genre: v.genre, weight }];
      })
    : [];
  let elected: {
    genre: string;
    weight: number;
    winnerRungs: string[];
  } | null = null;
  if (isRecord(payload.elected)) {
    const weight = finiteOf(payload.elected.weight);
    if (
      typeof payload.elected.genre === "string" &&
      weight !== null &&
      Array.isArray(payload.elected.winnerRungs)
    ) {
      const rungs = payload.elected.winnerRungs.filter(
        (r: unknown): r is string => typeof r === "string",
      );
      elected = { genre: payload.elected.genre, weight, winnerRungs: rungs };
    }
  }
  return { done, total, name, notes, votes, elected };
}

/** Build the megadj CLI argv for one fetch run. */
export function fetchArgs(opts: FetchOptions): string[] {
  const args = ["fetch", "--json"];
  if (opts.all) args.push("--all");
  if (opts.only && opts.only !== "all") args.push(`--${opts.only}`);
  if (opts.aiFallback) args.push("--ai-fallback");
  if (opts.dryRun) args.push("--dry-run");
  if (opts.jobs !== undefined) args.push("--jobs", String(opts.jobs));
  return args;
}

/** Decode fetch options carried in the enqueue API's mountPoint slot. */
export function parseFetchJobMount(mountPoint: string): FetchOptions {
  if (
    !mountPoint ||
    mountPoint === "local-archive" ||
    !mountPoint.startsWith("{")
  )
    return {};
  const parsed = safeJsonParse(mountPoint);
  if (!isRecord(parsed)) return {};
  const out: FetchOptions = {};
  if (parsed.all === true) out.all = true;
  if (typeof parsed.only === "string" && /^[a-z-]+$/.test(parsed.only))
    out.only = parsed.only;
  if (parsed.aiFallback === true) out.aiFallback = true;
  if (parsed.dryRun === true) out.dryRun = true;
  const jobs = finiteOf(parsed.jobs);
  if (jobs !== null && Number.isInteger(jobs) && jobs >= 1 && jobs <= 32)
    out.jobs = jobs;
  return out;
}
