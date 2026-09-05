// images — provider search (brave | exa) proxied server-side; chosen images
// cached forever under data/images/<drive>/.
import { join } from "node:path";
import type { CrateConfig } from "./config";
import type { Guard } from "./guard";
import type { DB } from "./db";

export interface ImageHit {
  id: string;
  thumb: string;
  full: string;
  source: string;
}

/** Minimal response typing for the Brave image-search API. */
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

export class ImageService {
  constructor(
    private cfg: CrateConfig,
    private db: DB,
    private guard: Guard,
  ) {}

  async search(q: string): Promise<{ provider: string; hits: ImageHit[] }> {
    if (!this.cfg.imageProvider || !this.cfg.imageKey) {
      return { provider: "none", hits: [] };
    }
    const hits =
      this.cfg.imageProvider === "brave"
        ? await this.brave(q)
        : await this.exa(q);
    return { provider: this.cfg.imageProvider, hits };
  }

  private async brave(q: string): Promise<ImageHit[]> {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(q)}&count=12&safesearch=off`,
      {
        headers: {
          "X-Subscription-Token": this.cfg.imageKey!,
          Accept: "application/json",
        },
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

  private async exa(q: string): Promise<ImageHit[]> {
    // Exa's search only returns a page-level `image` sometimes; the reliable
    // way to get product images is contents.extras.imageLinks. Merge both.
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": this.cfg.imageKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: q,
        numResults: 12,
        type: "keyword",
        contents: { extras: { imageLinks: 4 }, text: false },
      }),
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

  /** Persist a chosen image for a drive (download URL or copy local path). */
  async choose(
    driveId: string,
    opts: { url?: string; localPath?: string },
  ): Promise<string> {
    const dir = join(this.cfg.imagesDir, driveId);
    const dest = join(dir, "photo");
    if (opts.url) {
      const res = await fetch(opts.url);
      if (!res.ok) throw new Error(`download failed ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) throw new Error("image > 10MB");
      this.guard.write(dest, buf);
    } else if (opts.localPath) {
      await this.guard.copy(opts.localPath, dest);
    } else {
      throw new Error("nothing to choose");
    }
    this.db.setPhoto(driveId, dest);
    this.db.event(driveId, "photo-set", {
      source: opts.url ? "url" : "upload",
    });
    return dest;
  }

  photoPath(driveId: string): string | null {
    return this.db.getDrive(driveId)?.photo_path ?? null;
  }

  /** Remove a drive's cover photo (file + DB pointer). */
  clear(driveId: string): void {
    const p = this.photoPath(driveId);
    if (p) {
      try {
        this.guard.rm(p);
      } catch (e) {
        // DB pointer is cleared regardless; a file that wouldn't delete
        // (permissions/AV) must be visible, not silently orphaned on disk.
        console.error(`photo rm failed for ${driveId} at ${p}`, e);
      }
    }
    this.db.setPhoto(driveId, "");
    this.db.event(driveId, "photo-cleared", {});
  }
}
