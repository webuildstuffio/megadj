/**
 * shelf-hygiene — detect → ledger → review → apply → validate (the docs/
 * shelf-hygiene-2026-09-09.md §4 feature, CLI half).
 *
 * Default run: walk the shelf, run every check, upsert the findings
 * ledger (hygiene_findings in the archive DB), print the census. Findings
 * are the SSOT: CrateDeck's API/UI and this command read the same rows.
 *
 * `--apply --yes` executes ONLY confirmed quarantine-loser findings whose
 * walkToken still matches a fresh walk — everything else waits for the
 * human confirm the web queue (or `--confirm <id>`) provides. `--json`
 * obeys the agent-first contract: one summary object on stdout.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { HygieneStore } from "../archive/hygiene/store";
import { walkShelf } from "../archive/hygiene/walk";
import { runChecks } from "../archive/hygiene/checks";
import {
  BUCKET_MEMBERSHIP,
  inBucket,
  isListenFirst,
} from "../archive/hygiene/subcategory";
import { applyFinding, validateFinding } from "../archive/hygiene/apply";
import type { CheckCtx } from "../archive/hygiene/types";
import { FpCache } from "./shelf-dupescan";

export interface ShelfHygieneOptions {
  shelfVolume?: string | undefined;
  dbPath?:
    | string
    | undefined; /** confirm findings by id (CLI-side confirm; the web queue is the
   *  primary confirm surface). Multiple ids = one call. */
  confirm?: string[] | undefined;
  /** dismiss findings by id */
  dismiss?: string[] | undefined;
  /** restrict detection to one check kind */
  kind?: string | undefined;
  /** confirm every open finding whose acoustic subcategory falls in this
   *  bucket (subcategory.ts). Acoustic-twin only; requires --yes with
   *  --apply, or works standalone as a batch-confirm. */
  bucket?: string | undefined;
  /** execute confirmed autoSafe findings after re-verification. Requires
   *  --yes (two-step safety, same as shelf-dupescan). */
  apply?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
  log?: ((s: string) => void) | undefined;
}

