import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDupePairs,
  parseDeleteResult,
  parseScanResult,
  pickKeeper,
  rbDedup,
  type RbDedupDeps,
  type ScanPair,
} from "./rb-dedup.js";
import { scanRow, scanPair } from "../test-support/scan-rows";

/**
 * Pair builder (issue #146 builder 2): a ScanPair whose `other` defaults
 * to a sibling row with the slightly-different len/size this suite's
 * original fixtures used (181 s / 900 B) — per-field overrides still win.
 */
const candidate = (
  id: string,
  path: string,
  overrides: Partial<ScanPair> = {},
): ScanPair =>
  scanPair(id, {
    path,
    other: scanRow(`${id}-other`, {
      path: `${path}.other`,
      len: 181,
      size: 900,
    }),
    ...overrides,
  });

const scanEdge = (
  first: ReturnType<typeof scanRow>,
  second: ReturnType<typeof scanRow>,
): ScanPair => ({
  ...first,
  basis: "candidate",
  other: second,
});

const samePathRow = (id: string): ReturnType<typeof scanRow> =>
  scanRow(id, { path: "/music/shared.aiff", bitrate: 320 });

const samePathEdge = (
  first: ReturnType<typeof samePathRow>,
  second: ReturnType<typeof samePathRow>,
): ScanPair => ({
  ...first,
  basis: "same-path",
  other: second,
});

describe("rb-dedup keeper selection", () => {
  test("prefers the file under Contents/", () => {
    const contents = {
      path: "/Volumes/SHELF1/Contents/Artist/x.aiff",
      size: 1,
      bitrate: 1,
    };
    const intake = {
      path: "/Volumes/SHELF1/Intake/2026-09-11/x.aiff",
      size: 10_000,
      bitrate: 1_000,
    };
    expect(pickKeeper(contents, intake)).toBe("a");
    expect(pickKeeper(intake, contents)).toBe("b");
  });

  test("falls back to stable lexical order when both are Contents", () => {
    expect(
      pickKeeper(
        { path: "/a/x", size: 10, bitrate: 256 },
        { path: "/b/x", size: 10, bitrate: 256 },
      ),
    ).toBe("a");
    expect(
      pickKeeper(
        { path: "/b/x", size: 10, bitrate: 256 },
        { path: "/a/x", size: 10, bitrate: 256 },
      ),
    ).toBe("b");
  });

  test("prefers higher bitrate, then larger file, before lexical order", () => {
    expect(
      pickKeeper(
        { path: "/a/x", size: 2_000, bitrate: 256 },
        { path: "/b/x", size: 1_000, bitrate: 320 },
      ),
    ).toBe("b");
    expect(
      pickKeeper(
        { path: "/a/x", size: 1_000, bitrate: 320 },
        { path: "/b/x", size: 2_000, bitrate: 320 },
      ),
    ).toBe("b");
  });
});

