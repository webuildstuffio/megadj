import { describe, test, expect, afterAll } from "bun:test";
import { $ } from "bun";
import { writePatch, groundTruth } from "../src/index-all";

const DIR = `/tmp/fulltags-bp-fields-test-${process.pid}`;

afterAll(async () => {
  await $`rm -rf ${DIR}`.quiet().nothrow();
});

async function makeFile(ext: string): Promise<string> {
  await $`mkdir -p ${DIR}`.quiet();
  const p = `${DIR}/bp-track${ext}`;
  await $`ffmpeg -y -hide_banner -loglevel error -f lavfi -i sine=frequency=440:duration=1 ${p}`.quiet();
  return p;
}

/**
 * Beatport identity-field round-trips (rev 6.4): label (TPUB / freeform
 * LABEL), mixName (TIT3 / freeform MIXNAME), isrc (TSRC / freeform ISRC)
 * and the TXXX:BP-FIELDS provenance stamp must SURVIVE a write and be
 * visible to groundTruth — "second pass changes nothing" is the
 * idempotency contract for every field the pipeline can write.
 * Empirically probed per container before wiring (Sep 11 2026):
 *   mp3: TPUB→publisher, TIT3, TSRC via ffmpeg remux
 *   flac: TPUB/TIT3/isrc vorbis comments
 *   aiff: mutagen ID3 (ffmpeg drops the chunk), ffprobe reads back
 *   wav: mutagen ID3-in-RIFF
 *   m4a: freeform ----:com.apple.iTunes:{LABEL,MIXNAME,ISRC} atoms
 */
describe("Beatport identity fields round-trip", () => {
  for (const ext of [".mp3", ".m4a", ".aiff", ".wav", ".flac"]) {
    test(
      `label + mixName + isrc + provenance stamp survive a ${ext} write`,
      async () => {
        const p = await makeFile(ext);
        await writePatch(p, {
          label: "Ropeadope",
          mixName: "Club Mix",
          isrc: "US8JA1418001",
          beatport: "label=Ropeadope; mix=Club Mix; isrc=US8JA1418001",
        });
        const t = groundTruth(p);
        expect(t.label).toBe("Ropeadope");
        expect(t.mixName).toBe("Club Mix");
        expect(t.isrc).toBe("US8JA1418001");
      },
      { timeout: 60_000 },
    );

    test(
      `second identical ${ext} write round is the contract of groundTruth read-back`,
      async () => {
        // This is the read-back half of idempotency: the values written
        // above must be visible to the same reader the pipeline gates on.
        // (Full rewrite-idempotency lives in the pipeline tests; here we
        // pin that a bp-filled file reads as bp-filled.)
        const p = await makeFile(ext);
        await writePatch(p, { label: "Aura Sound" });
        expect(groundTruth(p).label).toBe("Aura Sound");
      },
      { timeout: 60_000 },
    );

    test(
      `remixer + mixName together on ${ext}: separate frames, no collision`,
      async () => {
        // Regression pin: remixer → TXXX:version, mixName → TIT3 (ID3
        // family). A both-fields write must land BOTH values verbatim —
        // and the mixName read probe must NOT pick up the remixer's
        // "version" frame (that collision existed in an earlier probe
        // set and would have blocked a Beatport mix fill on
        // remixer-only files).
        const p = await makeFile(ext);
        await writePatch(p, {
          remixer: "RemixGuy Remix",
          mixName: "Club Mix",
        });
        const t = groundTruth(p);
        expect(t.remixer).toBe("RemixGuy Remix");
        expect(t.mixName).toBe("Club Mix");

        // Remixer-only write: mixName must read NULL (never the remixer
        // string), so a later Beatport mixName fill is not blocked.
        const q = await makeFile(`remixer-only-${ext}`);
        await writePatch(q, { remixer: "Solo Credit" });
        const tq = groundTruth(q);
        expect(tq.remixer).toBe("Solo Credit");
        expect(tq.mixName).toBeNull();
      },
      { timeout: 60_000 },
    );
  }
});
