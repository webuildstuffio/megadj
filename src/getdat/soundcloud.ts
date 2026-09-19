// soundcloud.ts — the SoundCloud download-source module (#255/#256/#257).
// Everything SC-specific about ACQUISITION lives here: the tagged source
// union (playlist pages / SC tracks / sets / user pages), the URL the
// Downloader must feed yt-dlp per row, the SC format policy (hls_aac_160k
// is the platform ceiling — measured Sep 19, formats = hls_mp3_0_1 128k /
// hls_aac_96k / hls_aac_160k), the failure classes (permalink 404 =
// permanent-gone; Go+/DRM protected streams = permanent, never retried),
// and the link-first rules (#256): a track that offers a purchase or
// free-download link gets the link SURFACED, not ripped.
//
// Pure logic is exported for tests; the spawn lives in the Downloader.
// Metadata-only SC reads (the genre/art/year ladders) stay in
// fulltags/sources/sc-search.ts — this file never duplicates them.
import { parseJsonObject } from "../fulltags/parse-json";

/** The ledger `source` value for SoundCloud rows (tracks.source). */
export const SC_SOURCE = "soundcloud";

/** A sync source. `ytm-playlist` keeps the legacy LM/LL/PL behavior
 *  (id = playlist id); the SC kinds carry the direct URL. */
export type SyncSource =
  | { kind: "ytm-playlist"; id: string; label: string }
  | { kind: "sc-track"; url: string; label: string }
  | { kind: "sc-set"; url: string; label: string }
  | { kind: "sc-likes"; url: string; label: string }
  | { kind: "sc-user"; url: string; label: string };

/** True when the URL is a SoundCloud URL (the single drop/sync entry
 *  classifier — sync.ts and drop.ts share it). */
export function isSoundCloudUrl(url: string): boolean {
  return (
    /^https:\/\/(www\.)?soundcloud\.com\//.test(url) ||
    url.startsWith("https://api.soundcloud.com/")
  );
}

/** The canonical SC track URL form: the numeric API permalink. Works as
 *  a yt-dlp input even when the human slug has drifted, and every SC
 *  row (flat-playlist entries, single-track probes) can be re-fed
 *  through it (verified live, Sep 19). */
export function scTrackUrl(trackId: string): string {
  return `https://api.soundcloud.com/tracks/${trackId}`;
}

/** Extract the numeric SC track id from a URL when the URL already IS
 *  the api permalink form. Null otherwise. */
export function scTrackIdFromUrl(url: string): string | null {
  const m = /^https:\/\/api\.soundcloud\.com\/tracks\/(\d+)\/?$/.exec(url);
  return m?.[1] ?? null;
}

/** An SC acquisition link parsed out of a track (#256). `kind` carries
 *  the provenance so the summary can say WHY a link was surfaced. */
export interface ScAcquisitionLink {
  kind:
    "purchase_url" | "free_download" | "description_store_link" | "smart_link";
  url: string;
}

/** Smart-link services (linktr.ee / fanlink / etc.) resolve to stores —
 *  surfaced as `smart_link`; direct store hosts are
 *  `description_store_link`. smarturl.it measured live (Sep 19): the
 *  canonical Shelter description routes its Spotify/iTunes through it —
 *  without the row the biggest tracks silently ripped. */
const SMART_LINK_HOSTS = [
  "linktr.ee",
  "fanlink.to",
  "ffm.to",
  "backl.ink",
  "hypeddit.com",
  "toneden.io",
  "lnk.to",
  "orcd.co",
  "onerpm.link",
  "found.ee",
  "smarturl.it",
];
const STORE_HOSTS = [
  "bandcamp.com",
  "beatport.com",
  "music.apple.com",
  "itunes.apple.com",
  "traxsource.com",
  "junodownload.com",
];
const URL_RE = /https?:\/\/[^\s<>")\]']+/g;

function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Pull the acquisition links out of one `-J` track payload (pure).
 *  Order: purchase_url (the API's own field) → the free-download
 *  marker → the description's store/smart links. Trailing punctuation
 *  is stripped. Unrelated URLs (YouTube links, socials) never surface. */
export function extractAcquisitionLinks(info: {
  purchase_url?: unknown;
  downloadable?: unknown;
  download_url?: unknown;
  description?: unknown;
}): ScAcquisitionLink[] {
  const links: ScAcquisitionLink[] = [];
  if (
    typeof info.purchase_url === "string" &&
    /^https?:\/\//.test(info.purchase_url)
  ) {
    links.push({ kind: "purchase_url", url: info.purchase_url });
  }
  if (
    info.downloadable === true &&
    typeof info.download_url === "string" &&
    /^https?:\/\//.test(info.download_url)
  ) {
    links.push({ kind: "free_download", url: info.download_url });
  }
  const description =
    typeof info.description === "string" ? info.description : "";
  for (const m of description.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?…]+$/, "");
    const host = (url.match(/^https?:\/\/([^/]+)/)?.[1] ?? "").toLowerCase();
    const kind: ScAcquisitionLink["kind"] | null = hostMatches(
      host,
      SMART_LINK_HOSTS,
    )
      ? "smart_link"
      : hostMatches(host, STORE_HOSTS)
        ? "description_store_link"
        : null;
    if (kind) links.push({ kind, url });
  }
  // Dedupe by URL, keep the first (highest-priority) occurrence.
  const seen = new Set<string>();
  return links.filter((l) =>
    seen.has(l.url) ? false : (seen.add(l.url), true),
  );
}

