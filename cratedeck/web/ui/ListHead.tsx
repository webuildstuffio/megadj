// ListHead.tsx — list header + fix-note shims. The implementations moved to
// ui/data.tsx (ListHead, copyList) so DataTable/BarList can share them
// without page-level cycles; this file re-exports for the existing import
// sites and keeps FixNote (page-voiced, one class).
//
// Extracted from ArchiveTab's UX pass so Coverage/Redundancy/Diff reuse the
// same pattern: every actionable list is copyable, because the fix is an
// agent (or future-you) running a command — handing the list over is the
// CTA.

export { copyList, ListHead } from "./data";
import type { ComponentChildren } from "preact";

/** The "fix:" footer naming the command that clears the list — every work
 *  card ends in an action, not a dead end. */
export function FixNote(props: { children: ComponentChildren }) {
  return <div class="arch-fix">fix: {props.children}</div>;
}
