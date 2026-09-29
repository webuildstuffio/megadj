/**
 * ak5-modes.test.ts — Tests for CrateDeck AK5 modes (B6.5).
 */
import { describe, expect, test } from "bun:test";
import {
  createAK5Session,
  addDispute,
  addTriplet,
  addEnergyPair,
  sessionStats,
} from "./ak5-modes";

describe("AK5 session", () => {
  test("creates empty session", () => {
    const session = createAK5Session("dispute");
    expect(session.mode).toBe("dispute");
    expect(session.disputes).toHaveLength(0);
  });

  test("adds dispute verdict", () => {
    let session = createAK5Session("dispute");
    session = addDispute(session, {
      trackId: "t1",
      proposedFamily: "house",
      chosenFamily: "house",
      confirmed: true,
      timestamp: new Date().toISOString(),
    });
    expect(session.disputes).toHaveLength(1);
    expect(session.disputes[0]!.confirmed).toBe(true);
  });

  test("adds triplet judgment", () => {
    let session = createAK5Session("triplet");
    session = addTriplet(session, {
      anchorId: "t1",
      moreSimId: "t2",
      lessSimId: "t3",
      timestamp: new Date().toISOString(),
    });
    expect(session.triplets).toHaveLength(1);
  });

  test("adds energy pair judgment", () => {
    let session = createAK5Session("energy-pair");
    session = addEnergyPair(session, {
      winnerId: "t1",
      loserId: "t2",
      timestamp: new Date().toISOString(),
    });
    expect(session.energyPairs).toHaveLength(1);
  });

  test("sessionStats counts overrides", () => {
    let session = createAK5Session("dispute");
    session = addDispute(session, {
      trackId: "t1",
      proposedFamily: "house",
      chosenFamily: "house",
      confirmed: true,
      timestamp: new Date().toISOString(),
    });
    session = addDispute(session, {
      trackId: "t2",
      proposedFamily: "house",
      chosenFamily: "techno",
      confirmed: false,
      timestamp: new Date().toISOString(),
    });
    const stats = sessionStats(session);
    expect(stats.total).toBe(2);
    expect(stats.overrides).toBe(1);
    expect(stats.confirmRate).toBe(0.5);
  });
});