/** The rip decision for one track (#256). Link-first: any acquisition
 *  link wins unless forceRip; else rip. */
export function ripDecision(
  links: ScAcquisitionLink[],
  forceRip: boolean,
): { action: "surface" | "rip"; link: ScAcquisitionLink | null } {
  if (!forceRip && links.length > 0) {
    return { action: "surface", link: links[0] ?? null };
  }
  return { action: "rip", link: null };
}

/** The SC format selector. HLS AAC 160k is the platform ceiling (no
 *  progressive 320 for non-Go+; Go+ streams are DRM-protected) —
 *  measured live Sep 19: formats = hls_mp3_0_1 (128k), hls_aac_96k,
 *  hls_aac_160k. yt-dlp's `-f` chain falls through each step. The mp3
 *  fallback exists because some legacy uploads stream ONLY mp3 — the
 *  container rules below keep it a stream-copy, never a re-encode. */
export const SC_FORMAT = "hls_aac_160k/bestaudio[ext=m4a]/bestaudio/bestaudio*";

/** #258-superfix: the extraction rule per landed SC format. AAC lands
 *  m4a (stream copy); the mp3 fallback must NOT go through
 *  `-x --audio-format m4a` — that re-encodes mp3→AAC (lossy→lossy, the
 *  exact double-transcode the archive refuses). Copy-as-is keeps the
 *  original bytes: mp3 in, mp3 out (isLowq's 128k mp3 floor already
 *  judges it correctly). Null = no extraction flags (stream copy). */
export function scExtractionArgs(formatId: string | null): string[] {
  if (formatId === "hls_mp3_0_1") return [];
  return ["-x", "--audio-format", "m4a", "--audio-quality", "0"];
}

/** SC format-id → kbps (the formatBitrateKbps twin for SC ids).
 *  Unknown ids → null (the row keeps ffprobe-able facts only). */
export function scFormatKbps(
  formatId: string | null | undefined,
): number | null {
  switch (formatId) {
    case "hls_aac_160k":
      return 160;
    case "hls_mp3_0_1":
      return 128;
    case "hls_aac_96k":
      return 96;
    default:
      return null;
  }
}

/** Failure classes for SC downloads. Permalink 404 → permanent-gone
 *  (measured: a dead slug returns `HTTP Error 404` from the SC API and
 *  the generic class used to retry it forever). Go+/DRM protected
 *  streams → permanent too (never retried). Everything else is
 *  retryable (the caller's backoff applies). */
export type ScFailureClass = "gone" | "permanent" | "retryable";

export function classifyScFailure(stderr: string): ScFailureClass {
  // Live shape (Sep 19): "ERROR: [soundcloud] artist/slug: Unable to
  // download JSON metadata: HTTP Error 404: Not Found".
  if (/\[soundcloud\].*HTTP Error 404/i.test(stderr)) return "gone";
  if (/soundcloud\.com.*404 Not Found/i.test(stderr)) return "gone";
  // Go+/DRM: protected streams never yield a downloadable URL.
  if (/PROTECTED-CCS/i.test(stderr)) return "permanent";
  if (/\[soundcloud\].*(DRM|not available)/i.test(stderr)) return "permanent";
  return "retryable";
}

/** #258: likes/user-page reads are the one SC surface that (a) needs
 *  impersonation (yt-dlp's curl_cffi) and (b) 404s on PRIVATE profiles
 *  with no cookies — a shape indistinguishable from a dead profile
 *  without context. The gate classifies so callers can say "add
 *  --cookies-from-browser" instead of a bare 404. */
export function scUserGateNeeded(source: SyncSource): boolean {
  return source.kind === "sc-likes" || source.kind === "sc-user";
}

/** True when the 404 came from a likely-PRIVATE likes/user page (cookies
 *  absent). Pure: the callers append their own remedy text. */
export function isPrivateUser404(stderr: string): boolean {
  return /\[soundcloud:user\].*HTTP Error 404/i.test(stderr);
}

// --- #256-followup: the purchase_url enrichment probe -----------------
// Measured live (Sep 19, paro sets census): yt-dlp's soundcloud extractor
// NEVER maps the API's `purchase_url` field (the return dict in
// soundcloud.py whitelists keys; purchase_url is not one). The raw API
// carries it on a large share of label tracks — 90 of the 220 paro-set
// rows — so link-first was silently blind to every one of them. The fix
// is a post-probe enrichment: fetch the raw track object and merge its
// links into the yt-dlp payload's.

/** The whitelisted raw-API fields the enrichment probe reads. The values
 *  mirror the yt-dlp payload types (purchase_url/description strings,
 *  downloadable boolean) so the merged object stays a valid YtdlpInfo. */
