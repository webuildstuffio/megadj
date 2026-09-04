// icons.tsx — one inline SVG sprite, zero deps. Single-path source of truth
// for every glyph in the UI (24×24 grid, stroke-based, currentColor).

const P: Record<string, string> = {
  search: "M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm5.6 13.1L21 21",
  folder:
    "M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h9A1.5 1.5 0 0 1 21 9.9v8.6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-11Z",
  disc: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-6.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Zm0-9a6.8 6.8 0 0 0-6.4 4.5",
  pulse: "M3 12h4l2.2-6 3.8 12L15.8 12H21",
  history: "M12 8v4l2.8 1.6M12 21a9 9 0 1 1 9-9M21 5v4h-4",
  sliders: "M5 5v6m0 3v5m7-14v2m0 3v9m7-14v10m0 3v1M3 11h4m3-3h4m3 7h4",
  chevronL: "M15 5l-7 7 7 7",
  chevronR: "M9 5l7 7-7 7",
  x: "M6 6l12 12M18 6L6 18",
  check: "M4.5 12.5L10 18 19.5 7",
  warn: "M12 3 2.5 20h19L12 3Zm0 7v4m0 3v.5",
  dot: "M12 14.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z",
  scan: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8m8 0h2.5A1.5 1.5 0 0 1 20 5.5V8m0 8v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16",
  shield:
    "M12 3 5 5.8v5.4c0 4.4 2.9 8.2 7 9.8 4.1-1.6 7-5.4 7-9.8V5.8L12 3Zm-3 9l2.2 2.2L15.5 10",
  bolt: "M13 3 4.5 13.5H11L10 21l8.5-10.5H13L13 3Z",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-13.5V12l3 1.8",
  hash: "M9.5 4 8 20m8-16-1.5 16M4.5 9h15m-16 6h15",
  pencil: "M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Zm11.5-13 3 3",
  photo:
    "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Zm1 9 4.5-4.5 4 4m1.5-1.5L17 12m-4.2-3.7a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0Z",
  usb: "M12 22V7m0 0-3 4m3-4 3 4M8.5 17.5 12 22l3.5-4.5M6 12l-2.5 4.5L6 21m12-9 2.5 4.5L18 21",
  refresh: "M20 12a8 8 0 1 1-2.34-5.66M20 3.5V8h-4.5",
  play: "M8 5.5v13l10.5-6.5L8 5.5Z",
  bell: "M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7m-4.3 10a2 2 0 0 1-3.4 0",
  trash:
    "M4.5 7h15M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7m3 0-.9 12.1a1.5 1.5 0 0 1-1.5 1.4H8.4a1.5 1.5 0 0 1-1.5-1.4L6 7m4 4v5m4-5v5",
  grid: "M4.5 5.5h6v6h-6v-6Zm9 0h6v6h-6v-6Zm-9 9h6v6h-6v-6Zm9 0h6v6h-6v-6Z",
  back: "M10.5 19 3.5 12l7-7m-7 7H21",
  sort: "M7 4v16m0 0-3.5-3.5M7 20l3.5-3.5M17 20V4m0 0-3.5 3.5M17 4l3.5 3.5",
};

export function Icon(props: {
  name: keyof typeof P | string;
  size?: number;
  class?: string;
}) {
  return (
    <svg
      class={props.class ?? "icon"}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden
    >
      <path d={P[props.name] ?? P.dot} />
    </svg>
  );
}
