import { describe, expect, test } from "bun:test";
import { canonGenre } from "./fetch_lib";

describe("canonGenre", () => {
  test("maps known SC labels to canonical genres", () => {
    expect(canonGenre("Hip-Hop & Rap")).toBe("Hip-Hop");
    expect(canonGenre("hip-hop & rap")).toBe("Hip-Hop");
    expect(canonGenre("#house")).toBe("House");
    expect(canonGenre("Tech House")).toBe("Tech House");
    expect(canonGenre("r&b / soul")).toBe("R&B");
    expect(canonGenre("Drum & Bass")).toBe("Drum & Bass");
    expect(canonGenre("dance & edm")).toBe("EDM");
  });

  test("title-cases unknown labels", () => {
    expect(canonGenre("afro house")).toBe("Afro house");
    expect(canonGenre("Baltimore club")).toBe("Baltimore club");
  });

  test("strips hashtag prefix", () => {
    expect(canonGenre("#techno")).toBe("Techno");
  });
});
