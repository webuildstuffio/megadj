import { JSON_MODE, emitJson, getJson, log } from "./deckctl_runtime";

export async function cmdPrep(outPath: string | undefined): Promise<void> {
  const { fetchWeeklyPrepInput, renderWeeklyPrep } =
    await import("./weekly_prep");
  const input = await fetchWeeklyPrepInput(getJson);
  const markdown = renderWeeklyPrep(input);
  if (outPath) await Bun.write(outPath, `${markdown}\n`);
  if (JSON_MODE) {
    await emitJson({ ...input, markdown, written: outPath });
    return;
  }
  log(markdown);
  if (outPath) log(`\nwritten: ${outPath}`);
}
