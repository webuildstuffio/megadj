// hygiene_routes.ts — the /api/hygiene family (§5 Phase 2.2). Extracted
// from index.ts (file-length guard); deps injected as plain params so the
// handlers stay pure orchestration over the real reader + job engine.
//
// Heavy work (scan/apply) NEVER runs in the request leg — it enqueues a
// job; the only synchronous writes are one-row decisions (decide/confirm)
// which go through megadj's CLI (the engine SSOT) and are fast.
import type { HygieneReader } from "./hygiene_reader";
import {
  servableAudioPath,
  audioStats,
  audioResponse,
  pruneStatsCache,
} from "./hygiene_audio";

/** The JSON body of POST /api/hygiene/decide. */
export interface DecideBody {
  id?: string;
  ids?: string[];
  confirm?: boolean;
}

export function makeHygieneRoutes(deps: {
  reader: HygieneReader;
  /** enqueue a hygiene job ("hygiene-scan" | "hygiene-apply"); the
   *  engine owns interlock + one-at-a-time + SSE. */
  enqueue: (kind: "hygiene-scan" | "hygiene-apply") => { id: string };
  /** megadj CLI path for the sync decision writes (the engine is the
   *  SSOT for status transitions — cratedeck never writes the archive) */
  megadjCli: (args: string[]) => Promise<{ code: number; stderr: string }>;
  /** the shelf volume mount — the audio/stats routes serve ONLY paths
   *  under it (the A/B compare rail) */
  shelfRoot: string;
  json: (data: unknown, status?: number) => Response;
}) {
  const { reader, enqueue, megadjCli, json } = deps;

  /** GET /api/hygiene?status=&kind=&severity= → HygienePayload. */
  function list(url: URL): Response {
    const findings = reader.list({
      status: url.searchParams.get("status") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      severity: url.searchParams.get("severity") ?? undefined,
    });
    const c = reader.counts();
    return json({
      findings,
      counts: {
        open: c.open,
        confirmed: c.confirmed,
        safe: c.safe,
        review: c.review,
        byKind: c.byKind,
        bySub: c.bySub,
      },
      walkToken: findings[0]?.walkToken ?? null,
    });
  }

  /** POST /api/hygiene/decide {id | ids[], confirm} — synchronous small
   *  write: ONE CLI call carries every id (`--confirm=a --confirm=b`). */
  async function decide(req: Request): Promise<Response> {
    let body: DecideBody;
    try {
      body = (await req.json()) as DecideBody;
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const ids = body.id
      ? [body.id]
      : Array.isArray(body.ids)
        ? body.ids.filter((x): x is string => typeof x === "string")
        : [];
    if (ids.length === 0) return json({ error: "id or ids[] required" }, 400);
    const confirm = body.confirm !== false;
    const key = confirm ? "confirm" : "dismiss";
    const r = await megadjCli([
      "shelf-hygiene",
      ...ids.map((id) => `--${key}=${id}`),
      "--json",
    ]);
    if (r.code !== 0)
      return json(
        { ok: false, decided: 0, failed: ids, stderr: r.stderr.slice(-400) },
        409,
      );
    return json({ ok: true, decided: ids.length, failed: [] });
  }

  /** POST /api/hygiene/scan — enqueue the detection job. */
  function scan(): Response {
    return json(enqueue("hygiene-scan"));
  }

  /** POST /api/hygiene/bucket-confirm {bucket} — batch-confirm every open
   *  acoustic-twin finding in one subcategory bucket. Same engine SSOT as
   *  decide(): megadj's CLI does the write, cratedeck never touches the
   *  archive. Validated against the CLI's accepted bucket names AND the
   *  listen-first refusal (the CLI owns the rule — this pre-check only
   *  avoids spawning a process guaranteed to fail; a drift between the
   *  two still surfaces as the CLI's 409). */
  async function bucketConfirm(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as {
      bucket?: string;
    } | null;
    const bucket = body?.bucket;
    const VALID = ["metadata-diff", "re-encode", "safe-batch"];
    if (!bucket || !VALID.includes(bucket))
      return json(
        {
          error: `bucket must be one of ${VALID.join(", ")} — quality-diff/oddball/ear-check are listen-first: A/B compare them in the Hygiene tab instead`,
        },
        400,
      );
    const r = await megadjCli([
      "shelf-hygiene",
      `--bucket=${bucket}`,
      "--json",
    ]);
    if (r.code !== 0)
      return json({ ok: false, stderr: r.stderr.slice(-400) }, 409);
    // the CLI prints one JSON summary line — surface the count
    const line = r.stderr; // engine logs go to stderr; stdout was the JSON
    return json({ ok: true, bucket, raw: line.slice(-200) });
  }

  /** POST /api/hygiene/apply — enqueue the apply job (confirmed rows
   *  only; the engine re-verifies every loser at apply time). */
  function apply(): Response {
    return json(enqueue("hygiene-apply"));
  }

  /** GET /api/hygiene/audio?path=… — stream one shelf audio file for the
   *  A/B compare player. Guarded: shelf-root-only, audio-extension-only,
   *  no traversal, must be a regular file. */
  function audio(url: URL): Response {
    const p = servableAudioPath(url.searchParams.get("path"), deps.shelfRoot);
    if (!p) return json({ error: "not servable" }, 403);
    return audioResponse(p);
  }

  /** GET /api/hygiene/stats?path=… — ffprobe sidecar (duration/bitrate/
   *  codec/sample-rate) for the compare card. Same guard as audio. */
  function stats(url: URL): Response {
    const p = servableAudioPath(url.searchParams.get("path"), deps.shelfRoot);
    if (!p) return json({ error: "not servable" }, 403);
    pruneStatsCache();
    return json(audioStats(p));
  }

  return { list, decide, scan, bucketConfirm, apply, audio, stats };
}
