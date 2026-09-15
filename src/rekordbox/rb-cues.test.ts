import { describe, expect, test } from "bun:test";
import {
  __test,
  HOT_CUE_KIND,
  LOOP_CUE_KIND,
  MAX_HOT_CUES,
  restampScript,
} from "./rb-cues.js";

/** Fake RbCommandRuntime with the green path stubbed; spread overrides in.
 *  One factory instead of seven hand-copied hook objects (jscpd cluster). */
function fakeRuntime(
  overrides: Partial<Parameters<typeof __test.run>[1]> = {},
): Parameters<typeof __test.run>[1] {
  return {
    fileExists: () => true,
    assertClosed: () => {},
    backup: () => "/tmp/master.db.bak",
    restore: () => {},
    sleep: () => {},
    spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    ...overrides,
  };
}

describe("rb-cues constants (F4-pinned semantics)", () => {
  test("HOT_CUE_KIND is 1 — DB-side truth from the Sep 13 F4 spike", () => {
    // The incident's intended hot cues must be Kind=1. Kind=0 remains the
    // legitimate collection-DB value for memory cues.
    expect(HOT_CUE_KIND).toBe(1);
    expect(LOOP_CUE_KIND).toBe(2);
  });

  test("MAX_HOT_CUES matches the 8-pad hardware contract", () => {
    expect(MAX_HOT_CUES).toBe(8);
  });

  test("restamp script contains the hard gates (never bare writes)", () => {
    const s = restampScript();
    expect(s).toContain("Kind == 0");
    expect(s).toContain("r.Kind = 1"); // pinned constant value
    expect(s).toContain("rollback"); // transaction safety
    expect(s).toContain('["pgrep", "-x", "rekordbox"]');
    expect(s).not.toContain("Kind = 0"); // never writes 0
  });

  test("restamp candidates require the proven intake incident signature", () => {
    const s = restampScript();
    expect(s).toContain("incident_start");
    expect(s).toContain("incident_end");
    expect(s).toContain("incident_labels");
    expect(s).toContain("incident_colors");
    expect(s).toContain("content_paths.get(str(cue.ContentID)");
    expect(s).toContain("os.path.commonpath");
    expect(s).toContain('"protected": len(all_kind_zero) - len(rows)');
  });

  test("rejects malformed and partial restamp summaries", () => {
    expect(() => __test.parseRestampOutput("not json", true)).toThrow(
      /malformed JSON/u,
    );
    expect(() =>
      __test.parseRestampOutput(
        JSON.stringify({
          found: 2,
          written: 1,
          protected: 0,
          written_ids: ["42"],
          errors: [],
        }),
        true,
      ),
    ).toThrow(/restamped 1\/2 rows/u);
  });

  test("failed dry-run subprocess fails closed", async () => {
    const result = await __test.run(
      { mount: "/Volumes/TEST" },
      fakeRuntime({
        spawn: () => ({ status: 9, stdout: "", stderr: "boom" }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("census failed (exit 9)");
  });

  test("reports non-incident Kind=0 memory cues as protected", async () => {
    const result = await __test.run(
      { mount: "/Volumes/TEST" },
      fakeRuntime({
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify({
            found: 1,
            written: 0,
            protected: 2,
            written_ids: [],
            errors: [],
          }),
          stderr: "",
        }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.found).toBe(1);
    expect(result.gated[0]?.reason).toContain("2 Kind=0 row(s)");
    expect(result.gated[0]?.reason).toContain("were preserved");
  });

  test("aborts when rekordbox reopens before the write spawn", async () => {
    let checks = 0;
    let spawned = false;
    let restored = false;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRuntime({
        assertClosed: () => {
          checks++;
          if (checks === 2) throw new Error("rekordbox reopened");
        },
        restore: () => {
          restored = true;
        },
        spawn: () => {
          spawned = true;
          throw new Error("must not spawn");
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("rekordbox reopened");
    expect(spawned).toBe(false);
    expect(restored).toBe(true);
  });

  test("zero-check failure and malformed verification fail closed", async () => {
    let call = 0;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRuntime({
        spawn: () => {
          call++;
          return call === 1
            ? {
                status: 0,
                stdout: JSON.stringify({
                  found: 1,
                  written: 1,
                  protected: 0,
                  written_ids: ["42"],
                  errors: [],
                }),
                stderr: "",
              }
            : { status: 0, stdout: "not json", stderr: "" };
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.verifyFailures.join(" ")).toContain("malformed JSON");
  });

  test("restores the DB family when verification rejects a committed restamp", async () => {
    const restores: [string, string][] = [];
    let call = 0;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRuntime({
        restore: (dbPath, backupPath) => {
          restores.push([dbPath, backupPath]);
        },
        spawn: () => {
          call++;
          return call === 1
            ? {
                status: 0,
                stdout: JSON.stringify({
                  found: 1,
                  written: 1,
                  protected: 0,
                  written_ids: ["42"],
                  errors: [],
                }),
                stderr: "",
              }
            : { status: 0, stdout: "not json", stderr: "" };
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("malformed JSON");
    expect(result.error).toContain("restored backup");
    expect(restores).toEqual([
      ["/Volumes/TEST/PIONEER/Master/master.db", "/tmp/master.db.bak"],
    ]);
  });

  test("surfaces both the verification failure and a failed restore", async () => {
    let call = 0;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRuntime({
        restore: () => {
          throw new Error("restore exploded");
        },
        spawn: () => {
          call++;
          return call === 1
            ? {
                status: 0,
                stdout: JSON.stringify({
                  found: 1,
                  written: 1,
                  protected: 0,
                  written_ids: ["42"],
                  errors: [],
                }),
                stderr: "",
              }
            : { status: 0, stdout: "not json", stderr: "" };
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("malformed JSON");
    expect(result.error).toContain("restore exploded");
  });

  test("restores after a nonzero write subprocess exit", async () => {
    let restored = false;
    const result = await __test.run(
      { mount: "/Volumes/TEST", apply: true, yes: true },
      fakeRuntime({
        restore: () => {
          restored = true;
        },
        spawn: () => ({ status: 9, stdout: "", stderr: "boom" }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("restamp failed (exit 9)");
    expect(result.error).toContain("restored backup");
    expect(restored).toBe(true);
  });
});