export async function shelfHygiene(
  opts: ShelfHygieneOptions = {},
): Promise<void> {
  const {
    shelfVolume = `/Volumes/${process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1"}`,
    dbPath = process.env.MEGADJ_DB ??
      `${process.env.HOME}/.local/state/megadj/archive.db`,
    confirm = [],
    dismiss = [],
    bucket,
    apply = false,
    yes = false,
    json = false,
    log = (s) => console.error(s),
  } = opts;

  const fail = (error: string): void => {
    if (json) console.log(JSON.stringify({ command: "shelf-hygiene", error }));
    else console.error(`shelf-hygiene: ${error}`);
    process.exitCode = 1;
  };

  if (apply && !yes) {
    // guard order: flag misuse fails BEFORE any disk/DB work
    fail("--apply requires --yes (two-step safety — nothing executed)");
    return;
  }
  if (!existsSync(shelfVolume)) {
    fail(`shelf not mounted: ${shelfVolume}`);
    return;
  }

  const db = new Database(dbPath);
  try {
    const store = new HygieneStore(db);

    // ---- decision mode: confirm/dismiss by id(s) ---------------------
    if (confirm.length || dismiss.length || bucket) {
      const decided: string[] = [];
      const failed: { id: string; why: string }[] = [];
      const run = (id: string, confirmIt: boolean): void => {
        if (store.decide(id, confirmIt)) decided.push(id);
        else failed.push({ id, why: "not found or not open" });
      };
      for (const id of confirm) run(id, true);
      for (const id of dismiss) run(id, false);
      // bucket batch-confirm: every OPEN acoustic-twin whose evidence
      // subcategory falls in the requested bucket (composite buckets
      // like safe-batch/ear-check match via BUCKET_MEMBERSHIP). Two-step
      // safety still applies downstream: applying needs --apply --yes
      // separately.
      let bucketMatched = 0;
      if (bucket) {
        if (!(bucket in BUCKET_MEMBERSHIP)) {
          fail(
            `unknown bucket "${bucket}" — valid: ${Object.keys(BUCKET_MEMBERSHIP).join(", ")}`,
          );
          return;
        }
        // Listen-first buckets are FILTER-ONLY (subcategory.ts): their
        // findings need ears before a keep decision, so batch-confirm
        // refuses them instead of stamping "confirmed" over unreviewed
        // rows. Dismiss by id stays available for genuine junk.
        if (isListenFirst(bucket)) {
          fail(
            `bucket "${bucket}" is listen-first — its findings need an A/B listen before a keep decision (Hygiene tab → A/B compare). Batch-confirm only: metadata-diff, re-encode, safe-batch.`,
          );
          return;
        }
        const open = store.list({ status: "open", kind: "acoustic-twin" });
        for (const f of open) {
          const sub = (f.evidence as Record<string, unknown>).subcategory;
          if (typeof sub !== "string" || !inBucket(sub, bucket)) continue;
          if (store.decide(f.id, true)) {
            decided.push(f.id);
            bucketMatched++;
          } else failed.push({ id: f.id, why: "bucket confirm race" });
        }
      }
      if (json)
        console.log(
          JSON.stringify({
            command: "shelf-hygiene",
            decided,
            bucket: bucket ?? null,
            bucketMatched,
            failed,
          }),
        );
      else {
        if (bucket)
          console.error(
            `shelf-hygiene: bucket ${bucket}: ${bucketMatched} confirmed`,
          );
        for (const f of failed)
          console.error(`shelf-hygiene: ${f.id}: ${f.why}`);
      }
      if (failed.length) process.exitCode = 1;
      return;
    }

    // ---- detection pass ---------------------------------------------
    const { files, walkToken, unreadable } = walkShelf(shelfVolume);
    log(`shelf-hygiene: ${files.length} files on ${shelfVolume}`);
    for (const dir of unreadable)
      log(`  WARNING: unreadable dir skipped — ${dir}`);
    const cache = new FpCache(db);
    const ctx: CheckCtx = {
      volume: shelfVolume,
      walkToken,
      md5: (p) => {
        const r = Bun.spawnSync(["md5", "-q", p]);
        if (r.exitCode !== 0) {
          // boundary log: a null here silently drops the file from every
          // same-size group — the caller must be able to see why
          console.error(
            `shelf-hygiene: md5 failed (${r.exitCode}) — ${p}: ${r.stderr
              .toString()
              .trim()}`,
          );
          return null;
        }
        const h = r.stdout.toString().trim();
        return h.length > 0 ? h : null;
      },
      fp: (p, size) => {
        const hit = cache.get(p, size);
        if (hit !== undefined) return hit;
        const fp = (() => {
          const r = Bun.spawnSync(["fpcalc", "-length", "120", p]);
          if (r.exitCode !== 0) return null;
          // base64url: `-`/`_` are in the alphabet — a class without them
          // truncates at the first hyphen (Sep 11 mass-collision regression)
          const m = r.stdout
            .toString()
            .match(/FINGERPRINT=([A-Za-z0-9+=/_-]+)/);
          return m?.[1] ?? null;
        })();
        cache.put(p, size, fp);
        return fp;
      },
      now: () => new Date().toISOString(),
    };
    const results = runChecks(files, ctx);
    const all = results.flatMap((r) => r.findings);
    const { written, reopened } = store.upsert(all);
    log(
      `findings: ${all.length} detected · ${written} written · ${reopened} reopened`,
    );

    // ---- apply pass (only --apply --yes) -----------------------------
    let applied = 0;
    let failed = 0;
    const applyErrors: string[] = [];
    if (apply && yes) {
      const operationOwner = crypto.randomUUID();
      if (!store.acquireOperation(operationOwner)) {
        fail("hygiene apply/restore already in flight");
        return;
      }
      try {
        const fresh = walkShelf(shelfVolume);
        if (fresh.walkToken !== walkToken) {
          fail("shelf changed during scan — re-run (stale-walk abort)");
          return;
        }
        const confirmed = store.list({ status: "confirmed" });
        // True shelf count at apply start (the fresh walk above) — the
        // baseline every receipt's delta is measured from. Per-move
        // arithmetic: after_i = start − moved_i. A fresh walk per finding
        // is minutes on exFAT; the whole-shelf audit is the caller's leg.
        const startCount = fresh.files.length;
        let moved = 0;
        for (const f of confirmed) {
          if (f.walkToken !== walkToken) {
            applyErrors.push(`stale walkToken: ${f.id}`);
            failed++;
            continue;
          }
          if (f.proposedAction.type !== "quarantine-loser") {
            // never "executed" then lied about — the row keeps its status
            // and the skip is visible (its human step hasn't been built)
            applyErrors.push(
              `${f.id}: ${f.proposedAction.type} has no executor yet — left confirmed`,
            );
            continue;
          }
          const r = applyFinding(f, shelfVolume, ctx);
          if (!r.moved) {
            applyErrors.push(`${f.id}: ${r.error ?? "unknown"}`);
            failed++;
            continue;
          }
          moved++;
          const receipt = validateFinding(
            f,
            startCount - moved + 1,
            startCount - moved,
            ctx,
            r.dest,
          );
          store.markApplied(f.id, receipt);
          if (receipt.ok) applied++;
          else {
            failed++;
            applyErrors.push(
              `${f.id}: validation failed — ${JSON.stringify(receipt.shelfDelta)}`,
            );
          }
          log(`  applied ${f.kind}: ${basename(r.loser ?? "")}`);
        }
      } finally {
        store.releaseOperation(operationOwner);
      }
    }

    // ---- summary (one JSON object on stdout in --json mode) ----------
    const byKind: Record<string, number> = {};
    for (const f of all) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    const summary = {
      command: "shelf-hygiene" as const,
      shelf: shelfVolume,
      walkToken,
      scanned: files.length,
      detected: all.length,
      written,
      reopened,
      byKind,
      open: store.list({ status: "open" }).length,
      confirmed: store.list({ status: "confirmed" }).length,
      applied,
      failed,
      applyErrors,
      unreadableDirs: unreadable.length,
      dryRun: !apply,
    };
    if (json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      log(
        `census: ${summary.open} open · ${summary.confirmed} confirmed · ${summary.applied} applied · ${summary.failed} failed`,
      );
      for (const [kind, n] of Object.entries(byKind)) log(`  ${kind}: ${n}`);
    }
  } finally {
    db.close();
  }
}
