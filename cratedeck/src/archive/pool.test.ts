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

  // Sep 21 live audit: "Other Side (Extended)" + "Other Side (Extended
  // Mix)" landed twice in one chain — the BARE release form ("(extended)"
  // without the trailing noun) keyed differently from the compound form.
  test("BARE release forms collapse ('(Extended)' ≡ '(Extended Mix)')", () => {
    expect(key("Azzecca", "Other Side (Extended)")).toBe(
      key("Azzecca", "Other Side (Extended Mix)"),
    );
    expect(key("Azzecca", "Other Side")).toBe(
      key("Azzecca", "Other Side (Radio Edit)"),
    );
  });

  // Sep 21 live audit: multi-credit artist string vs solo credit keyed
  // differently for the same recording — head credit is the identity.
  test("multi-credit artist collapses to the HEAD credit", () => {
    expect(
      key(
        "Hugel, Cumbiafrica, Florent Hugel, Lina Rojas",
        "Morenita (Extended Mix)",
      ),
    ).toBe(key("HUGEL", "Morenita"));
    // a DIFFERENT head credit stays distinct (never a substring merge)
    expect(key("John Summit", "History of Groove")).not.toBe(
      key("SecondCity", "History of Groove"),
    );
  });

  // Sep 21 live audit: ".mp3" rode INSIDE a tagged title and defeated the key.
  test("file extension inside a TAGGED title strips too", () => {
    expect(
      key("Shakira ft. Wyclef Jean", "Hips Don't Lie (HÄWK VIP Edit).mp3"),
    ).toBe(key("Shakira ft. Wyclef Jean", "Hips Don't Lie (HÄWK VIP Edit)"));
  });
});
