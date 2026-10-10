# Survival Guide (UK), an offline field guide for a dedicated Android phone

A fully offline survival guide app for a debloated Samsung Galaxy A21s (Android 12) with **no SIM, no accounts, no
Google Play services**, kept in airplane mode and switched off between uses.

- **209 articles** in six groups, from what to do in the first minutes to living off-grid for months:
  Stay alive · Situations · When help isn't coming · Skills · Nature · Reference.
- **4 step-by-step decision flows:** someone is injured, I'm lost, I need water now, it's getting dark and cold.
- **268 UK species** (plants, fungi, animals and a psychoactive section), with 700+ Wikimedia Commons photos,
  "don't confuse with" lookalikes and what's in season now.
- **Phone-powered tools:**
  - navigation: compass, GPS grid reference and waypoints, offline map of Great Britain, sun and moon,
    clinometer, pace counter
  - signalling: SOS and mountain distress beacons by torch, screen and sound; Morse
  - medical: CPR metronome, casualty log, boil timer
  - calculators and a field notebook
- **Phone mode:** switch between survival mode (the guide is the pinned home screen) and a normal phone, with no PC.

The app never uses the network: no INTERNET permission, `blockNetworkLoads`, no Google libraries, no CDNs or
analytics. Everything except the map data ships inside the APK; the map data is copied to the phone once
(see [docs/MAP.md](docs/MAP.md)).

**The phone has no SIM card and cannot call or text anyone**, so the app has no call or SMS features. The guide
covers signalling, being found, self-rescue, and what to tell 999 once you reach a phone or a person.

## Install or update (Windows)

### Updating an installed copy

A device-owner app can only be replaced by an APK signed with the **same key** and a higher `versionCode`
(v1.2.0 is versionCode 3). Every build from this repo uses `keystore/release.jks`:

```
C:\adb\adb.exe install -r app-release.apk
```

If that fails, push it and install from the phone's shell:

```
C:\adb\adb.exe push app-release.apk /data/local/tmp/
C:\adb\adb.exe shell pm install -r /data/local/tmp/app-release.apk
```

Device owner, settings and saved pages survive the update. On first start, v1.2 moves your saved pages, settings and
checklists across to its new storage once, and, as device owner with no mode chosen yet, switches on **survival mode**
so nothing changes for you.

### First install on a fresh phone

```
C:\adb\adb.exe install -r app-release.apk
C:\adb\adb.exe shell dpm set-device-owner uk.theseus.survival/.KioskAdminReceiver
```

`set-device-owner` only works while the phone has **no accounts**. Then copy the map files (below).

### Map data

Download `gb.pmtiles`, `contours.pmtiles` and `places.tsv` from the latest **Map data** release (GitHub → Releases)
and push them:

```
C:\adb\adb.exe push gb.pmtiles /sdcard/Android/media/uk.theseus.survival/maps/gb.pmtiles
C:\adb\adb.exe push contours.pmtiles /sdcard/Android/media/uk.theseus.survival/maps/contours.pmtiles
C:\adb\adb.exe push places.tsv /sdcard/Android/media/uk.theseus.survival/maps/places.tsv
```

Sizes, checksums and how to rebuild the data: [docs/MAP.md](docs/MAP.md).

## Phone mode (Settings → Phone mode, or long-press the title for 5 seconds)

