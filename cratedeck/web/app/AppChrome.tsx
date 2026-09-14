import type {
  DriveCardData,
  InterlockState,
  SearchResult,
} from "../../shared/types";
import type { ComponentChildren } from "preact";
import { PRODUCT_TABS, PRODUCTS, LEDE } from "../products/shared";
import { Icon } from "../ui/icons";
import { Onboard } from "../ui/Onboard";
import { navigate, navigateProduct, type Route } from "./router";

export function AppHeader(props: {
  drives: DriveCardData[];
  interlock: InterlockState;
  query: string;
  results: SearchResult[] | null;
  searchRef: { current: HTMLInputElement | null };
  searchInput: ComponentChildren;
  setQuery: (value: string) => void;
  openDrive: (id: string, tab?: string) => void;
  openPalette: () => void;
}) {
  const mounted = props.drives.filter((drive) => drive.mounted).length;
  const ghosts = props.drives.length - mounted;
  const locked = props.interlock.rekordbox_running;
  const slowLink = props.drives.filter(
    (drive) =>
      drive.mounted &&
      drive.link_bps !== null &&
      drive.link_bps < 5_000_000_000,
  );
  return (
    <>
      <header class="topbar">
        <div
          class="brand"
          onClick={() => navigate(null)}
          title="megadj — one toolkit for the DJ library"
        >
          <span class="brand-mark" />
          <h1>megadj</h1>
        </div>
        <span
          class="top-meta"
          title="How many known drives are mounted now vs remembered-but-unplugged ('ghosts')."
        >
          <b>{mounted}</b> mounted · <span class="ghostn">{ghosts}</span> ghost
          {ghosts === 1 ? "" : "s"}
        </span>
        <div class="spacer" />
        <span
          class={`lockchip ${locked ? "on" : "off"}`}
          title={
            locked
              ? `rekordbox is running (pid ${props.interlock.pid}) — the interlock refuses ALL drive jobs because rekordbox locks the same databases. Quit rekordbox to unlock.`
              : "rekordbox is not running — the interlock allows drive jobs."
          }
        >
          <span class="lockdot" />
          {locked ? `rekordbox · pid ${props.interlock.pid}` : "ready"}
        </span>
        <div class="search">
          <span class="search-ico">
            <Icon name="search" size={15} />
          </span>{" "}
          {props.searchInput}
          {props.query && (
            <button
              type="button"
              class="search-clear"
              onClick={() => {
                props.setQuery("");
                props.searchRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <Icon name="x" size={13} />
            </button>
          )}
          {props.results && (
            <div class="search-results">
              {props.results.length === 0 && (
                <div class="sr-empty">No matches in any crate.</div>
              )}
              {props.results.map((result) => (
                <div
                  key={result.drive_id}
                  class="sr-drive"
                  onClick={() => props.openDrive(result.drive_id)}
                >
                  <div class="hd">
                    <span class={`dot ${result.mounted ? "on" : "off"}`} />
                    {result.drive_name}
                    {!result.mounted && <span class="ghost-tag">ghost</span>}
                  </div>
                  {result.matches.map((match) => (
                    <div class="sr-match" key={`${match.type}:${match.name}`}>
                      <span>
                        <span class="sr-type">{match.type}</span> {match.name}
                      </span>
                      <span>{match.entries?.toLocaleString() ?? "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          class="btn ghostbtn palette-btn"
          title="Command palette — jump to any drive, tab or fleet scope"
          onClick={props.openPalette}
        >
          <Icon name="chevronR" size={12} /> <kbd>⌘K</kbd>
        </button>
      </header>
      {slowLink.length > 0 && (
        <div
          class="arch-verdict warn usblink-banner"
          role="alert"
          title="The negotiated USB link rate is read from the Mac's USB tree when the drive mounts. USB 2.0 caps copies/playback at ~35 MB/s — move the cable to a USB 3.0 (blue) port or a faster hub. Run Health → Speed probe to measure real throughput."
        >
          <Icon name="warn" size={15} />
          <span>
            <b>Slow USB link:</b>{" "}
            {slowLink.map((drive) => drive.nickname ?? drive.name).join(", ")}{" "}
            {slowLink.length === 1 ? "is" : "are"} on a USB 2.0-class link —
            transfers will crawl. Try a USB 3.0 port or hub.
          </span>
          <button
            type="button"
            class="usblink-action"
            onClick={() => {
              const first = slowLink[0];
              if (first) props.openDrive(first.id, "health");
            }}
          >
            Check speed
          </button>
        </div>
      )}
    </>
  );
}

/** Product and scope navigation derived from the shared product registry. */
export function AppNav({ route }: { route: Route }) {
  const scopeTabs =
    route.product === "fleet"
      ? [...PRODUCT_TABS.drives, ...PRODUCT_TABS.fleet]
      : PRODUCT_TABS[route.product];
  const scopeOn =
    route.product === "drives" ? (route.fleet ? "fleet" : "") : route.tab;
  const activeProduct =
    route.product === "fleet"
      ? PRODUCTS[0]
      : PRODUCTS.find((product) => product.id === route.product);
  return (
    <nav class="navstrip" aria-label="Products">
      {PRODUCTS.map((product) => (
        <button
          type="button"
          key={product.id}
          class={`product-tab ${
            route.product === product.id ||
            (product.id === "drives" && route.product === "fleet")
              ? "on"
              : ""
          }`}
          data-prod={product.id}
          onClick={() =>
            route.product !== product.id &&
            (product.id === "drives"
              ? navigate(null)
              : navigateProduct(product.id))
          }
          title={product.title}
        >
          <Icon name={product.icon} size={13} /> {product.label}
        </button>
      ))}
      <span class="navstrip-sep" aria-hidden />
      {scopeTabs.map((tab) => {
        const on =
          tab.id === "fleet" && route.product === "fleet"
            ? true
            : scopeOn === tab.id;
        const onClick = () => {
          if (route.product === "drives") {
            if (tab.id === "fleet") navigateProduct("fleet");
            else if (route.fleet) navigate(null);
          } else if (route.product === "fleet") {
            if (tab.id === "fleet") navigate(null);
            else if (route.tab !== tab.id) navigateProduct("fleet", tab.id);
          } else if (route.tab !== tab.id) {
            navigateProduct(route.product, tab.id);
          }
        };
        return (
          <button
            type="button"
            key={`${route.product}:${tab.id || "shelf"}`}
            class={`scope-tab ${on ? "on" : ""}`}
            data-prod={route.product}
            onClick={onClick}
            title={tab.title}
          >
            {tab.label}
          </button>
        );
      })}
      <span class="navstrip-spacer" aria-hidden />
      {activeProduct && (
        <span
          class="phasechip"
          data-prod={activeProduct.id}
          title={activeProduct.title}
        >
          <span class="phasechip-step">
            {PRODUCTS.indexOf(activeProduct) + 1}
          </span>
          {activeProduct.phase}
        </span>
      )}
    </nav>
  );
}

/** The empty-crate shelf (no drive selected): the megadj pipeline story —
 *  three product launcher cards in pipeline order — plus the health notes
 *  (failing drives, interlock) and the guided tour. Launchers come from the
 *  same SSOT as the nav strip (PRODUCTS + LEDE), so a new product can't
 *  exist on one surface only. */
export function Welcome(props: {
  drives: DriveCardData[];
  locked: boolean;
  onPick: (id: string) => void;
}) {
  const failing = props.drives.filter((d) =>
    d.badges.some((b) => b.tone === "bad"),
  );
  return (
    <div class="canvas welcome-page">
      <div class="wstory">
        <div class="wbrand">
          <span class="brand-mark big" />
          <div>
            <h2>megadj</h2>
            <p class="wtag">
              One toolkit for the DJ library: drives stay honest, the archive
              fills, the tracks get smart.
            </p>
          </div>
        </div>
        <div class="wpipe">
          {PRODUCTS.map((p, i) => (
            <button
              type="button"
              key={p.id}
              class="wcard"
              data-prod={p.id}
              onClick={() =>
                p.id === "drives" ? navigate(null) : navigateProduct(p.id)
              }
            >
              <span class="wphase" data-prod={p.id}>
                <span class="wstep">{i + 1}</span>
                {p.phase}
              </span>
              <span class="whd">
                <Icon name={p.icon} size={17} /> {p.label}
              </span>
              <span class="wlede">{LEDE[p.id]}</span>
              <span class="wgo">
                Open {p.label} <Icon name="play" size={12} />
              </span>
            </button>
          ))}
        </div>
        {props.drives.length === 0 && (
          <div class="note" style={{ justifyContent: "center" }}>
            <Icon name="usb" size={14} /> No drives yet — plug a DJ USB stick in
            and it appears on the rail, health-checked automatically.
          </div>
        )}
        {failing.length > 0 && (
          <div class="note bad" style={{ justifyContent: "center" }}>
            <Icon name="warn" size={14} />
            {failing.length} drive{failing.length > 1 ? "s" : ""} flagged —
            start with {failing[0]!.nickname ?? failing[0]!.name}.
            <button
              type="button"
              class="btn sm"
              onClick={() => props.onPick(failing[0]!.id)}
            >
              Open
            </button>
          </div>
        )}
        {props.locked && (
          <div class="note bad" style={{ justifyContent: "center" }}>
            <Icon name="warn" size={14} /> rekordbox is running — jobs are
            locked until it quits.
          </div>
        )}
      </div>
      <Onboard />
    </div>
  );
}
