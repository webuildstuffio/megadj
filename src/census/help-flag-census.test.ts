/**
 * help-flag-census.test.ts — audit gap G1's root-cause tripwire.
 *
 * The drift class: help documents a flag the parser never accepts
 * (`rb-comment-sync --limit N` shipped for months; parseFlags silently
 * ignored the unknown string, so an agent scripting it thought the
 * batch was bounded while nothing was bounded). #143 removed the stale
 * block and moved help into the command-doc producer leaves, but nothing
 * pinned flag TRUTH — a new block can lie again the same way.
 *
 * This census cross-checks, per command:
 *   1. every `--flag` the registry block advertises must be accepted by
 *      the command's dispatch arm, and
 *   2. the reverse: every flag the dispatch arm accepts must be
 *      advertised (a usable-but-undiscoverable flag is half an agent
 *      surface — P1 makes the help the agent-facing contract).
 *
 * Flag truth comes from source on both sides. A dispatch arm declares
 * its accepted flags in exactly one of three shapes (all parsed here):
 *   a. parseFlags(rest, stringOpts, boolOpts) — the standard seam;
 *   b. `manyOf(rest, "flag")` / `rest.includes("--flag")` — raw parses;
 *   c. a shared helper's flag block (rbWriteOpts's playlist/group pair)
 *      or HAND_PARSED below — every entry carries a reason.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_DOCS } from "../command-registry";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/** verb → dispatch source file. The four domain command records (#235:
 *  rekordbox joined from the dissolved maintenance table) + the shelf
 *  runners (exported fns, no table). */
const DISPATCH_FILES = [
  "src/getdat/cli-commands.ts",
  "src/shelf/cli-commands.ts",
  "src/fulltags/cli-commands.ts",
  "src/rekordbox/cli-commands.ts",
  "src/shelf/cli-cmds.ts",
];

/** verb → flags the arm accepts via raw rest-parses that no parseFlags
 *  list declares. Every entry needs a reason. */
const HAND_PARSED: Readonly<Record<string, readonly string[]>> = {
  status: ["json"], // rest.includes contract (statusCommand)
  list: ["json"], // rest.includes contract
  retry: ["json"], // rest.includes contract
  audit: ["json"], // rest.includes contract
  adopt: ["shelf", "apply", "json"], // rest.includes contract
  "shelf-sync": ["json", "dry-run"], // cli-cmds.ts rest-parses
  "shelf-archive": ["json", "dry-run", "deep", "trashes", "into", "suffix"],
  "shelf-sweeps": ["json"], // cli-cmds.ts
  "shelf-dedupe": ["apply", "yes", "json"], // cli-cmds.ts rest-parses
  "shelf-dupescan": [
    "json",
    "quarantine",
    "yes",
    "only-identical",
    "scan-dir", // index-walk pair parse
  ],
  "shelf-hygiene": ["confirm", "dismiss"], // manyOf repeatable list flags
};

/** verb → flags that are implementation seams, not agent-facing options
 *  (a help line advertising them would LIE by implying they shape the
 *  product behavior; they name internal anchors). Reason-carrying. */
const NOT_AGENT_FLAGS: Readonly<Record<string, readonly string[]>> = {
  ingest: ["ingest", "folder"], // positional-anchor stringOpts (AGENTS
  // stringOpts contract — the anchor word is the command token itself)
  drop: ["drop", "target", "max-beat-seconds"], // same anchor class
  convert: ["convert"], // anchor
  similar: ["similar", "k", "space"], // anchor + covered by help copy
  boothFixAnchor: [],
};

interface ArmFlags {
  strings: Set<string>;
  bools: Set<string>;
}

const emptyFlags = (): ArmFlags => ({ strings: new Set(), bools: new Set() });

/** Extract a function body that starts at `start` (the `const name =`
 *  or `function name(`) and ends before the next top-level decl. */
function bodyFrom(src: string, start: number): string {
  const rest = src.slice(start);
  const next = rest.slice(1).search(/\n(?:const|export|function) /);
  return rest.slice(0, next === -1 ? rest.length : next + 1);
}

