// images-drive-photo.test.ts — the dual-save cover-photo feature: local
// canonical copy + on-stick copy (Contents/CrateDeck/), picking an image
// that already exists on the drive, and the mount-time re-sync that makes
// both sides agree. Real fs (a tmp "volume" via CRATEDECK_VOLUMES), real
// sqlite DB, real Guard — the write allow-list is the thing under test.
import { describe, it, expect, afterAll } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";

const FIX = `/tmp/cratedeck-images-${Date.now()}`;
const VOL = join(FIX, "vol", "DJPHOTO");
const DATA = join(FIX, "data");

mkdirSync(join(VOL, "Contents"), { recursive: true });
mkdirSync(DATA, { recursive: true });
process.env.CRATEDECK_DATA = DATA;
process.env.CRATEDECK_VOLUMES = join(FIX, "vol");

// static imports resolve before env is set — config reads env at call time
const { ImageService, readBoundedImageBody } = await import("../image/store");
const { Guard } = await import("../server/guard");
const { DB } = await import("../db");
const { loadConfig } = await import("../config");

// a 1x1 PNG (valid magic; the service checks size/ext, not decodability)
const PNG = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
);
const PNG_ALT = Uint8Array.from(PNG, (byte, index) =>
  index === PNG.length - 1 ? byte ^ 0xff : byte,
);

const cfg = loadConfig(FIX);
const db = new DB(cfg.dbPath);
db.masterName = cfg.masterDrive;
db.mirrorName = cfg.mirrorDrive;
const guard = new Guard(cfg);
guard.allow(join(cfg.volumesRoot, "*", "Contents", "CrateDeck"));
const images = new ImageService(cfg, db, guard);

/** Register a fake mounted drive row — the FULL Drive shape (a partial
 *  with `as never` once slipped past the compiler and lied about what
 *  upsertDrive actually requires). */
function seedDrive(id: string, name: string, mounted: boolean): void {
  const now = Date.now();
  db.upsertDrive({
    id,
    volume_uuid: id,
    name,
    nickname: null,
    photo_path: null,
    capacity_bytes: 1000,
    fs: "exfat",
    vendor: null,
    model: null,
    usb_serial: null,
    role: "unknown",
    first_seen_at: now,
    last_seen_at: now,
    last_port_key: null,
    link_bps: null,
    plug_count: 0,
    mounted,
    state: "ghost", // derived, not stored — any valid DriveState satisfies
    last_snapshot_json: null,
    predecessor_id: null,
    verify_report_json: null,
  });
}

const stickPhotoDir = () => join(VOL, "Contents", "CrateDeck");

/** Virgin stick: wipe leftovers from a previous test (one shared volume). */
function freshStick(): void {
  rmSync(stickPhotoDir(), { recursive: true, force: true });
}

afterAll(() => {
  db.close();
  rmSync(FIX, { recursive: true, force: true });
});

