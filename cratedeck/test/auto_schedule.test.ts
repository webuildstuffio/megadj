// auto_schedule.test.ts — pure decision logic behind ideas.md §C17
// (on-mount auto-scan + weekly auto-verify). The JobEngine's dedupe,
// interlock, and per-drive concurrency guard everything downstream; these
// tests pin that the DECISION itself is right.
import { describe, expect, it } from "bun:test";
import {
  shouldAutoScan,
  shouldAutoVerify,
  autoVerifyReason,
} from "../src/auto_schedule";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe("shouldAutoScan", () => {
  it("scans on a fresh mount with no snapshot", () => {
    expect(
      shouldAutoScan(
        { mounted: true, justMounted: true, hasFreshSnapshot: false },
        true,
      ),
    ).toBe(true);
  });

  it("skips when a fresh snapshot already exists (quick re-plug)", () => {
    expect(
      shouldAutoScan(
        { mounted: true, justMounted: true, hasFreshSnapshot: true },
        true,
      ),
    ).toBe(false);
  });

  it("never fires for drives that did not just mount", () => {
    expect(
      shouldAutoScan(
        { mounted: true, justMounted: false, hasFreshSnapshot: false },
        true,
      ),
    ).toBe(false);
  });

  it("respects the enabled=false config off-switch", () => {
    expect(
      shouldAutoScan(
        { mounted: true, justMounted: true, hasFreshSnapshot: false },
        false,
      ),
    ).toBe(false);
  });
});

describe("shouldAutoVerify", () => {
  it("verifies a never-verified mounted drive", () => {
    expect(
      shouldAutoVerify(
        { mounted: true, lastVerifyAt: null, hasActiveJob: false, now: NOW },
        7,
      ),
    ).toBe(true);
  });

  it("waits until the interval elapses", () => {
    const sixDays = NOW - 6 * DAY;
    const eightDays = NOW - 8 * DAY;
    expect(
      shouldAutoVerify(
        { mounted: true, lastVerifyAt: sixDays, hasActiveJob: false, now: NOW },
        7,
      ),
    ).toBe(false);
    expect(
      shouldAutoVerify(
        {
          mounted: true,
          lastVerifyAt: eightDays,
          hasActiveJob: false,
          now: NOW,
        },
        7,
      ),
    ).toBe(true);
  });

  it("skips unmounted drives and drives with an active job", () => {
    const stale = NOW - 30 * DAY;
    expect(
      shouldAutoVerify(
        { mounted: false, lastVerifyAt: stale, hasActiveJob: false, now: NOW },
        7,
      ),
    ).toBe(false);
    expect(
      shouldAutoVerify(
        { mounted: true, lastVerifyAt: stale, hasActiveJob: true, now: NOW },
        7,
      ),
    ).toBe(false);
  });

  it("interval 0 disables the whole feature", () => {
    expect(
      shouldAutoVerify(
        { mounted: true, lastVerifyAt: null, hasActiveJob: false, now: NOW },
        0,
      ),
    ).toBe(false);
  });
});

describe("autoVerifyReason", () => {
  it("explains never-verified vs stale", () => {
    expect(
      autoVerifyReason(
        { mounted: true, lastVerifyAt: null, hasActiveJob: false, now: NOW },
        7,
      ),
    ).toContain("never verified");
    const reason = autoVerifyReason(
      {
        mounted: true,
        lastVerifyAt: NOW - 12 * DAY,
        hasActiveJob: false,
        now: NOW,
      },
      7,
    );
    expect(reason).toContain("12d ago");
    expect(reason).toContain("7d");
  });
});
