import { JSON_MODE, getJson, log } from "./deckctl_runtime";

export async function cmdPrep(outPath: string | undefined): Promise<void> {
  const { fetchWeeklyPrepInput, renderWeeklyPrep } =
    await import("./weekly_prep");
  const input = await fetchWeeklyPrepInput(getJson);
  const markdown = renderWeeklyPrep(input);
  if (outPath) await Bun.write(outPath, `${markdown}\n`);
  if (JSON_MODE) {
    console.log(
      JSON.stringify({ ...input, markdown, written: outPath }, null, 2),
    );
    return;
  }
  log(markdown);
  if (outPath) log(`\nwritten: ${outPath}`);
}
