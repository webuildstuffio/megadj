// kv.tsx — the KV display primitives (#204 split from data.tsx):
// Card/Truncated/copyList + the .kvrows/.kvrow key-value family.
import type { ComponentChildren } from "preact";
import { toast } from "./toast";
import { errMessage } from "../../../src/shared/leaf/fmt";

/** Copy a text list to the clipboard (moved here from ListHead so DataTable
 *  and BarList can copy without a page-level dependency cycle — ListHead
 *  re-exports it for compat). Lists exist to be fixed — and the fix is an
 *  agent running megadj/deckctl, so handing the list over is the CTA. */
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

/** The one card shell. `.card` was used 32× across the app with NO base
 *  rule — cards rendered visually flat; this adds the surface, border and
 *  padding in one place. */
export function Card(props: { children: ComponentChildren; class?: string }) {
  return <div class={`card ${props.class ?? ""}`}>{props.children}</div>;
}

/** The "showing N of M — Copy has the full list" footer. 8+ hand-rolled
 *  copies collapsed into one; `full` defaults to true (Copy carries the
 *  rest) — pass full={false} when lines aren't copyable. */
export function Truncated(props: {
  shown: number;
  total: number;
  full?: boolean;
}) {
  if (props.total <= props.shown) return null;
  return (
    <div class="fleet-note">
      showing {props.shown} of {props.total}
      {(props.full ?? true) ? " — Copy has the full list" : ""}
    </div>
  );
}

// ---- KV rows (the .rows/.row key-value lists) ---------------------------------

/** One key-value row (title left, value right). The `.rows`/`.row` CSS was
 *  scoped to `.archive-cols` only — everywhere else these rendered UNSTYLED.
 *  The new `.kvrows` classes own the layout. */
export function KVRows(props: { children: ComponentChildren; class?: string }) {
  return <div class={`kvrows ${props.class ?? ""}`}>{props.children}</div>;
}

export function KVRow(props: {
  children: ComponentChildren;
  class?: string;
  title?: string;
}) {
  return (
    <div class={`kvrow ${props.class ?? ""}`} title={props.title}>
      {props.children}
    </div>
  );
}

/** The left fragment of a KVRow — the "title — artist" lead. */
export function KVKey(props: { children: ComponentChildren }) {
  return <span class="kvkey">{props.children}</span>;
}

/** The right fragment of a KVRow — muted, ellipsized, right-aligned. */
export function KVVal(props: {
  children: ComponentChildren;
  title?: string;
  class?: string;
}) {
  return (
    <span class={`kvval ${props.class ?? ""}`} title={props.title}>
      {props.children}
    </span>
  );
}
