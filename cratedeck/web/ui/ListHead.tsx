// ListHead.tsx — shared list-header + copy helpers for the Fleet tabs.
//
// Extracted from ArchiveTab's UX pass so Coverage/Redundancy/Diff reuse the
// same pattern: every actionable list is copyable, because the fix is an
// agent (or future-you) running a command — handing the list over is the
// CTA. Same class names as the archive pass (.ah-head/.ah-actions/.btn.sm).

import type { ComponentChildren } from "preact";
import { toast } from "./toast";
import { Icon } from "./icons";
import { InfoTip } from "./InfoTip";
import { errMessage } from "../../shared/fmt";

/** Copy a text list to the clipboard. Lists exist to be fixed — and the
 *  fix is an agent running megadj/deckctl, so handing the list over is the
 *  CTA. */
export async function copyList(name: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast(
      `${name} copied (${lines.length} line${lines.length === 1 ? "" : "s"})`,
      "ok",
    );
  } catch (e: unknown) {
    // clipboard rejects on permission denial / insecure context — surface,
    // never silently no-op (the silent no-op Copy button is slop)
    toast(`copy failed: ${errMessage(e)}`, "err");
  }
}

/** One list header: what it is (InfoTip), how many (sect-n), Copy CTA (only
 *  when there's something worth pasting — pass `lines` to enable it). */
export function ListHead(props: {
  icon: string;
  title: string;
  n: number;
  hint: string;
  lines?: string[];
  /** extra content between the title and the actions (e.g. a fix chip) */
  children?: never;
}) {
  return (
    <div class="ah-head">
      <b>
        <Icon name={props.icon} size={13} /> {props.title}
        <span class="sect-n">{props.n}</span>
      </b>
      <div class="ah-actions">
        <InfoTip title={props.title} body={props.hint} align="right" />
        {props.lines && props.lines.length > 0 && (
          <button
            type="button"
            class="btn sm ghostbtn"
            title={`Copy these ${props.n} items — paste to an agent or notes to work the list`}
            onClick={() => copyList(props.title, props.lines ?? [])}
          >
            <Icon name="copy" size={12} /> Copy
          </button>
        )}
      </div>
    </div>
  );
}

/** The "fix:" footer naming the command that clears the list — every work
 *  card ends in an action, not a dead end. */
export function FixNote(props: { children: ComponentChildren }) {
  return <div class="arch-fix">fix: {props.children}</div>;
}
