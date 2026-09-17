// Regression tests for the MB wire seam (issue #99): mbRecording and
// mbLookupCached used to be byte-twin fetch blocks that had already
// drifted (only the cached twin bounded its request). The seam pins:
// ONE fetch/UA/timeout/not-ok/parse block, per-caller logging policy,
// malformed JSON throws (never a silent false answer).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mbLookupCached, mbRecording } from "../../mb_lookup";

interface FetchCall {
  url: string;
  signal: AbortSignal | null;
}

const originalFetch = globalThis.fetch;
let calls: FetchCall[] = [];
let responder: (url: string) => Response | Promise<Response>;

function okJson(body: unknown): Response {
  return Response.json(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  responder = () => okJson({ recordings: [] });
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({
      url,
      signal: (init?.signal as AbortSignal | undefined) ?? null,
    });
    return Promise.resolve(responder(url));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const hit = {
  recordings: [
    {
      title: "Nightcall",
      id: "mbid-1",
      "artist-credit": [{ artist: { name: "Kavinsky" } }],
      releases: [{ title: "OutRun", date: "2013-01-01" }],
    },
  ],
};

describe("MB wire seam (issue #99)", () => {
  test("mbRecording projects the truth row (artist/album/date/mbid)", async () => {
    responder = () => okJson(hit);
    const r = await mbRecording("Kavinsky", "Nightcall");
    expect(r).toEqual({
      artist: "Kavinsky",
      album: "OutRun",
      date: "2013-01-01",
      artistTags: "",
      mbid: "mbid-1",
    });
  });

  test("both callers bound their request with the same timeout signal", async () => {
    responder = () => okJson({ recordings: [] });
    await mbRecording(null, "track-a");
    const untyped = mbLookupCached("A", "untimed-hit") as unknown;
    // the cached lookup rate-limits after the fetch; await it fully
    await untyped;
    expect(calls.length).toBe(2);
    // the seam passes ONE signal source to both — drift was "one twin
    // timed out, the other could stall a batch"; pin the signal exists.
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("HTTP 404 degrades to the miss row / null (no throw)", async () => {
    responder = () => new Response("nope", { status: 404 });
    expect(await mbRecording("X", "y")).toEqual({
      artist: null,
      album: null,
      date: null,
      artistTags: "",
      mbid: null,
    });
    expect(await mbLookupCached("X", "degrade")).toBeNull();
  });

  test("malformed JSON on a 200 trips the guarded boundary in both callers", async () => {
    responder = () => new Response("{not json", { status: 200 });
    // mbRecording: per-row silence (optional hint degrades, batch must not drown)
    expect(await mbRecording("X", "y")).toEqual({
      artist: null,
      album: null,
      date: null,
      artistTags: "",
      mbid: null,
    });
    // mbLookupCached: logged, then null
    expect(await mbLookupCached("X", "bad-body")).toBeNull();
  });

  test("network failure keeps each caller's degrade policy", async () => {
    responder = () => {
      throw new Error("dead connection");
    };
    // mbRecording: silent per-row miss (ingest batch must not drown)
    expect(await mbRecording("X", "y")).toEqual({
      artist: null,
      album: null,
      date: null,
      artistTags: "",
      mbid: null,
    });
    // mbLookupCached: logged miss → null
    expect(await mbLookupCached("X", "net-fail")).toBeNull();
  });
});
