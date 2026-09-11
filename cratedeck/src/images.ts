// images — provider search (brave | exa) proxied server-side; chosen images
// cached forever under data/images/<drive>/.
//
// The photo lives in TWO places by design (dual-save):
//   1. locally  — data/images/<driveId>/photo.<ext>  (canonical, always there
//                 so ghost drives still render their cover)
//   2. the stick — <mount>/Contents/CrateDeck/photo.<ext> (travels with the
//                 hardware; visible when the drive is used standalone)
// A mount-time re-sync pushes the local copy back onto a drive that lacks it
// (or restores the local copy from the stick when the local side is gone) —
// see syncOnMount. Scanners skip Contents/CrateDeck (walk.ts DEFAULT_SKIP_DIRS).
import { readdirSync, statSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { CrateConfig } from "./config";
import type { Guard } from "./guard";
import type { DB } from "./db";
import type { DriveImage } from "../shared/types";

// The wire shape is canonically defined in shared/types.ts; re-export keeps
// every existing `from "./images"` import working unchanged.
export type { DriveImage };

export interface ImageHit {
  id: string;
  thumb: string;
  full: string;
  source: string;
}

/** Exact filename(s) CrateDeck writes: local copies may be extensionless
 *  (legacy uploads), stick copies keep their extension. */
const PHOTO_BASENAME = /^photo(?:\.(?:png|jpe?g|gif|webp|avif))?$/i;
/** Extensions accepted for cover photos. */
const PHOTO_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);

