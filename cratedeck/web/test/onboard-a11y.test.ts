import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const helpCss = readFileSync(
  join(import.meta.dir, "../styles/help.css"),
  "utf8",
);
const pagesCss = readFileSync(
  join(import.meta.dir, "../styles/pages.css"),
  "utf8",
);
const canvasCss = readFileSync(
  join(import.meta.dir, "../styles/canvas.css"),
  "utf8",
);
const railCss = readFileSync(
  join(import.meta.dir, "../styles/rail.css"),
  "utf8",
);
const dataCss = readFileSync(
  join(import.meta.dir, "../styles/data.css"),
  "utf8",
);
const productsCss = readFileSync(
  join(import.meta.dir, "../styles/products.css"),
  "utf8",
);
const intakeCss = readFileSync(
  join(import.meta.dir, "../styles/intake.css"),
  "utf8",
);
const fleetCss = readFileSync(
  join(import.meta.dir, "../styles/fleet-tabs.css"),
  "utf8",
);

function colorFor(css: string, selector: string): string | undefined {
  return new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*color:\\s*([^;]+)`,
    "u",
  )
    .exec(css)?.[1]
    ?.trim();
}

test("onboarding secondary text uses the AA-readable muted token", () => {
  for (const selector of [".ob-where", ".ob-dur", ".ob-job-safety"]) {
    expect(colorFor(helpCss, selector)).toBe("var(--muted)");
  }
  expect(colorFor(pagesCss, ".port .port-last")).toBe("var(--muted)");
  expect(colorFor(canvasCss, "h3.sect")).toBe("var(--muted)");
  expect(colorFor(canvasCss, ".sect-n")).toBe("var(--muted)");
  expect(colorFor(dataCss, ".dt-head")).toBe("var(--muted)");
  for (const selector of [
    ".ft-coverage-head",
    ".ft-coverage-label",
    ".ft-coverage-cmd",
  ]) {
    expect(colorFor(productsCss, selector)).toBe("var(--muted)");
  }
  expect(colorFor(intakeCss, ".intake-setup .intake-watch-hint")).toBe(
    "var(--muted)",
  );
  expect(colorFor(fleetCss, ".fleet-note")).toBe("var(--muted)");
  expect(railCss).not.toMatch(/\.dcard\.ghost\s*\{[^}]*opacity:/u);
});
