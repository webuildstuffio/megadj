import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlaylistTwinMutation, playlistXmlPath } from "./rb-playlist-twin";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<MASTER_PLAYLIST Version="3.0.0">
  <PLAYLISTS>
  </PLAYLISTS>
</MASTER_PLAYLIST>
`;

describe("playlist DB/XML twin mutation", () => {
  test("writes and verifies both twins while preserving 64-bit ids", () => {
    const dir = mkdtempSync("/tmp/rb-playlist-twin-");
    const dbPath = join(dir, "master.db");
    const xmlPath = playlistXmlPath(dbPath);
    writeFileSync(dbPath, "original-db");
    writeFileSync(xmlPath, XML);
    try {
      const result = applyPlaylistTwinMutation({
        dbPath,
        what: "test playlist write",
        mutateDb: () => {
          writeFileSync(dbPath, "mutated-db");
          return { playlistId: "9007199254740993" };
        },
        nodes: ({ playlistId }) => [
          {
            id: playlistId,
            name: "64-bit & safe",
            parentId: "0",
            attribute: 0,
          },
        ],
        verifyDb: () => expect(readFileSync(dbPath, "utf8")).toBe("mutated-db"),
        testHooks: { assertClosed: () => {}, sleep: () => {} },
      });

      expect(result.value.playlistId).toBe("9007199254740993");
      const xml = readFileSync(xmlPath, "utf8");
      expect(xml).toContain('Name="64-bit &amp; safe"');
      expect(xml).toContain('Id="20000000000001"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an XML failure restores the DB and XML backups", () => {
    const dir = mkdtempSync("/tmp/rb-playlist-twin-rollback-");
    const dbPath = join(dir, "master.db");
    const xmlPath = playlistXmlPath(dbPath);
    writeFileSync(dbPath, "original-db");
    writeFileSync(xmlPath, XML);
    try {
      expect(() =>
        applyPlaylistTwinMutation({
          dbPath,
          what: "test playlist rollback",
          mutateDb: () => {
            writeFileSync(dbPath, "mutated-db");
            return { playlistId: "42" };
          },
          nodes: ({ playlistId }) => [
            {
              id: playlistId,
              name: "will fail",
              parentId: "0",
              attribute: 0,
            },
          ],
          verifyDb: () => {},
          testHooks: {
            assertClosed: () => {},
            sleep: () => {},
            writeXml: () => {
              throw new Error("simulated XML write failure");
            },
          },
        }),
      ).toThrow(/restored DB and XML/u);
      expect(readFileSync(dbPath, "utf8")).toBe("original-db");
      expect(readFileSync(xmlPath, "utf8")).toBe(XML);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a stale same-id XML node is repaired to the DB metadata", () => {
    const dir = mkdtempSync("/tmp/rb-playlist-twin-repair-");
    const dbPath = join(dir, "master.db");
    const xmlPath = playlistXmlPath(dbPath);
    writeFileSync(dbPath, "original-db");
    writeFileSync(
      xmlPath,
      XML.replace(
        "  </PLAYLISTS>",
        '    <NODE Name="Stale" Id="2A" ParentId="0" Attribute="1" Timestamp="0" Lib_Type="0" CheckType="0"/>\n  </PLAYLISTS>',
      ),
    );
    try {
      applyPlaylistTwinMutation({
        dbPath,
        what: "test playlist repair",
        mutateDb: () => ({ playlistId: "42" }),
        nodes: ({ playlistId }) => [
          {
            id: playlistId,
            name: "Current",
            parentId: "7",
            attribute: 0,
          },
        ],
        verifyDb: () => {},
        testHooks: { assertClosed: () => {}, sleep: () => {} },
      });

      const xml = readFileSync(xmlPath, "utf8");
      expect(xml).toContain(
        'Name="Current" Id="2A" ParentId="7" Attribute="0"',
      );
      expect(xml).not.toContain('Name="Stale"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every playlist mutation routes through the twin seam", () => {
    for (const file of [
      "rb-import.ts",
      "rb-playlist.ts",
      "rb-playlist-reconcile.ts",
    ]) {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      expect(source, file).toContain("applyPlaylistTwinMutation({");
      expect(source, file).not.toContain("copyFileSync(dbPath");
    }
  });

  test("reconcile compares XML metadata, not only node ids", () => {
    const source = readFileSync(
      join(import.meta.dir, "rb-playlist-reconcile.ts"),
      "utf8",
    );
    expect(source).toContain("xmlNode.name !== p.name");
    expect(source).toContain("xmlNode.parentId !== p.parentId");
    expect(source).toContain("xmlNode.attribute !== p.attribute");
  });
});
