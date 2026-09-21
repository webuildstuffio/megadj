// #283 dedupe-key tests — the set-level dedupe that keeps one recording
// (across its release-form/stray variants) from landing twice in a set.
import { describe, expect, test } from "bun:test";
import { __test } from "./pool";

const key = (artist: string | null, title: string | null): string =>
  __test.poolTitleKey({ artist, title });

describe("#283 poolTitleKey (release-form + stray folding)", () => {
  test("release-form parentheticals collapse to one key", () => {
    expect(key("Cristoph", "EPOCH (Original Mix)")).toBe(
      key("Cristoph", "Epoch"),
    );
  });

  test("bracketed suffixes (closed and UNCLOSED/truncated) strip", () => {
    expect(key("Cristoph", "Epoch (Original Mix) [Pryda Presentation")).toBe(
      key("Cristoph", "EPOCH (Original Mix)"),
    );
  });

  test("unknown-artist strays lend the title-embedded artist back", () => {
    // the live 3×-Epoch incident, Sep 20: same recording, tagged row +
    // shelf-rescue stray with a lost-tag title, must share ONE key
    expect(
      key("UnknownArtist", "cristoph - epoch (original mix) [pryda prese"),
    ).toBe(key("Cristoph", "EPOCH (Original Mix)"));
    expect(key("Unknown", "cristoph - epoch (original mix).wav")).toBe(
      key("Cristoph", "Epoch"),
    );
  });

  test("remix attributions stay distinct tracks", () => {
    expect(key("Shiba San", "I Wanna (Tchami Extended Remix)")).not.toBe(
      key("Shiba San", "I Wanna"),
    );
  });
});
