/**
 * colour-energy.ts — RB colour = energy band; My Tag = L2/L3 (B10.2).
 *
 * Maps energy bands (1–10) to rekordbox colour IDs and
 * builds the My Tag string from genre family + L3 subgenre.
 *
 * Rekordbox colour codes (djmdContent.ColorID):
 *   0=none, 1=pink, 2=red, 3=orange, 4=yellow, 5=green,
 *   6=aqua, 7=blue, 8=purple
 *
 * Energy-to-colour: cold→hot gradient:
 *   1–2=blue(7), 3–4=aqua(6), 5–6=green(5), 7–8=orange(3), 9–10=red(2)
 */

/** Map energy band (1–10) to rekordbox ColorID. */
export function energyToColour(band: number): number {
  if (band <= 2) return 7; // blue — low energy
  if (band <= 4) return 6; // aqua
  if (band <= 6) return 5; // green — mid energy
  if (band <= 8) return 3; // orange
  return 2; // red — high energy
}

/** Human-readable colour name for display. */
export function colourName(colorId: number): string {
  const NAMES: Record<number, string> = {
    0: "none",
    1: "pink",
    2: "red",
    3: "orange",
    4: "yellow",
    5: "green",
    6: "aqua",
    7: "blue",
    8: "purple",
  };
  return NAMES[colorId] ?? "unknown";
}

/**
 * Build the My Tag string from genre info.
 *
 * Format: "L2 / L3" when L3 is available, just "L2" otherwise.
 * This fits in rekordbox's My Tag field for grid browsing by genre.
 */
export function buildMyTag(
  family: string | null,
  l3Subgenre: string | null,
): string {
  if (family === null) return "";
  if (l3Subgenre !== null && l3Subgenre !== family) {
    return `${family} / ${l3Subgenre}`;
  }
  return family;
}
