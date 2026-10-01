/**
 * Shared surface-name producers for census tests (surface-parity,
 * docs-surface-names). One parser per surface — import here, not copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_DOCS } from "../command-registry";
import { DECK_MCP_SURFACES } from "../deck/mcp/surfaces";
import { JOB_KINDS } from "../deck/shared/types";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").split("\n") as string[];

/** deckctl verb set: DECK_COMMANDS table + PRE_SERVER_VERBS. */
export function deckctlVerbs(): string[] {
  const src = read("src/deck/deckctl.ts");
  const tableStart = src.findIndex((l) => l.includes("DECK_COMMANDS: Record<"));
  const tableEnd = src.indexOf("};");
  const verbs = src
    .slice(tableStart, tableEnd > tableStart ? tableEnd : src.length)
    .map((l) => l.match(/^\s{2}([a-z-]+):/))
    .map((m) => (m ? m[1] : undefined))
    .filter((v): v is string => v !== undefined);
  const pre = src
    .find((l) => l.includes("PRE_SERVER_VERBS = ["))
    ?.match(/\[([^\]]*)\]/)?.[1];
  if (pre)
    for (const v of pre.split(",").map((s) => s.trim().replace(/['"]/g, "")))
      if (v) verbs.push(v);
  return [...new Set(verbs)].toSorted();
}

/** megadj CLI command set: COMMAND_DOCS + shelf/rekordbox dispatch tables. */
export function megadjCommands(): string[] {
  const verbs = COMMAND_DOCS.map(({ name }) => name);
  for (const f of [
    "src/shelf/cli-commands.ts",
    "src/rekordbox/cli-commands.ts",
    "src/fulltags/cli/cli-commands.ts",
    "src/getdat/cli-commands.ts",
  ]) {
    const src = read(f).join("\n");
    for (const tbl of src.matchAll(
      /export const \w+_COMMANDS(?::[^=]*)?= \{[\s\S]*?\n\};/g,
    )) {
      for (const match of (tbl[0] ?? "").matchAll(/"([a-z-]+)":/g))
        if (match[1]) verbs.push(match[1]);
    }
  }
  return [...new Set(verbs)].toSorted();
}

/** MCP tool keys from source tables + DECK_MCP_SURFACES. */
export function mcpTools(): string[] {
  const files = [
    "src/deck/mcp.ts",
    "src/deck/report/tools.ts",
    "src/getdat/tools.ts",
  ];
  const tools = files
    .flatMap((f) =>
      read(f).map((l) =>
        l.match(/^\s{2,4}((?:deck|archive|getdat|megaset)_[a-z_]+):/),
      ),
    )
    .map((m) => (m ? m[1] : undefined))
    .filter((v): v is string => v !== undefined);
  return [
    ...new Set([...DECK_MCP_SURFACES.map((surface) => surface.tool), ...tools]),
  ].toSorted();
}

/** Runtime SSOT — no jobs.ts text parser. */
export function canonicalJobKinds(): string[] {
  return [...JOB_KINDS].toSorted();
}