describe("drive cover photos (dual-save)", () => {
  it("bounds remote image bodies while streaming, before full buffering", async () => {
    await expect(
      readBoundedImageBody(new Response(Uint8Array.of(1, 2, 3)), 2),
    ).rejects.toThrow("image > 2 bytes");
    await expect(
      readBoundedImageBody(
        new Response(Uint8Array.of(1), {
          headers: { "Content-Length": "99" },
        }),
        2,
      ),
    ).rejects.toThrow("image > 2 bytes");
    expect(
      await readBoundedImageBody(new Response(Uint8Array.of(1, 2, 3)), 3),
    ).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("choose() saves to BOTH the local dir and the stick", async () => {
    freshStick();
    seedDrive("d1", "DJPHOTO", true);
    await images.choose("d1", { data: PNG, name: "shot.png" });
    // local canonical copy
    expect(readdirSync(join(cfg.imagesDir, "d1")).length).toBe(1);
    // on-stick copy at Contents/CrateDeck/photo.*
    const stick = readdirSync(stickPhotoDir());
    expect(stick.length).toBe(1);
    expect(stick[0]).toMatch(/^photo\.(png|jpe?g|gif|webp|avif)$/);
  });

  it("choose() from a file ON the drive works and dual-saves", async () => {
    freshStick();
    seedDrive("d2", "DJPHOTO", true);
    writeFileSync(join(VOL, "cover.jpg"), PNG); // root-level art on the stick
    const list = await images.listDriveImages("DJPHOTO");
    expect(list.map((i) => i.rel)).toContain("cover.jpg");
    await images.choose("d2", { driveRel: "cover.jpg" });
    expect(readdirSync(join(cfg.imagesDir, "d2")).length).toBe(1);
    expect(readdirSync(stickPhotoDir()).length).toBe(1);
  });

  it("listDriveImages skips non-images and shows the app dir", async () => {
    seedDrive("d3", "DJPHOTO", true);
    writeFileSync(join(VOL, "readme.txt"), "nope");
    writeFileSync(join(VOL, "mix.wav"), PNG);
    mkdirSync(stickPhotoDir(), { recursive: true });
    writeFileSync(join(stickPhotoDir(), "photo.png"), PNG);
    const list = await images.listDriveImages("DJPHOTO");
    const rels = list.map((i) => i.rel);
    expect(rels).toContain("Contents/CrateDeck/photo.png");
    expect(rels).not.toContain("readme.txt");
    expect(rels).not.toContain("mix.wav"); // .wav is not an image
  });

  it("driveImageFile refuses path escape and non-allowed dirs", () => {
    expect(images.driveImageFile("DJPHOTO", "../../etc/hosts")).toBeNull();
    expect(
      images.driveImageFile("DJPHOTO", "Contents/Elsewhere/x.png"),
    ).toBeNull();
    expect(images.driveImageFile("DJPHOTO", "cover.jpg")).toBeTruthy();
  });

  it("driveImageFile refuses forged volumes, non-images, and symlink escapes", () => {
    const outside = join(FIX, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.png"), PNG);
    expect(images.driveImageFile("../outside", "secret.png")).toBeNull();

    writeFileSync(join(VOL, "secret.txt"), "private");
    expect(images.driveImageFile("DJPHOTO", "secret.txt")).toBeNull();

    symlinkSync(join(outside, "secret.png"), join(VOL, "escape.png"));
    expect(images.driveImageFile("DJPHOTO", "escape.png")).toBeNull();
  });

  it("syncOnMount pushes the local copy to a stick that lacks it", async () => {
    freshStick();
    seedDrive("d4", "DJPHOTO", false);
    // picked the photo while the drive was unmounted: only local exists
    await images.choose("d4", { data: PNG, name: "shot.png" });
    // nothing on the stick yet (drive unmounted → no sync target)
    expect(existsSync(stickPhotoDir())).toBe(false);
    // now it mounts
    db.setMounted("d4", true);
    await images.syncOnMount("d4");
    expect(readdirSync(stickPhotoDir()).length).toBe(1);
    // second sweep = no-op (same bytes, same ext)
    const before = readdirSync(stickPhotoDir()).join(",");
    await images.syncOnMount("d4");
    expect(readdirSync(stickPhotoDir()).join(",")).toBe(before);
  });

  it("syncOnMount restores a lost local copy from the stick", async () => {
    freshStick();
    seedDrive("d5", "DJPHOTO", true);
    await images.choose("d5", { data: PNG });
    rmSync(join(cfg.imagesDir, "d5"), { recursive: true, force: true });
    await images.syncOnMount("d5");
    expect(readdirSync(join(cfg.imagesDir, "d5")).length).toBe(1);
    expect(images.photoPath("d5")).toContain("images");
  });

  it("clear() removes both copies", async () => {
    freshStick();
    seedDrive("d6", "DJPHOTO", true);
    await images.choose("d6", { data: PNG });
    images.clear("d6");
    expect(readdirSync(join(cfg.imagesDir, "d6")).length).toBe(0);
    expect(readdirSync(stickPhotoDir()).length).toBe(0);
  });

  it("changing extensions leaves one canonical photo on each side", async () => {
    freshStick();
    seedDrive("d7", "DJPHOTO", true);
    await images.choose("d7", { data: PNG, name: "first.png" });
    await images.choose("d7", { data: PNG_ALT, name: "second.jpg" });

    expect(readdirSync(join(cfg.imagesDir, "d7"))).toEqual(["photo.jpg"]);
    expect(readdirSync(stickPhotoDir())).toEqual(["photo.jpg"]);
    expect(images.photoPath("d7")).toEndWith("photo.jpg");
  });

  it("syncs same-size same-extension content changes by bytes", async () => {
    freshStick();
    seedDrive("d8", "DJPHOTO", true);
    await images.choose("d8", { data: PNG, name: "first.png" });
    await images.choose("d8", { data: PNG_ALT, name: "second.png" });

    expect(readFileSync(join(stickPhotoDir(), "photo.png"))).toEqual(
      Buffer.from(PNG_ALT),
    );
  });

  it("clear() removes every canonical and stale photo sibling", () => {
    freshStick();
    seedDrive("d9", "DJPHOTO", true);
    const local = join(cfg.imagesDir, "d9");
    mkdirSync(local, { recursive: true });
    mkdirSync(stickPhotoDir(), { recursive: true });
    for (const name of ["photo", "photo.jpg", "photo.png"]) {
      writeFileSync(join(local, name), PNG);
      writeFileSync(join(stickPhotoDir(), name), PNG);
    }

    images.clear("d9");

    expect(readdirSync(local)).toEqual([]);
    expect(readdirSync(stickPhotoDir())).toEqual([]);
  });

  it("keeps the old canonical photo when the replacement write fails", async () => {
    freshStick();
    seedDrive("d10", "DJPHOTO", false);
    const local = join(cfg.imagesDir, "d10");
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, "photo.png"), PNG);
    class RejectingGuard extends Guard {
      override async write(path: string, data: Uint8Array | string) {
        if (path.endsWith("photo.jpg")) throw new Error("injected write fail");
        await super.write(path, data);
      }
    }
    const failingImages = new ImageService(cfg, db, new RejectingGuard(cfg));

    await expect(
      failingImages.choose("d10", { data: PNG_ALT, name: "second.jpg" }),
    ).rejects.toThrow("injected write fail");
    expect(readdirSync(local)).toEqual(["photo.png"]);
    expect(readFileSync(join(local, "photo.png"))).toEqual(Buffer.from(PNG));
  });

  it("scan's walker skips Contents/CrateDeck (not DJ data)", async () => {
    const { walkTree } = await import("../tools/walk");
    const seen: string[] = [];
    await walkTree(VOL, {
      onlySubdir: "Contents",
      onFile: (_p, _st, rel) => {
        seen.push(rel);
      },
    });
    expect(seen.some((r) => r.includes("CrateDeck"))).toBe(false);
  });
});
