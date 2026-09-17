// images — the dual-save cover-photo STORE; provider search (brave | exa)
// lives in image-search.ts (#42 split), and the ImageService (photo
// store, drive sync, mount reconciliation) lives in image-store.ts
// (#42 item 2 split). Chosen images are cached forever under
// data/images/<drive>/.
//
// The photo lives in TWO places by design (dual-save):
//   1. locally  — data/images/<driveId>/photo.<ext>  (canonical, always there
//                 so ghost drives still render their cover)
//   2. the stick — <mount>/Contents/CrateDeck/photo.<ext> (travels with the
//                 hardware; visible when the drive is used standalone)
//
// A mount-time re-sync pushes the local copy back onto a drive that lacks it
// (or restores the local copy from the stick when the local side is gone) —
// see image-store.ts syncOnMount. Scanners skip Contents/CrateDeck
// (walk.ts DEFAULT_SKIP_DIRS).

export { ImageService } from "./image-store";
export { MAX_IMAGE_BYTES, readBoundedImageBody } from "./image-store";
