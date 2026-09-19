// Public CrateDeck persistence facade. Cohesive query families are layered in
// db/core.ts, db/library.ts, and db/activity.ts; callers keep one stable type.
import type { BenchRun } from "../shared/types";
import { DBActivity } from "./db/activity";

export { inferRole } from "./db/drives";

export class DB extends DBActivity {
  addBenchmark(driveId: string, seq: number, rand4k: number): void {
    this.benchStore.addBenchmark(driveId, seq, rand4k);
  }

  benchmarks(driveId: string): BenchRun[] {
    return this.benchStore.benchmarks(driveId);
  }

  addSpeedProbe(driveId: string, mbps: number, bytesRead: number): void {
    this.benchStore.addSpeedProbe(driveId, mbps, bytesRead);
  }

  speedProbes(driveId: string): { ran_at: number; mbps: number }[] {
    return this.benchStore.speedProbes(driveId);
  }

  ledgerBiggest(driveId: string, limit: number): string[] {
    return this.benchStore.ledgerBiggest(driveId, limit);
  }

  manifestBiggest(driveId: string, limit: number): string[] {
    return this.benchStore.manifestBiggest(driveId, limit);
  }

  ledgerPut(
    driveId: string,
    path: string,
    size: number,
    mtime: number,
    hash: string,
  ): void {
    this.benchStore.ledgerPut(driveId, path, size, mtime, hash);
  }

  ledgerGet(
    driveId: string,
    path: string,
  ): { hash: string; size: number; mtime: number } | null {
    return this.benchStore.ledgerGet(driveId, path);
  }

  ledgerCount(driveId: string): number {
    return this.benchStore.ledgerCount(driveId);
  }

  ledgerAgeDays(driveId: string): number | null {
    return this.benchStore.ledgerAgeDays(driveId);
  }

  close(): void {
    this.sqlite.close();
  }
}
