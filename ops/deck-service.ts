/**
 * deck-service.ts — the launchd service SSOT for the CrateDeck server
 * (#247). The AGENTS.md restart trap used to target a service that did
 * not exist: the live server ran as a reparented orphan (ppid 1, no
 * KeepAlive, no boot persistence — a reboot silently left no deck
 * server). This module owns everything knowable about that service so
 * the installer (deck-install.ts) and the doctor probe
 * (src/shared/doctor-checks.ts checkDeckService) cannot drift apart:
 *
 *   - the service label (com.nick.megadj-deck)
 *   - the plist template (placeholders; rendered at install time with
 *     THIS machine's repo root + bun path — a committed plist with a
 *     baked absolute path would be a private-path-in-git violation)
 *   - the state classifier (installed-and-running / installed-stopped /
 *     orphan / absent) shared by the installer's verdict and doctor's
 *     check, with one fix hint per state.
 */
import { join } from "node:path";

/** The launchd label. Renaming this is a breaking operator change —
 *  the plist path, the installer, doctor, and AGENTS.md all name it. */
export const DECK_SERVICE_LABEL = "com.nick.megadj-deck";

/** ~/Library/LaunchAgents plist path for the label (homedir supplied —
 *  pure module, testable without a real home). */
export function plistPath(homedir: string): string {
  return join(
    homedir,
    "Library",
    "LaunchAgents",
    `${DECK_SERVICE_LABEL}.plist`,
  );
}

/** The plist template. ${REPO_ROOT} / ${BUN_PATH} / ${PORT_ENV} render at
 *  install time. RunAtLoad + KeepAlive are the whole point (#247): the
 *  server survives crashes and reboots instead of dying with its parent
 *  shell. stdout/stderr land in the megadj state dir (rotated by size —
 *  launchd appends). */
export const PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${DECK_SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>\${BUN_PATH}</string>
        <string>run</string>
        <string>cratedeck/src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>\${REPO_ROOT}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>\${STATE_DIR}/deck.log</string>
    <key>StandardErrorPath</key>
    <string>\${STATE_DIR}/deck.log</string>
</dict>
</plist>
`;

/** Render the template with this machine's paths. `port` bakes an
 *  EnvironmentVariables block ONLY when a non-default port was resolved
 *  at install time (the server defaults to 7742 per server-port.ts; a
 *  non-default port must survive launchd's clean env). */
export function renderPlist(opts: {
  repoRoot: string;
  bunPath: string;
  stateDir: string;
  port?: number | undefined;
  defaultPort: number;
}): string {
  const portEnv =
    opts.port !== undefined && opts.port !== opts.defaultPort
      ? `    <key>EnvironmentVariables</key>\n    <dict>\n        <key>CRATEDECK_PORT</key>\n        <string>${opts.port}</string>\n    </dict>\n    `
      : "";
  const runAtLoadKey = "    <key>RunAtLoad</key>";
  // Substitute once: paths may contain XML characters, $&, or template tokens.
  return PLIST_TEMPLATE.replace(
    runAtLoadKey,
    `${portEnv}${runAtLoadKey}`,
  ).replace(
    /\$\{(REPO_ROOT|BUN_PATH|STATE_DIR)\}/g,
    (_token: string, key: string) => {
      const path =
        key === "REPO_ROOT"
          ? opts.repoRoot
          : key === "BUN_PATH"
            ? opts.bunPath
            : opts.stateDir;
      return path
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    },
  );
}

/** The four observable states of the deck server, and the one fix hint
 *  per state. `probeOk` = a live HTTP probe of /api/interlock succeeded;
 *  `serviceLoaded` = launchctl knows the label; `pid` = the service's
 *  pid when launchd reports one. */
export type DeckServiceState =
  "service-running" | "service-stopped" | "orphan-process" | "absent";

export interface DeckServiceVerdict {
  state: DeckServiceState;
  ok: boolean;
  detail: string;
  fix: string | undefined;
  /** The launchd-reported pid when state is service-running. */
  pid?: number | undefined;
}

/** Classify raw observations into a verdict. Pure — the installer and
 *  doctor each gather the observations their context can see. */
export function classifyDeckService(input: {
  serviceLoaded: boolean;
  servicePid: number | null;
  probeOk: boolean;
  /** A bun cratedeck/src/index.ts process is listening but launchd does
   *  not know the label (the Sep 18 orphan: ppid 1, no KeepAlive). */
  orphanProbeOk: boolean;
}): DeckServiceVerdict {
  const install = `bun run deck:install`;
  if (input.serviceLoaded) {
    if (input.probeOk)
      return {
        state: "service-running",
        ok: true,
        detail: `launchd service running${input.servicePid ? ` (pid ${input.servicePid})` : ""}, HTTP healthy`,
        fix: undefined,
        pid: input.servicePid ?? undefined,
      };
    return {
      state: "service-stopped",
      ok: false,
      detail:
        "service registered but not answering — likely mid-restart or crashed in a loop",
      fix: `launchctl kickstart -k gui/$(id -u)/${DECK_SERVICE_LABEL}, then check ${"~/.local/state/megadj/deck.log"}`,
    };
  }
  if (input.orphanProbeOk)
    return {
      state: "orphan-process",
      ok: false,
      detail:
        "a bare deck server answers but launchd does not own it (no KeepAlive, dies on reboot — the #247 orphan class)",
      fix: `${install} (it replaces the orphan with the kept-alive service)`,
    };
  return {
    state: "absent",
    ok: false,
    detail: "no launchd service and no server answering",
    fix: `${install} — or bun run deck for a one-off foreground run`,
  };
}
