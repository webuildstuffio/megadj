// data.tsx — the shared data-display primitives (the shadcn-style layer
// for megadj's dashboard): DataTable, BarList, StatGrid/StatCard, Truncated,
// SearchBar, KVRows, EmptyNote, Card. Every table, bar list, stat grid and
// truncation footer in the app renders through ONE of these so column
// templates, numeric alignment, ARIA roles and the copy/CTA patterns can't
// drift between products — and the three call sites whose cells wrapped
// into implicit grid rows (Cues, Pipeline runs, Set builder) are structurally
// impossible now: the grid template is DERIVED from the columns array.
//
// Rule (AGENTS.md): web components never re-declare server shapes — this
// file defines NO wire types, only render props.
import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "./icons";
import { InfoTip } from "./InfoTip";
import { toast } from "./toast";
import { errMessage } from "../../shared/fmt";

// ---- clipboard ---------------------------------------------------------------

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

// ---- Card + empty states ------------------------------------------------------

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

// ---- stat cards ---------------------------------------------------------------

export type StatTone = "ok" | "warn" | "bad" | "";

/** One stat card — value, label, icon, hover gloss, optional tone. Extends
 *  the old DrivePanels.StatCard with `tone` (the 3 inline re-implementations
 *  hand-rolled `.stat bad` divs to get it) and `em` (the label suffix the
 *  mood gloss maps wanted). */
export function StatCard(props: {
  v: string;
  l: string;
  icon?: IconName | string | undefined;
  title?: string | undefined;
  tone?: StatTone | undefined;
  /** small muted suffix after the label (e.g. the mood gloss) */
  em?: string | undefined;
}) {
  return (
    <div class={`stat ${props.tone ?? ""}`} title={props.title}>
      <div class="v">
        {props.icon && <Icon name={props.icon} size={13} />} {props.v}
      </div>
      <div class="l">
        {props.l}
        {props.em && <em> {props.em}</em>}
      </div>
    </div>
  );
}

/** A stat value computed from done/total with an automatic tone: zero →
 *  ok, some → warn, or invert={true} for "high is good" counters. */
export function CountStat(props: {
  n: number;
  l: string;
  icon: IconName | string;
  title: string;
  /** "bad when >0" (default) or "ok when >0" */
  invert?: boolean;
}) {
  const tone: StatTone = props.invert
    ? props.n > 0
      ? ""
      : "bad"
    : props.n > 0
      ? "bad"
      : "ok";
  return (
    <StatCard
      v={props.n.toLocaleString()}
      l={props.l}
      icon={props.icon}
      title={props.title}
      tone={tone}
    />
  );
}

// ---- DataTable ----------------------------------------------------------------

// The table CORE is @tanstack/preact-table (v9): sorting, a global text
// filter and pagination are its problem now — memoized row models, shift-
// click multi-sort, and a state store we don't have to babysit. What stays
// OURS is the render contract: the grid template is still derived from the
// columns array (a 5-column table can never render in a 3-column grid
// again), and the CSS classes are unchanged, so every call site keeps its
// look while the behavior underneath is library-grade.
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  createSortedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  sortFn_alphanumeric,
  filterFn_includesString,
  type ColumnDef,
  type RowData,
} from "@tanstack/preact-table";

export type CellAlign = "start" | "end" | "center";

export interface DataTableColumn<T> {
  key: string;
  head: ComponentChildren;
  align?: CellAlign;
  /** relative width via the grid's fr math (default 1) */
  grow?: number;
  /** min-width hint for the column template */
  min?: number;
  /** render one row's cell (already-truncated text; the table owns layout) */
  cell: (row: T, index: number) => ComponentChildren;
  /** stable key for the row — defaults to index */
  rowKey?: (row: T, index: number) => string;
  /** natural sort value when the column header is clicked */
  sortValue?: (row: T) => number | string | null;
}

export interface DataTableRowAction<T> {
  label: string;
  icon?: IconName | string;
  title?: string;
  run: (row: T) => void;
}

// one static feature set for every DataTable instance — registered once so
// the row-model pipeline (filter → sort → paginate) is memoized per table
const dtFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  filterFns: { includesString: filterFn_includesString },
});

/** The one data table. shadcn-flavored: declarative columns, sticky header,
 *  click-to-sort (nulls last, stable, shift-click multi-sort), right-aligned
 *  tabular numerics, ARIA table semantics, optional per-row actions, and the
 *  truncation + copy pair built in. Opt-in extras: `filterable` renders a
 *  global filter box; `paginate` adds page controls (default 15/page). */
