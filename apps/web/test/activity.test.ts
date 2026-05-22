import { describe, it, expect } from "vitest";
import { project, centroidFor, MAP_WIDTH, MAP_HEIGHT } from "../src/lib/geo.js";
import { sourceColor, SOURCE_COLORS, FALLBACK_COLOR } from "../src/lib/activity.js";

describe("geo.project (equirectangular)", () => {
  it("maps (0,0) to the center of the box", () => {
    const { x, y } = project(0, 0);
    expect(x).toBeCloseTo(MAP_WIDTH / 2);
    expect(y).toBeCloseTo(MAP_HEIGHT / 2);
  });

  it("maps the extremes to opposite corners", () => {
    expect(project(-180, 90)).toEqual({ x: 0, y: 0 });
    expect(project(180, -90)).toEqual({ x: MAP_WIDTH, y: MAP_HEIGHT });
  });
});

describe("centroidFor", () => {
  it("knows the launch countries", () => {
    expect(centroidFor("US")?.name).toBe("United States");
    expect(centroidFor("BR")?.name).toBe("Brazil");
  });

  it("returns null for an unknown code", () => {
    expect(centroidFor("ZZ")).toBeNull();
  });
});

describe("sourceColor", () => {
  it("returns a stable color for every registered source", () => {
    for (const id of Object.keys(SOURCE_COLORS)) {
      expect(sourceColor(id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("falls back for an unknown source id", () => {
    expect(sourceColor("mystery-source")).toBe(FALLBACK_COLOR);
  });
});
