// server_lifecycle.ts — the reconcile loop, auto-schedule decisions, and
// drive-photo mount re-sync, extracted from index.ts (complexity hot-spot
// split, #42). Pure orchestration over injected deps: no HTTP, no globals.
import { listMountedVolumes } from "./detect";
import {
  shouldAutoScan,
  shouldAutoVerify,
  autoVerifyReason,
} from "./auto-schedule";
import type { DB } from "./db";
import type { Registry } from "./registry";
import type { ImageService } from "./image/store";
import type { JobEngine } from "./jobs";
import type { CrateConfig } from "./config";

export function makeServerLifecycle(deps: {
  cfg: CrateConfig;
  db: DB;
  registry: Registry;
  images: ImageService;
  jobs: JobEngine;
}) {
  const { cfg, db, registry, images, jobs } = deps;

  function mountPointOf(driveName: string): string {
    return `${cfg.volumesRoot}/${driveName}`;
  }

  /** Drive-photo re-sync at mount time: every reconcile sweep, for each
   *  mounted drive, make local copy and stick copy agree (cheap no-op when
   *  they do — extension+size check, no hashing). Failures log, never break
   *  the sweep. */
  async function photoMountResync(): Promise<void> {
    for (const d of db.allDrives()) {
      if (!d.mounted) continue;
      try {
        await images.syncOnMount(d.id);
      } catch (e) {
        console.error(`photo mount re-sync failed for ${d.name}`, e);
      }
    }
  }

  /** archived ideas §C17 (docs/archive/ideas-2026-09-15.md): on mount → light scan automatically; stale verify → auto
   *  verify weekly. Decisions in auto_schedule.ts (pure, tested); this only
   *  resolves inputs and enqueues. All job-engine guards (dedupe, interlock,
   *  per-drive concurrency) still apply on top. */
  function autoSchedule(): void {
    const now = Date.now();
    // 1 — mount-triggered light scan
    if (registry.justMountedIds.size) {
      const snaps = db.latestSnapshots();
      for (const id of registry.justMountedIds) {
        const drive = db.getDrive(id);
        if (!drive?.mounted) continue;
        const snap = snaps.get(id);
        const hasFresh =
          Boolean(snap?.taken_at) && now - snap!.taken_at < 60_000;
        if (
          shouldAutoScan(
            { mounted: true, justMounted: true, hasFreshSnapshot: hasFresh },
            cfg.autoScanOnMount,
          )
        ) {
          const j = jobs.enqueue(id, "scan", mountPointOf(drive.name), "auto");
          console.log(
            `cratedeck: auto-scan ${drive.name} (${j.id.slice(0, 8)})`,
          );
        }
      }
      registry.justMountedIds.clear();
    }
    // 2 — weekly auto-verify for mounted drives (checked every sweep; cheap)
    if (cfg.verifyIntervalDays > 0) {
      for (const drive of db.allDrives()) {
        if (!drive.mounted) continue;
        if (db.activeJobOfKind(drive.id, "verify")) continue;
        const last = db.latestVerify(drive.id);
        const input = {
          mounted: true,
          lastVerifyAt: last?.ran_at ?? null,
          hasActiveJob: Boolean(db.activeJobOfKind(drive.id, "scan")),
          now,
        };
        if (shouldAutoVerify(input, cfg.verifyIntervalDays)) {
          // one shot per server boot per drive: mark by enqueueing (dedupe)
          // and remembering the decision so a failed verify doesn't loop
          const lastAttempt = autoVerifyAttempts.get(drive.id) ?? 0;
          if (now - lastAttempt < 3_600_000) continue; // max 1 attempt/hour
          autoVerifyAttempts.set(drive.id, now);
          const reason = autoVerifyReason(input, cfg.verifyIntervalDays);
          const j = jobs.enqueue(
            drive.id,
            "verify",
            mountPointOf(drive.name),
            "auto",
          );
          console.log(
            `cratedeck: auto-verify ${drive.name} (${j.id.slice(0, 8)}) — ${reason}`,
          );
        }
      }
    }
  }

  let reconciling = false;
  async function reconcile(): Promise<void> {
    if (reconciling) return;
    reconciling = true;
    try {
      registry.reconcile(await listMountedVolumes(cfg.volumesRoot));
      await photoMountResync();
      autoSchedule();
    } catch (e) {
      console.error("reconcile:", (e as Error).message);
    } finally {
      reconciling = false;
    }
  }

  return { reconcile, autoSchedule, mountPointOf };
}

// one-shot-per-boot verify attempts: module-scope on purpose (server process
// lifetime is the dedupe window — see the max 1 attempt/hour guard above)
const autoVerifyAttempts = new Map<string, number>();
