import { describe, expect, test } from "bun:test";
import { nodeLine, parseXmlNodes } from "./rb-playlist-reconcile.js";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<MASTER_PLAYLIST Version="3.0.0">
  <PRODUCT Name="rekordbox" Version="7.2.7" Company="Pioneer DJ"/>
  <PLAYLISTS>
    <NODE Id="30D40" ParentId="0" Attribute="0" Timestamp="1788520613420" Lib_Type="0" CheckType="0"/>
    <NODE Name="DJ-Imports" Id="6D4C8F32" ParentId="0" Attribute="1" Timestamp="1788520613421" Lib_Type="0" CheckType="0"/>
    <NODE Name="2026-09-11 intake" Id="6D4C9233" ParentId="6D4C8F32" Attribute="0" Timestamp="1788520613422" Lib_Type="0" CheckType="0"/>
  </PLAYLISTS>
</MASTER_PLAYLIST>
`;

describe("rb-playlist-reconcile XML parsing (RB7 hex-id format)", () => {
  test("extracts NODEs and converts hex Id → DB decimal id", () => {
    const nodes = parseXmlNodes(SAMPLE);
    expect(nodes.length).toBe(3);
    // 0x30D40 = 200000 (the CUE Analysis Playlist family)
    const internal = nodes.find((n) => n.hexId === "30D40");
    expect(internal?.id).toBe("200000");
    expect(internal?.name).toBeNull(); // internal nodes carry no Name
    const folder = nodes.find((n) => n.hexId === "6D4C8F32");
    expect(folder?.name).toBe("DJ-Imports");
    expect(folder?.attribute).toBe(1);
    const intake = nodes.find((n) => n.name === "2026-09-11 intake");
    // parent link resolves to the folder's DB id, not its hex form
    expect(intake?.parentId).toBe(String(0x6d4c8f32));
  });

  test("nodeLine emits hex Id + RB7 attrs and escapes XML-special names", () => {
    const line = nodeLine({
      name: "Dub & Bass <remix>",
      id: "123",
      parentId: "0",
      attribute: 0,
    });
    expect(line).toContain('Id="7B"'); // 123 → 7B hex
    expect(line).toContain("Dub &amp; Bass &lt;remix&gt;");
    expect(line).toContain('Lib_Type="0"');
    // parent hex too
    const nested = nodeLine({
      name: "x",
      id: "200",
      parentId: "123",
      attribute: 0,
    });
    expect(nested).toContain('ParentId="7B"');
    expect(nested).toContain('Id="C8"');
  });
});
