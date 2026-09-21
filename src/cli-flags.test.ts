import { describe, expect, test } from "bun:test";
import {
  firstPositional,
  nonNegOpt,
  nonNegOptInvalid,
  parseFlags,
  positionalArgs,
  repeatedOf,
} from "./cli-flags";

describe("CLI flag parsing", () => {
  test("a later explicit false overrides an earlier boolean flag", () => {
    const flags = parseFlags(["--json", "--json=false"], [], ["json"]);

    expect(flags.bools.has("json")).toBe(false);
  });

  test("invalid numeric input errors loudly (silent numOpt retired)", () => {
    const flags = parseFlags(["--jobs", "Infinity"], ["jobs"], []);

    expect(nonNegOptInvalid(flags, "jobs", "t")).toBe(true);
    process.exitCode = undefined;
  });
});

describe("positionalArgs / firstPositional — flag values are not positionals", () => {
  test("space-form flag value is not mistaken for the positional", () => {
    // the ingest class: `--min-duration 30 <folder>` returned "30"
    expect(
      positionalArgs(["--min-duration", "30", "/x/dump"], ["min-duration"]),
    ).toEqual(["/x/dump"]);
    expect(
      firstPositional(["--min-duration", "30", "/x/dump"], "ingest", [
        "ingest",
        "folder",
        "min-duration",
      ]),
    ).toBe("/x/dump");
  });

  test("= form and bare flags never eat the next arg", () => {
    expect(
      positionalArgs(["--min-duration=30", "/x"], ["min-duration"]),
    ).toEqual(["/x"]);
    expect(positionalArgs(["--dry-run", "/x"], ["min-duration"])).toEqual([
      "/x",
    ]);
  });

  test("value that itself looks like a flag stays unconsumed (both parsers skip it)", () => {
    // parseFlags also refuses a --prefixed value; positionals must too
    expect(
      positionalArgs(["--min-duration", "--json", "/x"], ["min-duration"]),
    ).toEqual(["/x"]);
  });

  test("command word is skipped, real positionals survive", () => {
    expect(firstPositional(["ingest", "/x/dump"], "ingest", ["folder"])).toBe(
      "/x/dump",
    );
    expect(firstPositional(["ingest"], "ingest", [])).toBeUndefined();
  });
});

describe("nonNegOpt — the loud numeric boundary (numOpt retired)", () => {
  test("absent flag is undefined, valid value parses", () => {
    const flags = parseFlags(["--limit", "5"], ["limit"], []);
    expect(nonNegOpt(flags, "limit", "cmd")).toBe(5);
    expect(
      nonNegOpt(parseFlags([], ["limit"], []), "limit", "cmd"),
    ).toBeUndefined();
  });

  test("invalid input errors: exit 2 signal, undefined returned", () => {
    const flags = parseFlags(["--limit", "abc"], ["limit"], []);
    expect(nonNegOptInvalid(flags, "limit", "cmd")).toBe(true);
    // the epilogue stamped a usage error (exit 2, zero-work contract)
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
  });

  test("zero is a VALID non-negative value (old numOpt mapped 0 → undefined = unlimited)", () => {
    const flags = parseFlags(["--limit", "0"], ["limit"], []);
    expect(nonNegOpt(flags, "limit", "cmd")).toBe(0);
    expect(nonNegOptInvalid(flags, "limit", "cmd")).toBe(false);
  });

  test("repeatedOf collects REPEATED space-form values (parseFlags is last-wins)", () => {
    // The Sep 21 sync bug: `--sc-url A --sc-url B --sc-url C --sc-url D`
    // synced only D — the strings map kept the last value.
    expect(
      repeatedOf(
        ["--sc-url", "https://a", "--limit", "5", "--sc-url", "https://b"],
        "sc-url",
      ),
    ).toEqual(["https://a", "https://b"]);
    // eq-form and mixed forms both count
    expect(
      repeatedOf(["--sc-url=https://c", "--sc-url", "https://d"], "sc-url"),
    ).toEqual(["https://c", "https://d"]);
    // a flag-shaped token is a VALUE boundary, not a value (parseFlags rule)
    expect(repeatedOf(["--sc-url", "--force-rip"], "sc-url")).toEqual([]);
    // other keys untouched
    expect(repeatedOf(["--cookies", "f.txt"], "sc-url")).toEqual([]);
  });
});
