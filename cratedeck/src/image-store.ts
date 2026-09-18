// image-store.ts — the ImageService (#42 item 2 split, out of images.ts):
// the dual-save cover-photo store. The photo lives in TWO places by design:
//   1. locally  — data/images/<driveId>/photo.<ext>  (canonical, always there
//                 so ghost drives still render their cover)
//   2. the stick — <mount>/Contents/CrateDeck/photo.<ext> (travels with the
//                 hardware; visible when the drive is used standalone)
// A mount-time re-sync pushes the local copy back onto a drive that lacks it
// (or restores the local copy from the stick when the local side is gone) —
// see syncOnMount. Scanners skip Contents/CrateDeck (walk.ts DEFAULT_SKIP_DIRS).
// Provider search (brave | exa) lives in image-search.ts (#42 split).
// Chosen images cache forever under data/images/<drive>/. This module is
// also the import surface (images.ts, 19L, was a bare re-export barrel over
// this file — merged per #221; import "./image-store" directly).
// File primitives (name/ext rules, capped reader) live in photo-files.ts.
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CrateConfig } from "./config";
import type { Guard } from "./guard";
import type { DB } from "./db";
import type { DriveImage } from "../shared/types";
import { searchProviders, type ImageHit } from "./image-search";
import {
  MAX_IMAGE_BYTES,
  PHOTO_BASENAME,
  PHOTO_EXT,
  extFromMime,
  extOfPhotoPath,
  readBoundedImageBody,
} from "./photo-files";

export { MAX_IMAGE_BYTES, readBoundedImageBody } from "./photo-files";

export class ImageService {
  private cfg: CrateConfig;
  private db: DB;
  private guard: Guard;