describe("rb-dedup fingerprint judgment", () => {
  test("same title and ±2s duration with distinct fingerprints emits no mutation", () => {
    const pair = candidate("a", "/music/a.aiff");
    const fingerprints = new Map([
      [pair.path, "AQID_same-prefix-A_B-1"],
      [pair.other.path, "AQID_same-prefix-A_B-2"],
    ]);
    expect(
      buildDupePairs([pair], (path) => fingerprints.get(path) ?? null),
    ).toEqual([]);
  });

  test("full base64url fingerprint equality is retained and is the honest basis", () => {
    const pair = candidate("a", "/music/a.aiff");
    const full = "AQID-_-full-base64url-tail";
    const result = buildDupePairs([pair], () => full);
    expect(result).toHaveLength(1);
    expect(result[0]?.basis).toBe("fingerprint");
  });

  test("transitive duplicate edges collapse the whole component", () => {
    const ab = candidate("a", "/music/a.aiff", {
      other: scanRow("b", { path: "/music/b.aiff", len: 181, size: 900 }),
    });
    const bc = candidate("b", "/music/b.aiff", {
      other: scanRow("c", { path: "/music/c.aiff", len: 182, size: 800 }),
    });
    const result = buildDupePairs([ab, bc], () => "same-full-fingerprint");
    expect(result.map(({ keepId, loseId }) => [keepId, loseId])).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });

  test("a three-row duplicate cluster keeps one canonical row and removes both losers", () => {
    const ab = candidate("a", "/music/a.aiff", {
      other: scanRow("b", { path: "/music/b.aiff", len: 181, size: 900 }),
    });
    const ac = candidate("a", "/music/a.aiff", {
      other: scanRow("c", { path: "/music/c.aiff", len: 182, size: 800 }),
    });
    const bc = candidate("b", "/music/b.aiff", {
      other: scanRow("c", { path: "/music/c.aiff", len: 182, size: 800 }),
    });

    const result = buildDupePairs([ab, ac, bc], () => "same-fingerprint");
    expect(result.map(({ keepId, loseId }) => [keepId, loseId])).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });

  test("cluster keeper selection is global and independent of edge order", () => {
    const a = scanRow("a", { bitrate: 128, size: 800 });
    const b = scanRow("b", { bitrate: 192, size: 900 });
    const c = scanRow("c", { bitrate: 320, size: 1_200 });

    for (const edges of [
      [scanEdge(a, b), scanEdge(a, c), scanEdge(b, c)],
      [scanEdge(b, c), scanEdge(a, b), scanEdge(a, c)],
    ]) {
      const result = buildDupePairs(edges, () => "same-fingerprint");
      expect(result.map(({ keepId }) => keepId)).toEqual(["c", "c"]);
      expect(new Set(result.map(({ loseId }) => loseId))).toEqual(
        new Set(["a", "b"]),
      );
    }
  });

  test("same-path cluster ties keep the oldest numeric Rekordbox id", () => {
    const two = samePathRow("2");
    const ten = samePathRow("10");
    const eleven = samePathRow("11");

    const result = buildDupePairs([
      samePathEdge(two, ten),
      samePathEdge(two, eleven),
      samePathEdge(ten, eleven),
    ]);
    expect(result.map(({ keepId }) => keepId)).toEqual(["2", "2"]);
  });
});

describe("rb-dedup subprocess boundaries", () => {
  test("rejects malformed and structurally invalid scan payloads", () => {
    expect(() => parseScanResult("not-json")).toThrow(
      "rb-dedup scan returned malformed JSON",
    );
    expect(() => parseScanResult('{"scanned":1,"pairs":[{}]}')).toThrow(
      "rb-dedup scan returned invalid JSON",
    );
  });

  test("rejects malformed and structurally invalid delete payloads", () => {
    expect(() => parseDeleteResult("not-json")).toThrow(
      "rb-dedup delete returned malformed JSON",
    );
    expect(() => parseDeleteResult('{"removed":"1","errors":[]}')).toThrow(
      "rb-dedup delete returned invalid JSON",
    );
    expect(() =>
      parseDeleteResult(
        '{"removed_ids":["unexpected"],"errors":[],"associations":[{"keep_id":"keep","playlists":[],"cue_signatures":[]}]}',
        ["requested"],
      ),
    ).toThrow("acknowledgements do not match requested loser ids");
  });
});

const applyPair = candidate("keep", "/mnt/Contents/Artist/keep.aiff", {
  other: scanRow("lose", {
    path: "/mnt/Contents/Artist/lose.aiff",
    size: 900,
  }),
});

const commandResult = (stdout: string) => ({
  status: 0,
  stdout,
  stderr: "",
});