| | Survival mode | Normal phone |
|---|---|---|
| Home button | The guide (persistent preferred HOME activity, set as device owner, so it wins even with Samsung's launcher enabled) | Samsung's launcher (set as the preferred HOME, so there's no "choose an app" prompt) |
| Pinned | Yes (`startLockTask`; FM radio, camera, calculator, clock and settings still open from Tools) | No |
| Device owner | Kept | Kept, so switching back is one tap |

The choice is saved and applied again at every start and at boot (`BootReceiver`). Normal mode is refused if there is
no other home app, so the phone can never end up without one. The screen also has:

- **Restore all phone apps:** re-installs every system app removed with `pm uninstall --user 0`
  (`DevicePolicyManager.enableSystemApp`), with progress.
- **Remove owner permission (advanced):** two confirmations; afterwards survival mode needs a PC again
  (`adb shell dpm set-device-owner uk.theseus.survival/.KioskAdminReceiver`).
- **Unpin until restart** (hidden menu only).

## Repository layout

```
app/src/main/java/uk/theseus/survival/
  MainActivity.kt   WebView host; WebViewAssetLoader (https://appassets.androidplatform.net); lifecycle
  WebBridge.kt      window.Android: state, brightness, sensors, GPS, signals, speech, map status, phone mode
  PhoneMode.kt      survival/normal modes, HOME preference, lock task, restore apps, remove owner
  SensorHub.kt      compass (rotation vector, falls back to accel + magnetometer), level, step counter
  GpsHub.kt         LocationManager GPS_PROVIDER, satellites, location switch as device owner, timeouts
  Signals.kt        torch and sound patterns (SOS, 6 a minute, Morse, CPR metronome)
  Speech.kt         read aloud with any installed offline TTS voice
  MapFiles.kt       serves /maps/* from the phone's media folder with HTTP range requests
  BootReceiver.kt, Tools.kt, Torch.kt, Prefs.kt, KioskAdminReceiver.kt
app/src/main/assets/
  index.html, app.css, app.js   the UI shell, guide screens and router
  tools.js, map.js, geo.js      tool screens, the map, offline maths (OS grid, WMM2025, sun and moon)
  lib/                          MapLibre GL JS 5, PMTiles 4 (bundled)
  map/glyphs/                   Noto Sans label glyphs (Latin ranges)
  icons.js, fonts.css           GENERATED by tools/build_ui_assets.py
  content/                      GENERATED by tools/build_content.py (index, bodies, flows, search, credits)
  img/, img/t/                  photos and thumbnails, from tools/fetch_images.py
content/
  structure.json    the whole hierarchy: group > category > topic > article, urgent tiles, flows, quick cards
  articles/*.md     articles (any file; where they appear is set by structure.json)
  flows/*.md        decision flows
  species/*.md      species
  kit.json          kit items for "You'll need"
  synonyms.txt      search synonyms
docs/CONTENT.md     how to write articles, flows and species (rules the build enforces)
docs/MAP.md         the offline map data
tools/              build_content.py, build_ui_assets.py, fetch_images.py, check_links.py,
                    serve_test.mjs, ui_smoke_test.mjs, map/ (map data pipeline)
third_party/        licences and sources of bundled icons, fonts and libraries
keystore/           release key + password (personal app; see keystore/README)
.github/workflows/  build.yml (APK), map.yml (map data release)
```

## Building

Requirements: JDK 17, Android SDK 34, Python 3.9+.

```
python3 tools/build_ui_assets.py      # icons.js + fonts.css (already committed)
python3 tools/build_content.py        # app/src/main/assets/content (already committed)
python3 tools/check_links.py --min 120
./gradlew assembleRelease testDebugUnitTest
```

GitHub Actions builds, tests and signs the APK on every push. It also checks that no Google Play services or Firebase
library is in the dependency tree. A commit message containing `[apk]` also commits the APK to `dist/app-release.apk`;
`[refresh-images]` re-resolves all photos, and `[map]` rebuilds the map data.

Desktop check of the UI: `node tools/serve_test.mjs` and open http://127.0.0.1:8137/, or run the full test
(Playwright + Chromium):

```
node tools/ui_smoke_test.mjs [screenshot-dir]
```

It visits every group, category, article, species, flow node and tool at 360×800 in all three themes. It fails on:
- JavaScript errors, or network requests beyond the test server
- missing icons, horizontal overflow, or tap targets under 48 px
- call or SMS links
- searches that miss, a map that doesn't render or search

It also checks the OS grid, WMM and sun maths.

## Writing content

See [docs/CONTENT.md](docs/CONTENT.md). In short: every article starts with 2–4 quick steps, ends with sources, has
an icon and lives in exactly one topic in `content/structure.json`. It may list a time, difficulty and "You'll
need" kit, and never tells the reader to call or text from this phone. Psychoactive species are covered for
identification, safety, the law and first aid only. The build fails on broken rules or links.

## Photos (Wikimedia Commons)

`tools/fetch_images.py` (run by CI) takes each entry's Wikipedia lead image, more photos from the same article
whose file names contain the exact binomial or common name, and tops species up to three photos from their own
Commons category. Only public domain, CC0, CC BY and CC BY-SA files are used. Photos are resized to ≤1000 px WebP
with metadata stripped, and credited in `content/images.json` and the in-app Credits page. Every photo is
reviewed by eye. Rejected files go in `content/image_exclude.txt` (drawings, maps, micrographs, wrong species…).

## Battery design

- Nothing runs in the background: no services, no wakelocks, no alarms. The phone's own screen timeout applies.
- Sensors and GPS run only while their tool is on screen:
  - registered on demand, at `SENSOR_DELAY_UI` at most
  - unregistered in `onPause` (a Robolectric test checks every listener is gone)
  - restarted on resume only if still wanted
  - stopped after a timeout: compass 10 min, GPS fix 3 min, follow 30 min
  - a header chip shows while any is active
- GPS uses `GPS_PROVIDER` only. As device owner the app switches the location setting on just for the fix and off
  afterwards.
- Signals keep the screen on, dimmed, only while running, and stop after the time you choose (2 h maximum). Each
  shows its expected battery cost.
- The map redraws only when something changes, is capped at 30 frames a second, prefetches nothing beyond the
  view, and is removed when you leave it. It costs roughly 2–3× the drain of reading a guide, which the Battery
  page says.
- The web UI has no animations. Timers exist only on tool screens that need them (metronome, boil timer) and stop
  when you leave.
- Dark theme by default, a high-contrast daylight theme, and a red-on-black night theme. An in-app brightness
  slider goes below the system minimum.

## Content sources and licences

Articles were written for this app from public UK guidance (NHS, St John Ambulance, British Red Cross,
Resuscitation Council UK, RNLI, Mountain Rescue, Met Office, UKHSA, Environment Agency, gov.uk, Ordnance Survey,
British Mycological Society, legislation.gov.uk and others); each lists its sources.

Bundled third-party material:
- Lucide icons (ISC)
- Atkinson Hyperlegible (OFL)
- MapLibre GL JS (BSD-3)
- PMTiles (BSD-3)
- Noto Sans glyphs (OFL)
- WMM2025 coefficients (public domain)
- map data © OpenStreetMap contributors (ODbL)
- contours containing OS data © Crown copyright (OGL v3)

The content is information, not training: see the in-app About page.
