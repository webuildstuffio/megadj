// ListHead.tsx — the page-voiced fix-note footer. ListHead/copyList live in
// ui/data.tsx; consumers import that leaf directly so this helper cannot add
// a re-export hop to every list dependency chain.
//
// Extracted from ArchiveTab's UX pass so Coverage/Redundancy/Diff reuse the
// same pattern: every actionable list is copyable, because the fix is an
// agent (or future-you) running a command — handing the list over is the
// CTA.

import type { ComponentChildren } from "preact";

/** The "fix:" footer naming the command that clears the list — every work
 *  card ends in an action, not a dead end. */
export function FixNote(props: { children: ComponentChildren }) {
  return <div class="arch-fix">fix: {props.children}</div>;
}