function applyDeps(
  deletePayload: string,
  verifyPayload: string,
  overrides: Partial<RbDedupDeps> = {},
  pairs: ScanPair[] = [applyPair],
): RbDedupDeps {
  const deleteValue = JSON.parse(deletePayload) as Record<string, unknown>;
  const removedIds = deleteValue.removed_ids;
  if (
    Array.isArray(removedIds) &&
    removedIds.every(
      (loseId: unknown): loseId is string => typeof loseId === "string",
    ) &&
    !Array.isArray(deleteValue.associations)
  ) {
    deleteValue.associations = removedIds.map((loseId) => {
      const pair = pairs.find((p) => p.id === loseId || p.other.id === loseId);
      return {
        keep_id:
          pair === undefined
            ? "keep"
            : pair.id === loseId
              ? pair.other.id
              : pair.id,
        playlists: [],
        cue_signatures: [],
      };
    });
  }
  const verifyValue = JSON.parse(verifyPayload) as {
    rows?: Record<string, unknown>[];
  };
  for (const row of verifyValue.rows ?? []) {
    row.playlists ??= [];
    row.cue_signatures ??= [];
    row.cue_owners_valid ??= true;
  }
  const outputs = [
    commandResult(JSON.stringify({ scanned: pairs.length * 2, pairs })),
    commandResult(JSON.stringify(deleteValue)),
    commandResult(JSON.stringify(verifyValue)),
  ];
  return {
    assertClosed: () => {},
    backup: () => "/backup/master.db",
    spawn: () => outputs.shift() ?? commandResult("{}"),
    fingerprint: () => "same-full-fingerprint",
    fileExists: () => true,
    realpath: (path) => path,
    mkdir: () => {},
    rename: () => {},
    writeFile: () => {},
    remove: () => {},
    restore: () => {},
    sleep: async () => {},
    now: () => new Date("2026-09-14T00:00:00Z"),
    ...overrides,
  };
}

