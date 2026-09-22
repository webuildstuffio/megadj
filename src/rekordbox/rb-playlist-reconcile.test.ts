import { describe, expect, test } from "bun:test";
import {
  inAgentScope,
  nodeLine,
  parseXmlNodes,
} from "./rb-playlist-reconcile.js";

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

  test("nodeLine preserves 64-bit playlist ids exactly", () => {
    const line = nodeLine({
      name: "Large ids",
      id: "9007199254740993",
      parentId: "9007199254740995",
      attribute: 0,
    });
    expect(line).toContain('Id="20000000000001"');
    expect(line).toContain('ParentId="20000000000003"');
  });
});

describe("inAgentScope (#282 subtree scoping)", () => {
  // DJ-Imports(10) → intake(11,12); MegaSets(20) → set(21) → nested(22);
  // a user playlist (30) at root; an orphan parent (99) pointing nowhere.
  const rows = new Map(
    [
      { id: "10", parentId: "0" },
      { id: "11", parentId: "10" },
      { id: "12", parentId: "10" },
      { id: "20", parentId: "0" },
      { id: "21", parentId: "20" },
      { id: "22", parentId: "21" },
      { id: "30", parentId: "0" },
      { id: "31", parentId: "30" },
      { id: "99", parentId: "98" }, // dangling parent (deleted folder)
    ].map((r) => [r.id, r] as const),
  );
  const roots = new Set(["10", "20"]);

  test("the root itself and every descendant are in scope", () => {
    expect(inAgentScope("10", rows, roots)).toBe(true);
    expect(inAgentScope("11", rows, roots)).toBe(true);
    expect(inAgentScope("22", rows, roots)).toBe(true); // two levels deep
  });

  test("RB-managed rows outside the agent roots are out of scope", () => {
    expect(inAgentScope("30", rows, roots)).toBe(false);
    expect(inAgentScope("31", rows, roots)).toBe(false);
  });

  test("a row with a dangling parent chain is out of scope", () => {
    expect(inAgentScope("99", rows, roots)).toBe(false);
  });

  test("an unknown id is out of scope", () => {
    expect(inAgentScope("404", rows, roots)).toBe(false);
  });

  test("a corrupt parent cycle cannot hang the walk", () => {
    const cyclic = new Map([
      ["5", { id: "5", parentId: "6" }],
      ["6", { id: "6", parentId: "5" }],
    ] as const);
    expect(inAgentScope("5", cyclic, roots)).toBe(false);
  });

  test("empty roots scope nothing", () => {
    expect(inAgentScope("10", rows, new Set())).toBe(false);
  });
});
