/**
 * embed.ts — artwork embedding for `megadj ingest`.
 *
 * mp3/m4a/flac: ffmpeg attached_pic (stream copy of audio).
 * WAV: mutagen APIC (ffmpeg's wav muxer canNOT carry attached_pic).
 */
import { $ } from "bun";
import { extname } from "node:path";

const MB_UA = "megadj/0.1 (https://github.com/megadj/megadj)";

export async function embedArtwork(
  filePath: string,
  artUrl: string,
): Promise<boolean> {
  const tmp = filePath.replace(/(\.[^.]+)$/, ".art$1");
  const img = `${tmp}.jpg`;
  try {
    const res = await fetch(artUrl);
    if (!res.ok) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 1000) return false;
    await Bun.write(img, buf);
    if (extname(filePath).toLowerCase() === ".wav") {
      return await embedWav(filePath, img);
    }
    const args =
      extname(filePath).toLowerCase() === ".mp3" ? ["-id3v2_version", "3"] : [];
    const proc =
      await $`ffmpeg -y -hide_banner -loglevel error -i ${filePath} -i ${img} -map 0:a -map 1:v -c:a copy -c:v mjpeg -disposition:v:0 attached_pic ${args} ${tmp}`
        .quiet()
        .nothrow();
    if (proc.exitCode !== 0) return false;
    return (await $`mv -f ${tmp} ${filePath}`.quiet().nothrow()).exitCode === 0;
  } finally {
    await $`rm -f ${img}`.quiet().nothrow();
  }
}

/** APIC into a WAV's ID3 chunk, preserving existing tags. */
export async function embedWav(
  filePath: string,
  imgPath: string,
): Promise<boolean> {
  const script = `
from mutagen.wave import WAVE
from mutagen.id3 import ID3, APIC
a = WAVE(${JSON.stringify(filePath)})
try:
    a.add_tags()
except Exception:
    pass
if not isinstance(a.tags, ID3):
    a.tags = ID3()
a.tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=open(${JSON.stringify(imgPath)}, "rb").read()))
a.save()
print("ok")`;
  const proc = await $`uv run --with mutagen python -c ${script}`
    .quiet()
    .nothrow();
  return proc.exitCode === 0 && proc.stdout.toString().trim().includes("ok");
}

/** Fetch the biggest artwork image from a SoundCloud track/playlist page. */
export async function soundcloudArtwork(
  pageUrl: string,
): Promise<string | null> {
  try {
    const oembed = await fetch(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`,
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { thumbnail_url?: string };
      if (data.thumbnail_url) {
        // t500x500 is the largest oEmbed serves; original art hides in the page.
        return data.thumbnail_url.replace(/-(large|t\d+x\d+)\./, "-t500x500.");
      }
    }
    const page = await fetch(pageUrl, { headers: { "User-Agent": MB_UA } });
    if (page.ok) {
      const html = await page.text();
      const og = /property="og:image" content="([^"]+)"/.exec(html);
      if (og?.[1]) return og[1].replace(/-(large|t\d+x\d+)\./, "-t500x500.");
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function itunesArtwork(
  artist: string,
  titleOrAlbum: string,
): Promise<string | null> {
  const term = encodeURIComponent(`${artist} ${titleOrAlbum}`.slice(0, 120));
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ artworkUrl100?: string }>;
    };
    const url = data.results?.[0]?.artworkUrl100;
    return url ? url.replace("/100x100", "/600x600") : null;
  } catch {
    return null;
  }
}
