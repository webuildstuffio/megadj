// data.tsx — the shared data-display barrel (#204 split). The component
// families moved to their own modules: kv.tsx (Card/Truncated/copyList/KV*),
// stats.tsx (StatCard/CountStat), barlist.tsx (BarList), data-table.tsx
// (DataTable + its column/action types). This file re-exports everything so
// every existing `from "../ui/data"` import keeps working; ListHead and
// SearchBar stayed here (they were always single-component sections).
//
// Rule (AGENTS.md): web components never re-declare server shapes — no
// wire types live in this family, only render props.
import { Icon, type IconName } from "./icons";
import { InfoTip } from "./InfoTip";
import { copyList } from "./kv";

export { Card, Truncated, KVRows, KVRow, KVKey, KVVal, copyList } from "./kv";
export { StatCard, CountStat } from "./stats";
export { BarList } from "./barlist";
export { DataTable, type DataTableColumn } from "./data-table";

// ---- SearchBar ----------------------------------------------------------------

/** The one search/filter bar: input + optional trailing button + clear ×.
 *  4 hand-rolled variants (PlaylistsTab, FleetPage Coverage, LibraryTab,
 *  SimilarTab) collapse into this. Escape clears (standard palette
 *  semantics); pressing Enter fires onSearch when armed. */
export function SearchBar(props: {
  value: string;
  onInput: (v: string) => void;
  placeholder: string;
  /** live filter (no button) when omitted */
  onSearch?: (q: string) => void;
  /** button label; onSearch must be set */
  buttonLabel?: string;
  busy?: boolean;
  /** min query length before the button arms (default 0) */
  minLength?: number;
  /** optional hint under the results (page-owned) */
  class?: string;
}) {
  const min = props.minLength ?? 0;
  const canSearch = props.value.trim().length > min && !props.busy;
  return (
    <div class={`pl-tools ${props.class ?? ""}`}>
      <div class="plsearch">
        <Icon name="search" size={13} />
        <input
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          value={props.value}
          onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              props.onInput("");
            } else if (e.key === "Enter" && props.onSearch && canSearch) {
              props.onSearch(props.value.trim());
            }
          }}
        />
        {props.value && (
          <button
            type="button"
            class="plsearch-clear"
            aria-label="Clear search"
            title="Clear (Escape)"
            onClick={() => props.onInput("")}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {props.onSearch && (
        <button
          type="button"
          class="btn"
          disabled={!canSearch}
          onClick={() => props.onSearch?.(props.value.trim())}
        >
          <Icon name="search" size={14} /> {props.buttonLabel ?? "Search"}
        </button>
      )}
    </div>
  );
}

// ---- ListHead (moved from ListHead.tsx; that file re-exports) ------------------

/** One list header: what it is (InfoTip), how many (sect-n), Copy CTA (only
 *  when there's something worth pasting — pass `lines` to enable it). */
export function ListHead(props: {
  icon: IconName | string;
  title: string;
  n: number;
  hint: string;
  lines?: string[] | undefined;
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
