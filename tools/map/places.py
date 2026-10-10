#!/usr/bin/env python3
"""Reduce an `osmium export` GeoJSONSeq of named features to the compact places.tsv the app searches.

  python3 tools/map/places.py places.geojsonseq places.tsv

Columns: name, kind, lat, lon, elevation (m, peaks/hills only, else empty). Header line first.
Sorted by kind importance, then name, so the app can stop scanning early for common queries.
"""
from __future__ import annotations

import json
import sys

# Kinds in order of importance (the app shows the most important matches first).
KINDS = ["city", "town", "village", "suburb", "hamlet", "island", "peak", "hill", "lake", "reservoir", "hut",
         "shelter", "waterfall", "spring", "wood", "saddle", "cave", "locality", "neighbourhood", "islet", "farm",
         "isolated_dwelling"]
PLACE = {"city", "town", "village", "suburb", "hamlet", "island", "islet", "locality", "neighbourhood", "farm",
         "isolated_dwelling"}


def kind_of(t: dict) -> str | None:
    if t.get("place") in PLACE:
        return t["place"]
    n = t.get("natural")
    if n in ("peak", "hill", "spring", "saddle"):
        return n
    if n == "cave_entrance":
        return "cave"
    if t.get("waterway") == "waterfall":
        return "waterfall"
    if t.get("tourism") in ("wilderness_hut", "alpine_hut"):
        return "hut"
    if t.get("amenity") == "shelter":
        return "shelter"
    if t.get("landuse") == "reservoir" or t.get("water") == "reservoir":
        return "reservoir"
    if n == "water":
        return "lake"
    if n == "wood" or t.get("landuse") == "forest":
        return "wood"
    return None


def point(geom: dict) -> tuple[float, float] | None:
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        return c[1], c[0]
    if t == "Polygon":
        ring = c[0]
    elif t == "MultiPolygon":
        ring = max((p[0] for p in c), key=len)
    else:
        return None
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return sum(ys) / len(ys), sum(xs) / len(xs)


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    rows: dict[tuple[str, str, float, float], str] = {}
    with open(src, encoding="utf-8") as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            feat = json.loads(line)
            t = feat.get("properties") or {}
            name = (t.get("name:en") or t.get("name") or "").strip().replace("\t", " ")
            if not name:
                continue
            k = kind_of(t)
            pt = point(feat.get("geometry") or {}) if k else None
            if not pt:
                continue
            ele = ""
            if k in ("peak", "hill") and t.get("ele"):
                try:
                    ele = str(round(float(t["ele"].replace("m", "").strip())))
                except ValueError:
                    pass
            lat, lon = round(pt[0], 5), round(pt[1], 5)
            # Collapse duplicates (the same named feature mapped as a node and an area).
            key = (name.lower(), k, round(lat, 2), round(lon, 2))
            if key not in rows:
                rows[key] = f"{name}\t{k}\t{lat}\t{lon}\t{ele}"
    order = {k: i for i, k in enumerate(KINDS)}
    out = sorted(rows.items(), key=lambda kv: (order[kv[0][1]], kv[0][0]))
    with open(dst, "w", encoding="utf-8") as o:
        o.write("name\tkind\tlat\tlon\tele\n")
        for _, line in out:
            o.write(line + "\n")
    print(f"{len(out)} places -> {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
