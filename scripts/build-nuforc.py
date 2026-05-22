#!/usr/bin/env python3
"""Aggregate the NUFORC sightings CSV (~80k rows) into a compact JSON for the map.

Source: planetsig/ufo-reports (geocoded + time-standardized NUFORC export).
We never ship 80k raw points to the browser — we pre-bucket them into a density
grid plus shape/decade/country rollups. Output: apps/web/src/data/nuforc.json

Run: python3 scripts/build-nuforc.py
"""
import csv, io, json, os, urllib.request
from collections import Counter

CSV_URL = (
    "https://raw.githubusercontent.com/planetsig/ufo-reports/master/"
    "csv-data/ufo-scrubbed-geocoded-time-standardized.csv"
)
OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "src", "data", "nuforc.json")
GRID = 2.0  # degrees per density cell


def snap(v: float, step: float) -> float:
    return round(round(v / step) * step, 1)


def main() -> None:
    print("downloading NUFORC CSV…")
    raw = urllib.request.urlopen(CSV_URL, timeout=120).read().decode("latin-1")
    reader = csv.reader(io.StringIO(raw))

    total = 0
    geo = 0
    grid: Counter = Counter()
    shapes: Counter = Counter()
    decades: Counter = Counter()
    countries: Counter = Counter()
    min_year, max_year = 9999, 0

    for row in reader:
        if len(row) < 11:
            continue
        total += 1
        dt, _city, _state, country, shape, _dsec, _dtxt, _comments, _posted, lat, lng = row[:11]

        if shape.strip():
            shapes[shape.strip().lower()] += 1
        if country.strip():
            countries[country.strip().lower()] += 1

        # year from "M/D/YYYY HH:MM"
        try:
            y = int(dt.split("/")[2].split()[0])
            if 1900 <= y <= 2100:
                decades[(y // 10) * 10] += 1
                min_year, max_year = min(min_year, y), max(max_year, y)
        except (IndexError, ValueError):
            pass

        try:
            la, lo = float(lat), float(lng)
            if -90 <= la <= 90 and -180 <= lo <= 180:
                geo += 1
                grid[(snap(la, GRID), snap(lo, GRID))] += 1
        except ValueError:
            pass

    cells = [
        {"lat": la, "lng": lo, "n": n}
        for (la, lo), n in grid.most_common(500)
    ]
    out = {
        "source": "NUFORC via planetsig/ufo-reports",
        "total": total,
        "geolocated": geo,
        "yearRange": [min_year, max_year],
        "gridDeg": GRID,
        "cells": cells,
        "shapes": [{"shape": s, "n": n} for s, n in shapes.most_common(14)],
        "decades": [{"decade": d, "n": n} for d, n in sorted(decades.items())],
        "countries": [{"country": c, "n": n} for c, n in countries.most_common(8)],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {total} sightings, {geo} geolocated, {len(cells)} grid cells")
    print(f"  years {min_year}-{max_year}, top shape: {out['shapes'][0]}")


if __name__ == "__main__":
    main()