export interface ScRawTrackInfo {
  purchase_url?: string;
  downloadable?: boolean;
  download_url?: string;
  description?: string;
  /** Identity backfill: SC set/user fan-out entries carry only id+url, so
   *  rows that go straight to a terminal state (gone / link_surfaced)
   *  never learn their title/artist at probe time. The raw object has
   *  both (title, user.username) — carried so the sync loop can backfill
   *  the ledger before marking terminal. */
  title?: string;
  user?: string;
}

/** The web client_id, scraped once per process from SC's asset bundle
 *  (the API 401s anonymous reads; yt-dlp ships its own list but has no
 *  CLI to expose it). Cached module-level; a failed scrape disables the
 *  probe for the run (null) rather than retrying per track. */
let cachedClientId: string | null | undefined;

/** Install a canned client id (tests) — restore via the returned fn. */
export function setScClientIdForTest(id: string | null): () => void {
  const prev = cachedClientId;
  cachedClientId = id;
  return () => {
    cachedClientId = prev;
  };
}

const TimeoutSignal = {
  tenSeconds(): AbortSignal {
    return AbortSignal.timeout(10_000);
  },
};

async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: TimeoutSignal.tenSeconds(),
      headers: { "User-Agent": "Mozilla/5.0", ...init?.headers },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Scrape a working web client_id from SC's page → asset bundle. Null
 *  when the scrape fails (offline, markup drift) — callers treat null as
 *  "enrichment unavailable", never as "no link". */
export async function scWebClientId(): Promise<string | null> {
  if (cachedClientId !== undefined) return cachedClientId;
  const page = await fetchText("https://soundcloud.com/");
  if (page === null) {
    cachedClientId = null;
    return null;
  }
  // The main bundles are a-v2.sndcdn.com/assets/*.js; the client_id sits
  // in one of them as client_id:"<22-40 alnum>". Try the LAST match (the
  // main app bundle) first — measured live Sep 19.
  const assets = [
    ...page.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"']+\.js/g),
  ].map((m) => m[0]);
  for (const asset of assets.toReversed().slice(0, 5)) {
    const js = await fetchText(asset);
    if (js === null) continue;
    const m = /client_id[:"=]+([a-zA-Z0-9]{20,40})/.exec(js);
    if (m?.[1]) {
      cachedClientId = m[1];
      return cachedClientId;
    }
  }
  cachedClientId = null;
  return null;
}

/** Fetch the RAW SC track object and return just the link-bearing fields
 *  yt-dlp drops. Null on any failure (offline / throttled / bad shape).
 *  This is BEST-EFFORT enrichment: null must never fail the run. */
export async function scRawTrackLinks(
  trackId: string,
): Promise<ScRawTrackInfo | null> {
  const clientId = await scWebClientId();
  if (clientId === null) return null;
  const body = await fetchText(
    `https://api-v2.soundcloud.com/tracks/${encodeURIComponent(trackId)}?client_id=${clientId}`,
  );
  if (body === null) return null;
  // The shared guarded parser (boundary-json census): corrupt body → null.
  const parsed = parseJsonObject(body);
  if (parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  // Carry only the fields extractAcquisitionLinks reads — the caller
  // merges them UNDER the yt-dlp payload (yt-dlp's own values win).
  // Values are type-gated (not blindly cast) so the merged object stays
  // a valid YtdlpInfo at the type level too.
  const out: ScRawTrackInfo = {};
  const v = raw["purchase_url"];
  if (typeof v === "string") out.purchase_url = v;
  if (typeof raw["downloadable"] === "boolean") {
    out.downloadable = raw["downloadable"];
  }
  if (typeof raw["download_url"] === "string") {
    out.download_url = raw["download_url"];
  }
  if (typeof raw["description"] === "string") {
    out.description = raw["description"];
  }
  if (typeof raw["title"] === "string") out.title = raw["title"];
  const user = raw["user"];
  if (
    user !== null &&
    typeof user === "object" &&
    typeof (user as { username?: unknown }).username === "string"
  ) {
    out.user = (user as { username: string }).username;
  }
  return out;
}

/** Merge the raw-API links under a yt-dlp payload (pure). yt-dlp values
 *  win: the probe only FILLS fields yt-dlp left empty. */
export function mergeScRawLinks<T extends Record<string, unknown>>(
  probed: T,
  raw: ScRawTrackInfo | null,
): T & ScRawTrackInfo {
  if (raw === null) return probed as T & ScRawTrackInfo;
  const merged: T & ScRawTrackInfo = { ...probed };
  const assign = (key: keyof ScRawTrackInfo): void => {
    const current = merged[key];
    const incoming = raw[key];
    if ((current === undefined || current === null) && incoming !== undefined) {
      (merged as Record<string, unknown>)[key] = incoming;
    }
  };
  assign("purchase_url");
  assign("downloadable");
  assign("download_url");
  assign("description");
  assign("title");
  assign("user");
  return merged;
}
