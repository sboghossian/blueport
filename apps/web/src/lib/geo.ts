export interface Centroid {
  name: string;
  lon: number;
  lat: number;
}

// Approximate country centroids for the release map. Add a row when a new
// government starts releasing — the map and country list pick it up for free.
export const COUNTRY_CENTROIDS: Readonly<Record<string, Centroid>> = {
  US: { name: "United States", lon: -98.5, lat: 39.8 },
  BR: { name: "Brazil", lon: -51.9, lat: -10.8 },
  GB: { name: "United Kingdom", lon: -1.5, lat: 52.4 },
  FR: { name: "France", lon: 2.2, lat: 46.6 },
  CA: { name: "Canada", lon: -106, lat: 56.1 },
  AU: { name: "Australia", lon: 134.5, lat: -25.7 },
  RU: { name: "Russia", lon: 90, lat: 61.5 },
  CL: { name: "Chile", lon: -71.5, lat: -35.7 },
  AR: { name: "Argentina", lon: -64, lat: -38.4 },
  MX: { name: "Mexico", lon: -102.5, lat: 23.6 },
};

export const MAP_WIDTH = 360;
export const MAP_HEIGHT = 180;

/** Equirectangular projection: lon/lat (degrees) → coords in a 360×180 box. */
export function project(lon: number, lat: number): { x: number; y: number } {
  return {
    x: ((lon + 180) / 360) * MAP_WIDTH,
    y: ((90 - lat) / 180) * MAP_HEIGHT,
  };
}

export function centroidFor(code: string): Centroid | null {
  return COUNTRY_CENTROIDS[code] ?? null;
}
