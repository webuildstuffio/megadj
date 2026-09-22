/**
 * deck-service.test.ts — pins the #247 service SSOT without touching the
 * real launchd domain (the installer end-to-end is a live-operator path;
 * these tests pin what the census class exists to pin: the label, the
 * template's structural invariants, and the state classifier's verdicts).
 */
import { describe, expect, test } from "bun:test";
import {
  DECK_SERVICE_LABEL,
  classifyDeckService,
  plistPath,
  renderPlist,
} from "./deck-service";

describe("deck service SSOT (#247)", () => {
  test("label is the AGENTS.md + issue-pinned name", () => {
    expect(DECK_SERVICE_LABEL).toBe("com.nick.megadj-deck");
  });

  test("plist path sits in ~/Library/LaunchAgents", () => {
    expect(plistPath("/Users/x")).toBe(
      "/Users/x/Library/LaunchAgents/com.nick.megadj-deck.plist",
    );
  });

  test("rendered plist: RunAtLoad + KeepAlive + program args + no leftover placeholders", () => {
    const plist = renderPlist({
      repoRoot: "/repo",
      bunPath: "/repo/.bun/bin/bun",
      stateDir: "/state",
      defaultPort: 7742,
    });
    expect(plist).toContain("<string>com.nick.megadj-deck</string>");
    // The #247 point: KeepAlive + RunAtLoad — the server must survive a
    // crash and a reboot, never reparent to launchd as a bare orphan.
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    // Program arguments: real bun → run → the pinned entry file, with the
    // working directory set to the repo (bun run resolves package.json).
    expect(plist).toContain("<string>/repo/.bun/bin/bun</string>");
    expect(plist).toContain("<string>src/deck/index.ts</string>");
    expect(plist).toContain("<string>/repo</string>");
    // No unrendered placeholders may survive.
    expect(plist).not.toContain("${");
    // Logs go to the state dir (tmp is cleaned under us; state persists).
    expect(plist).toContain("/state/deck.log");
  });

  test("non-default port bakes an env block; default port omits it", () => {
    const withPort = renderPlist({
      repoRoot: "/repo",
      bunPath: "/bun",
      stateDir: "/state",
      port: 59997,
      defaultPort: 7742,
    });
    expect(withPort).toContain("CRATEDECK_PORT");
    expect(withPort).toContain("<string>59997</string>");
    const defaultPort = renderPlist({
      repoRoot: "/repo",
      bunPath: "/bun",
      stateDir: "/state",
      defaultPort: 7742,
    });
    expect(defaultPort).not.toContain("CRATEDECK_PORT");
  });

  test.each([7742, 59997])(
    "plist parser preserves special path characters on port %i",
    (port) => {
      const opts = {
        repoRoot: `/repo & <mixes>/${String.fromCharCode(36)}{BUN_PATH}`,
        bunPath: "/bun $&/bin/bun",
        stateDir: "/state",
        port,
        defaultPort: 7742,
      };
      for (const [key, value] of [
        ["WorkingDirectory", opts.repoRoot],
        ["ProgramArguments.0", opts.bunPath],
        ["StandardOutPath", `${opts.stateDir}/deck.log`],
        ["StandardErrorPath", `${opts.stateDir}/deck.log`],
      ] as const) {
        const parsed = Bun.spawnSync(
          ["plutil", "-extract", key, "raw", "-o", "-", "--", "-"],
          {
            stdin: Buffer.from(renderPlist(opts)),
          },
        );
        expect(parsed.exitCode).toBe(0);
        expect(new TextDecoder().decode(parsed.stdout).trimEnd()).toBe(value);
      }
    },
  );

  test("classifier: the four states with honest fix hints", () => {
    const healthy = classifyDeckService({
      serviceLoaded: true,
      servicePid: 42,
      probeOk: true,
      orphanProbeOk: false,
    });
    expect(healthy.state).toBe("service-running");
    expect(healthy.ok).toBe(true);
    expect(healthy.fix).toBeUndefined();

    const stopped = classifyDeckService({
      serviceLoaded: true,
      servicePid: null,
      probeOk: false,
      orphanProbeOk: false,
    });
    expect(stopped.state).toBe("service-stopped");
    expect(stopped.fix).toContain("kickstart");

    // The #247 incident state: server answers, launchd does not own it.
    const orphan = classifyDeckService({
      serviceLoaded: false,
      servicePid: null,
      probeOk: false,
      orphanProbeOk: true,
    });
    expect(orphan.state).toBe("orphan-process");
    expect(orphan.ok).toBe(false);
    expect(orphan.fix).toContain("deck:install");

    const absent = classifyDeckService({
      serviceLoaded: false,
      servicePid: null,
      probeOk: false,
      orphanProbeOk: false,
    });
    expect(absent.state).toBe("absent");
    expect(absent.fix).toContain("deck:install");
  });
});