function flagsFromBody(body: string, into: ArmFlags): void {
  // parseFlags(...): the stringOpts list is the FIRST bracket group, the
  // boolOpts the second. Requiring two bracket groups keeps other calls
  // out; flat string arrays are the only legal shape here.
  for (const call of body.matchAll(/parseFlags\(([^;]*?)\)\s*[;.)]/g)) {
    const inside = call[1] ?? "";
    const lists = [...inside.matchAll(/\[([^\][]*)\]/g)].map((m) => m[1] ?? "");
    if (lists.length < 2) continue; // never a flags-call shape
    for (const s of (lists[0] ?? "").matchAll(/"([a-z][a-z-]+)"/g))
      if (s[1]) into.strings.add(s[1]);
    for (const b of (lists[1] ?? "").matchAll(/"([a-z][a-z-]+)"/g))
      if (b[1]) into.bools.add(b[1]);
  }
  // positionalArgs/firstPositional carry MORE stringOpts (the same list
  // by contract — the stringOpts bug class); union them in.
  for (const p of body.matchAll(
    /(?:positionalArgs|firstPositional)\([^;]*?\[([^\]]*)\]/g,
  )) {
    for (const s of (p[1] ?? "").matchAll(/"([a-z][a-z-]+)"/g))
      if (s[1]) into.strings.add(s[1]);
  }
  // manyOf(rest, "flag") — repeatable raw-parsed list flags
  for (const p of body.matchAll(/manyOf\(\s*\w+,\s*"([a-z][a-z-]+)"\s*\)/g)) {
    if (p[1]) into.strings.add(p[1]);
  }
  // rest.includes("--flag") — the raw boolean contract
  for (const p of body.matchAll(/rest\.includes\("--([a-z][a-z-]+)"\)/g)) {
    if (p[1]) into.bools.add(p[1]);
  }
  // --x= prefix scans (shelf-archive's `--into=` / `--suffix=`)
  for (const p of body.matchAll(/startsWith\("--([a-z][a-z-]+)="?\)/g)) {
    if (p[1]) into.strings.add(p[1]);
  }
}

/** Shared option-block helpers: callers gain their flags from the
 *  helper's declared surface. Keyed by helper fn name. */
const SHARED_OPT_HELPERS: Readonly<
  Record<string, { strings: readonly string[]; bools: readonly string[] }>
> = {
  // rbWriteOpts (rekordbox/cli-commands.ts): the playlist+group+apply/yes+json block
  rbWriteOpts: {
    strings: ["playlist", "group"],
    bools: ["apply", "yes", "json"],
  },
};

interface RegistryEntry {
  name: string;
  block: string[];
}

function registryEntries(): RegistryEntry[] {
  return COMMAND_DOCS.map(({ name, block }) => ({ name, block }));
}