export function DataTable<T extends RowData>(props: {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** cap rendered rows; over-cap renders the Truncated footer */
  cap?: number;
  /** copy payload builder — presence arms the "Copy" button in the header */
  copyLines?: (rows: T[]) => string[];
  copyName?: string;
  /** per-row hover/overflow actions (rendered as an extra trailing column) */
  rowActions?: DataTableRowAction<T>[];
  /** initial sort — defaults to natural row order */
  initialSort?: { key: string; dir: 1 | -1 };
  /** ARIA caption for screen readers */
  ariaLabel?: string;
  /** render under the table when over cap (default: the Truncated footer) */
  footer?: ComponentChildren;
  empty?: ComponentChildren;
  /** per-row emphasis tint (e.g. "bad" for octave grid rows) */
  rowTone?: (row: T) => "" | "bad" | "warn" | "ok";
  /** render a client-side global filter box above the table */
  filterable?: boolean;
  /** paginate with page controls (page size: `pageSize`, default 15) */
  paginate?: boolean;
  pageSize?: number;
}) {
  const {
    columns,
    rows,
    cap,
    copyLines,
    copyName,
    rowActions,
    initialSort,
    ariaLabel,
    empty,
    rowTone,
  } = props;

  // grid template derived from the columns themselves (NOT from the table
  // core) — track sizes stay flat: `minmax(90px, minmax(0, 1fr))` is INVALID
  // grid syntax and silently discards the whole declaration.
  const allColumns: DataTableColumn<T>[] = rowActions
    ? [
        ...columns,
        {
          key: "__actions",
          head: "",
          align: "end",
          min: 34,
          grow: 0,
          cell: () => null,
        },
      ]
    : columns;
  const template = allColumns
    .map((c) => {
      if (c.grow === 0) return `${c.min ?? 34}px`;
      const fr = `${c.grow ?? 1}fr`;
      return c.min ? `minmax(${c.min}px, ${fr})` : `minmax(0, ${fr})`;
    })
    .join(" ");

  // our column defs → tanstack ColumnDefs. sortValue becomes the accessor
  // (nulls → undefined + sortUndefined:"last" = the old nulls-last contract);
  // action/display columns stay display-only, so global filter skips them.
  const tableColumns: ColumnDef<typeof dtFeatures, T, unknown>[] =
    allColumns.map((c) =>
      c.sortValue
        ? {
            id: c.key,
            accessorFn: (row: T) => c.sortValue?.(row) ?? undefined,
            sortUndefined: "last" as const,
            cell: (info) => c.cell(info.row.original, info.row.index),
          }
        : {
            id: c.key,
            cell: (info) => c.cell(info.row.original, info.row.index),
          },
    );

  const table = useTable({
    features: dtFeatures,
    columns: tableColumns,
    data: rows,
    globalFilterFn: "includesString",
    getRowId: (row: T, idx: number) =>
      columns[0]?.rowKey?.(row, idx) ?? String(idx),
    initialState: {
      sorting: initialSort
        ? [{ id: initialSort.key, desc: initialSort.dir === -1 }]
        : [],
      pagination: {
        pageIndex: 0,
        pageSize: props.paginate
          ? (props.pageSize ?? 15)
          : Number.MAX_SAFE_INTEGER,
      },
    },
  });

  if (rows.length === 0 && empty) return <>{empty}</>;

  const view = table.getRowModel().rows; // filter → sort → paginate applied
  const page = view;
  const shown = cap !== undefined ? page.slice(0, cap) : page;
  const overCap = cap !== undefined && page.length > shown.length;
  // table.state.globalFilter is `any` upstream (@tanstack/table-core declares
  // `globalFilter: any`). Read it through a typed narrow instead of letting
  // the any propagate; the state-hoisting refactor is tracked in the audit.
  const rawState: unknown = table.state;
  const rawFilter =
    typeof rawState === "object" &&
    rawState !== null &&
    "globalFilter" in rawState
      ? (rawState as { globalFilter?: unknown }).globalFilter
      : undefined;
  const q = String(typeof rawFilter === "string" ? rawFilter : "").trim();

  return (
    <div
      class="datatable"
      role="table"
      aria-label={ariaLabel ?? copyName}
      style={{ "--dt-cols": template } as Record<string, string>}
    >
      {props.filterable && (
        <div class="pl-tools">
          <div class="plsearch">
            <Icon name="search" size={13} />
            <input
              name={`${copyName ?? "datatable"}-filter`}
              aria-label={`Filter ${ariaLabel ?? copyName ?? "rows"}`}
              placeholder="Filter rows…"
              value={q}
              onInput={(e) =>
                table.setGlobalFilter((e.target as HTMLInputElement).value)
              }
            />
            {q && (
              <button
                type="button"
                class="plsearch-clear"
                title="Clear filter (Escape)"
                onClick={() => table.setGlobalFilter("")}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      <div class="dt-head" role="row">
        {table.getHeaderGroups()[0]?.headers.map((h) => {
          const c = allColumns.find((x) => x.key === h.column.id)!;
          const canSort = h.column.getCanSort();
          const dir = h.column.getIsSorted();
          return (
            <span
              key={h.id}
              role="columnheader"
              aria-sort={
                dir === "asc"
                  ? "ascending"
                  : dir === "desc"
                    ? "descending"
                    : canSort
                      ? "none"
                      : undefined
              }
              class={`dt-h ${c.align ? `ta-${c.align}` : ""} ${canSort ? "dt-sortable" : ""} ${dir ? "sorted" : ""}`}
              onClick={h.column.getToggleSortingHandler()}
              onKeyDown={(e: KeyboardEvent) => {
                if (canSort && e.key === "Enter") h.column.toggleSorting();
              }}
              tabIndex={canSort ? 0 : undefined}
              title={
                canSort
                  ? `Sort by ${typeof c.head === "string" ? c.head : c.key}`
                  : undefined
              }
            >
              {c.head}
              {canSort && dir && (
                <Icon name={dir === "asc" ? "chevU" : "chevD"} size={10} />
              )}
            </span>
          );
        })}
      </div>
      {shown.map((r) => {
        const tone = rowTone?.(r.original) ?? "";
        return (
          <div
            class={`dt-row${tone ? ` row-tone-${tone}` : ""}`}
            role="row"
            key={r.id}
          >
            {r.getAllCells().map((cell, ci) => {
              const c = allColumns[ci]!;
              return (
                <span
                  key={cell.id}
                  role="cell"
                  class={`dt-c ${c.align ? `ta-${c.align}` : ""}`}
                >
                  {cell.column.id === "__actions"
                    ? rowActions?.map((a) => (
                        <button
                          type="button"
                          class="btn sm ghostbtn"
                          title={a.title ?? a.label}
                          onClick={() => a.run(r.original)}
                        >
                          {a.icon && <Icon name={a.icon} size={12} />}
                          {a.label}
                        </button>
                      ))
                    : c.cell(r.original, r.index)}
                </span>
              );
            })}
          </div>
        );
      })}
      {page.length === 0 && rows.length > 0 && (
        <div class="empty">
          no rows match “{q}” — clear the filter to see all {rows.length}
        </div>
      )}
      {overCap &&
        (props.footer ?? (
          <Truncated shown={shown.length} total={page.length} />
        ))}
      {props.paginate && table.getPageCount() > 1 && (
        <div class="dt-pages">
          <button
            type="button"
            class="btn sm ghostbtn"
            disabled={!table.getCanPreviousPage()}
            onClick={table.previousPage}
          >
            <Icon name="chevronL" size={12} /> prev
          </button>
          <span class="fleet-note">
            page {table.state.pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <button
            type="button"
            class="btn sm ghostbtn"
            disabled={!table.getCanNextPage()}
            onClick={table.nextPage}
          >
            next <Icon name="chevronR" size={12} />
          </button>
        </div>
      )}
      {rows.length > 0 && copyLines && (
        <div class="dt-copy">
          <button
            type="button"
            class="btn sm ghostbtn"
            title={`Copy all ${view.length} rows — paste to an agent or notes${table.state.sorting.length ? " (current sort/filter)" : ""}`}
            onClick={() =>
              copyList(
                copyName ?? "Table",
                copyLines(view.map((r) => r.original)),
              )
            }
          >
            <Icon name="copy" size={12} /> Copy
          </button>
        </div>
      )}
    </div>
  );
}

// ---- BarList ------------------------------------------------------------------

export interface BarListRow {
  key: string;
  name: string;
  /** the measured value the bar scales against (raw, for the title) */
  value: number;
  /** what prints in the right column (defaults to value.toLocaleString()) */
  display?: string;
  /** hover gloss for the row */
  title?: string;
  /** the max all bars scale against (defaults to max of rows) */
  max?: number;
  /** total for share-% copy in the row title (defaults to sum of rows) */
  total?: number;
}

/** The one horizontal bar list. Replaces .barrow (DrivePanels.Bars,
 *  HealthTab.FolderBars), .extrow (ExtBars) and .chip-list (GenreBars,
 *  ChipListLite, skip census) — 7 hand-rolled variants, one component. */
export function BarList(props: {
  rows: BarListRow[];
  /** cap rendered rows (renders the "…and N more" footer) */
  cap?: number;
  /** gradient flavor: accent (genres/keys) | info (ext/tech) | warn */
  tone?: "accent" | "info" | "warn";
  empty?: ComponentChildren;
  class?: string;
}) {
  if (props.rows.length === 0) return props.empty ? <>{props.empty}</> : null;
  const max =
    props.rows.length > 0 ? Math.max(...props.rows.map((r) => r.value), 1) : 1;
  const total = props.rows.reduce((s, r) => s + r.value, 0) || 1;
  const shown =
    props.cap !== undefined ? props.rows.slice(0, props.cap) : props.rows;
  return (
    <div class={`barlist ${props.class ?? ""}`} role="list">
      {shown.map((r) => (
        <div
          class="bl-row"
          role="listitem"
          key={r.key}
          title={
            r.title ??
            `${r.name}: ${r.display ?? r.value.toLocaleString()} · ${Math.round(
              (r.value / total) * 100,
            )}% of total`
          }
        >
          <span class="bl-name">{r.name}</span>
          <span class={`bl-track tone-${props.tone ?? "accent"}`}>
            <i
              style={{
                width: `${Math.max(2, (r.value / (r.max ?? max)) * 100)}%`,
              }}
            />
          </span>
          <span class="bl-n">{r.display ?? r.value.toLocaleString()}</span>
        </div>
      ))}
      {props.cap !== undefined && props.rows.length > props.cap && (
        <div class="fleet-note">
          …and {props.rows.length - props.cap} more — Copy has all
        </div>
      )}
    </div>
  );
}

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
