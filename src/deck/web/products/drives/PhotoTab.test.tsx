// PhotoTab.test.tsx — co-located pins for #520: the cover-photo thumbs are
// real buttons (keyboard-operable), the instruction is visible text, and
// the base.css halo enumeration covers every newly focusable surface.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import render from "preact-render-to-string";
import { PhotoTab, type PhotoHit } from "./PhotoTab";
import type { Drive, DriveImage } from "../../../shared/types";
import { ShareBar } from "../shared";

const tabSrc = readFileSync(join(import.meta.dir, "PhotoTab.tsx"), "utf8");
const baseCss = readFileSync(
  join(import.meta.dir, "../../styles/base.css"),
  "utf8",
);

const drive: Drive = {
  id: "d1",
  volume_uuid: null,
  name: "SHELF1",
  nickname: null,
  photo_path: null,
  capacity_bytes: 1_000_000_000_000,
  fs: "apfs",
  vendor: null,
  model: null,
  usb_serial: null,
  role: "master",
  first_seen_at: 0,
  last_seen_at: 0,
  last_port_key: null,
  link_bps: null,
  plug_count: 1,
  mounted: true,
  state: "mounted",
  last_snapshot_json: null,
  predecessor_id: null,
  verify_report_json: null,
};
const imgs = [
  { rel: "cover.jpg", url: "/drive-files/cover.jpg", bytes: 10 },
  { rel: "art/b.jpg", url: "/drive-files/art/b.jpg", bytes: 20 },
];
const hits: PhotoHit[] = [
  { id: "h1", thumb: "/t1", full: "/f1", source: "openverse" },
  { id: "h2", thumb: "/t2", full: "/f2", source: "openverse" },
];

function renderTab(
  searchHits: PhotoHit[] | null,
  driveImages: DriveImage[] | null,
) {
  return render(
    <PhotoTab
      drive={drive}
      driveId="d1"
      name="SHELF1"
      photoQuery=""
      setPhotoQuery={() => {}}
      onSearch={() => {}}
      hits={searchHits}
      onChoose={() => {}}
      onClear={() => {}}
      driveImages={driveImages}
      onChooseDriveImage={() => {}}
      onUploadFile={() => {}}
    />,
  );
}

describe("cover-photo picking is keyboard-operable (#520)", () => {
  test("drive-image thumbs are real buttons + the instruction is visible", () => {
    const html = renderTab(null, imgs);
    expect(html.split('class="photopick-btn"').length - 1).toBe(2);
    expect(html).toContain('type="button"');
    expect(html).toContain("Tab to one and press Enter");
    // the hover-only wording is gone from the tab
    expect(tabSrc).not.toContain("click to set as cover");
  });

  test("web-hit thumbs are real buttons too", () => {
    const html = renderTab(hits, null);
    expect(html.split('class="photopick-btn"').length - 1).toBe(2);
    expect(html).toContain('type="button"');
  });

  test("ShareBar clickable segs + legend entries are focusable buttons", () => {
    const html = render(
      <ShareBar
        total={4}
        segs={[
          {
            n: 3,
            cls: "ok",
            label: "in archive",
            title: "In archive",
            onClick: () => {},
          },
          { n: 1, cls: "bad", label: "failed", title: "Failed" },
        ]}
      />,
    );
    // one seg + one legend entry are focusable; the n>0 non-clickable pair is not
    expect(html.split('tabindex="0"').length - 1).toBe(2);
    expect(html.split('role="button"').length - 1).toBe(2);
  });

  test("base.css halo enumeration covers the newly focusable surfaces", () => {
    expect(baseCss).toContain(".photopick-btn:focus-visible");
    expect(baseCss).toContain(".stat.clickable:focus-visible");
    expect(baseCss).toContain(".arch-seg.clickable:focus-visible");
    expect(baseCss).toContain(".arch-legend .clickable:focus-visible");
    expect(baseCss).toContain(".brand:focus-visible");
  });
});