/** verb → accepted flags, derived from dispatch source. */
function dispatchFlags(): Map<string, ArmFlags> {
  const out = new Map<string, ArmFlags>();
  for (const file of DISPATCH_FILES) {
    const src = read(file);
    // 1. per-handler flag sets: every `const <name> =` body
    const handlerFlags = new Map<string, ArmFlags>();
    for (const m of src.matchAll(/^const (\w+)(?::\s*[\w<>, ]+)?\s*= /gm)) {
      const handler = m[1];
      if (!handler || handler === "runMaintenanceCommand") continue;
      const body = bodyFrom(src, m.index ?? 0);
      const flags = emptyFlags();
      flagsFromBody(body, flags);
      for (const [helper, shared] of Object.entries(SHARED_OPT_HELPERS)) {
        if (new RegExp(`\\b${helper}\\(`).test(body)) {
          for (const s of shared.strings) flags.strings.add(s);
          for (const b of shared.bools) flags.bools.add(b);
        }
      }
      handlerFlags.set(handler, flags);
    }
    // 2. verb → handler, from every export table's body. Rows come in
    // three shapes — shorthand `doctor,` · mapped `sync: syncCommand,` ·
    // quoted `"rb-adopt": rbAdoptCmd,` — and the value must start with a
    // lowercase identifier (generic-parameter rows like `json: boolean`
    // have no handler const and skip on the handler lookup below).
    // First: factory arrow bodies (`const organizeOrEnrich = (command:
    // "a" | "b") => async ...`) — one shared body parses the same flag
    // list for every verb it produces; stored under `name#body` so the
    // factory table rows below can resolve them.
    for (const m of src.matchAll(
      /^const (\w+)\s*=\s*\(command: [\w " |]+\): \w+ =>\s*$/gm,
    )) {
      const factory = m[1];
      if (!factory) continue;
      const body = bodyFrom(src, m.index ?? 0);
      const flags = emptyFlags();
      flagsFromBody(body, flags);
      handlerFlags.set(`${factory}#body`, flags);
    }
    for (const tbl of src.matchAll(/= \{([\s\S]*?)\n\};/g)) {
      const body = tbl[1] ?? "";
      for (const t of body.matchAll(/"([a-z][a-z-]+)": (\w+),/g)) {
        const verb = t[1];
        const handler = t[2];
        if (!verb || !handler) continue;
        const flags = handlerFlags.get(handler);
        if (flags) out.set(verb, flags);
      }
      for (const t of body.matchAll(/^\s{2}([a-z][a-z-]+): (\w+),$/gm)) {
        const verb = t[1];
        const handler = t[2];
        if (!verb || !handler) continue;
        const flags = handlerFlags.get(handler);
        if (flags) out.set(verb, flags);
      }
      for (const t of body.matchAll(/^\s{2}([a-z][a-z-]+),$/gm)) {
        const verb = t[1];
        const handler = t[1];
        if (!verb || !handler) continue;
        const flags = handlerFlags.get(handler);
        if (flags) out.set(verb, flags);
      }
      // factory rows: `verb: factory("verb")` — the factory's own body
      // (a `const factory = (arg) => async (rest...)` arrow) carries the
      // flags; bind them to each produced verb.
      for (const t of body.matchAll(
        /^\s{2}([a-z][a-z-]+): (\w+)\("([a-z][a-z-]+)"\),$/gm,
      )) {
        const verb = t[1];
        const factory = t[2];
        if (!verb || !factory) continue;
        const factoryBody = handlerFlags.get(`${factory}#body`);
        if (factoryBody) out.set(verb, factoryBody);
      }
    }
    // 3. cli-cmds runners: exported functions called from the
    // shelf/cli-commands wrapper — map runShelfX to the shelf verb
    for (const m of src.matchAll(/export async function (runShelf\w+)\(/g)) {
      const fn = m[1];
      if (!fn) continue;
      const body = bodyFrom(src, m.index ?? 0);
      const flags = emptyFlags();
      flagsFromBody(body, flags);
      const verb = fn
        .replace(/^runShelf/, "")
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
      if (verb === "sync" || verb === "archive" || verb === "sweeps")
        out.set(`shelf-${verb}`, flags);
    }
  }
  return out;
}

describe("help-flag census (audit gap G1: help can't lie about flags)", () => {
  const entries = registryEntries();
  const flags = dispatchFlags();

  test("the census is live, not vacuous", () => {
    expect(entries.length).toBeGreaterThan(30);
    expect(flags.size).toBeGreaterThanOrEqual(40);
    // the drift that started this must stay caught: rb-comment-sync
    // accepts batch (string) + apply/yes/json (bools) — nothing else
    const rcs = flags.get("rb-comment-sync");
    expect(rcs?.strings.has("batch")).toBeTrue();
    expect(rcs?.strings.has("limit")).toBeFalse();
  });

  test("every advertised --flag is accepted by the dispatch arm", () => {
    const problems: string[] = [];
    for (const { name, block } of entries) {
      const helpText = block.join(" ");
      const advertised = [...helpText.matchAll(/--([a-z][a-z-]+)/g)].map(
        (m) => m[1] ?? "",
      );
      for (const flag of advertised) {
        const known =
          flags.get(name)?.strings.has(flag) === true ||
          flags.get(name)?.bools.has(flag) === true ||
          (HAND_PARSED[name] ?? []).includes(flag);
        if (!known) {
          problems.push(
            `${name}: help advertises --${flag} but the arm never accepts it (G1 class: an agent scripting it thinks it shaped the run while nothing happened)`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("every accepted agent-facing --flag is advertised in help", () => {
    const problems: string[] = [];
    for (const [name, arm] of flags) {
      // a verb may have MULTIPLE registry blocks (rb-playlist reconcile vs
      // the set-builder arm) — the flag must appear in the union of them,
      // not just the first; `.find()` here let a fully-documented second
      // block fail the census because the first lacked the flags.
      const helpText = entries
        .filter((e) => e.name === name)
        .map((e) => e.block.join(" "))
        .join(" ");
      if (helpText === "") continue; // registry↔dispatch parity is the help census
      for (const flag of [...arm.strings, ...arm.bools]) {
        if (helpText.includes(`--${flag}`)) continue;
        if ((HAND_PARSED[name] ?? []).includes(flag)) continue;
        // positional-anchor stringOpts name the command token / a
        // positional alias, not agent-facing option flags
        if ((NOT_AGENT_FLAGS[name] ?? []).includes(flag) || flag === name)
          continue;
        problems.push(
          `${name}: arm accepts --${flag} but help never mentions it (a usable flag half the agent surface can't discover)`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
