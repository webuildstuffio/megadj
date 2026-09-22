import { expect, test } from "bun:test";
import { join } from "node:path";
import { functionMetrics } from "../../test-support/source-metrics";

const webDir = join(import.meta.dir, "..", "web");

test("#45: DrivePage and App stay below their hotspot ceilings", () => {
  const drivePage = functionMetrics(
    join(webDir, "products", "drives", "DrivePage.tsx"),
    "DrivePage",
  );
  const app = functionMetrics(join(webDir, "app", "App.tsx"), "App");

  expect(
    drivePage.lines,
    "DrivePage must be at most 400 lines",
  ).toBeLessThanOrEqual(400);
  expect(app.lines, "App must be at most 300 lines").toBeLessThanOrEqual(300);
});
