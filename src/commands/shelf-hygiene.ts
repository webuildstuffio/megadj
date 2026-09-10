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
import { HygieneStore } from "../hygiene/store";
import { walkShelf } from "../hygiene/walk";
import { runChecks } from "../hygiene/checks";
import { applyFinding, validateFinding } from "../hygiene/apply";
import type { CheckCtx } from "../hygiene/types";
import { FpCache } from "./shelf-dupescan";

export interface ShelfHygieneOptions {
  shelfVolume?: string;
  dbPath?: string;
  /** confirm one finding by id (CLI-side single confirm; the web queue
   *  is the primary confirm surface) */
  confirm?: string;
  /** dismiss one finding by id */
  dismiss?: string;
  /** execute confirmed autoSafe findings after re-verification. Requires
   *  --yes (two-step safety, same as shelf-dupescan). */
  apply?: boolean;
  yes?: boolean;
  /** restrict detection to one check kind */
  kind?: string;
  json?: boolean;
  log?: (s: string) => void;
}

export async function shelfHygiene(
  opts: ShelfHygieneOptions = {},
): Promise<void> {
  const {
    shelfVolume = `/Volumes/${process.env.MEGADJ_SHELF_VOLUME ?? "SHELF1"}`,
    dbPath = process.env.MEGADJ_DB ??
      `${process.env.HOME}/.local/state/megadj/archive.db`,
    confirm,
    dismiss,
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

    // ---- single-decision mode: confirm/dismiss by id ----------------
    if (confirm || dismiss) {
      const id = (confirm ?? dismiss) as string;
      const ok = confirm ? store.decide(id, true) : store.decide(id, false);
      if (!ok) {
        fail(`finding ${id} not found or not open`);
        return;
      }
      if (json)
        console.log(
          JSON.stringify({
            command: "shelf-hygiene",
            decided: id,
            confirmed: !!confirm,
          }),
        );
      return;
    }

    // ---- detection pass ---------------------------------------------
    const { files, walkToken } = walkShelf(shelfVolume);
    log(`shelf-hygiene: ${files.length} files on ${shelfVolume}`);
    const cache = new FpCache(db);
    const ctx: CheckCtx = {
      volume: shelfVolume,
      walkToken,
      md5: (p) => {
        const r = Bun.spawnSync(["md5", "-q", p]);
        if (r.exitCode !== 0) return null;
        const h = r.stdout.toString().trim();
        return h.length > 0 ? h : null;
      },
      fp: (p, size) => {
        const hit = cache.get(p, size);
        if (hit !== undefined) return hit;
        const fp = (() => {
          const r = Bun.spawnSync(["fpcalc", "-length", "120", p]);
          if (r.exitCode !== 0) return null;
          const m = r.stdout.toString().match(/FINGERPRINT=([A-Za-z0-9=/]+)/);
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
      const fresh = walkShelf(shelfVolume);
      if (fresh.walkToken !== walkToken) {
        fail("shelf changed during scan — re-run (stale-walk abort)");
        return;
      }
      const confirmed = store.list({ status: "confirmed" });
      let before = -1;
      for (const f of confirmed) {
        if (f.walkToken !== walkToken) {
          applyErrors.push(`stale walkToken: ${f.id}`);
          failed++;
          continue;
        }
        const r = applyFinding(f, shelfVolume, ctx);
        if (!r.moved) {
          applyErrors.push(`${f.id}: ${r.error ?? "unknown"}`);
          failed++;
          continue;
        }
        // shelf count delta for the receipt: before the FIRST move vs
        // after this one (a fresh walk per finding is minutes on exFAT)
        const afterCount = files.length - applied - 1;
        const receipt = validateFinding(
          f,
          before < 0 ? files.length : before,
          afterCount,
          ctx,
          r.dest,
        );
        if (before < 0) before = files.length;
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