/** Content-type → file extension for the photo download path. */
function extFromMime(ctype: string): string | null {
  const m = ctype.match(/image\/(png|jpeg|gif|webp|avif)/);
  if (!m?.[1]) return null;
  return m[1] === "jpeg" ? ".jpg" : `.${m[1]}`;
}
const MAX_BYTES = 10 * 1024 * 1024;

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

  /** The writable prefix on a mounted drive (guard.allow'ed at boot). */
  static driveDirName(): string {
    return "CrateDeck";
  }

  /** Absolute path of the on-stick photo dir for a mounted drive. */
  private driveDir(volumeName: string): string {
    return join(this.cfg.volumesRoot, volumeName, "Contents", "CrateDeck");
  }

  /** Absolute path of the local canonical copy for a drive. */
  private localDir(driveId: string): string {
    return join(this.cfg.imagesDir, driveId);
  }

  /** Current local canonical file, whatever its extension. */
  private localPhoto(driveId: string): string | null {
    const dir = this.localDir(driveId);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    const hit = names
      .filter((n) => PHOTO_BASENAME.test(n))
      .toSorted()
      .at(-1);
    return hit ? join(dir, hit) : null;
  }

  /** Current on-stick photo file for a mounted drive, absolute path. */
  private drivePhoto(volumeName: string): string | null {
    const dir = this.driveDir(volumeName);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return null; // not mounted / dir absent
    }
    const hit = names
      .filter((n) => PHOTO_BASENAME.test(n))
      .toSorted()
      .at(-1);
    return hit ? join(dir, hit) : null;
  }

  /** Images on a mounted drive worth offering as the cover: the CrateDeck
   *  dir first (canonical location), then the volume root — DJ sticks carry
   *  cover art at the root (cover.jpg / folder art dropped next to mixes).
   *  Capped + depth-1 outside CrateDeck: a walk here would touch every file
   *  on a 1TB stick. */
  async listDriveImages(volumeName: string): Promise<DriveImage[]> {
    const root = join(this.cfg.volumesRoot, volumeName);
    const out: DriveImage[] = [];
    const seen = new Set<string>();
    const push = (abs: string, rel: string): void => {
      try {
        const st = statSync(abs);
        if (!st.isFile() || st.size > MAX_BYTES) return;
        if (!PHOTO_EXT.has(extname(abs).toLowerCase())) return;
        if (seen.has(`${rel}:${st.size}`)) return;
        seen.add(`${rel}:${st.size}`);
        out.push({
          rel,
          url: `/api/drives/${encodeURIComponent(volumeName)}/drive-image?rel=${encodeURIComponent(rel)}`,
          bytes: st.size,
        });
      } catch {
        // raced an unlink mid-list — skip the entry, not the whole listing
      }
    };
    // 1 — Contents/CrateDeck/ (all of it; tiny, ours)
    for (const f of this.dirFiles(
      this.driveDir(volumeName),
      `Contents/${ImageService.driveDirName()}`,
    )) {
      push(f.abs, f.rel);
    }
    // 2 — volume root, one level, image extensions only
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return out; // drive not mounted right now
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!PHOTO_EXT.has(extname(e.name).toLowerCase())) continue;
      push(join(root, e.name), e.name);
    }
    return out;
  }

  /** Serve one file from the mounted volume by relative path. Refuses
   *  anything escaping the volume or outside the two allow-listed dirs. */
  driveImageFile(volumeName: string, rel: string): string | null {
    const root = join(this.cfg.volumesRoot, volumeName);
    const abs = join(root, rel);
    if (!abs.startsWith(root.endsWith("/") ? root : root + "/")) return null;
    const inAppDir = rel.startsWith(`Contents/${ImageService.driveDirName()}/`);
    const atRoot = !rel.includes("/");
    if (!inAppDir && !atRoot) return null;
    return existsSync(abs) ? abs : null;
  }

  private *dirFiles(
    dir: string,
    relPrefix: string,
  ): Generator<{ abs: string; rel: string }> {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      yield { abs: join(dir, n), rel: `${relPrefix}/${n}` };
    }
  }

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
        // every fetch gets a deadline: a hung provider must surface as a
        // catchable failure, not a wedged route (repo fetch-deadline rule)
        signal: AbortSignal.timeout(10_000),
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
      signal: AbortSignal.timeout(10_000), // deadline: see brave()
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

  /** Persist a chosen image for a drive: local canonical copy + on-stick
   *  copy (when mounted). Source = downloaded URL, uploaded bytes, an
   *  existing local file, or a file already on the drive. The source's
   *  extension is preserved (photo.png / photo.jpg / …) so the stick copy
   *  previews like a normal image file. */
  async choose(
    driveId: string,
    opts: {
      url?: string;
      localPath?: string;
      data?: Uint8Array;
      /** Original filename for uploads (derives the extension). */
      name?: string;
      /** Path relative to the drive root (a pick from listDriveImages). */
      driveRel?: string;
    },
  ): Promise<string> {
    const dir = this.localDir(driveId);
    if (opts.url) {
      const res = await fetch(opts.url, {
        // 30s deadline: image hosts stall; without it the route hangs and
        // the UI spin never resolves
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`download failed ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error("image > 10MB");
      const ext =
        extFromMime(res.headers.get("content-type") ?? "") ??
        this.extOf(opts.url) ??
        ".jpg";
      await this.guard.write(join(dir, `photo${ext}`), buf);
    } else if (opts.data) {
      if (opts.data.length > MAX_BYTES) throw new Error("image > 10MB");
      const ext = this.extOf(opts.name) ?? ".jpg";
      await this.guard.write(join(dir, `photo${ext}`), opts.data);
    } else if (opts.driveRel) {
      const drive = this.db.getDrive(driveId);
      if (!drive?.mounted) throw new Error("drive not mounted");
      const src = this.driveImageFile(drive.name, opts.driveRel);
      if (!src) throw new Error("image not found on drive");
      const ext = this.extOf(src) ?? ".jpg";
      await this.guard.copy(src, join(dir, `photo${ext}`));
    } else if (opts.localPath) {
      const ext = this.extOf(opts.localPath) ?? ".jpg";
      await this.guard.copy(opts.localPath, join(dir, `photo${ext}`));
    } else {
      throw new Error("nothing to choose");
    }
    await this.syncToDrive(driveId);
    this.db.setPhoto(driveId, this.localPhoto(driveId) ?? join(dir, "photo"));
    this.db.event(driveId, "photo-set", {
      source: opts.url
        ? "url"
        : opts.data
          ? "upload"
          : opts.driveRel
            ? "drive"
            : "upload",
    });
    return this.localPhoto(driveId) ?? join(dir, "photo");
  }

  /** Lowercased extension of a path/URL ("" → null). Query strings off. */
  private extOf(p: string | undefined): string | null {
    if (!p) return null;
    const clean = p.split(/[?#]/)[0] ?? p;
    const ext = extname(clean).toLowerCase();
    return ext ? ext : null;
  }

  /** Copy the local canonical photo onto the mounted stick (when it isn't
   *  already there, or differs). No-op when unmounted or nothing local. */
  async syncToDrive(driveId: string): Promise<boolean> {
    const local = this.localPhoto(driveId);
    if (!local) return false;
    const drive = this.db.getDrive(driveId);
    if (!drive?.mounted || !drive.name) return false;
    const onStick = this.drivePhoto(drive.name);
    if (onStick && this.sameBytes(local, onStick)) return false;
    const dest = join(this.driveDir(drive.name), `photo${extname(local)}`);
    await this.guard.copy(local, dest);
    return true;
  }

  /** Mount-time reconciliation: prefer whichever side has a photo and make
   *  both agree. Drive → local when the local copy was lost; local → drive
   *  when the stick never got it (picked while unmounted / older sync).
   *  Never deletes: a stray extra file on either side is left alone. */
  async syncOnMount(driveId: string): Promise<void> {
    const drive = this.db.getDrive(driveId);
    if (!drive?.mounted || !drive.name) return;
    const local = this.localPhoto(driveId);
    const onStick = this.drivePhoto(drive.name);
    if (onStick && !local) {
      // restore the local canonical copy from the stick
      await this.guard.copy(onStick, join(this.localDir(driveId), "photo"));
      this.db.setPhoto(driveId, join(this.localDir(driveId), "photo"));
      this.db.event(driveId, "photo-restored", { from: "drive" });
      return;
    }
    if (local && (!onStick || !this.sameBytes(local, onStick))) {
      const dest = join(this.driveDir(drive.name), `photo${extname(local)}`);
      await this.guard.copy(local, dest);
      this.db.event(driveId, "photo-synced", { to: "drive" });
    }
  }

  /** Extension+size equality — enough to decide "already synced" without
   *  hashing a multi-MB image on every sweep. */
  private sameBytes(a: string, b: string): boolean {
    try {
      const sa = statSync(a);
      const sb = statSync(b);
      return (
        sa.size === sb.size &&
        extname(a).toLowerCase() === extname(b).toLowerCase()
      );
    } catch {
      return false;
    }
  }

  /** The path to serve for /photos/:id — local first (works for ghosts),
   *  falling back to the stick copy when only that exists. */
  photoPath(driveId: string): string | null {
    return (
      this.localPhoto(driveId) ?? this.db.getDrive(driveId)?.photo_path ?? null
    );
  }

  /** Remove a drive's cover photo (both copies + DB pointer). */
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
    // the on-stick copy too — remove means remove from both
    const drive = this.db.getDrive(driveId);
    if (drive?.mounted && drive.name) {
      const stick = this.drivePhoto(drive.name);
      if (stick) {
        try {
          this.guard.rm(stick);
        } catch (e) {
          console.error(`photo rm failed (stick) for ${driveId}`, e);
        }
      }
    }
    this.db.setPhoto(driveId, "");
    this.db.event(driveId, "photo-cleared", {});
  }
}
