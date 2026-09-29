/**
 * playlist-evidence.test.ts — Tests for playlist genre evidence (B4.6).
 */
import { describe, expect, test } from "bun:test";
import { extractPlaylistEvidence } from "./playlist-evidence";

function makeTrack(playlistId: string, videoId: string, genre: string | null) {
  return { playlist_id: playlistId, video_id: videoId, genre };
}

describe("extractPlaylistEvidence", () => {
  test("playlist ≥70% one family produces evidence", () => {
    const playlists = [{ playlist_id: "p1", playlist_name: "House Vibes" }];
    const tracks = [
      makeTrack("p1", "v1", "house"),
      makeTrack("p1", "v2", "deep house"),
      makeTrack("p1", "v3", "house"),
      makeTrack("p1", "v4", "house"),
      makeTrack("p1", "v5", "techno"),
    ];
    const { evidence, stats } = extractPlaylistEvidence(playlists, tracks);
    expect(stats.playlistsQualified).toBe(1);
    expect(stats.details[0]!.family).toBe("house");
    expect(evidence.length).toBe(5); // all tracks get evidence
    expect(evidence[0]!.scope).toBe("user");
    expect(evidence[0]!.genreFamily).toBe("house");
  });

  test("playlist <70% one family produces no evidence", () => {
    const playlists = [{ playlist_id: "p1", playlist_name: "Mixed Bag" }];
    const tracks = [
      makeTrack("p1", "v1", "house"),
      makeTrack("p1", "v2", "techno"),
      makeTrack("p1", "v3", "drum and bass"),
      makeTrack("p1", "v4", "trance"),
      makeTrack("p1", "v5", "dubstep"),
    ];
    const { evidence, stats } = extractPlaylistEvidence(playlists, tracks);
    expect(stats.playlistsQualified).toBe(0);
    expect(evidence).toHaveLength(0);
  });

  test("playlist too small (<5 tracks) is skipped", () => {
    const playlists = [{ playlist_id: "p1", playlist_name: "Tiny" }];
    const tracks = [
      makeTrack("p1", "v1", "house"),
      makeTrack("p1", "v2", "house"),
      makeTrack("p1", "v3", "house"),
    ];
    const { evidence, stats } = extractPlaylistEvidence(playlists, tracks);
    expect(stats.playlistsQualified).toBe(0);
    expect(evidence).toHaveLength(0);
  });

  test("tracks with null genre are excluded from family counting", () => {
    const playlists = [{ playlist_id: "p1", playlist_name: "House+" }];
    const tracks = [
      makeTrack("p1", "v1", "house"),
      makeTrack("p1", "v2", "house"),
      makeTrack("p1", "v3", "house"),
      makeTrack("p1", "v4", null),
      makeTrack("p1", "v5", null),
      makeTrack("p1", "v6", "house"),
      makeTrack("p1", "v7", null),
    ];
    const { evidence, stats } = extractPlaylistEvidence(playlists, tracks);
    // 4 house out of 4 with genre = 100%
    expect(stats.playlistsQualified).toBe(1);
    expect(evidence).toHaveLength(7); // all tracks incl. null-genre
  });

  test("multiple playlists each evaluated independently", () => {
    const playlists = [
      { playlist_id: "p1", playlist_name: "House Set" },
      { playlist_id: "p2", playlist_name: "Techno Set" },
    ];
    const tracks = [
      makeTrack("p1", "v1", "house"),
      makeTrack("p1", "v2", "house"),
      makeTrack("p1", "v3", "house"),
      makeTrack("p1", "v4", "house"),
      makeTrack("p1", "v5", "house"),
      makeTrack("p2", "v6", "techno"),
      makeTrack("p2", "v7", "techno"),
      makeTrack("p2", "v8", "techno"),
      makeTrack("p2", "v9", "techno"),
      makeTrack("p2", "v10", "techno"),
    ];
    const { evidence, stats } = extractPlaylistEvidence(playlists, tracks);
    expect(stats.playlistsQualified).toBe(2);
    expect(stats.details).toHaveLength(2);
    expect(stats.details[0]!.family).toBe("house");
    expect(stats.details[1]!.family).toBe("techno");
    expect(evidence).toHaveLength(10);
  });

  test("annotatorId includes playlist name lowercase", () => {
    const playlists = [{ playlist_id: "p1", playlist_name: "Deep House" }];
    const tracks = [
      makeTrack("p1", "v1", "house"),
      makeTrack("p1", "v2", "house"),
      makeTrack("p1", "v3", "house"),
      makeTrack("p1", "v4", "house"),
      makeTrack("p1", "v5", "house"),
    ];
    const { evidence } = extractPlaylistEvidence(playlists, tracks);
    expect(evidence[0]!.annotatorId).toBe("user:playlist:deep house");
  });

  test("empty input → empty output", () => {
    const { evidence, stats } = extractPlaylistEvidence([], []);
    expect(stats.playlistsExamined).toBe(0);
    expect(stats.playlistsQualified).toBe(0);
    expect(evidence).toHaveLength(0);
  });
});
