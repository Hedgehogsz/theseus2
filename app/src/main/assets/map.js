/* Offline map of Great Britain: MapLibre GL JS + PMTiles, all bundled; data read from the phone's storage.
 *
 *   maps/gb.pmtiles        OpenStreetMap vector tiles (Protomaps basemap schema), z0-14
 *   maps/contours.pmtiles  10 m contours from OS Terrain 50 (optional)
 *   maps/places.tsv        place-name index for offline search (optional)
 *
 * Battery: MapLibre only redraws when something changes; frames are capped at 30 a second while the map is open;
 * no tiles are prefetched beyond the view; GPS and the compass run only on request and stop with the screen.
 */
(function () {
  "use strict";
  var A = window.App, T = A.tools, G = window.Geo, icon = A.icon, esc = A.esc;
  // icons: crosshair locate-fixed navigation flag ruler grid-3x3 search x compass undo-2 trash-2 map-pinned
  var GB = { center: [-3.4, 54.6], zoom: 5.2 };
  var BOUNDS = [[-11.5, 48.8], [4.5, 61.6]];
  var map = null, rafRestore = null;

  // ------------------------------------------------------------------ style
  var PALETTE = {
    dark: { bg: "#1b1a17", land: "#1b1a17", water: "#1d3245", waterLine: "#5a95c8", wood: "#1f2a1b", grass: "#1f251c", farm: "#1d1d19", urban: "#24221f",
      building: "#2f2c28", contour: "#6d5b43", contourIdx: "#8c7553", major: "#e6dccb", majorCase: "#1b1a17", minor: "#8f877c", path: "#ffa04a", track: "#d39a55",
      rail: "#8a8178", text: "#efe9df", halo: "#121110", peak: "#f1c27a", waterText: "#86b8e3", poi: "#c9bfb1", place: "#ffffff" },
    light: { bg: "#f3efe6", land: "#f3efe6", water: "#a8cde6", waterLine: "#2f78b8", wood: "#cadfb7", grass: "#e0ebcf", farm: "#efebdf", urban: "#e8e2d8",
      building: "#d3cbbf", contour: "#c19a6b", contourIdx: "#9a7344", major: "#ffffff", majorCase: "#a89e90", minor: "#ffffff", path: "#c0392b", track: "#8a5a2b",
      rail: "#6b6259", text: "#1d1a15", halo: "#ffffff", peak: "#5a3d12", waterText: "#1f5c94", poi: "#4a433a", place: "#111111" },
    red: { bg: "#000000", land: "#000000", water: "#1e0303", waterLine: "#a3221a", wood: "#110202", grass: "#0c0101", farm: "#070000", urban: "#120202",
      building: "#1c0404", contour: "#4d0d0a", contourIdx: "#6e130e", major: "#c42a1f", majorCase: "#000000", minor: "#7e1a14", path: "#ff4a36", track: "#d63a2a",
      rail: "#6e130e", text: "#ff5a46", halo: "#000000", peak: "#ff7a5c", waterText: "#d8392c", poi: "#b8291e", place: "#ff6a50" }
  };
  var REG = ["Noto Sans Regular"], MED = ["Noto Sans Medium"], ITA = ["Noto Sans Italic"];
  var NAME = ["coalesce", ["get", "name:en"], ["get", "name"]];

  function style(theme, hasContours) {
    var c = PALETTE[theme] || PALETTE.dark;
    var base = location.origin + location.pathname.replace(/[^/]*$/, "");
    var sources = {
      osm: { type: "vector", url: "pmtiles://" + base + "maps/gb.pmtiles",
        attribution: "© OpenStreetMap contributors (ODbL)" }
    };
    if (hasContours) sources.contours = { type: "vector", url: "pmtiles://" + base + "maps/contours.pmtiles", attribution: "Contours: OS Terrain 50, © Crown copyright (OGL)" };
    var L = [];
    L.push({ id: "bg", type: "background", paint: { "background-color": c.water } });
    L.push({ id: "earth", type: "fill", source: "osm", "source-layer": "earth", paint: { "fill-color": c.land } });
    L.push({ id: "landcover", type: "fill", source: "osm", "source-layer": "landcover", maxzoom: 8,
      paint: { "fill-color": ["match", ["get", "kind"], ["forest", "wood"], c.wood, ["grassland", "scrub"], c.grass, c.land] } });
    L.push({ id: "landuse", type: "fill", source: "osm", "source-layer": "landuse", minzoom: 8,
      paint: { "fill-color": ["match", ["get", "kind"],
        ["wood", "forest"], c.wood,
        ["grass", "meadow", "park", "village_green", "recreation_ground", "golf_course", "garden", "grassland", "scrub", "heath", "nature_reserve"], c.grass,
        ["farmland", "farmyard", "orchard", "allotments"], c.farm,
        ["residential", "commercial", "industrial", "retail", "school", "hospital", "railway", "military"], c.urban, c.land] } });
    L.push({ id: "water", type: "fill", source: "osm", "source-layer": "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.water } });
    if (hasContours) {
      L.push({ id: "contour", type: "line", source: "contours", "source-layer": "contour", minzoom: 10,
        paint: { "line-color": ["case", [">=", ["get", "idx"], 1], c.contourIdx, c.contour],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["case", [">=", ["get", "idx"], 1], 0.6, 0.3], 15, ["case", [">=", ["get", "idx"], 1], 1.3, 0.7]],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 13, 1] } });
    }
    L.push({ id: "streams", type: "line", source: "osm", "source-layer": "water", minzoom: 10,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "kind"], "river"]],
      paint: { "line-color": c.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 15, 1.6] } });
    L.push({ id: "rivers", type: "line", source: "osm", "source-layer": "water", minzoom: 7,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "kind"], "river"]],
      paint: { "line-color": c.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 15, 3] } });
    L.push({ id: "buildings", type: "fill", source: "osm", "source-layer": "buildings", minzoom: 13, paint: { "fill-color": c.building } });
    L.push({ id: "rail", type: "line", source: "osm", "source-layer": "roads", minzoom: 9, filter: ["==", ["get", "kind"], "rail"],
      paint: { "line-color": c.rail, "line-width": 1.2, "line-dasharray": [3, 2] } });
    // Footpaths, bridleways and tracks are what matter on foot: strong colour, dashed, drawn early (z12).
    L.push({ id: "tracks", type: "line", source: "osm", "source-layer": "roads", minzoom: 11,
      filter: ["all", ["==", ["get", "kind"], "path"], ["==", ["get", "kind_detail"], "track"]],
      paint: { "line-color": c.track, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 2.6], "line-dasharray": [4, 2] } });
    L.push({ id: "paths", type: "line", source: "osm", "source-layer": "roads", minzoom: 12,
      filter: ["all", ["==", ["get", "kind"], "path"], ["match", ["get", "kind_detail"], ["track", "sidewalk", "crossing", "corridor"], false, true]],
      paint: { "line-color": c.path, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 2.4], "line-dasharray": [2, 1.6] } });
    L.push({ id: "minor-case", type: "line", source: "osm", "source-layer": "roads", minzoom: 11, filter: ["in", ["get", "kind"], ["literal", ["minor_road", "other"]]],
      paint: { "line-color": c.majorCase, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 7] } });
    L.push({ id: "minor", type: "line", source: "osm", "source-layer": "roads", minzoom: 11, filter: ["in", ["get", "kind"], ["literal", ["minor_road", "other"]]],
      paint: { "line-color": c.minor, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 5] } });
    L.push({ id: "major-case", type: "line", source: "osm", "source-layer": "roads", minzoom: 6, filter: ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]],
      paint: { "line-color": c.majorCase, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 16, 10] } });
    L.push({ id: "major", type: "line", source: "osm", "source-layer": "roads", minzoom: 6, filter: ["in", ["get", "kind"], ["literal", ["major_road", "highway"]]],
      paint: { "line-color": c.major, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 16, 7] } });
    L.push({ id: "boundary", type: "line", source: "osm", "source-layer": "boundaries", filter: ["<=", ["get", "kind_detail"], 2],
      paint: { "line-color": c.contour, "line-width": 1, "line-dasharray": [3, 2] } });
    // Labels
    L.push({ id: "water-label", type: "symbol", source: "osm", "source-layer": "water", minzoom: 11,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["has", "name"]],
      layout: { "text-field": NAME, "text-font": ITA, "text-size": 12, "text-max-width": 8 },
      paint: { "text-color": c.waterText, "text-halo-color": c.halo, "text-halo-width": 1.2 } });
    L.push({ id: "river-label", type: "symbol", source: "osm", "source-layer": "water", minzoom: 13,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "name"]],
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ITA, "text-size": 11 },
      paint: { "text-color": c.waterText, "text-halo-color": c.halo, "text-halo-width": 1.2 } });
    if (hasContours) {
      L.push({ id: "contour-label", type: "symbol", source: "contours", "source-layer": "contour", minzoom: 13, filter: [">=", ["get", "idx"], 1],
        layout: { "symbol-placement": "line", "text-field": ["to-string", ["get", "ele"]], "text-font": REG, "text-size": 10 },
        paint: { "text-color": c.contourIdx, "text-halo-color": c.halo, "text-halo-width": 1.2 } });
    }
    L.push({ id: "road-label", type: "symbol", source: "osm", "source-layer": "roads", minzoom: 14, filter: ["has", "name"],
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": REG, "text-size": 11 },
      paint: { "text-color": c.poi, "text-halo-color": c.halo, "text-halo-width": 1.2 } });
    L.push({ id: "peak-dot", type: "circle", source: "osm", "source-layer": "pois", minzoom: 10, filter: ["==", ["get", "kind"], "peak"],
      paint: { "circle-radius": 3, "circle-color": c.peak, "circle-stroke-color": c.halo, "circle-stroke-width": 1 } });
    L.push({ id: "peak-label", type: "symbol", source: "osm", "source-layer": "pois", minzoom: 10, filter: ["==", ["get", "kind"], "peak"],
      layout: { "text-field": ["format", NAME, {}, ["case", ["has", "elevation"], ["concat", "\n", ["to-string", ["round", ["get", "elevation"]]], " m"], ""], { "font-scale": 0.85 }],
        "text-font": MED, "text-size": 11.5, "text-anchor": "top", "text-offset": [0, 0.5], "text-max-width": 8 },
      paint: { "text-color": c.peak, "text-halo-color": c.halo, "text-halo-width": 1.3 } });
    var POI = ["alpine_hut", "wilderness_hut", "shelter", "drinking_water", "water_point", "spring", "toilets", "hospital", "pub", "camp_site", "parking", "pharmacy", "police", "fire_station", "information"];
    L.push({ id: "poi-dot", type: "circle", source: "osm", "source-layer": "pois", minzoom: 14, filter: ["in", ["get", "kind"], ["literal", POI]],
      paint: { "circle-radius": 3, "circle-color": c.poi, "circle-stroke-color": c.halo, "circle-stroke-width": 1 } });
    L.push({ id: "poi-label", type: "symbol", source: "osm", "source-layer": "pois", minzoom: 14, filter: ["all", ["in", ["get", "kind"], ["literal", POI]], ["has", "name"]],
      layout: { "text-field": NAME, "text-font": REG, "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.5], "text-max-width": 8, "text-optional": true },
      paint: { "text-color": c.poi, "text-halo-color": c.halo, "text-halo-width": 1.2 } });
    L.push({ id: "places", type: "symbol", source: "osm", "source-layer": "places",
      filter: ["in", ["get", "kind"], ["literal", ["locality", "neighbourhood", "region", "country"]]],
      layout: { "text-field": NAME, "text-font": MED, "text-max-width": 8,
        "text-size": ["match", ["get", "kind_detail"], "city", 16, "town", 14, "village", 12.5, "hamlet", 11.5, ["suburb", "neighbourhood", "quarter"], 11, 12] },
      paint: { "text-color": c.place, "text-halo-color": c.halo, "text-halo-width": 1.5 } });
    return { version: 8, glyphs: "glyphs://{fontstack}/{range}", sources: sources, layers: L };
  }

  // ------------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function circle(lat, lon, radiusM, n) {
    var pts = [], k = radiusM / 111320;
    for (var i = 0; i <= n; i++) {
      var a = i / n * 2 * Math.PI;
      pts.push([lon + k * Math.sin(a) / Math.cos(lat * Math.PI / 180), lat + k * Math.cos(a)]);
    }
    return pts;
  }
  function cone(lat, lon, headingTrue, lengthM) {
    var pts = [[lon, lat]], k = lengthM / 111320;
    for (var a = -25; a <= 25; a += 5) {
      var b = (headingTrue + a) * Math.PI / 180;
      pts.push([lon + k * Math.sin(b) / Math.cos(lat * Math.PI / 180), lat + k * Math.cos(b)]);
    }
    pts.push([lon, lat]);
    return pts;
  }
  function fc(features) { return { type: "FeatureCollection", features: features }; }
  function gridLabel(lat, lon, digits) { var g = G.toOSGB(lat, lon); return g ? G.gridRef(g, digits || 8) : "outside the GB grid"; }

  /** OS grid lines for the current view: 100 km, 10 km or 1 km depending on zoom. */
  function gridLines(b, z) {
    var step = z < 8 ? 100000 : z < 11.5 ? 10000 : 1000;
    var corners = [[b.getSouth(), b.getWest()], [b.getSouth(), b.getEast()], [b.getNorth(), b.getWest()], [b.getNorth(), b.getEast()]]
      .map(function (c) { return G.toOSGB(Math.max(49.8, Math.min(60.9, c[0])), Math.max(-8.6, Math.min(1.9, c[1]))); }).filter(Boolean);
    if (!corners.length) return fc([]);
    var e0 = Math.max(0, Math.floor(Math.min.apply(null, corners.map(function (g) { return g.e; })) / step) * step);
    var e1 = Math.min(700000, Math.ceil(Math.max.apply(null, corners.map(function (g) { return g.e; })) / step) * step);
    var n0 = Math.max(0, Math.floor(Math.min.apply(null, corners.map(function (g) { return g.n; })) / step) * step);
    var n1 = Math.min(1300000, Math.ceil(Math.max.apply(null, corners.map(function (g) { return g.n; })) / step) * step);
    if ((e1 - e0) / step > 80 || (n1 - n0) / step > 80) return fc([]);
    var out = [], samples = 8, e, n, i, line, p;
    for (e = e0; e <= e1; e += step) {
      line = [];
      for (i = 0; i <= samples; i++) { p = G.fromOSGB(e, n0 + (n1 - n0) * i / samples); line.push([p.lon, p.lat]); }
      out.push({ type: "Feature", properties: { major: e % (step * 10) === 0 ? 1 : 0 }, geometry: { type: "LineString", coordinates: line } });
    }
    for (n = n0; n <= n1; n += step) {
      line = [];
      for (i = 0; i <= samples; i++) { p = G.fromOSGB(e0 + (e1 - e0) * i / samples, n); line.push([p.lon, p.lat]); }
      out.push({ type: "Feature", properties: { major: n % (step * 10) === 0 ? 1 : 0 }, geometry: { type: "LineString", coordinates: line } });
    }
    return fc(out);
  }

  // Cap the frame rate while the map is open (MapLibre only draws when something changes anyway).
  function capFrames(fps) {
    var orig = window.requestAnimationFrame, origCancel = window.cancelAnimationFrame;
    var min = 1000 / fps - 1, last = 0, seq = 0, real = {};
    window.requestAnimationFrame = function (cb) {
      var id = ++seq;
      function run(t) {
        if (t - last < min) { real[id] = orig.call(window, run); return; }
        delete real[id];
        last = t;
        cb(t);
      }
      real[id] = orig.call(window, run);
      return id;
    };
    window.cancelAnimationFrame = function (id) { if (real[id] != null) { origCancel.call(window, real[id]); delete real[id]; } };
    return function () { window.requestAnimationFrame = orig; window.cancelAnimationFrame = origCancel; };
  }

  // ------------------------------------------------------------------ data files
  function mapFiles() {
    var st = A.nativeJson("mapStatus");
    if (st) return Promise.resolve(st);
    // In a desktop browser (development): ask the test server.
    var names = ["gb.pmtiles", "contours.pmtiles", "places.tsv"];
    return Promise.all(names.map(function (n) {
      return fetch("maps/" + n, { headers: { Range: "bytes=0-0" } }).then(function (r) { return r.ok ? { size: 1 } : null; }, function () { return null; });
    })).then(function (res) {
      var files = {};
      names.forEach(function (n, i) { files[n] = res[i]; });
      return { files: files, sdcardDir: "/sdcard/Android/media/uk.theseus.survival/maps" };
    });
  }
  function notInstalled(st) {
    A.setChrome("Map", { tab: "tools" });
    var dir = st.sdcardDir || "/sdcard/Android/media/uk.theseus.survival/maps";
    var h = '<h1 class="page">Map data not installed</h1>';
    h += '<p class="lead">The map needs its data files copied to this phone once. They are too big to include in the app (about 1.6 GB in total).</p>';
    h += '<div class="status-grid">' + ["gb.pmtiles", "contours.pmtiles", "places.tsv"].map(function (n) {
      var f = st.files && st.files[n];
      return "<span>" + n + "</span><b>" + (f ? (f.size > 1 ? (f.size / 1e6).toFixed(0) + " MB" : "found") : "missing") + "</b>";
    }).join("") + "</div>";
    h += '<div class="body"><h2>How to install</h2><ol><li>On your PC, download the three files from the latest <b>Map data</b> release of this app\'s GitHub repository (Releases).</li>' +
      "<li>Connect the phone with USB debugging on, put the files next to <code>adb.exe</code>, and run:</li></ol>" +
      '<pre class="cmd">C:\\adb\\adb.exe push gb.pmtiles ' + dir + "/gb.pmtiles\nC:\\adb\\adb.exe push contours.pmtiles " + dir + "/contours.pmtiles\nC:\\adb\\adb.exe push places.tsv " + dir + "/places.tsv</pre>" +
      "<p>Then open the map again. Only <code>gb.pmtiles</code> is essential; the others add contours and place search.</p></div>";
    A.view.innerHTML = h;
  }

  // ------------------------------------------------------------------ place search (offline)
  var PLACES = null;
  var KIND_LABEL = { city: "City", town: "Town", village: "Village", hamlet: "Hamlet", suburb: "Suburb", locality: "Locality", isolated_dwelling: "House",
    farm: "Farm", island: "Island", islet: "Islet", peak: "Peak", hill: "Hill", lake: "Lake", reservoir: "Reservoir", hut: "Hut", shelter: "Shelter",
    waterfall: "Waterfall", spring: "Spring", wood: "Wood", saddle: "Pass", cave: "Cave", neighbourhood: "Area" };
  function loadPlaces() {
    if (PLACES) return Promise.resolve(PLACES);
    return fetch("maps/places.tsv").then(function (r) { if (!r.ok) throw new Error("no index"); return r.text(); }).then(function (t) {
      var lines = t.split("\n"), out = [];
      for (var i = 1; i < lines.length; i++) {
        var p = lines[i].split("\t");
        if (p.length >= 4) out.push({ name: p[0], key: norm(p[0]), kind: p[1], lat: +p[2], lon: +p[3], ele: p[4] });
      }
      PLACES = out;
      return out;
    });
  }
  function norm(s) { s = s.toLowerCase(); if (s.normalize) s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); return s.replace(/[^a-z0-9 ]/g, ""); }
  function searchPlaces(q, list) {
    var k = norm(q).trim();
    if (k.length < 2) return [];
    var a = [], b = [], c = [];
    for (var i = 0; i < list.length && a.length < 30; i++) {
      var p = list[i];
      if (p.key === k) a.push(p);
      else if (p.key.indexOf(k) === 0) { if (b.length < 30) b.push(p); }
      else if (c.length < 30 && p.key.indexOf(" " + k) >= 0) c.push(p);
    }
    return a.concat(b, c).slice(0, 25);
  }

  // ------------------------------------------------------------------ the map screen
  function open(q, tab, token) {
    return mapFiles().then(function (st) {
      if (!A.isCurrent(token)) return;
      if (!st.files || !st.files["gb.pmtiles"]) return notInstalled(st);
      var hasContours = !!st.files["contours.pmtiles"];
      A.setChrome("Map", { tab: tab });
      var h = '<div class="map-wrap"><div id="map"></div>' +
        '<div class="map-top"><label class="map-search">' + icon("search") + '<input id="msq" type="search" placeholder="Search places" autocomplete="off" aria-label="Search places"></label>' +
        '<span class="map-centre" id="mcentre"></span></div><div class="map-results" id="mres" hidden></div>' +
        '<div class="map-north" aria-label="North is up"><b>N</b>' + icon("navigation", "ic-sm") + "</div>" +
        '<div class="map-btns">' +
        '<button class="mbtn" id="mloc" aria-label="Locate me">' + icon("locate-fixed") + "</button>" +
        '<button class="mbtn" id="mfol" aria-label="Follow me" aria-pressed="false">' + icon("navigation") + "</button>" +
        '<button class="mbtn" id="mhdg" aria-label="Heading from compass" aria-pressed="false">' + icon("compass") + "</button>" +
        '<button class="mbtn" id="mgrid" aria-label="OS grid lines" aria-pressed="false">' + icon("grid-3x3") + "</button>" +
        '<button class="mbtn" id="mmeas" aria-label="Measure distance" aria-pressed="false">' + icon("ruler") + "</button>" +
        '<button class="mbtn" id="mdrop" aria-label="Drop a waypoint" aria-pressed="false">' + icon("flag") + "</button></div>" +
        '<div class="map-sheet" id="msheet" hidden></div><div class="map-warn" id="mwarn" hidden></div>' +
        '<a class="map-attr" href="#/credits">© OpenStreetMap' + (hasContours ? " · OS Terrain 50" : "") + "</a></div>";
      A.view.innerHTML = h;

      var protocol = new pmtiles.Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      // Glyphs come from the APK; ranges we don't bundle (other scripts) resolve to an empty set rather than an error.
      maplibregl.addProtocol("glyphs", function (params) {
        var m = params.url.match(/^glyphs:\/\/(.+)\/(\d+-\d+)$/);
        var url = m ? "map/glyphs/" + m[1] + "/" + m[2] + ".pbf" : "";
        return fetch(url).then(function (r) { return r.ok ? r.arrayBuffer() : new ArrayBuffer(0); }, function () { return new ArrayBuffer(0); })
          .then(function (buf) { return { data: buf }; });
      });
      rafRestore = capFrames(30);

      var f = T.lastFix(), wpFocus = q.wp ? T.waypoints().filter(function (w) { return w.id === q.wp; })[0] : null;
      var start = wpFocus ? { center: [wpFocus.lon, wpFocus.lat], zoom: 14 } : f && (q.fix || Date.now() - f.time < 6 * 3600000) ? { center: [f.lon, f.lat], zoom: 14 } : A.load("mapView", GB);
      map = new maplibregl.Map({
        container: "map", style: style(A.settings.theme || "dark", hasContours), center: start.center, zoom: start.zoom,
        minZoom: 4.5, maxZoom: 17.5, maxBounds: BOUNDS, renderWorldCopies: false, fadeDuration: 0, prefetchZoomDelta: 0,
        maxTileCacheSize: 80, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), dragRotate: false, pitchWithRotate: false, maxPitch: 0,
        attributionControl: false, localIdeographFontFamily: "sans-serif"
      });
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 100 }), "bottom-left");

      var me = null, heading = null, d = T.decl(T.position()), mode = "", measure = [], target = null, gridOn = !!A.settings.mapGrid;
      function setSources() {
        var feats = [];
        if (me) {
          feats.push({ type: "Feature", properties: { k: "acc" }, geometry: { type: "Polygon", coordinates: [circle(me.lat, me.lon, Math.max(5, me.acc), 48)] } });
          if (heading != null) feats.push({ type: "Feature", properties: { k: "cone" }, geometry: { type: "Polygon", coordinates: [cone(me.lat, me.lon, heading + d, Math.max(60, me.acc * 2))] } });
          feats.push({ type: "Feature", properties: { k: "dot" }, geometry: { type: "Point", coordinates: [me.lon, me.lat] } });
        }
        map.getSource("me").setData(fc(feats));
        map.getSource("wps").setData(fc(T.waypoints().map(function (w) {
          return { type: "Feature", properties: { id: w.id, name: w.name }, geometry: { type: "Point", coordinates: [w.lon, w.lat] } };
        })));
        var lines = [];
        if (measure.length > 1) lines.push({ type: "Feature", properties: { k: "measure" }, geometry: { type: "LineString", coordinates: measure } });
        if (target && me) lines.push({ type: "Feature", properties: { k: "target" }, geometry: { type: "LineString", coordinates: [[me.lon, me.lat], target] } });
        map.getSource("lines").setData(fc(lines.concat(measure.map(function (p) { return { type: "Feature", properties: { k: "vertex" }, geometry: { type: "Point", coordinates: p } }; }))));
      }
      function setGrid() {
        if (!map.getSource("grid")) return;
        map.getSource("grid").setData(gridOn ? gridLines(map.getBounds(), map.getZoom()) : fc([]));
      }
      function centreChip() {
        var c = map.getCenter();
        $("mcentre").textContent = gridLabel(c.lat, c.lng, map.getZoom() >= 13 ? 8 : 6);
      }

      map.on("load", function () {
        var c = PALETTE[A.settings.theme || "dark"] || PALETTE.dark, accent = A.settings.theme === "red" ? "#ff3b2b" : A.settings.theme === "light" ? "#b5460a" : "#ff8a3d";
        var meCol = A.settings.theme === "red" ? "#ff2a1a" : "#3d8bff", meRing = A.settings.theme === "red" ? "#000000" : "#ffffff";
        map.addSource("grid", { type: "geojson", data: fc([]) });
        // OS-style blue grid lines (red in the night theme), thicker every 10 squares.
        var gridCol = A.settings.theme === "red" ? "#c41f12" : A.settings.theme === "light" ? "#1f5fbf" : "#5aa7ff";
        map.addLayer({ id: "grid", type: "line", source: "grid", paint: { "line-color": gridCol, "line-opacity": 0.85, "line-width": ["case", ["==", ["get", "major"], 1], 2, 1.2] } });
        map.addSource("lines", { type: "geojson", data: fc([]) });
        map.addLayer({ id: "lines", type: "line", source: "lines", filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": accent, "line-width": 3, "line-dasharray": ["case", ["==", ["get", "k"], "target"], ["literal", [2, 1]], ["literal", [1, 0]]] } });
        map.addLayer({ id: "vertices", type: "circle", source: "lines", filter: ["==", ["get", "k"], "vertex"], paint: { "circle-radius": 5, "circle-color": accent, "circle-stroke-color": c.halo, "circle-stroke-width": 2 } });
        map.addSource("wps", { type: "geojson", data: fc([]) });
        map.addLayer({ id: "wp-dot", type: "circle", source: "wps", paint: { "circle-radius": 7, "circle-color": accent, "circle-stroke-color": c.halo, "circle-stroke-width": 2 } });
        map.addLayer({ id: "wp-label", type: "symbol", source: "wps", layout: { "text-field": ["get", "name"], "text-font": MED, "text-size": 12, "text-anchor": "top", "text-offset": [0, 0.9] },
          paint: { "text-color": accent, "text-halo-color": c.halo, "text-halo-width": 1.5 } });
        map.addSource("me", { type: "geojson", data: fc([]) });
        map.addLayer({ id: "me-acc", type: "fill", source: "me", filter: ["==", ["get", "k"], "acc"], paint: { "fill-color": meCol, "fill-opacity": 0.15 } });
        map.addLayer({ id: "me-acc-line", type: "line", source: "me", filter: ["==", ["get", "k"], "acc"], paint: { "line-color": meCol, "line-width": 1, "line-opacity": 0.6 } });
        map.addLayer({ id: "me-cone", type: "fill", source: "me", filter: ["==", ["get", "k"], "cone"], paint: { "fill-color": meCol, "fill-opacity": 0.35 } });
        map.addLayer({ id: "me-dot", type: "circle", source: "me", filter: ["==", ["get", "k"], "dot"], paint: { "circle-radius": 7, "circle-color": meCol, "circle-stroke-color": meRing, "circle-stroke-width": 2.5 } });
        if (f) { me = f; }
        setSources(); setGrid(); centreChip();
        if (wpFocus) showWaypoint(wpFocus);
      });
      map.on("moveend", function () {
        var c = map.getCenter();
        A.save("mapView", { center: [c.lng, c.lat], zoom: map.getZoom() });
        setGrid(); centreChip();
      });

      // --- bottom sheet
      function sheet(html) {
        var s = $("msheet");
        if (!html) { s.hidden = true; s.innerHTML = ""; return; }
        s.innerHTML = '<button class="icon-btn sheet-x" id="mclose" aria-label="Close">' + icon("x") + "</button>" + html;
        s.hidden = false;
        $("mclose").onclick = function () { sheet(null); if (mode === "measure") setMode(""); target = null; setSources(); };
      }
      function relText(p) {
        if (!me) return "";
        var m = G.distance(me, p), b = G.bearing(me, p);
        return '<span class="rel">' + icon("navigation", "ic-sm") + T.dist(m) + " · " + T.deg3(b) + "° true, " + T.deg3(b - d) + "° magnetic · " + T.cardinal(b) + "</span>";
      }
      function showPoint(lat, lon) {
        var p = { lat: lat, lon: lon };
        sheet("<b>" + esc(gridLabel(lat, lon, 8)) + "</b><span>" + lat.toFixed(5) + ", " + lon.toFixed(5) + "</span>" + relText(p) +
          '<div class="btn-row"><button class="btn" id="mpsave">' + icon("flag", "ic-sm") + 'Save as waypoint</button><button class="btn" id="mpnav">' + icon("navigation", "ic-sm") + "Navigate here</button></div>");
        $("mpsave").onclick = function () {
          var name = prompt("Name this waypoint:", "");
          if (name === null) return;
          var w = T.addWaypoint(name.trim(), { lat: lat, lon: lon, acc: null });
          setSources(); showWaypoint(w);
        };
        $("mpnav").onclick = function () { target = [lon, lat]; setSources(); showPoint(lat, lon); if (!me) locate("fix"); };
      }
      function showWaypoint(w) {
        sheet('<b>' + icon("flag", "ic-sm") + esc(w.name) + "</b><span>" + esc(w.grid) + " · saved " + T.hhmm(new Date(w.t)) + "</span>" + relText(w) +
          '<div class="btn-row"><a class="btn" href="#/tool/gps?nav=' + w.id + '">' + icon("navigation", "ic-sm") + 'Navigate back</a><button class="btn" id="mwdel">' + icon("trash-2", "ic-sm") + "Delete</button></div>");
        $("mwdel").onclick = function () {
          if (!confirm("Delete this waypoint?")) return;
          A.save("waypoints", T.waypoints().filter(function (x) { return x.id !== w.id; }));
          setSources(); sheet(null);
        };
      }
      function measureSheet() {
        var m = 0;
        for (var i = 1; i < measure.length; i++) m += G.distance({ lat: measure[i - 1][1], lon: measure[i - 1][0] }, { lat: measure[i][1], lon: measure[i][0] });
        sheet("<b>" + (measure.length < 2 ? "Tap points along your route" : T.dist(m)) + "</b>" +
          (measure.length > 1 ? "<span>About " + T.dur(G.naismith(m / 1000, 0) * 60000) + " on the flat (5 km/h). Add 1 min for every 10 m of climb: count the contour lines you cross.</span>" : "<span>Each tap adds a point.</span>") +
          '<div class="btn-row"><button class="btn" id="mundo">' + icon("undo-2", "ic-sm") + 'Undo</button><button class="btn" id="mclear">' + icon("trash-2", "ic-sm") + "Clear</button></div>");
        $("mundo").onclick = function () { measure.pop(); setSources(); measureSheet(); };
        $("mclear").onclick = function () { measure = []; setSources(); measureSheet(); };
      }
      function setMode(m) {
        mode = mode === m ? "" : m;
        $("mmeas").setAttribute("aria-pressed", mode === "measure");
        $("mdrop").setAttribute("aria-pressed", mode === "drop");
        if (mode === "measure") measureSheet();
        else if (mode === "drop") sheet("<b>Tap the map to drop a waypoint</b><span>You'll be asked to name it.</span>");
        else { measure = []; setSources(); sheet(null); }
      }
      map.on("click", function (e) {
        $("mres").hidden = true;
        if (mode === "measure") { measure.push([e.lngLat.lng, e.lngLat.lat]); setSources(); measureSheet(); return; }
        if (mode === "drop") {
          var name = prompt("Name this waypoint:", "");
          setMode("drop");
          if (name === null) return;
          var w = T.addWaypoint(name.trim(), { lat: e.lngLat.lat, lon: e.lngLat.lng, acc: null });
          setSources(); showWaypoint(w);
          return;
        }
        var hit = map.queryRenderedFeatures([[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]], { layers: ["wp-dot"] })[0];
        if (hit) { var w2 = T.waypoints().filter(function (x) { return x.id === hit.properties.id; })[0]; if (w2) { showWaypoint(w2); return; } }
        showPoint(e.lngLat.lat, e.lngLat.lng);
      });

      // --- GPS
      var gpsMode = null;
      function locate(m) {
        var r = A.native("startGps", m);
        if (r !== "ok") {
          sheet("<b>GPS isn't available</b><span>" + ({ "no-permission": "No location permission (check Phone mode).", "location-off": "Location is switched off on the phone.", "no-gps": "No GPS on this device." }[r] || "Only on the phone.") + "</span>");
          return;
        }
        gpsMode = m;
        A.sensorChip(m === "follow" ? "GPS follow" : "GPS");
        $("mfol").setAttribute("aria-pressed", m === "follow");
        $("mwarn").hidden = m !== "follow";
        $("mwarn").innerHTML = icon("battery-medium", "ic-sm") + "Follow keeps GPS on: it drains the battery. It stops after 30 minutes.";
        if (!me) sheet("<b>Finding your position…</b><span>Stand in the open. The first fix can take a few minutes.</span>");
      }
      function stopGps() { if (gpsMode) { gpsMode = null; A.native("stopGps"); $("mfol").setAttribute("aria-pressed", "false"); $("mwarn").hidden = true; A.sensorChip(hdg ? "Compass" : null); } }
      T.listen("gps-fix", function (fx) {
        var first = !me || gpsMode === "fix";
        me = fx; T.fillReport(fx); A.save("lastFixWeb", fx); setSources();
        if (gpsMode === "follow" || first) map.jumpTo({ center: [fx.lon, fx.lat], zoom: Math.max(map.getZoom(), 14) });
        if (gpsMode === "fix") sheet("<b>" + esc(gridLabel(fx.lat, fx.lon, 8)) + "</b><span>Your position, ± " + Math.round(fx.acc) + " m</span>");
      });
      T.listen("gps-status", function (s) {
        if (gpsMode && !me) sheet("<b>Finding your position…</b><span>" + s.used + " of " + s.sats + " satellites · stops in " + Math.round(s.remaining) + " s</span>");
      });
      T.listen("gps-stopped", function () { gpsMode = null; $("mfol").setAttribute("aria-pressed", "false"); $("mwarn").hidden = true; A.sensorChip(hdg ? "Compass" : null); });
      $("mloc").onclick = function () {
        if (me && !gpsMode) map.jumpTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), 14) });
        if (gpsMode !== "follow") locate("fix");
      };
      $("mfol").onclick = function () { if (gpsMode === "follow") stopGps(); else locate("follow"); };

      // --- heading cone from the compass
      var hdg = null;
      $("mhdg").onclick = function () {
        if (hdg) { hdg.stop(); hdg = null; heading = null; setSources(); $("mhdg").setAttribute("aria-pressed", "false"); return; }
        hdg = T.sensor("compass", 10 * 60000, gpsMode ? "GPS + compass" : "Compass", function (e) { if (e.az != null) { heading = e.az; setSources(); } },
          function () { hdg = null; heading = null; setSources(); $("mhdg").setAttribute("aria-pressed", "false"); });
        $("mhdg").setAttribute("aria-pressed", hdg.running());
        if (!hdg.running()) { hdg = null; sheet("<b>Compass</b><span>The compass works in the app on the phone.</span>"); }
      };
      $("mgrid").setAttribute("aria-pressed", gridOn);
      $("mgrid").onclick = function () { gridOn = !gridOn; A.setSetting("mapGrid", gridOn); $("mgrid").setAttribute("aria-pressed", gridOn); setGrid(); };
      $("mmeas").onclick = function () { setMode("measure"); };
      $("mdrop").onclick = function () { setMode("drop"); };

      // --- search
      var sq = $("msq"), res = $("mres");
      sq.addEventListener("input", function () {
        var v = sq.value;
        if (v.trim().length < 2) { res.hidden = true; return; }
        loadPlaces().then(function (list) {
          if (sq.value !== v) return;
          var out = searchPlaces(v, list);
          res.hidden = false;
          res.innerHTML = out.length ? out.map(function (p, i) {
            return '<button class="mres" data-i="' + i + '"><b>' + esc(p.name) + "</b><span>" + (KIND_LABEL[p.kind] || p.kind) + (p.ele ? " · " + p.ele + " m" : "") + " · " + esc(gridLabel(p.lat, p.lon, 6)) + "</span></button>";
          }).join("") : '<p class="small muted">No places match.</p>';
          res.querySelectorAll("[data-i]").forEach(function (b) {
            b.onclick = function () {
              var p = out[+b.getAttribute("data-i")];
              res.hidden = true; sq.blur();
              var z = { city: 11, town: 12.5, village: 13.5, peak: 13.5, hill: 13.5, lake: 12.5, reservoir: 12.5, wood: 13 }[p.kind] || 14.5;
              map.jumpTo({ center: [p.lon, p.lat], zoom: z });
              showPoint(p.lat, p.lon);
            };
          });
        }, function () {
          res.hidden = false;
          res.innerHTML = '<p class="small muted">The place index (places.tsv) isn\'t installed, so search only finds names on the map as you pan.</p>';
        });
      });

      A.onLeave(function () {
        stopGps();
        if (hdg) hdg.stop();
        if (map) { map.remove(); map = null; }
        maplibregl.removeProtocol("pmtiles");
        maplibregl.removeProtocol("glyphs");
        if (rafRestore) { rafRestore(); rafRestore = null; }
      });
    });
  }

  window.MapView = { open: open, style: style, gridLines: gridLines, current: function () { return map; } };
})();
