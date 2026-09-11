import { describe, expect, test } from "bun:test";
import { numOpt, parseFlags } from "./cli-flags";

describe("CLI flag parsing", () => {
  test("a later explicit false overrides an earlier boolean flag", () => {
    const flags = parseFlags(["--json", "--json=false"], [], ["json"]);

    expect(flags.bools.has("json")).toBe(false);
  });

  test("non-finite numeric options are ignored", () => {
    const flags = parseFlags(["--jobs", "Infinity"], ["jobs"], []);

    expect(numOpt(flags, "jobs")).toBeUndefined();
  });
});
