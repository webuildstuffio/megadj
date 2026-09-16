// image-search.ts — the cover-photo provider search half of images.ts
// (#42 split): Brave + Exa image search mapped onto the ImageHit wire
// shape. Pure provider I/O — no filesystem, no DB, no Guard; the
// ImageService store half calls into these.
export interface ImageHit {
  id: string;
  thumb: string;
  full: string;
  source: string;
}

/** Minimal response typing for the Brave image search API. */
interface BraveResponse {
  results?: {
    index?: number;
    url?: string;
    source?: string;
    thumbnail?: { src?: string };
    properties?: { image?: string };
  }[];
}

/** Minimal response typing for the Exa search API. */
interface ExaResponse {
  results?: {
    id?: string;
    image?: string;
    url?: string;
    extras?: { imageLinks?: string[] };
  }[];
}

/** Every provider fetch gets a deadline: a hung provider must surface as
 *  a catchable failure, not a wedged route (repo fetch-deadline rule). */
const PROVIDER_TIMEOUT_MS = 10_000;

/** The provider dispatch — `none` when no provider/key is configured. */
export async function searchProviders(
  provider: "brave" | "exa",
  key: string,
  q: string,
): Promise<ImageHit[]> {
  return provider === "brave" ? brave(key, q) : exa(key, q);
}

async function brave(key: string, q: string): Promise<ImageHit[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(q)}&count=12&safesearch=off`,
    {
      headers: {
        "X-Subscription-Token": key,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const data = (await res.json()) as BraveResponse;
  return (data.results ?? []).slice(0, 12).map((r, i) => ({
    id: String(r.index ?? i),
    thumb: r.thumbnail?.src ?? r.properties?.image ?? r.url ?? "",
    full: r.properties?.image ?? r.url ?? "",
    source: r.source ?? "web",
  }));
}

async function exa(key: string, q: string): Promise<ImageHit[]> {
  // Exa's search only returns a page-level `image` sometimes; the reliable
  // way to get product images is contents.extras.imageLinks. Merge both.
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: q,
      numResults: 12,
      type: "keyword",
      contents: { extras: { imageLinks: 4 }, text: false },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), // deadline: see brave()
  });
  if (!res.ok) throw new Error(`exa ${res.status}`);
  const data = (await res.json()) as ExaResponse;
  const hits: ImageHit[] = [];
  for (const r of data.results ?? []) {
    const source = r.url ?? "web";
    if (r.image)
      hits.push({
        id: `${r.id ?? hits.length}-main`,
        thumb: r.image,
        full: r.image,
        source,
      });
    for (const [i, img] of (r.extras?.imageLinks ?? []).entries()) {
      hits.push({
        id: `${r.id ?? hits.length}-${i}`,
        thumb: img,
        full: img,
        source,
      });
      if (hits.length >= 12) return hits;
    }
  }
  return hits;
}
