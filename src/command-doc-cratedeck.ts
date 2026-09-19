import type { CommandDocEntry } from "./command-doc-types";

export const CRATEDECK_COMMAND_DOCS: readonly CommandDocEntry[] = [
  {
    name: "tmp-purge",
    group: "cratedeck",
    block: [
      "  megadj tmp-purge [--state] [--apply] [--all] [--json]",
      "                                               sweep stale test fixture dirs from the OS tmpdir (--state:",
      "                                               the ~/.local/state/megadj backup/sidecar/spike tier, newest",
      "                                               lineage backup kept); age-gated >24h, read-only without --apply",
    ],
  },
  {
    name: "doctor",
    group: "cratedeck",
    block: [
      "  megadj doctor  [--json]                      one-shot dependency/env/config diagnostics (exit 1 if broken)",
    ],
  },
  {
    name: "init",
    group: "cratedeck",
    block: [
      "  megadj init                                  first-run bootstrap: scaffold config.toml + doctor",
    ],
  },
];
