import { expect, test } from "bun:test";
import { join } from "node:path";
import { functionMetrics } from "../test-support/source-metrics";

test("#39: the CLI entry point is a thin dispatcher", () => {
  const metrics = functionMetrics(join(import.meta.dir, "../cli.ts"), "main");

  expect(metrics.lines, "main() must be at most 150 lines").toBeLessThanOrEqual(
    150,
  );
  expect(
    metrics.cyclomaticComplexity,
    "main() cyclomatic complexity must be at most 15",
  ).toBeLessThanOrEqual(15);
});
