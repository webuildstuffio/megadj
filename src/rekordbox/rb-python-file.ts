/**
 * rb-python-file — the corpus-file python spawn family (pyUvArgv,
 * pyUvFileArgv, renderKitMarkers, rbPythonFile) + the kit-marker
 * renderer, extracted from rb-command-kit (Sep 21) to break the
 * rb-command-kit ↔ guard runtime cycle: guard's verifyReRead needs the
 * spawn leg while rb-command-kit composes guard's interlock fns. This
 * module imports ONLY node stdlib + rb-script-kit fragments — it is the
 * dependency-free bottom of the rb-* module graph.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { incidentCuePredicatePython } from "./cue-incident.js";
import {
  PY_CUE_SIG_BLOCK,
  PY_FIND_PLAYLIST_FN,
  PY_MATCH_TRACK_STEP,
  PY_RID_FN,
  pyAddSongPlaylist,
  pyContentMatchPreamble,
  pyDbOpen,
  pyDbOpenBlock,
  pyDbOpenImports,
  pyEnsurePlaylistLadder,
  pyPathKeyFn,
} from "./rb-script-kit.js";

/** ONE rekordbox-closed guard so the two gates can never drift apart
 *  (process list, flags, semantics) — moved with the renderer because
 *  the guard string IS python-source text. */
export const RB_CLOSED_PY_GUARD =
  'if subprocess.run(["pgrep", "-x", "rekordbox"], capture_output=True).returncode == 0:';

/** THE python-subprocess argv (#68): `["run","--with",pkg,"python","-c",
 *  script, …args]` — every rb-* python spawn (direct rbPythonRun, DI
 *  deps.spawn sites, runPyScript) assembles its command line HERE. The
 *  `--with` package defaults to plain "pyrekordbox"; the pinned PYRK_TAG
 *  fork spec rides as an explicit `withPkg`. A pyrekordbox API change is
 *  a one-line edit, not a seven-site hunt. */
export function pyUvArgv(opts: {
  script: string;
  args?: string[];
  withPkg?: string;
}): string[] {
  return [
    "run",
    "--with",
    opts.withPkg ?? "pyrekordbox",
    "python",
    "-c",
    opts.script,
    ...(opts.args ?? []),
  ];
}

/** DI-runtime variant of rbPythonFile (#194): renders a corpus file's
 *  kit markers and returns the same argv shape pyUvArgv produces, so
 *  deps.spawn sites run the corpus without a second spawn contract. */
export function pyUvFileArgv(opts: {
  file: string;
  args?: string[];
  withPkg?: string;
}): string[] {
  const script = renderKitMarkers(
    readFileSync(join(import.meta.dir, "rb-scripts", opts.file), "utf8"),
  );
  return pyUvArgv({
    script,
    ...(opts.args === undefined ? {} : { args: opts.args }),
    ...(opts.withPkg === undefined ? {} : { withPkg: opts.withPkg }),
  });
}

/** The corpus twin of rbPythonRun (#194): `uv run --with <pkg> python
 *  <file> [argv…]` where <file> lives in src/rekordbox/rb-scripts/. The
 *  python corpus is mypy/ruff-gated (pyproject files list) exactly like
 *  cratedeck/python — an inline -c string cannot be. New scripts go in
 *  the corpus, not into another template literal.
 *
 *  Composed programs (#194 acceptance): a corpus file may embed
 *  `#@kit(NAME)` marker lines where an rb-script-kit fragment belongs
 *  (`#@kit(pyPathKeyFn)`, `#@kit(pyEnsurePlaylistLadder reuse)`, …).
 *  Markers are rendered by `renderKitMarkers` immediately before the
 *  spawn — the kit fragment stays the single SSOT, the corpus file stays
 *  a real lintable python program. */
