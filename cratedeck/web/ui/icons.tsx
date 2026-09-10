// icons.tsx — lucide-preact behind our Icon API. Every glyph comes from
// lucide (stroke-based, 24×24, currentColor — the exact language the old
// hand-drawn path table used), so the 36 name→glyph choices stay the SSOT
// here while drawing, accessibility attributes and upstream fixes are
// maintained by lucide. Tree-shaking keeps only the 35 icons we name.
//
// The `name` union is now CHECKED: a typo like name="chevDown" is a compile
// error, not a silent fallback dot. Legacy names keep their call sites
// working ("warn" → lucide's TriangleAlert, "pulse" → Activity,
// "sliders" → SlidersHorizontal, "history" → History, "grid" → LayoutGrid,
// "chevronL/R" → ChevronLeft/Right, "chevD/U" → ChevronDown/Up).
import type { FunctionalComponent } from "preact";
import {
  Search,
  Folder,
  Disc,
  Activity,
  History,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  TriangleAlert,
  Circle,
  Scan,
  ShieldCheck,
  Zap,
  Clock,
  Hash,
  Pencil,
  Image,
  Usb,
  RotateCw,
  Play,
  Bell,
  Trash2,
  LayoutGrid,
  ArrowLeft,
  ArrowUpDown,
  Copy,
  FileText,
  Info,
  Compass,
  Download,
  ChevronDown,
  ChevronUp,
  Tag,
  CircleCheckBig,
  CircleAlert,
  CircleX,
  CircleDashed,
  type LucideProps,
} from "lucide-preact";

/** The one name table — legacy app name → lucide component. Typed as
 *  FunctionalComponent so the JSX renderer accepts the lookup (a plain
 *  Record<string, …> widens to `object` and fails JSX). */
const P: Record<string, FunctionalComponent<LucideProps>> = {
  search: Search,
  folder: Folder,
  disc: Disc,
  pulse: Activity,
  history: History,
  sliders: SlidersHorizontal,
  chevronL: ChevronLeft,
  chevronR: ChevronRight,
  x: X,
  check: Check,
  warn: TriangleAlert,
  dot: Circle,
  scan: Scan,
  shield: ShieldCheck,
  bolt: Zap,
  clock: Clock,
  hash: Hash,
  pencil: Pencil,
  photo: Image,
  usb: Usb,
  refresh: RotateCw,
  play: Play,
  bell: Bell,
  trash: Trash2,
  grid: LayoutGrid,
  back: ArrowLeft,
  sort: ArrowUpDown,
  copy: Copy,
  doc: FileText,
  info: Info,
  compass: Compass,
  download: Download,
  chevD: ChevronDown,
  chevU: ChevronUp,
  tag: Tag,
  // circular verdict glyphs — the status language of the redesigned rail:
  // a check INSIDE a filled circle reads at any size, unlike a bare "!"
  circleCheck: CircleCheckBig,
  circleAlert: CircleAlert,
  circleX: CircleX,
  circleDashed: CircleDashed,
};

/** Any lucide glyph name. Call sites can name icons beyond the table when a
 *  page needs something one-off (autocompleted, compile-checked, tree-shaken
 *  exactly like the table). */
export type IconName = keyof typeof P;

export function Icon(props: {
  name: IconName | string;
  size?: number;
  class?: string;
}) {
  // table wins (renames stay centralized); unknown names fall back to dot
  const Cmp = P[props.name] ?? Circle;
  return (
    <Cmp
      class={props.class ?? "icon"}
      size={props.size ?? 16}
      absoluteStrokeWidth={false}
      aria-hidden
    />
  );
}
