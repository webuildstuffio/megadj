// stats.tsx — the stat-card primitives (#204 split from data.tsx):
// StatCard + CountStat (the .stat family with tone/em support).
import { Icon, type IconName } from "./icons";

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
  /** Click affordance (Sep 21): the archive counters jump to their
   *  matching list — the stat becomes a button. */
  onClick?: (() => void) | undefined;
}) {
  const clickable = props.onClick !== undefined;
  return (
    <div
      class={`stat ${props.tone ?? ""}${clickable ? " clickable" : ""}`}
      title={props.title}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? props.onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") props.onClick?.();
            }
          : undefined
      }
    >
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
  invert?: boolean | undefined;
  /** Click affordance — forwarded to StatCard (the stat jumps to its
   *  matching list). */
  onClick?: (() => void) | undefined;
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
      onClick={props.onClick}
    />
  );
}
