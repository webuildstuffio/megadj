// bench-hash-cancel.test.ts — regression: a cancelled hash must never
// persist a digest of the partial bytes. hashFileAsync used to `break` on
// cancellation and return the partial digest; checksumLedger then wrote
// that poisoned fingerprint into the ledger as the file's known-good —
// every future sweep would report the healthy file as "changed".
// Invariant under test: whatever lands in the ledger equals the FULL file
// digest (or nothing lands at all).
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checksumLedger, hashFileAsync } from "../src/bench";
import { DB } from "../src/db";

function tmpDir(): string {
  return join(
    tmpdir(),
    `cratedeck-hashcancel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

/** Write a file big enough to clear biggestFiles' 1MB audio floor and span
 *  multiple stream chunks (so a cancel can land mid-hash). */
function bigFile(dir: string, name: string, bytes: number): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, new Uint8Array(bytes));
  return p;
}

// checksumLedger takes no Guard (write-root enforcement lives in
// db.ledgerPut's caller) — no stub needed here.

describe("cancelled hashing never poisons the checksum ledger", () => {
  it("hashFileAsync throws 'cancelled' instead of returning a partial digest", async () => {
    const dir = tmpDir();
    const p = bigFile(dir, "a.wav", 4 * 1024 * 1024);
    const signal = { cancelled: false };
    // timer fires while the hash loop awaits its first chunk → mid-stream
    setTimeout(() => {
      signal.cancelled = true;
    }, 0);
    try {
      const digest = await hashFileAsync(p, signal);
      // on a machine fast enough to finish before the timer, the digest must
      // at least be the FULL digest — never a truncated prefix of one
      const full = await hashFileAsync(p);
      expect(digest).toBe(full);
    } catch (e) {
      expect((e as Error).message).toBe("cancelled");
    }
  });

  it("checksumLedger persists only the FULL digest even when cancelled mid-run", async () => {
    const root = tmpDir();
    const mount = join(root, "vol");
    const db = new DB(join(tmpDir(), "db.sqlite"));
    try {
      const p = bigFile(mount, "big.wav", 4 * 1024 * 1024);
      const signal = { cancelled: false };
      setTimeout(() => {
        signal.cancelled = true;
      }, 0);
      try {
        await checksumLedger(db, "d1", mount, 8 * 1024 * 1024 * 1024, signal);
      } catch (e) {
        expect((e as Error).message).toBe("cancelled");
      }
      // THE invariant: a persisted row is the full-file digest, or no row
      if (db.ledgerCount("d1") > 0) {
        const stored = db.ledgerGet("d1", "big.wav")!;
        const full = await hashFileAsync(p);
        expect(stored.hash).toBe(full);
      }
    } finally {
      db.close();
    }
  });

  it("cancelled BEFORE the loop starts processes nothing, persists nothing", async () => {
    const root = tmpDir();
    const mount = join(root, "vol");
    const db = new DB(join(tmpDir(), "db.sqlite"));
    try {
      bigFile(mount, "big.wav", 4 * 1024 * 1024);
      const r = await checksumLedger(db, "d1", mount, 8 * 1024 * 1024 * 1024, {
        cancelled: true,
      });
      expect(r.hashed).toBe(0);
      expect(db.ledgerCount("d1")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("a clean (uncancelled) run still baselines the ledger", async () => {
    const root = tmpDir();
    const mount = join(root, "vol");
    const db = new DB(join(tmpDir(), "db.sqlite"));
    try {
      bigFile(mount, "ok.wav", 2 * 1024 * 1024);
      const r = await checksumLedger(db, "d1", mount);
      expect(r.hashed).toBe(1);
      expect(r.changed).toEqual([]);
      expect(db.ledgerCount("d1")).toBe(1);
    } finally {
      db.close();
    }
  });
});