describe("rb-dedup apply safety", () => {
  test("rekordbox reopening before backup prevents backup and delete", async () => {
    let checks = 0;
    let backups = 0;
    let spawns = 0;
    const deps = applyDeps(
      '{"removed_ids":["lose"],"errors":[]}',
      '{"rows":[{"id":"keep","path":"/mnt/Contents/Artist/keep.aiff"}]}',
      {
        assertClosed: () => {
          checks++;
          if (checks === 2) throw new Error("rekordbox reopened");
        },
        backup: () => {
          backups++;
          return "/backup/master.db";
        },
      },
    );
    const spawn = deps.spawn;
    deps.spawn = (...args) => {
      spawns++;
      return spawn(...args);
    };

    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox reopened");
    expect(checks).toBe(2);
    expect(backups).toBe(0);
    expect(spawns).toBe(1); // scan only
  });

  test("cross-volume paths are rejected before backup, delete, or rename", async () => {
    const outside = candidate(
      "outside-keep",
      "/Volumes/flip-master/Contents/Artist/keep.aiff",
      {
        basis: "path-twin",
        other: scanRow("inside-lose", {
          path: "/mnt/Contents/Artist/lose.aiff",
          size: 900,
        }),
      },
    );
    let backups = 0;
    let renames = 0;
    let spawns = 0;
    const deps = applyDeps(
      '{"removed_ids":["inside-lose"],"errors":[]}',
      '{"rows":[]}',
      {
        backup: () => {
          backups++;
          return "/backup/master.db";
        },
        rename: () => {
          renames++;
        },
      },
      [outside],
    );
    const spawn = deps.spawn;
    deps.spawn = (...args) => {
      spawns++;
      return spawn(...args);
    };
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside selected Contents root");
    expect(backups).toBe(0);
    expect(renames).toBe(0);
    expect(spawns).toBe(1); // read-only scan only
  });

  test("casefold path twins retire only the duplicate row and never move shared bytes", async () => {
    const twin = candidate("keep-twin", "/mnt/Contents/Artist/Track.aiff", {
      basis: "path-twin",
      other: scanRow("lose-twin", {
        path: "/mnt/Contents/artist/TRACK.aiff",
        size: 900,
      }),
    });
    let renames = 0;
    let receipts = 0;
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":["lose-twin"],"errors":[]}',
        '{"rows":[{"id":"keep-twin","path":"/mnt/Contents/Artist/Track.aiff"}]}',
        {
          rename: () => {
            renames++;
          },
          writeFile: () => {
            receipts++;
          },
        },
        [twin],
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.quarantined).toEqual([]);
    expect(renames).toBe(0);
    expect(receipts).toBe(0);
  });

  test("equal resolved paths are row-only and an unresolvable identity fails closed", async () => {
    let renames = 0;
    const sharedResult = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":["lose"],"errors":[]}',
        '{"rows":[{"id":"keep","path":"/mnt/Contents/Artist/keep.aiff"}]}',
        {
          realpath: (path) =>
            path === "/mnt/Contents"
              ? path
              : "/mnt/Contents/Artist/shared.aiff",
          rename: () => {
            renames++;
          },
        },
      ),
    );
    expect(sharedResult.ok).toBe(true);
    expect(sharedResult.removed).toBe(1);
    expect(renames).toBe(0);

    let backups = 0;
    let spawns = 0;
    const deps = applyDeps(
      '{"removed_ids":["lose"],"errors":[]}',
      '{"rows":[]}',
      {
        realpath: (path) => {
          if (path.endsWith("lose.aiff"))
            throw new Error("identity unreadable");
          return path;
        },
        backup: () => {
          backups++;
          return "/backup/master.db";
        },
      },
    );
    const spawn = deps.spawn;
    deps.spawn = (...args) => {
      spawns++;
      return spawn(...args);
    };
    const failedResult = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      deps,
    );
    expect(failedResult.ok).toBe(false);
    expect(failedResult.error).toContain("identity unreadable");
    expect(backups).toBe(0);
    expect(spawns).toBe(1);
  });

  test("partial row deletion fails closed and reports exact surviving state", async () => {
    const restores: string[] = [];
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":[],"errors":[["lose","locked"]]}',
        '{"rows":[{"id":"keep","path":"/mnt/Contents/Artist/keep.aiff"},{"id":"lose","path":"/mnt/Contents/Artist/lose.aiff"}]}',
        { restore: (db, backup) => restores.push(`${backup} -> ${db}`) },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.removed).toBe(0);
    expect(result.error).toContain("lose: locked");
    expect(result.error).toContain("loser rows still present: lose");
    expect(result.error).toContain("restored from backup");
    expect(restores).toEqual([
      "/backup/master.db -> /mnt/PIONEER/Master/master.db",
    ]);
  });

  test("quarantine rename failure is an honest failed apply", async () => {
    let restored = false;
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":["lose"],"errors":[]}',
        '{"rows":[{"id":"keep","path":"/mnt/Contents/Artist/keep.aiff"}]}',
        {
          rename: () =>
            void (() => {
              throw new Error("disk full");
            })(),
          restore: () => {
            restored = true;
          },
        },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.removed).toBe(0);
    expect(result.quarantined).toEqual([]);
    expect(result.error).toContain("quarantine failed");
    expect(result.error).toContain("disk full");
    expect(result.error).toContain("restored from backup");
    expect(restored).toBe(true);
  });

  test("fresh re-read mismatch fails closed with keeper and loser details", async () => {
    const renames: string[] = [];
    let restored = false;
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":["lose"],"errors":[]}',
        '{"rows":[{"id":"keep","path":"/wrong/path.aiff"},{"id":"lose","path":"/mnt/Contents/Artist/lose.aiff"}]}',
        {
          rename: (from, to) => renames.push(`${from} -> ${to}`),
          restore: () => {
            restored = true;
          },
        },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("loser rows still present: lose");
    expect(result.error).toContain("keeper path mismatch: keep");
    expect(result.error).toContain("restored from backup");
    expect(restored).toBe(true);
    expect(renames).toHaveLength(2); // quarantine, then reverse compensation
  });

  test("unique playlist memberships and cue semantics are re-homed and verified", async () => {
    const scripts: string[] = [];
    const deps = applyDeps(
      JSON.stringify({
        removed_ids: ["lose"],
        errors: [],
        associations: [
          {
            keep_id: "keep",
            playlists: [["playlist-1", 7]],
            cue_signatures: ["cue-semantic-hash"],
          },
        ],
      }),
      JSON.stringify({
        rows: [
          {
            id: "keep",
            path: "/mnt/Contents/Artist/keep.aiff",
            playlists: [["playlist-1", 7]],
            cue_signatures: ["cue-semantic-hash"],
          },
        ],
      }),
    );
    const spawn = deps.spawn;
    deps.spawn = (command, args, options) => {
      scripts.push(args[5] ?? "");
      return spawn(command, args, options);
    };
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(scripts[1]).toContain("sp.ContentID = keep_id");
    expect(scripts[1]).toContain("cue.ContentID = keep_id");
    expect(scripts[1]).toContain("cue.ContentUUID = keeper.UUID");
    expect(scripts[1]).toContain("if len(keeper_cues) >= 8:");
    expect(scripts[2]).toContain('"cue_owners_valid"');
  });

  test("association verification mismatch restores DB and quarantined file", async () => {
    let restored = false;
    const renames: string[] = [];
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        JSON.stringify({
          removed_ids: ["lose"],
          errors: [],
          associations: [
            {
              keep_id: "keep",
              playlists: [["playlist-1", 7]],
              cue_signatures: ["cue-semantic-hash"],
            },
          ],
        }),
        JSON.stringify({
          rows: [
            {
              id: "keep",
              path: "/mnt/Contents/Artist/keep.aiff",
              playlists: [],
              cue_signatures: [],
              cue_owners_valid: false,
            },
          ],
        }),
        {
          rename: (from, to) => renames.push(`${from} -> ${to}`),
          restore: () => {
            restored = true;
          },
        },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("playlist associations mismatch: keep");
    expect(result.error).toContain("cue associations mismatch: keep");
    expect(result.error).toContain("cue ownership mismatch: keep");
    expect(restored).toBe(true);
    expect(renames).toHaveLength(2);
  });

  test("receipt failure restores DB and reverses quarantine", async () => {
    let restored = false;
    const renames: string[] = [];
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":["lose"],"errors":[]}',
        '{"rows":[{"id":"keep","path":"/mnt/Contents/Artist/keep.aiff"}]}',
        {
          rename: (from, to) => renames.push(`${from} -> ${to}`),
          writeFile: () => {
            throw new Error("receipt disk full");
          },
          restore: () => {
            restored = true;
          },
        },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("receipt disk full");
    expect(result.error).toContain("restored from backup");
    expect(restored).toBe(true);
    expect(renames).toHaveLength(2);
  });

  test("two same-basename losers receive collision-proof destinations", async () => {
    const first = candidate("keep-a", "/mnt/Contents/Artist A/keep.aiff", {
      other: scanRow("lose-a", {
        path: "/mnt/Contents/Artist A/same.aiff",
        size: 900,
      }),
    });
    const second = candidate("keep-b", "/mnt/Contents/Artist B/keep.aiff", {
      other: scanRow("lose-b", {
        path: "/mnt/Contents/Artist B/same.aiff",
        size: 900,
      }),
    });
    const destinations: string[] = [];
    const result = await rbDedup(
      { mount: "/mnt", apply: true, yes: true },
      applyDeps(
        '{"removed_ids":["lose-a","lose-b"],"errors":[]}',
        '{"rows":[{"id":"keep-a","path":"/mnt/Contents/Artist A/keep.aiff"},{"id":"keep-b","path":"/mnt/Contents/Artist B/keep.aiff"}]}',
        {
          fingerprint: () => "same-full-fingerprint",
          rename: (_from, to) => destinations.push(to),
        },
        [first, second],
      ),
    );
    expect(result.ok).toBe(true);
    expect(destinations).toHaveLength(2);
    expect(new Set(destinations).size).toBe(2);
  });

  test("a same-day rerun preserves an existing quarantine destination", async () => {
    const mount = mkdtempSync(join(tmpdir(), "rb-dedup-collision-"));
    const pair = candidate(
      "keep-rerun",
      join(mount, "Contents", "Artist", "keep.aiff"),
      {
        other: scanRow("lose-rerun", {
          path: join(mount, "Contents", "Artist", "same.aiff"),
          size: 900,
        }),
      },
    );
    const qdir = join(mount, "Quarantine", "rb-dedup-2026-09-14");
    mkdirSync(qdir, { recursive: true });
    const existing = join(qdir, "Artist · same.aiff");
    writeFileSync(existing, "prior run");
    const destinations: string[] = [];
    try {
      const result = await rbDedup(
        { mount, apply: true, yes: true },
        applyDeps(
          '{"removed_ids":["lose-rerun"],"errors":[]}',
          JSON.stringify({
            rows: [{ id: "keep-rerun", path: pair.path }],
          }),
          {
            fingerprint: () => "same-full-fingerprint",
            rename: (_from, to) => destinations.push(to),
            mkdir: (path) => mkdirSync(path, { recursive: true }),
          },
          [pair],
        ),
      );
      expect(result.ok).toBe(true);
      expect(destinations).toEqual([join(qdir, "Artist · same (2).aiff")]);
      expect(Bun.file(existing).size).toBeGreaterThan(0);
    } finally {
      rmSync(mount, { recursive: true, force: true });
    }
  });
});
