#!/usr/bin/env bash
# Build the offline map data for Great Britain. Needs network access, so it runs in GitHub Actions
# (.github/workflows/map.yml), but works on any Linux box with the tools below.
#
#   tools/map/build_map.sh basemap    # gb.pmtiles: OpenStreetMap vector tiles (Protomaps basemap build)
#   tools/map/build_map.sh places     # places.tsv: named places, peaks, huts, lakes... for offline search
#   tools/map/build_map.sh contours   # contours.pmtiles: 10 m contours from OS Terrain 50 (OGL)
#   tools/map/build_map.sh sample     # tiny extracts of all three around Keswick, for the UI tests
#
# Needs: curl, pmtiles (go-pmtiles), python3; places: osmium-tool; contours: gdal-bin, tippecanoe >= 2.17.
# Output goes to $OUT (default ./mapdata). See docs/MAP.md.
set -euo pipefail

OUT=${OUT:-mapdata}
BBOX="-8.7,49.8,1.9,60.9"            # Great Britain incl. Scilly, Orkney and Shetland
MAXZOOM=${MAXZOOM:-15}
LIMIT=$((2000 * 1024 * 1024))         # a GitHub release asset must be < 2 GiB
SAMPLE_BBOX="-3.22,54.52,-3.0,54.66"  # Keswick, Derwentwater and Skiddaw
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"

latest_build() {
  # Daily Protomaps planet builds are published as https://build.protomaps.com/YYYYMMDD.pmtiles
  for i in $(seq 0 30); do
    d=$(date -u -d "-$i day" +%Y%m%d)
    if curl -sfI "https://build.protomaps.com/$d.pmtiles" >/dev/null; then echo "$d"; return; fi
  done
  echo "no Protomaps build found in the last 30 days" >&2; return 1
}

basemap() {
  local d; d=$(latest_build)
  echo "Protomaps build $d"
  echo "$d" > "$OUT/basemap-build.txt"
  pmtiles extract "https://build.protomaps.com/$d.pmtiles" "$OUT/gb-z$MAXZOOM.pmtiles" \
    --bbox="$BBOX" --maxzoom="$MAXZOOM" --download-threads=8
  local size; size=$(stat -c %s "$OUT/gb-z$MAXZOOM.pmtiles")
  echo "z0-$MAXZOOM: $size bytes"
  if [ "$size" -gt "$LIMIT" ]; then
    # Too big for one release asset: drop the most detailed zoom. MapLibre overzooms z14 tiles fine.
    pmtiles extract "$OUT/gb-z$MAXZOOM.pmtiles" "$OUT/gb.pmtiles" --maxzoom=$((MAXZOOM - 1))
    echo "z0-$((MAXZOOM - 1)): $(stat -c %s "$OUT/gb.pmtiles") bytes"
    rm "$OUT/gb-z$MAXZOOM.pmtiles"
  else
    mv "$OUT/gb-z$MAXZOOM.pmtiles" "$OUT/gb.pmtiles"
  fi
  pmtiles show "$OUT/gb.pmtiles" | head -30
}

places() {
  local work=${WORK:-work}; mkdir -p "$work"
  curl -fL --retry 3 -o "$work/gb.osm.pbf" https://download.geofabrik.de/europe/great-britain-latest.osm.pbf
  osmium tags-filter "$work/gb.osm.pbf" \
    n/place n/natural=peak,hill,spring,saddle,cave_entrance n/waterway=waterfall \
    nwr/tourism=wilderness_hut,alpine_hut nwr/amenity=shelter \
    wr/natural=water wr/landuse=reservoir wr/natural=wood wr/landuse=forest \
    -o "$work/places.osm.pbf" --overwrite
  osmium export "$work/places.osm.pbf" -f geojsonseq --geometry-types=point,polygon \
    -o "$work/places.geojsonseq" --overwrite
  python3 "$HERE/places.py" "$work/places.geojsonseq" "$OUT/places.tsv"
}

contours() {
  local work=${WORK:-work}; mkdir -p "$work/terr50" "$work/asc"
  # OS Terrain 50 (Open Government Licence), 50 m height grid of Great Britain.
  curl -fL --retry 3 -o "$work/terr50.zip" \
    "https://api.os.uk/downloads/v1/products/Terrain50/downloads?area=GB&format=ASCII+Grid+and+GML+%28Grid%29&redirect"
  unzip -q -o "$work/terr50.zip" -d "$work/terr50"
  find "$work/terr50" -name '*.zip' -print0 | xargs -0 -n 50 -P 4 sh -c 'for z; do unzip -q -o -d "'"$work"'/asc" "$z" "*.asc" || true; done' _
  echo "$(find "$work/asc" -name '*.asc' | wc -l) height tiles"
  find "$work/asc" -name '*.asc' > "$work/asc.txt"
  gdalbuildvrt -a_srs EPSG:27700 -input_file_list "$work/asc.txt" "$work/terr50.vrt"
  gdal_contour -a ele -i 10 "$work/terr50.vrt" "$work/contours.gpkg"
  ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 -lco COORDINATE_PRECISION=5 -dialect SQLite \
    -sql "SELECT geom, CAST(ele AS INTEGER) AS ele,
                 CASE WHEN CAST(ele AS INTEGER) % 100 = 0 THEN 2 WHEN CAST(ele AS INTEGER) % 50 = 0 THEN 1 ELSE 0 END AS idx
          FROM contour WHERE ele > 0" \
    "$work/contours.geojsonseq" "$work/contours.gpkg"
  # z10: 100 m lines, z11: 50 m, z12: every 10 m. The app overzooms z12 for closer views.
  tippecanoe -o "$OUT/contours.pmtiles" --force -l contour -Z10 -z12 -y ele -y idx \
    -j '{"contour":["any",[">=","$zoom",12],["all",[">=","$zoom",11],[">=","idx",1]],["==","idx",2]]}' \
    --no-tile-size-limit --simplification=2 \
    --attribution='Contains OS data © Crown copyright and database right' \
    -n "GB contours (OS Terrain 50)" "$work/contours.geojsonseq"
  pmtiles show "$OUT/contours.pmtiles" | head -20
}

sample() {
  local dest=${DEST:-tools/testdata}; mkdir -p "$dest"
  pmtiles extract "$OUT/gb.pmtiles" "$dest/sample-gb.pmtiles" --bbox="$SAMPLE_BBOX"
  if [ -f "$OUT/contours.pmtiles" ]; then
    pmtiles extract "$OUT/contours.pmtiles" "$dest/sample-contours.pmtiles" --bbox="$SAMPLE_BBOX"
  fi
  if [ -f "$OUT/places.tsv" ]; then
    python3 - "$OUT/places.tsv" "$dest/sample-places.tsv" "$SAMPLE_BBOX" <<'EOF'
import sys
src, dst, bbox = sys.argv[1], sys.argv[2], [float(x) for x in sys.argv[3].split(",")]
with open(src, encoding="utf-8") as f, open(dst, "w", encoding="utf-8") as o:
    for i, line in enumerate(f):
        p = line.rstrip("\n").split("\t")
        if i == 0 or (bbox[0] - 0.3 <= float(p[3]) <= bbox[2] + 0.3 and bbox[1] - 0.2 <= float(p[2]) <= bbox[3] + 0.2):
            o.write(line)
EOF
  fi
  ls -l "$dest"
}

for step in "$@"; do "$step"; done
