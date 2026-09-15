// record-ledger.test.ts — #74: the ledger base's one contract — a corrupt
// payload row reads as ABSENT through the shared guard, never throws into
// a query, and every ledger reports the row id in its diagnostic.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { RecordLedger } from "./record-ledger";

class ProbeLedger extends RecordLedger {
  constructor(db: Database) {
    super(db, () => "2026-09-15T00:00:00.000Z");
  }

  put(videoId: string, payload: string): void {
    this.upsert("probe", videoId, ["payload"], [payload]);
  }

  read(videoId: string): unknown {
    const row = this.row<{ payload: string }>("probe", videoId, ["payload"]);
    if (!row) return null;
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("expected a JSON object");
      }
      return parsed;
    } catch (error) {
      return this.absorbParseFailure(error, `probe ${videoId}`, (m) =>
        this.warnings.push(m),
      );
    }
  }

  readonly warnings: string[] = [];
}

describe("RecordLedger base (#74)", () => {
  test("upsert is idempotent by video_id with fresh timestamps", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE probe (video_id TEXT PRIMARY KEY, payload TEXT)");
    const ledger = new ProbeLedger(db);
    ledger.put("a", '{"v":1}');
    ledger.put("a", '{"v":2}');
    expect(ledger.read("a")).toEqual({ v: 2 });
    expect(
      db.query("SELECT COUNT(*) n FROM probe").get() as { n: number },
    ).toEqual({ n: 1 });
  });

  test("corrupt JSON row reads as absent + names the row (ONE guard home)", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE probe (video_id TEXT PRIMARY KEY, payload TEXT)");
    const ledger = new ProbeLedger(db);
    ledger.put("bad", "{not json");
    expect(ledger.read("bad")).toBeNull();
    expect(ledger.warnings.join("\n")).toContain("probe bad");
  });

  test("structurally invalid JSON reads as absent too (not just syntax)", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE probe (video_id TEXT PRIMARY KEY, payload TEXT)");
    const ledger = new ProbeLedger(db);
    ledger.put("shape", '["not","an","object"]');
    expect(ledger.read("shape")).toBeNull();
    expect(ledger.warnings.join("\n")).toContain("expected a JSON object");
  });

  test("missing row is null without a diagnostic", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE probe (video_id TEXT PRIMARY KEY, payload TEXT)");
    const ledger = new ProbeLedger(db);
    expect(ledger.read("missing")).toBeNull();
    expect(ledger.warnings).toEqual([]);
  });
});