export function renderKitMarkers(source: string): string {
  const out: string[] = [];
  for (const line of source.split("\n")) {
    const match =
      /^[ \t]*#[ \t]*[@]kit[(](\w+)(?:[ \t]+([^)]*))?(?:;([ \t]*\d+[ \t]*))?[)][ \t]*$/u.exec(
        line,
      );
    if (!match) {
      out.push(line);
      continue;
    }
    const name: string = match[1] ?? "";
    const arg = match[2]?.trim() ?? "";
    const indent = match[3]
      ? " ".repeat(Math.max(0, parseInt(match[3], 10) || 0))
      : "";
    const rendered = renderKitFragment(name, arg);
    if (rendered === null)
      throw new Error(`rb-scripts: unknown #@kit(${name}) marker`);
    const body = rendered.replace(/^\n+|\n+$/g, "");
    // Preserve the fragment's INTERNAL relative indentation: every line
    // shifts by the marker's indent, keeping intra-fragment offsets.
    const bodyLines = body.split("\n");
    const base = Math.min(
      ...bodyLines
        .filter((l) => l.trim() !== "")
        .map((l) => l.length - l.trimStart().length),
    );
    out.push(
      bodyLines
        .map((l) => (l.trim() === "" ? l : indent + l.slice(base)))
        .join("\n"),
    );
  }
  return out.join("\n");
}

/** Marker name → rb-script-kit fragment. One table so a fragment rename
 *  is one edit here plus the corpus file. */
function renderKitFragment(name: string, arg: string): string | null {
  switch (name) {
    case "pyPathKeyFn":
      return pyPathKeyFn();
    case "pyContentMatchPreamble":
      return pyContentMatchPreamble();
    case "PY_MATCH_TRACK_STEP":
      return PY_MATCH_TRACK_STEP;
    case "PY_FIND_PLAYLIST_FN":
      return PY_FIND_PLAYLIST_FN;
    case "PY_RID_FN":
      return PY_RID_FN;
    case "PY_CUE_SIG_BLOCK":
      return PY_CUE_SIG_BLOCK;
    case "pyDbOpenBlock":
      return pyDbOpenBlock(arg || "sys.argv[1]");
    case "pyDbOpenImports":
      return pyDbOpenImports();
    case "pyDbOpen":
      return pyDbOpen(arg || "sys.argv[1]");
    case "RB_CLOSED_PY_GUARD":
      return RB_CLOSED_PY_GUARD;
    case "pyEnsurePlaylistLadder": {
      // arg is "<createMissingGroup>|<onExisting>", e.g. "true|reuse"
      const [group, existing] = arg.split("|").map((p) => p.trim());
      if (group === undefined || existing === undefined) return null;
      if (group !== "true" && group !== "false") return null;
      if (existing !== "refuse" && existing !== "reuse") return null;
      return pyEnsurePlaylistLadder({
        createMissingGroup: group === "true",
        onExisting: existing,
      });
    }
    case "pyAddSongPlaylist":
      return pyAddSongPlaylist("sp", "pl.ID", "cid", "track_no + 1");
    case "incidentCuePredicatePython":
      return incidentCuePredicatePython();
    default:
      return null;
  }
}

/** The corpus twin of rbPythonRun (#194): `uv run --with <pkg> python
 *  <file> [argv…]` where <file> lives in src/rekordbox/rb-scripts/. */
export function rbPythonFile(opts: {
  /** Corpus file NAME (not path) — resolved against rb-scripts/. */
  file: string;
  args?: string[];
  timeoutMs: number;
  withPkg?: string;
  maxBuffer?: number;
  input?: string;
}): { status: number | null; stdout: string; stderr: string } {
  const file = join(import.meta.dir, "rb-scripts", opts.file);
  const script = renderKitMarkers(readFileSync(file, "utf8"));
  const result = spawnSync(
    "uv",
    [
      "run",
      "--with",
      opts.withPkg ?? "pyrekordbox",
      "python",
      "-c",
      script,
      ...(opts.args ?? []),
    ],
    {
      encoding: "utf8",
      timeout: opts.timeoutMs,
      ...(opts.maxBuffer === undefined ? {} : { maxBuffer: opts.maxBuffer }),
      ...(opts.input === undefined ? {} : { input: opts.input }),
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
