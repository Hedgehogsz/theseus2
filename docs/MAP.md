# Offline map data

The app's map (Tools → Map) draws Great Britain from three files that live on the phone, not in the APK:

| File | What | Size (build 2026-10-09) |
|---|---|---|
| `gb.pmtiles` | OpenStreetMap vector tiles for GB (bbox −8.7, 49.8 to 1.9, 60.9: Scilly to Shetland), zoom 0–14, Protomaps basemap schema: roads, footpaths, tracks, bridleways, rivers, streams, lakes, woods, buildings, place names, peaks | 1.49 GB |
| `contours.pmtiles` | 10 m contours (50 m and 100 m index lines) derived from OS Terrain 50 | 95 MB |
| `places.tsv` | Named places, peaks, hills, lakes, huts, waterfalls, springs, woods… for offline place search | 7.7 MB |

Only `gb.pmtiles` is essential. Without `contours.pmtiles` there are no contour lines; without `places.tsv`
the search box only finds names already drawn on screen.

## Install on the phone (Windows)

1. Download the three files (and `SHA256SUMS.txt` if you want to check them) from the latest **Map data**
   release of this repository: GitHub → Releases → `map-YYYYMMDD-rN`.
2. Put them next to `adb.exe`, connect the phone with USB debugging on, and run:

```
C:\adb\adb.exe push gb.pmtiles /sdcard/Android/media/uk.theseus.survival/maps/gb.pmtiles
C:\adb\adb.exe push contours.pmtiles /sdcard/Android/media/uk.theseus.survival/maps/contours.pmtiles
C:\adb\adb.exe push places.tsv /sdcard/Android/media/uk.theseus.survival/maps/places.tsv
```

`adb push` creates the folders. Copying 1.6 GB over USB 2 takes a few minutes. Then open the map.

Optional check, in PowerShell: `Get-FileHash gb.pmtiles` and compare with `SHA256SUMS.txt`.

The folder is the app's own "media" directory, which needs no storage permission. If the app is ever
uninstalled, Android deletes this folder too.

## How the app reads it

`MapFiles.kt` serves the files to the WebView at `https://appassets.androidplatform.net/maps/<name>` with HTTP
range requests (PMTiles reads small byte ranges of the big file, never the whole thing). MapLibre GL JS, the PMTiles
reader, the map style, glyphs (label fonts) and everything else are bundled in the APK, so the map makes no network
requests. The style is written for the dark, daylight and night-red themes in `app/src/main/assets/map.js`.

## Rebuilding or updating the map

The data is built by GitHub Actions (`.github/workflows/map.yml`, which runs `tools/map/build_map.sh`):

- **From GitHub:** Actions → *Build offline map data* → *Run workflow*, or push a commit whose message contains
  `[map]`. It takes about 20 minutes and publishes a new `map-…` release with checksums.
- **On a Linux machine:** install `pmtiles` (go-pmtiles), `osmium-tool`, `gdal-bin` and `tippecanoe` (≥ 2.17), then
  `OUT=mapdata tools/map/build_map.sh basemap places contours`.

What it does:

1. **Base map:** `pmtiles extract` of the newest daily Protomaps planet build (build.protomaps.com) for the GB bbox.
   It asks for zoom 15 and drops to zoom 14 if the file would exceed GitHub's 2 GiB release limit (it does:
   z0–14 is 1.49 GB). The map overzooms z14 tiles smoothly to street level.
2. **Places:** the Geofabrik Great Britain OSM extract, filtered with `osmium tags-filter` to named places, peaks,
   hills, springs, waterfalls, huts, shelters, lakes, reservoirs and woods, then reduced by `tools/map/places.py`.
3. **Contours:** OS Terrain 50 (50 m height grid, Open Government Licence) → `gdal_contour` at 10 m →
   `tippecanoe` (100 m lines from z10, 50 m from z11, all from z12).
4. **Samples:** small Keswick extracts of all three are committed to `tools/testdata/` for the desktop UI tests.

The tiles are a snapshot: rebuild every year or two if paths or buildings matter to you.

## Licences and attribution

- Map data © OpenStreetMap contributors, Open Database Licence (ODbL), openstreetmap.org/copyright.
  Tiles from the Protomaps basemap (protomaps.com).
- Contours contain OS data © Crown copyright and database right, Open Government Licence v3.0.
- The app shows the attribution in the corner of the map and on the Credits page.
