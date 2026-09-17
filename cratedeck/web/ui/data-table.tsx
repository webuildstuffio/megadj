// data-table.tsx — the DataTable (#204 split from data.tsx): the tanstack-
// backed table with its column/row-action types. The grid template is
// DERIVED from the columns array; the CSS classes are the stable contract.
import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "./icons";
import { copyList, Truncated } from "./kv";
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