  constructor(cfg: CrateConfig, db: DB, guard: Guard) {
    this.cfg = cfg;
    this.db = db;
    this.guard = guard;
  }

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
    return this.currentPhoto(this.localDir(driveId));
  }

  /** Current on-stick photo file for a mounted drive, absolute path. */
  private drivePhoto(volumeName: string): string | null {
    return this.currentPhoto(this.driveDir(volumeName));
  }

  private photoFiles(dir: string): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => PHOTO_BASENAME.test(name))
      .map((name) => join(dir, name));
  }

  private currentPhoto(dir: string): string | null {
    return this.photoFiles(dir).toSorted().at(-1) ?? null;
  }

  /** Remove every old canonical-name sibling only after `keep` exists. */
  private removeStalePhotos(dir: string, keep: string): number {
    const keepReal = realpathSync(keep);
    let removed = 0;
    for (const photo of this.photoFiles(dir)) {
      if (realpathSync(photo) === keepReal) continue;
      this.guard.rm(photo);
      removed += 1;
    }
    return removed;
  }

  private removeAllPhotos(dir: string, context: string): void {
    for (const photo of this.photoFiles(dir)) {
      try {
        this.guard.rm(photo);
      } catch (error) {
        console.error(`photo rm failed (${context}) at ${photo}`, error);
      }
    }
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
        if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return;
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
    let entries: Dirent[];
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
    const registered = this.db
      .allDrives()
      .some((drive) => drive.mounted && drive.name === volumeName);
    if (!registered || !rel || rel.includes("\0")) return null;
    try {
      const root = realpathSync(join(this.cfg.volumesRoot, volumeName));
      const abs = realpathSync(resolve(root, rel));
      const canonicalRel = relative(root, abs);
      if (
        !canonicalRel ||
        isAbsolute(canonicalRel) ||
        canonicalRel === ".." ||
        canonicalRel.startsWith(`..${sep}`)
      )
        return null;
      const appPrefix = `${join("Contents", ImageService.driveDirName())}${sep}`;
      const inAppDir = canonicalRel.startsWith(appPrefix);
      const atRoot = !canonicalRel.includes(sep);
      if (!inAppDir && !atRoot) return null;
      if (!PHOTO_EXT.has(extname(abs).toLowerCase())) return null;
      return statSync(abs).isFile() ? abs : null;
    } catch {
      return null;
    }
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
    const hits = await searchProviders(
      this.cfg.imageProvider,
      this.cfg.imageKey,
      q,
    );
    return { provider: this.cfg.imageProvider, hits };
  }

  /** Persist a chosen image for a drive: local canonical copy + on-stick
   *  copy (when mounted). Source = downloaded URL, uploaded bytes, an
   *  existing local file, or a file already on the drive. The source's
   *  extension is preserved (photo.png / photo.jpg / …) so the stick copy
   *  previews like a normal image file. */
  async choose(
    driveId: string,
    opts: {
      url?: string | undefined;
      localPath?: string | undefined;
      data?: Uint8Array | undefined;
      /** Original filename for uploads (derives the extension). */
      name?: string | undefined;
      /** Path relative to the drive root (a pick from listDriveImages). */
      driveRel?: string | undefined;
    },
  ): Promise<string> {
    // One leg per image source (#199): each staging fn lands the bytes in
    // the local canonical dir and returns the dest path.
    const dir = this.localDir(driveId);
    const staging = opts.url
      ? () => this.stageFromUrl(dir, opts.url!)
      : opts.data
        ? () => this.stageFromUpload(dir, opts.data!, opts.name)
        : opts.driveRel
          ? () => this.stageFromDrive(dir, driveId, opts.driveRel!)
          : opts.localPath
            ? () => this.stageFromLocal(dir, opts.localPath!)
            : null;
    if (staging === null) throw new Error("nothing to choose");
    const dest = await staging();
    this.removeStalePhotos(dir, dest);
    await this.syncToDrive(driveId);
    this.db.setPhoto(driveId, dest);
    this.db.event(driveId, "photo-set", {
      source: opts.url
        ? "url"
        : opts.data
          ? "upload"
          : opts.driveRel
            ? "drive"
            : "upload",
    });
    return dest;
  }

  /** Fetch a remote image (30s deadline: image hosts stall; without it the
   *  route hangs and the UI spin never resolves) into the canonical dir. */
  private async stageFromUrl(dir: string, url: string): Promise<string> {
    const sourceUrl = new URL(url);
    if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:")
      throw new Error("image URL must use http or https");
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    const buf = await readBoundedImageBody(res);
    const ext =
      extFromMime(res.headers.get("content-type") ?? "") ?? extOfPhotoPath(url);
    if (!ext) throw new Error("unsupported image type");
    const dest = join(dir, `photo${ext}`);
    await this.guard.write(dest, buf);
    return dest;
  }

  /** Stage a file that already exists on the mounted drive. */
  private async stageFromDrive(
    dir: string,
    driveId: string,
    driveRel: string,
  ): Promise<string> {
    const drive = this.db.getDrive(driveId);
    if (!drive?.mounted) throw new Error("drive not mounted");
    const src = this.driveImageFile(drive.name, driveRel);
    if (!src) throw new Error("image not found on drive");
    const dest = join(dir, `photo${extOfPhotoPath(src) ?? ".jpg"}`);
    await this.guard.copy(src, dest);
    return dest;
  }

  /** Copy the local canonical photo onto the mounted stick (when it isn't
   *  already there, or differs). No-op when unmounted or nothing local. */
  async syncToDrive(driveId: string): Promise<boolean> {
    const local = this.localPhoto(driveId);
    if (!local) return false;
    const drive = this.db.getDrive(driveId);
    if (!drive?.mounted || !drive.name) return false;
    const dir = this.driveDir(drive.name);
    const dest = join(dir, `photo${extname(local)}`);
    let changed = false;
    if (!this.sameBytes(local, dest)) {
      await this.guard.copy(local, dest);
      changed = true;
    }
    return this.removeStalePhotos(dir, dest) > 0 || changed;
  }

  /** Mount-time reconciliation: prefer whichever side has a photo and make
   *  both agree. Drive → local when the local copy was lost; local → drive
   *  when the stick never got it (picked while unmounted / older sync).
   *  Reconciliation also removes stale photo-name siblings, leaving one
   *  canonical file on each side. */
  async syncOnMount(driveId: string): Promise<void> {
    const drive = this.db.getDrive(driveId);
    if (!drive?.mounted || !drive.name) return;
    const local = this.localPhoto(driveId);
    const onStick = this.drivePhoto(drive.name);
    if (onStick && !local) {
      // restore the local canonical copy from the stick
      const localDir = this.localDir(driveId);
      const dest = join(localDir, `photo${extname(onStick)}`);
      await this.guard.copy(onStick, dest);
      this.removeStalePhotos(localDir, dest);
      this.removeStalePhotos(this.driveDir(drive.name), onStick);
      this.db.setPhoto(driveId, dest);
      this.db.event(driveId, "photo-restored", { from: "drive" });
      return;
    }
    if (local && (await this.syncToDrive(driveId))) {
      this.db.event(driveId, "photo-synced", { to: "drive" });
    }
  }

  /** Byte equality prevents equal-length replacement images being skipped. */
  private sameBytes(a: string, b: string): boolean {
    try {
      const sa = statSync(a);
      const sb = statSync(b);
      return sa.size === sb.size && readFileSync(a).equals(readFileSync(b));
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
    const drive = this.db.getDrive(driveId);
    const localFiles = new Set(this.photoFiles(this.localDir(driveId)));
    if (drive?.photo_path) localFiles.add(drive.photo_path);
    for (const photo of localFiles) {
      try {
        this.guard.rm(photo);
      } catch (error) {
        // DB pointer is cleared regardless; a file that wouldn't delete
        // (permissions/AV) must be visible, not silently orphaned on disk.
        console.error(`photo rm failed for ${driveId} at ${photo}`, error);
      }
    }
    // the on-stick copy too — remove means remove from both
    if (drive?.mounted && drive.name) {
      this.removeAllPhotos(this.driveDir(drive.name), `stick ${driveId}`);
    }
    this.db.setPhoto(driveId, "");
    this.db.event(driveId, "photo-cleared", {});
  }

  /** Stage uploaded bytes into the canonical dir (10MB cap: images only). */
  private async stageFromUpload(
    dir: string,
    data: Uint8Array,
    name: string | undefined,
  ): Promise<string> {
    if (data.length > MAX_IMAGE_BYTES) throw new Error("image > 10MB");
    const ext = name ? extOfPhotoPath(name) : ".jpg";
    if (!ext) throw new Error("unsupported image type");
    const dest = join(dir, `photo${ext}`);
    await this.guard.write(dest, data);
    return dest;
  }

  /** Stage a local server-side file into the canonical dir. */
  private async stageFromLocal(
    dir: string,
    localPath: string,
  ): Promise<string> {
    const ext = extOfPhotoPath(localPath);
    if (!ext) throw new Error("unsupported image type");
    const dest = join(dir, `photo${ext}`);
    await this.guard.copy(localPath, dest);
    return dest;
  }
}
