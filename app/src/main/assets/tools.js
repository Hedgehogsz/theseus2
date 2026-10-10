/* Phone-powered tools: compass, position and waypoints, sun and moon, signalling, Morse, clinometer, pace counter,
 * CPR metronome, casualty log, boil timer, calculators, notebook, battery, phone mode, and the map route.
 *
 * Battery rules: every sensor, the GPS and every timer here starts only when its screen is opened (or its Start
 * button pressed), is stopped by App.onLeave when the screen is left, is stopped by the app in onPause, and stops
 * itself after a timeout. A small chip in the header shows while a sensor or GPS is running.
 */
(function () {
  "use strict";
  var A = window.App, icon = A.icon, esc = A.esc, view = A.view, G = window.Geo;
  var DEFAULT_POS = { lat: 54.0, lon: -2.0, label: "central UK (no GPS fix yet)" };
  // icons: map compass locate-fixed sun footprints triangle-right siren radio-tower heart-pulse clipboard-list flame calculator notebook-pen map-pin battery-medium
  // icons: arrow-right arrow-left wrench square
  // icons: flashlight radio camera alarm-clock battery-charging sliders-horizontal smartphone info images volume-2 shield sunrise sunset moon navigation flag satellite

  // ------------------------------------------------------------------ shared helpers
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(d) { return d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : "–"; }
  function dur(ms) {
    if (ms <= 0) return "0 min";
    var m = Math.round(ms / 60000), h = Math.floor(m / 60);
    return h ? h + " h " + pad(m % 60) + " min" : m + " min";
  }
  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + pad(s % 60); }
  function deg3(d) { d = Math.round(((d % 360) + 360) % 360); return (d < 10 ? "00" : d < 100 ? "0" : "") + d; }
  function cardinal(d) { return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round((((d % 360) + 360) % 360) / 22.5) % 16]; }
  function dist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + " km" : Math.round(m) + " m"; }
  function dms(v, pos, neg) {
    var a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    return d + "° " + pad(m) + "′ " + s.toFixed(1) + "″ " + (v >= 0 ? pos : neg);
  }
  function lastFix() {
    var st = A.nativeState();
    return st && st.lastFix ? st.lastFix : A.load("lastFixWeb", null);
  }
  function position() {
    var f = lastFix();
    return f ? { lat: f.lat, lon: f.lon, label: "your last GPS fix, " + ageText(f.time) } : DEFAULT_POS;
  }
  function ageText(t) {
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }
  function decl(p) { return G.declination(p.lat, p.lon, 0, new Date()); }
  function declText(d) {
    var a = Math.abs(d).toFixed(1);
    return Math.abs(d) < 0.05 ? "Magnetic north and true north are the same here." : "Magnetic north is " + a + "° " + (d < 0 ? "west" : "east") + " of true north here.";
  }
  function phoneOnly(msg) {
    return A.NATIVE ? "" : '<div class="banner info">' + icon("info") + "<span>" + (msg || "This tool uses the phone's sensors: it works in the app on the phone.") + "</span></div>";
  }
  function stopBanner(reason, again) {
    return '<div class="banner info">' + icon("info") + "<span>" + (reason === "timeout" ? "Stopped automatically to save battery." : "Stopped.") +
      ' <button class="btn" id="' + again + '">Start again</button></span></div>';
  }
  /** Subscribe to native events for the life of the current screen. */
  function listen(ev, fn) { A.onNative(ev, fn); A.onLeave(function () { A.offNative(ev, fn); }); }

  /**
   * Runs a native sensor ("compass", "level", "steps") while this screen is open. Returns {stop}. onStop(reason)
   * is called if it times out or the app stops it.
   */
  function sensor(name, timeoutMs, label, onData, onStop) {
    var running = !!A.native("startSensor", name, timeoutMs);
    if (running) A.sensorChip(label);
    var evName = name === "steps" ? "steps" : name;
    listen(evName, onData);
    if (name === "compass") listen("compass-accuracy", function (d) { onData({ accOnly: d.acc }); });
    listen("sensor-stopped", function (d) {
      if (d.name === name && running) { running = false; A.sensorChip(null); if (onStop) onStop(d.reason); }
    });
    var h = {
      running: function () { return running; },
      stop: function () { if (running) { running = false; A.native("stopSensor", name); A.sensorChip(null); } }
    };
    A.onLeave(h.stop);
    return h;
  }

  // ------------------------------------------------------------------ Tools tab
  var TOOL_GROUPS = [
    ["Navigation", [["#/map", "map", "Map", "Offline map with GPS"], ["compass", "compass", "Compass", "True or magnetic, bearing lock"],
      ["gps", "locate-fixed", "Position", "Grid reference, waypoints"], ["sun", "sun", "Sun and moon", "Daylight left, sun bearing"],
      ["pace", "footprints", "Pace counter", "Steps, distance, Naismith"], ["level", "triangle-right", "Clinometer", "Slope, heights, level"]]],
    ["Signalling", [["signal", "siren", "Signal", "SOS and 6 a minute: torch, screen, sound"], ["morse", "radio-tower", "Morse", "Send text by light or sound"]]],
    ["Medical", [["cpr", "heart-pulse", "CPR metronome", "110 a minute, 30:2 counter"], ["casualty", "clipboard-list", "Casualty log", "Tourniquet time, observations"],
      ["boil", "flame", "Boil timer", "To the boil, then 1 minute"]]],
    ["Calculators and notes", [["calc", "calculator", "Calculators", "Walking time, wind chill, water"], ["notebook", "notebook-pen", "Notebook", "Notes, incidents, daily checks"],
      ["#/report", "map-pin", "Location report", "To hand to rescuers"], ["battery", "battery-medium", "Battery", "Sessions left, solar"]]]
  ];
  function viewTools(p, q, tab) {
    A.setChrome("Tools", { root: true, tab: tab });
    var st = A.nativeState();
    var torchOn = !!(st && st.torch);
    var avail = A.nativeJson("toolsAvailable");
    function tile(t) {
      var href = t[0].charAt(0) === "#" ? t[0] : "#/tool/" + t[0];
      return '<a class="tool grp-tools" href="' + href + '">' + A.iconTile(t[1], "grp-tools") + "<span><b>" + t[2] + '</b><span class="sub">' + t[3] + "</span></span></a>";
    }
    var h = "";
    TOOL_GROUPS.forEach(function (g, i) {
      h += '<div class="section' + (i ? "" : " first") + '"><span class="label">' + g[0] + '</span><div class="tools">' + g[1].map(tile).join("");
      if (g[0] === "Signalling") {
        h += '<button class="tool' + (torchOn ? " on" : "") + '" id="torch">' + A.iconTile("flashlight", "grp-tools") + "<span><b>Torch " + (torchOn ? "on" : "off") + '</b><span class="sub">Tap to switch</span></span></button>';
      }
      h += "</div></div>";
    });
    var apps = [["fm", "radio", "FM Radio", "Needs wired headphones"], ["camera", "camera", "Camera", "Photograph for ID"],
      ["calculator", "calculator", "Calculator", "Phone calculator"], ["clock", "alarm-clock", "Clock", "Alarm and stopwatch"],
      ["battery", "battery-charging", "Battery usage", "Phone's battery settings"]].filter(function (x) { return !avail || avail[x[0]]; });
    if (apps.length) {
      h += '<div class="section"><span class="label">Phone apps</span><div class="tools">' + apps.map(function (x) {
        return '<button class="tool" data-app="' + x[0] + '">' + A.iconTile(x[1], "grp-reference") + "<span><b>" + x[2] + '</b><span class="sub">' + x[3] + "</span></span></button>";
      }).join("") + "</div></div>";
    }
    h += '<div class="section"><span class="label">This guide</span><ul class="list">' +
      row("#/settings", "sliders-horizontal", "Settings", "Theme, text size, brightness, low-power mode") +
      row("#/tool/phone-mode", "smartphone", "Phone mode", "Survival mode or normal phone, restore apps") +
      row("#/about", "info", "About and licences", "Disclaimer, sources and licences") +
      row("#/credits", "images", "Credits", "Map data and " + A.IDX.counts.photos + " photos") + "</ul></div>";
    if (!A.NATIVE) h = '<div class="banner info">' + icon("info") + "<span>Sensor tools and phone apps work only in the app on the phone.</span></div>" + h;
    view.innerHTML = h;
    view.querySelectorAll("[data-app]").forEach(function (b) {
      b.onclick = function () {
        if (!A.native("launchTool", b.getAttribute("data-app"))) alert(A.NATIVE ? "That app isn't available on this phone." : "Only available on the phone.");
      };
    });
    $("torch").onclick = function () {
      var cur = A.nativeState();
      if (!A.native("setTorch", !(cur && cur.torch))) alert(A.NATIVE ? "The torch could not be switched (the camera may be in use)." : "Only available on the phone.");
      A.render();
    };
  }
  function row(href, ic, t, s) {
    return '<li><a class="row" href="' + href + '">' + A.iconTile(ic, "grp-reference") + '<span class="txt"><span class="t">' + t + '</span><span class="s">' + s + "</span></span>" + icon("chevron-right", "chev") + "</a></li>";
  }

  // ------------------------------------------------------------------ compass
  function dialSvg() {
    var s = '<svg viewBox="-130 -130 260 260" class="dial" aria-hidden="true"><g id="rose">';
    s += '<circle r="122" class="ring"/>';
    for (var d = 0; d < 360; d += 5) {
      var major = d % 30 === 0, len = major ? 14 : d % 10 === 0 ? 9 : 5;
      s += '<line x1="0" y1="-121" x2="0" y2="' + (-121 + len) + '" class="' + (major ? "tick major" : "tick") + '" transform="rotate(' + d + ')"/>';
      if (major && d % 90) s += '<text y="-92" class="num" transform="rotate(' + d + ')">' + d + "</text>";
    }
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (c) {
      s += '<text y="-88" class="card' + (c[0] === "N" ? " north" : "") + '" transform="rotate(' + c[1] + ')">' + c[0] + "</text>";
    });
    s += '<g id="lockmark" style="display:none"><path d="M0,-121 l-7,-10 h14 z" class="lock"/></g>';
    s += '</g><path d="M0,-130 l-9,-0 l9,22 l9,-22 z" class="index"/><circle r="4" class="hub"/></svg>';
    return s;
  }
  function viewCompass(p, q, tab) {
    A.setChrome("Compass", { tab: tab });
    var pos = position(), d = decl(pos);
    var north = A.settings.compassNorth || "mag";
    var lock = A.load("bearingLock", null);
    var h = phoneOnly();
    h += '<div class="compass-wrap">' + dialSvg() + '</div>';
    h += '<div class="readout"><b id="hdg">---°</b><span id="card">Hold the phone flat</span></div>';
    h += '<div class="seg two" role="group" aria-label="North reference"><button data-n="mag" aria-pressed="' + (north === "mag") + '">Magnetic</button><button data-n="true" aria-pressed="' + (north === "true") + '">True</button></div>';
    h += '<p class="small muted center">' + declText(d) + " Position: " + esc(pos.label) + ".</p>";
    h += '<div id="cal"></div>';
    h += '<div class="lockbox"><div class="lock-row"><label for="lockv">Bearing</label><input id="lockv" type="number" inputmode="numeric" min="0" max="359" placeholder="e.g. 245" value="' + (lock != null ? lock : "") + '">' +
      '<button class="btn" id="lockset">Set</button><button class="btn" id="lockhere">Use heading</button></div><div id="lockout" class="lockout"></div></div>';
    h += '<div id="cstop"></div>';
    h += '<p class="small muted">Hold the phone flat, away from metal, magnets and cars. Held upright, the heading follows the camera, so you can sight a landmark. For map work, magnetic matches a baseplate compass. No magnetometer? Use the <a href="#/tool/sun">sun bearing</a>.</p>';
    A.view.innerHTML = h;

    var rose = $("rose"), hdg = $("hdg"), card = $("card"), lockout = $("lockout"), lockmark = $("lockmark");
    var heading = null, acc = 3;
    function shown() { return heading == null ? null : (north === "true" ? heading + d : heading); }
    function draw() {
      var v = shown();
      if (v == null) return;
      v = ((v % 360) + 360) % 360;
      rose.setAttribute("transform", "rotate(" + (-v).toFixed(1) + ")");
      hdg.textContent = deg3(v) + "°";
      card.textContent = cardinal(v) + " · " + (north === "true" ? "true" : "magnetic");
      if (lock != null) {
        lockmark.style.display = "";
        lockmark.setAttribute("transform", "rotate(" + lock + ")");
        var diff = ((lock - v + 540) % 360) - 180;
        lockout.className = "lockout" + (Math.abs(diff) <= 3 ? " on" : "");
        lockout.innerHTML = Math.abs(diff) <= 3 ? icon("check", "ic-sm") + "On bearing " + deg3(lock) + "°"
          : icon(diff > 0 ? "arrow-right" : "arrow-left", "ic-sm") + "Turn " + (diff > 0 ? "right " : "left ") + Math.round(Math.abs(diff)) + "° to " + deg3(lock) + "°";
      } else {
        lockmark.style.display = "none";
        lockout.innerHTML = "";
      }
    }
    function calib() {
      $("cal").innerHTML = acc <= 1 ? '<div class="banner warn">' + icon("rotate-ccw") + "<span><b>Compass needs calibrating.</b> Move the phone slowly in a figure-of-eight a few times, away from metal.</span></div>" : "";
    }
    view.querySelectorAll("[data-n]").forEach(function (b) {
      b.onclick = function () {
        north = b.getAttribute("data-n"); A.setSetting("compassNorth", north);
        view.querySelectorAll("[data-n]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        draw();
      };
    });
    $("lockset").onclick = function () {
      var v = parseFloat($("lockv").value);
      lock = isNaN(v) ? null : ((Math.round(v) % 360) + 360) % 360;
      A.save("bearingLock", lock); draw();
    };
    $("lockhere").onclick = function () {
      var v = shown();
      if (v == null) return;
      lock = Math.round(((v % 360) + 360) % 360); $("lockv").value = lock; A.save("bearingLock", lock); draw();
    };
    function start() {
      $("cstop").innerHTML = "";
      sensor("compass", 10 * 60000, "Compass", function (e) {
        if (e.accOnly !== undefined) { acc = e.accOnly; calib(); return; }
        heading = e.az;
        if (e.acc !== undefined) { acc = e.acc; }
        if (e.err != null && e.err > 25) acc = Math.min(acc, 1);
        calib(); draw();
      }, function (reason) {
        $("cstop").innerHTML = stopBanner(reason, "crestart");
        $("crestart").onclick = start;
      });
    }
    if (lock != null) draw();
    start();
  }

  // ------------------------------------------------------------------ position, waypoints, navigate back
  function waypoints() { return A.load("waypoints", []); }
  function saveWaypoints(w) { A.save("waypoints", w); }
  function addWaypoint(name, fix) {
    var w = waypoints();
    var g = G.toOSGB(fix.lat, fix.lon);
    var wp = { id: "w" + Date.now(), name: name || "Waypoint " + (w.length + 1), lat: fix.lat, lon: fix.lon, acc: fix.acc || null, t: Date.now(), grid: g ? G.gridRef(g, 8) : "" };
    w.unshift(wp);
    saveWaypoints(w);
    return wp;
  }
  function fixHtml(f) {
    var g = G.toOSGB(f.lat, f.lon);
    var h = '<div class="fix"><span class="k">OS grid reference</span><b class="grid">' + (g ? esc(G.gridRef(g, 8)) : "Outside the British grid") + "</b>";
    if (g) h += '<span class="sub">6-figure ' + esc(G.gridRef(g, 6)) + " · 10-figure " + esc(G.gridRef(g, 10)) + "</span>";
    h += '<div class="facts2"><span><span class="k">Accuracy</span>± ' + Math.round(f.acc) + " m</span>" +
      '<span><span class="k">Height</span>' + (f.alt != null ? Math.round(f.alt) + " m (GPS)" : "–") + "</span>" +
      '<span><span class="k">Lat / long</span>' + f.lat.toFixed(5) + ", " + f.lon.toFixed(5) + "</span>" +
      '<span><span class="k">Fix time</span>' + hhmm(new Date(f.time)) + " · " + ageText(f.time) + "</span></div>";
    h += '<p class="small muted">' + dms(f.lat, "N", "S") + " · " + dms(f.lon, "E", "W") + ". Grid reference via the OS Helmert transformation: accurate to about 5 m, plus the GPS error.</p></div>";
    return h;
  }
  function fillReport(f) {
    var g = G.toOSGB(f.lat, f.lon);
    if (!g) return;
    var r = A.load("report", {});
    var ref = G.gridRef(g, 8);
    if (!r.grid || r.grid === r.gridAuto) r.grid = ref;
    r.gridAuto = ref;
    r.latlon = f.lat.toFixed(5) + ", " + f.lon.toFixed(5) + " ±" + Math.round(f.acc) + " m";
    r.t = Date.now();
    A.save("report", r);
  }
  function viewGps(p, q, tab) {
    if (q.nav) return viewNavigate(q.nav, tab);
    A.setChrome("Position", { tab: tab });
    var f = lastFix();
    var h = phoneOnly("GPS works in the app on the phone. In a browser this shows saved waypoints only.");
    h += '<button class="btn primary block big" id="getpos">' + icon("locate-fixed") + "Get my position</button>";
    h += '<p class="small muted">GPS switches on just for this and turns itself off after a good fix or 3 minutes. It works in airplane mode. Stand in the open; the first fix can take a few minutes.</p>';
    h += '<div id="gstatus"></div><div id="gfix">' + (f ? fixHtml(f) : "") + "</div>";
    h += '<div id="gactions"' + (f ? "" : " hidden") + ' class="btn-row"><button class="btn" id="savewp">' + icon("flag", "ic-sm") + 'Save as waypoint</button><a class="btn" href="#/report">' + icon("map-pin", "ic-sm") +
      'Location report</a><a class="btn" href="#/map?fix=1">' + icon("map", "ic-sm") + "Show on map</a></div>";
    h += '<div class="section"><span class="label">Waypoints</span><div id="wps"></div></div>';
    view.innerHTML = h;
    function drawWps() {
      var w = waypoints(), cur = lastFix();
      $("wps").innerHTML = w.length ? '<ul class="list">' + w.map(function (wp) {
        var rel = cur ? dist(G.distance(cur, wp)) + " at " + deg3(G.bearing(cur, wp)) + "° true" : "";
        return '<li><div class="row wp"><span class="ic-tile grp-tools">' + icon("flag") + '</span><span class="txt"><span class="t">' + esc(wp.name) + '</span><span class="s">' +
          esc(wp.grid) + " · " + hhmm(new Date(wp.t)) + " " + new Date(wp.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + (rel ? " · " + rel : "") +
          '</span><span class="wp-actions"><a class="btn" href="#/tool/gps?nav=' + wp.id + '">' + icon("navigation", "ic-sm") + 'Go back</a><a class="btn" href="#/map?wp=' + wp.id + '">' + icon("map", "ic-sm") + "Map</a>" +
          '<button class="btn" data-del="' + wp.id + '" aria-label="Delete ' + esc(wp.name) + '">' + icon("x", "ic-sm") + "</button></span></span></div></li>";
      }).join("") + "</ul>" : '<p class="muted small">No waypoints yet. Save your camp, car or a casualty\'s position so you can find your way back.</p>';
      view.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () {
          if (!confirm("Delete this waypoint?")) return;
          saveWaypoints(waypoints().filter(function (x) { return x.id !== b.getAttribute("data-del"); }));
          drawWps();
        };
      });
    }
    function bindSave() {
      $("savewp").onclick = function () {
        var cur = lastFix();
        if (!cur) return;
        var name = prompt("Name this waypoint (e.g. Camp, Car, Casualty):", "");
        if (name === null) return;
        addWaypoint(name.trim(), cur);
        drawWps();
      };
    }
    var running = false;
    function stopGps() { if (running) { running = false; A.native("stopGps"); A.sensorChip(null); } }
    A.onLeave(stopGps);
    listen("gps-status", function (s) {
      if (!running) return;
      if (s.state === "disabled") { $("gstatus").innerHTML = '<div class="banner warn">' + icon("triangle-alert") + "<span>Location is switched off on the phone.</span></div>"; return; }
      $("gstatus").innerHTML = '<div class="gps-progress">' + icon("satellite") + "<div><b>" + (s.state === "fix" ? "Improving the fix…" : "Searching for satellites…") +
        "</b><span>" + s.used + " used of " + s.sats + " in view · " + mmss(s.elapsed) + " · stops in " + mmss(s.remaining) + '</span><div class="bar"><i style="width:' + Math.min(100, s.used / 8 * 100) + '%"></i></div></div></div>';
    });
    listen("gps-fix", function (fx) {
      $("gfix").innerHTML = fixHtml(fx);
      $("gactions").hidden = false;
      fillReport(fx);
      A.save("lastFixWeb", fx);
      drawWps();
    });
    listen("gps-stopped", function (s) {
      running = false; A.sensorChip(null);
      $("getpos").disabled = false;
      $("gstatus").innerHTML = '<p class="small muted">' + icon("check", "ic-sm") + " GPS is off. " +
        (s.reason === "fix" ? "Good fix saved and copied to the location report." : s.reason === "timeout" ? "No good fix within 3 minutes: try somewhere with a wider view of the sky." :
          s.reason === "timeout-with-fix" ? "Best fix saved; accuracy may be limited." : "") + "</p>";
    });
    $("getpos").onclick = function () {
      var r = A.native("startGps", "fix");
      if (r === "ok") {
        running = true; A.sensorChip("GPS");
        $("getpos").disabled = true;
        $("gstatus").innerHTML = '<div class="gps-progress">' + icon("satellite") + "<div><b>Starting GPS…</b></div></div>";
      } else {
        $("gstatus").innerHTML = '<div class="banner warn">' + icon("triangle-alert") + "<span>" + ({
          "no-permission": "The guide doesn't have location permission. In Phone mode, check the guide is the device owner.",
          "location-off": "Location is switched off and the guide couldn't switch it on. Turn on Location in the phone's quick settings.",
          "no-gps": "This phone has no GPS receiver."
        }[r] || "GPS isn't available here.") + "</span></div>";
      }
    };
    bindSave();
    drawWps();
  }
  function viewNavigate(id, tab) {
    var wp = waypoints().filter(function (x) { return x.id === id; })[0];
    A.setChrome("Back to waypoint", { tab: tab });
    if (!wp) { view.innerHTML = '<p class="empty">That waypoint has been deleted.</p>'; return; }
    var pos = position(), d = decl(pos);
    var h = phoneOnly();
    h += '<h1 class="page">' + esc(wp.name) + '</h1><p class="lead">' + esc(wp.grid) + "</p>";
    h += '<div class="nav-big"><svg viewBox="-60 -60 120 120" class="nav-arrow" aria-hidden="true"><g id="arrow"><path d="M0,-52 L22,30 L0,16 L-22,30 Z"/></g></svg>' +
      '<div><b id="ndist">–</b><span id="nbear">–</span><span id="nturn" class="small"></span></div></div>';
    h += '<div class="btn-row"><button class="btn primary" id="nupd">' + icon("locate-fixed", "ic-sm") + 'Update my position</button><a class="btn" href="#/map?wp=' + wp.id + '">' + icon("map", "ic-sm") + "Map</a></div>";
    h += '<div id="nstatus"></div><p class="small muted">The arrow points to the waypoint using the compass; distance and bearing update when you get a new position. ' + declText(d) + "</p>";
    view.innerHTML = h;
    var cur = lastFix(), heading = null;
    function draw() {
      if (!cur) { $("ndist").textContent = "Get a position first"; return; }
      var b = G.bearing(cur, wp), m = G.distance(cur, wp);
      $("ndist").textContent = dist(m);
      $("nbear").textContent = deg3(b) + "° true · " + deg3(b - d) + "° magnetic · " + cardinal(b);
      if (heading != null) {
        var rel = ((b - (heading + d)) % 360 + 360) % 360;
        $("arrow").setAttribute("transform", "rotate(" + rel.toFixed(0) + ")");
        $("nturn").textContent = rel < 10 || rel > 350 ? "Straight ahead" : rel < 180 ? "Turn right " + Math.round(rel) + "°" : "Turn left " + Math.round(360 - rel) + "°";
      }
    }
    sensor("compass", 10 * 60000, "Compass", function (e) { if (e.az != null) { heading = e.az; draw(); } });
    var running = false;
    A.onLeave(function () { if (running) A.native("stopGps"); });
    listen("gps-fix", function (fx) { cur = fx; fillReport(fx); A.save("lastFixWeb", fx); draw(); });
    listen("gps-stopped", function () { running = false; A.sensorChip("Compass"); $("nstatus").innerHTML = ""; });
    listen("gps-status", function (s) { if (running) $("nstatus").innerHTML = '<p class="small muted">GPS: ' + s.used + "/" + s.sats + " satellites · " + mmss(s.elapsed) + "</p>"; });
    $("nupd").onclick = function () {
      if (A.native("startGps", "fix") === "ok") { running = true; A.sensorChip("GPS + compass"); }
    };
    draw();
  }

  // ------------------------------------------------------------------ sun and moon
  function moonSvg(phase) {
    // Lit part = semicircle on the lit side (right while waxing) + an elliptical terminator back to the top.
    var r = 40, k = Math.cos(phase * 2 * Math.PI), waxing = phase < 0.5, crescent = k > 0;
    var outer = waxing ? 1 : 0, term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0), rx = (Math.abs(k) * r).toFixed(1);
    var d = "M0,-" + r + " A" + r + "," + r + " 0 0," + outer + " 0," + r + " A" + rx + "," + r + " 0 0," + term + " 0,-" + r + " Z";
    return '<svg viewBox="-50 -50 100 100" class="moon" aria-hidden="true"><circle r="40" class="dark"/><path d="' + d + '" class="lit"/></svg>';
  }
  function viewSun(p, q, tab) {
    A.setChrome("Sun and moon", { tab: tab });
    var pos = position(), now = new Date();
    var day = q.d === "1" ? new Date(now.getTime() + 86400000) : now;
    var t = G.sunTimes(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12), pos.lat, pos.lon);
    var sp = G.sunPosition(now, pos.lat, pos.lon), d = decl(pos), mp = G.moonPhase(now);
    var h = '<div class="seg two" role="group"><a class="segb" href="#/tool/sun" aria-pressed="' + (q.d !== "1") + '">Today</a><a class="segb" href="#/tool/sun?d=1" aria-pressed="' + (q.d === "1") + '">Tomorrow</a></div>';
    h += '<p class="small muted center">For ' + esc(pos.label) + ". Times are phone time.</p>";
    if (q.d !== "1" && t.dawn && now < t.dawn) {
      h += '<div class="big-stat"><span class="k">Night</span><b>First light ' + hhmm(t.dawn) + '</b><span class="sub">Sunrise ' + hhmm(t.sunrise) + ". " +
        dur(t.sunset - t.sunrise) + " of daylight today.</span></div>";
    } else if (q.d !== "1") {
      var left = t.sunset ? t.sunset - now : 0, dark = t.dusk ? t.dusk - now : 0;
      h += '<div class="big-stat' + (left < 3600000 ? " warn" : "") + '"><span class="k">Daylight left</span><b>' + (left > 0 ? dur(left) : "Sun has set") + "</b>" +
        '<span class="sub">' + (dark > 0 ? "Dark (end of civil twilight) in " + dur(dark) + ". " : "") + (left > 3600000 ? "Stop and make camp by " + hhmm(new Date(t.sunset - 3600000)) + "." : left > 0 ? "Make camp now." : "") + "</span></div>";
    }
    h += '<div class="timeline">' + [["First light", t.dawn, "sunrise"], ["Sunrise", t.sunrise, "sunrise"], ["Midday sun", t.noon, "sun"], ["Sunset", t.sunset, "sunset"], ["Dark", t.dusk, "moon"]]
      .map(function (x) { return '<div class="tl">' + icon(x[2], "ic-sm") + "<span>" + x[0] + "</span><b>" + hhmm(x[1]) + "</b></div>"; }).join("") + "</div>";
    if (q.d !== "1") {
      h += '<div class="section"><span class="label">The sun now</span><div class="sunnow">' +
        (sp.altitude > -0.8 ? "<b>" + deg3(sp.azimuth) + "° true</b><span>" + cardinal(sp.azimuth) + " · " + deg3(sp.azimuth - d) + "° magnetic · " + Math.round(sp.altitude) + "° above the horizon</span>"
          : "<b>Below the horizon</b><span>Bearing " + deg3(sp.azimuth) + "° true</span>") + "</div>" +
        '<p class="small muted">Sun compass: face the sun; it is at the bearing above. South is roughly where the sun is highest (around 13:00 in summer time, 12:00 in winter).</p></div>';
    }
    h += '<div class="section"><span class="label">Moon</span><div class="moonrow">' + moonSvg(mp.phase) + "<div><b>" + mp.name + "</b><span>" + Math.round(mp.fraction * 100) + "% lit</span>" +
      '<span class="small muted">A bright moon (near full) gives enough light to move on open ground; a new moon gives none.</span></div></div></div>';
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ battery maths (Galaxy A21s: 5000 mAh)
  function capacityMah(st) {
    if (!st || st.battery < 0) return 5000 * 0.5;
    return st.chargeMah > 0 ? st.chargeMah : 5000 * st.battery / 100;
  }
  function hoursFor(st, mA) { return capacityMah(st) * 0.9 / mA; }
  function hoursText(h) { return h >= 48 ? "about " + Math.round(h / 24) + " days" : h >= 2 ? "about " + Math.round(h) + " hours" : "about " + Math.max(1, Math.round(h * 60 / 10) * 10) + " min"; }

  // ------------------------------------------------------------------ Morse and signal patterns
  var MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--",
    N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "@": ".--.-."
  };
  function toMorse(text) {
    return String(text).toUpperCase().split(/\s+/).filter(Boolean).map(function (w) {
      return w.split("").map(function (c) { return MORSE[c] || ""; }).filter(Boolean).join(" ");
    }).filter(Boolean).join(" / ");
  }
  /** Morse code -> on/off durations (ms): dot 1 unit, dash 3, gap 1, letter gap 3, word gap 7 (also after the end). */
  function morsePattern(code, unit) {
    var out = [];
    code.split(" / ").forEach(function (word, wi) {
      word.split(" ").forEach(function (letter) {
        letter.split("").forEach(function (sym) { out.push(sym === "-" ? 3 * unit : unit, unit); });
        if (out.length) out[out.length - 1] = 3 * unit;
      });
      if (out.length) out[out.length - 1] = 7 * unit;
    });
    return out;
  }
  // International mountain distress signal: six long signals spread over a minute, then a minute's silence.
  var SIX = [2000, 8000, 2000, 8000, 2000, 8000, 2000, 8000, 2000, 8000, 2000, 68000];
  var SOS = morsePattern(toMorse("SOS"), 300);
  function duty(pat) { var on = 0, all = 0; pat.forEach(function (v, i) { all += v; if (i % 2 === 0) on += v; }); return on / all; }

  // Screen flasher: a full-screen panel switched by the pattern (screen tools only run while visible).
  function screenFlash(pattern, colour, repeat, onEnd) {
    var el = document.createElement("div");
    el.className = "flash";
    el.innerHTML = '<span class="flash-hint">Tap to stop</span>';
    document.body.appendChild(el);
    var i = 0, timer = null, stopped = false;
    function step() {
      if (stopped) return;
      if (i >= pattern.length) { if (!repeat) return stop(); i = 0; }
      el.style.background = i % 2 === 0 ? colour : "#000";
      timer = setTimeout(step, pattern[i++]);
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
      if (onEnd) onEnd();
    }
    el.onclick = stop;
    step();
    return stop;
  }

  // ------------------------------------------------------------------ signal beacons
  var SIGNALS = [
    { id: "six-torch", ch: "torch", pat: SIX, t: "Mountain distress: torch", s: "6 long flashes a minute, then a minute off", icon: "flashlight" },
    { id: "sos-torch", ch: "torch", pat: SOS, t: "SOS: torch", s: "··· — — — ··· in light", icon: "flashlight" },
    { id: "six-sound", ch: "sound", pat: SIX, t: "Mountain distress: sound", s: "6 loud blasts a minute through the speaker", icon: "volume-2" },
    { id: "sos-sound", ch: "sound", pat: SOS, t: "SOS: sound", s: "··· — — — ··· as loud beeps", icon: "volume-2" },
    { id: "sos-screen", ch: "screen", pat: SOS, t: "SOS: screen", s: "Whole screen flashes white at full brightness", icon: "smartphone" },
    { id: "strobe-screen", ch: "screen", pat: [500, 500], t: "Strobe: screen", s: "Orange flashing screen to catch attention", icon: "smartphone", colour: "#ff7a1a" }
  ];
  function signalMa(sg) {
    var base = 110; // screen on at minimum brightness + processor
    if (sg.ch === "torch") return base + 220 * duty(sg.pat);
    if (sg.ch === "sound") return base + 300 * duty(sg.pat);
    return base + 330; // LCD backlight at full brightness, whatever the colour
  }
  function viewSignal(p, q, tab) {
    A.setChrome("Signal", { tab: tab });
    var st = A.nativeState();
    var mins = A.settings.signalMins || 30;
    var h = phoneOnly("Torch and sound beacons work in the app on the phone. The screen beacons work here too.");
    h += '<p class="lead">The screen stays on, dimmed, while a beacon runs, and it stops by itself. Help: <a href="#/a/signalling-rescue">how to signal</a>, <a href="#/a/distress-signals">signals at a glance</a>.</p>';
    h += '<div class="setting-row"><span>Stop after</span><div class="seg four" role="group">' + [15, 30, 60, 120].map(function (m) {
      return '<button data-mins="' + m + '" aria-pressed="' + (m === mins) + '">' + (m < 60 ? m + " min" : m / 60 + " h") + "</button>";
    }).join("") + "</div></div>";
    h += '<div id="sigrun"></div><div class="sig-list">' + SIGNALS.map(function (sg) {
      return '<button class="sig" data-sig="' + sg.id + '">' + A.iconTile(sg.icon, "grp-urgent") + '<span class="txt"><b>' + sg.t + "</b><span>" + sg.s +
        '</span><span class="cost">' + icon("battery-medium", "ic-sm") + hoursText(hoursFor(st, signalMa(sg))) + (st && st.battery >= 0 ? " on " + st.battery + "%" : " on a half-full battery") + "</span></span></button>";
    }).join("") + "</div>";
    view.innerHTML = h;
    var active = null, stopScreen = null, endAt = 0, tick = null;
    function finish(reason) {
      if (!active) return;
      if (active.ch === "screen") { if (stopScreen) { var s = stopScreen; stopScreen = null; s(); } }
      else A.native("stopPattern", active.ch);
      active = null;
      clearInterval(tick);
      A.native("keepScreenOn", false);
      A.native("setSignalBrightness", -1);
      $("sigrun").innerHTML = reason === "timeout" ? '<div class="banner info">' + icon("info") + "<span>The beacon stopped after the time you set.</span></div>" : "";
    }
    A.onLeave(function () { finish("left"); });
    listen("signal-stopped", function (d) { if (active && d.channel === active.ch && d.reason !== "replaced") finish(d.reason); });
    view.querySelectorAll("[data-mins]").forEach(function (b) {
      b.onclick = function () { mins = +b.getAttribute("data-mins"); A.setSetting("signalMins", mins); view.querySelectorAll("[data-mins]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); };
    });
    view.querySelectorAll("[data-sig]").forEach(function (b) {
      b.onclick = function () {
        var sg = SIGNALS.filter(function (x) { return x.id === b.getAttribute("data-sig"); })[0];
        finish("replaced");
        var ms = mins * 60000;
        if (sg.ch === "screen") {
          A.native("keepScreenOn", true);
          A.native("setSignalBrightness", 1);
          active = sg;
          stopScreen = screenFlash(sg.pat, sg.colour || "#fff", true, function () { stopScreen = null; finish("stopped"); });
        } else {
          if (!A.native("startPattern", sg.ch, JSON.stringify(sg.pat), true, 2900, true, ms)) { alert(A.NATIVE ? "Couldn't start (the torch may be in use)." : "Only on the phone."); return; }
          A.native("keepScreenOn", true);
          A.native("setSignalBrightness", 0.02);
          active = sg;
        }
        endAt = Date.now() + ms;
        function upd() {
          if (!active) return;
          if (Date.now() >= endAt) { finish("timeout"); return; }
          $("sigrun").innerHTML = '<div class="running">' + icon(sg.icon) + "<div><b>" + sg.t + "</b><span>Stops in " + dur(endAt - Date.now()) + '</span></div><button class="btn danger" id="sigstop">Stop</button></div>';
          $("sigstop").onclick = function () { finish("stopped"); };
        }
        upd();
        tick = setInterval(upd, 30000);
        window.scrollTo(0, 0);
      };
    });
  }

  // ------------------------------------------------------------------ Morse
  function viewMorse(p, q, tab) {
    A.setChrome("Morse", { tab: tab });
    var wpm = A.settings.morseWpm || 8, ch = A.settings.morseCh || "torch";
    var h = phoneOnly("Torch and sound need the phone; the screen works here.");
    h += '<div class="form"><label for="mtext">Message</label><input id="mtext" maxlength="60" value="SOS" autocomplete="off" autocapitalize="characters"></div>';
    h += '<p class="morse-out" id="mout"></p>';
    h += '<div class="seg" role="group" aria-label="Send by">' + [["torch", "Torch"], ["screen", "Screen"], ["sound", "Sound"]].map(function (x) {
      return '<button data-ch="' + x[0] + '" aria-pressed="' + (ch === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="seg" role="group" aria-label="Speed">' + [[5, "Slow"], [8, "Medium"], [12, "Fast"]].map(function (x) {
      return '<button data-wpm="' + x[0] + '" aria-pressed="' + (wpm === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="btn-row"><button class="btn primary" id="msend">' + icon("send", "ic-sm") + 'Send once</button><button class="btn" id="mloop">' + icon("repeat", "ic-sm") + 'Repeat</button><button class="btn danger" id="mstop" hidden>Stop</button></div>';
    h += '<div class="section"><span class="label">Morse code</span><div class="morse-table">' + Object.keys(MORSE).filter(function (k) { return /[A-Z0-9]/.test(k); }).map(function (k) {
      return "<span><b>" + k + "</b>" + MORSE[k].replace(/\./g, "·").replace(/-/g, "–") + "</span>";
    }).join("") + '</div><p class="small muted">A dot is one unit, a dash three. Gap of one unit inside a letter, three between letters, seven between words. Full guide: <a href="#/a/morse-code">Morse code</a>.</p></div>';
    view.innerHTML = h;
    var stopScreen = null, sending = false;
    function upd() { $("mout").textContent = toMorse($("mtext").value).replace(/\./g, "·").replace(/-/g, "—") || "–"; }
    function stop() {
      if (stopScreen) { var s = stopScreen; stopScreen = null; s(); }
      if (sending) { A.native("stopPattern", "torch"); A.native("stopPattern", "sound"); }
      sending = false;
      A.native("keepScreenOn", false);
      $("mstop").hidden = true;
    }
    A.onLeave(stop);
    listen("signal-stopped", function (d) { if (d.reason !== "replaced" && sending) stop(); });
    function send(repeat) {
      stop();
      var code = toMorse($("mtext").value);
      if (!code) return;
      var pat = morsePattern(code, Math.round(1200 / wpm));
      $("mstop").hidden = false;
      A.native("keepScreenOn", true);
      if (ch === "screen") stopScreen = screenFlash(pat, "#fff", repeat, function () { stopScreen = null; stop(); });
      else {
        sending = !!A.native("startPattern", ch, JSON.stringify(pat), repeat, 700, false, 30 * 60000);
        if (!sending) { stop(); alert("Only on the phone."); }
      }
    }
    $("mtext").addEventListener("input", upd);
    view.querySelectorAll("[data-ch]").forEach(function (b) { b.onclick = function () { ch = b.getAttribute("data-ch"); A.setSetting("morseCh", ch); view.querySelectorAll("[data-ch]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); }; });
    view.querySelectorAll("[data-wpm]").forEach(function (b) { b.onclick = function () { wpm = +b.getAttribute("data-wpm"); A.setSetting("morseWpm", wpm); view.querySelectorAll("[data-wpm]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); }; });
    $("msend").onclick = function () { send(false); };
    $("mloop").onclick = function () { send(true); };
    $("mstop").onclick = stop;
    upd();
  }

  // ------------------------------------------------------------------ clinometer / level
  function viewLevel(p, q, tab) {
    A.setChrome("Clinometer", { tab: tab });
    var mode = q.m || "slope";
    var h = phoneOnly();
    h += '<div class="seg" role="group">' + [["slope", "Slope"], ["height", "Height"], ["level", "Level"]].map(function (x) {
      return '<a class="segb" href="#/tool/level?m=' + x[0] + '" aria-pressed="' + (mode === x[0]) + '">' + x[1] + "</a>";
    }).join("") + "</div>";
    if (mode === "slope") {
      h += '<div class="big-stat"><span class="k">Slope angle</span><b id="lv">–</b><span class="sub" id="lrisk">Lay the phone flat on the slope.</span></div>';
      h += '<p class="small muted">Lay the phone on a walking pole or map case resting on the slope, pointing straight downhill. Most avalanches start on slopes of 30–45°; wet, loose or grassy slopes above about 30° are also where slips turn into falls. See <a href="#/a/mountain-weather">mountain weather</a>.</p>';
    } else if (mode === "height") {
      h += '<div class="big-stat"><span class="k">Height</span><b id="lv">–</b><span class="sub" id="lang">Sight the top along the phone\'s top edge.</span></div>';
      h += '<div class="form two-col"><div><label for="hd">Distance to the base (m)</label><input id="hd" type="number" inputmode="decimal" value="' + (A.settings.hDist || 20) + '"></div>' +
        '<div><label for="he">Your eye height (m)</label><input id="he" type="number" inputmode="decimal" value="' + (A.settings.hEye || 1.6) + '"></div></div>';
      h += '<div class="btn-row"><button class="btn" id="hold">' + icon("pause", "ic-sm") + "Hold reading</button></div>";
      h += '<p class="small muted">Pace out the distance to the base of the tree or cliff on level ground. Hold the phone up and look along its long top edge at the top. Height = distance × tan(angle) + eye height. Quick check: if you\'re at 45°, the height is your distance plus eye height.</p>';
    } else {
      h += '<div class="bubble-box"><div class="bubble" id="bub"></div><div class="cross"></div></div><div class="facts2 center"><span><span class="k">Front–back</span><b id="lp">–</b></span><span><span class="k">Side–side</span><b id="lr">–</b></span></div>';
    }
    h += '<div id="lstop"></div>';
    view.innerHTML = h;
    var held = false;
    if ($("hold")) $("hold").onclick = function () { held = !held; $("hold").innerHTML = icon(held ? "play" : "pause", "ic-sm") + (held ? "Release" : "Hold reading"); };
    function risk(a) {
      return a < 25 ? "Gentle: avalanches and serious slips are unlikely below about 25–30°." : a < 30 ? "Steep: take care on snow, ice and wet grass." :
        a <= 45 ? "Avalanche-prone range (30–45°). Avoid on snow unless you know it is stable." : "Very steep: frequent small slides; a slip here is hard to stop.";
    }
    function start() {
      $("lstop").innerHTML = "";
      sensor("level", 10 * 60000, "Level", function (e) {
        if (mode === "slope") { $("lv").textContent = Math.round(e.flat) + "°"; $("lrisk").textContent = risk(e.flat); }
        else if (mode === "height") {
          if (held) return;
          var ang = Math.abs(e.pitch), d = parseFloat($("hd").value) || 0, eye = parseFloat($("he").value) || 0;
          A.setSetting("hDist", d); A.setSetting("hEye", eye);
          $("lang").textContent = "Angle " + ang.toFixed(1) + "°";
          $("lv").textContent = ang > 85 ? "–" : (d * Math.tan(ang * Math.PI / 180) + eye).toFixed(1) + " m";
        } else {
          $("lp").textContent = e.pitch.toFixed(1) + "°"; $("lr").textContent = e.roll.toFixed(1) + "°";
          var x = Math.max(-1, Math.min(1, -e.roll / 15)), y = Math.max(-1, Math.min(1, e.pitch / 15));
          $("bub").style.transform = "translate(" + (x * 90).toFixed(0) + "px," + (y * 90).toFixed(0) + "px)";
          $("bub").className = "bubble" + (Math.abs(e.pitch) < 1 && Math.abs(e.roll) < 1 ? " ok" : "");
        }
      }, function (reason) { $("lstop").innerHTML = stopBanner(reason, "lagain"); $("lagain").onclick = start; });
    }
    start();
  }

  // ------------------------------------------------------------------ pace counter
  function viewPace(p, q, tab) {
    A.setChrome("Pace counter", { tab: tab });
    var per100 = A.settings.pace100 || 130;
    var st = A.load("pace", { steps: 0, manual: 0 });
    var h = phoneOnly("The step counter needs the phone. The manual counter works anywhere.");
    h += '<div class="big-stat"><span class="k">Distance walked</span><b id="pdist">–</b><span class="sub" id="psteps"></span></div>';
    h += '<div class="btn-row"><button class="btn primary" id="pstart">' + icon("play", "ic-sm") + 'Count steps</button><button class="btn" id="preset">' + icon("rotate-ccw", "ic-sm") + "Reset</button></div>";
    h += '<p class="small muted">Uses the phone\'s low-power hardware step counter while this screen is open. With the screen off, some phones keep counting and some don\'t: check the total when you look again, and use the manual counter as a backup.</p>';
    h += '<div class="section"><span class="label">Manual count</span><div class="manual"><button class="btn" id="mminus" aria-label="Minus 100 metres">−</button><b id="mval">' + st.manual + ' × 100 m</b><button class="btn primary" id="mplus" aria-label="Plus 100 metres">+100 m</button></div>' +
      '<p class="small muted">Count double paces (every time your left foot lands); tap +100 m each time you reach your number (typically 60–70 on a path).</p></div>';
    h += '<div class="section"><span class="label">Your steps per 100 m</span><div class="form"><input id="p100" type="number" inputmode="numeric" value="' + per100 + '" aria-label="Steps per 100 metres"></div>' +
      '<p class="small muted">Walk a measured 100 m (e.g. between fence posts on a map) and count every step. Typical: 120–140. More on rough ground, uphill or in the dark.</p></div>';
    h += '<div class="section"><span class="label">Naismith time to go</span><div class="form two-col"><div><label for="nkm">Distance (km)</label><input id="nkm" type="number" inputmode="decimal" value="' + (A.settings.nKm || 5) + '"></div><div><label for="nup">Climb (m)</label><input id="nup" type="number" inputmode="decimal" value="' + (A.settings.nUp || 300) + '"></div></div><p id="nout" class="calc-out"></p></div>';
    view.innerHTML = h;
    var base = null, live = 0, sens = null;
    function draw() {
      var steps = st.steps + live, m = steps / per100 * 100 + st.manual * 100;
      $("pdist").textContent = dist(m);
      $("psteps").textContent = (st.steps + live) + " steps" + (st.manual ? " + " + st.manual * 100 + " m counted by hand" : "");
      $("mval").textContent = st.manual + " × 100 m";
      var km = parseFloat($("nkm").value) || 0, up = parseFloat($("nup").value) || 0;
      A.setSetting("nKm", km); A.setSetting("nUp", up);
      var t = G.naismith(km, up);
      $("nout").innerHTML = "<b>" + dur(t * 60000) + "</b> by Naismith (5 km/h plus 1 min per 10 m of climb). Add 25–50% for rough ground, heavy loads, a tired group or darkness.";
    }
    function commit() { st.steps += live; live = 0; base = null; A.save("pace", st); }
    function start() {
      if (sens && sens.running()) return;
      sens = sensor("steps", 60 * 60000, "Steps", function (e) {
        if (base == null) base = e.total;
        live = Math.max(0, e.total - base);
        draw();
      }, function () { commit(); $("pstart").disabled = false; });
      $("pstart").disabled = sens.running();
    }
    A.onLeave(commit);
    $("pstart").onclick = start;
    $("preset").onclick = function () { if (!confirm("Reset the distance?")) return; st = { steps: 0, manual: 0 }; live = 0; base = null; A.save("pace", st); draw(); };
    $("mplus").onclick = function () { st.manual++; A.save("pace", st); draw(); };
    $("mminus").onclick = function () { st.manual = Math.max(0, st.manual - 1); A.save("pace", st); draw(); };
    $("p100").oninput = function () { per100 = Math.max(40, parseFloat($("p100").value) || 130); A.setSetting("pace100", per100); draw(); };
    $("nkm").oninput = draw; $("nup").oninput = draw;
    draw();
  }

  // ------------------------------------------------------------------ CPR metronome
  function viewCpr(p, q, tab) {
    A.setChrome("CPR metronome", { tab: tab });
    var mode = A.settings.cprMode || "30:2";
    var h = '<div class="banner">' + icon("heart-pulse") + '<span>Push hard and fast in the centre of the chest, 5–6 cm deep, 100–120 a minute. Full guide: <a href="#/a/cpr-adult">adults</a>, <a href="#/a/cpr-child">children and babies</a>.</span></div>';
    h += '<div class="seg two" role="group"><button data-mode="30:2" aria-pressed="' + (mode === "30:2") + '">30 : 2 with breaths</button><button data-mode="hands" aria-pressed="' + (mode === "hands") + '">Hands only</button></div>';
    h += '<div class="cpr"><div class="beat" id="beat"><b id="ccount">0</b><span id="clabel">compressions</span></div></div>';
    h += '<div class="facts2 center three"><span><span class="k">Time</span><b id="ctime">0:00</b></span><span><span class="k">Cycles</span><b id="ccyc">0</b></span><span><span class="k">Rate</span><b>110 / min</b></span></div>';
    h += '<button class="btn primary block big" id="cgo">' + icon("play") + 'Start metronome</button>';
    h += '<p class="small muted">The screen stays on while it runs. If someone can take over, swap every 2 minutes. Keep going until help arrives, they recover, or you are too exhausted to continue.</p>';
    view.innerHTML = h;
    var running = false, startAt = 0, cycles = 0, fallback = null;
    function pattern() {
      var p = [];
      for (var i = 0; i < 30; i++) p.push(60, 485);
      if (mode === "30:2") p[59] = 485 + 5000; // time for 2 rescue breaths
      return p;
    }
    function beat(index) {
      if (!running) return;
      var n = index + 1;
      if (n === 1 && index === 0 && Date.now() - startAt > 2000) cycles++;
      $("ccount").textContent = n;
      $("clabel").textContent = mode === "30:2" && n === 30 ? "now give 2 breaths" : "compressions";
      $("beat").className = "beat " + (n % 2 ? "a" : "b") + (mode === "30:2" && n === 30 ? " breaths" : "");
      $("ctime").textContent = mmss((Date.now() - startAt) / 1000);
      $("ccyc").textContent = cycles;
    }
    function stop() {
      if (!running) return;
      running = false;
      A.native("stopPattern", "sound");
      clearTimeout(fallback);
      A.native("keepScreenOn", false);
      $("cgo").innerHTML = icon("play") + "Start metronome";
      $("beat").className = "beat";
    }
    A.onLeave(stop);
    listen("signal-beat", function (d) { if (d.channel === "sound") beat(d.index); });
    listen("signal-stopped", function (d) { if (d.channel === "sound" && d.reason !== "replaced") stop(); });
    view.querySelectorAll("[data-mode]").forEach(function (b) {
      b.onclick = function () { mode = b.getAttribute("data-mode"); A.setSetting("cprMode", mode); view.querySelectorAll("[data-mode]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); if (running) { stop(); go(); } };
    });
    function go() {
      running = true; startAt = Date.now(); cycles = 0;
      A.native("keepScreenOn", true);
      $("cgo").innerHTML = icon("square") + "Stop";
      var pat = pattern();
      if (!A.native("startPattern", "sound", JSON.stringify(pat), true, 1100, false, 60 * 60000)) {
        // In a browser: visual beat only.
        var i = 0;
        (function loop() { if (!running) return; beat(i / 2 % 30); var ms = pat[i] + pat[i + 1]; i = (i + 2) % pat.length; fallback = setTimeout(loop, ms); })();
      }
    }
    $("cgo").onclick = function () { if (running) stop(); else go(); };
  }

  // ------------------------------------------------------------------ casualty log
  function viewCasualty(p, q, tab) {
    A.setChrome("Casualty log", { tab: tab });
    var log = A.load("casualty", { who: "", tq: null, obs: [] });
    var h = '<p class="lead">Write down what happened and what you see, with times. Hand it to whoever takes over. Guide: <a href="#/a/medicine-overview">monitoring a casualty</a>.</p>';
    h += '<div class="form"><label for="cwho">Casualty</label><input id="cwho" value="' + esc(log.who) + '" placeholder="Name or description, age, what happened"></div>';
    h += '<div id="tqbox"></div>';
    h += '<div class="section"><span class="label">Add an observation</span><div class="obs-grid">' +
      '<div><span class="k">Response (AVPU)</span><div class="seg four">' + ["Alert", "Voice", "Pain", "None"].map(function (x) { return '<button data-avpu="' + x + '">' + x + "</button>"; }).join("") + "</div></div>" +
      '<div class="form two-col"><div><label for="obr">Breaths / min</label><input id="obr" type="number" inputmode="numeric"></div><div><label for="opu">Pulse / min</label><input id="opu" type="number" inputmode="numeric"></div></div>' +
      '<div><span class="k">Skin</span><div class="seg four">' + ["Normal", "Pale", "Blue", "Hot"].map(function (x) { return '<button data-skin="' + x + '">' + x + "</button>"; }).join("") + "</div></div>" +
      '<div class="form"><label for="onote">Note</label><input id="onote" placeholder="e.g. complaining of pain in left leg, 7/10"></div>' +
      '<button class="btn primary block" id="oadd">' + icon("plus", "ic-sm") + "Add with the time now</button></div></div>";
    h += '<div class="section"><span class="label">Log</span><div id="obslist"></div><div class="btn-row"><button class="btn" id="cshow">Show as text</button><button class="btn danger" id="cclear">New casualty</button></div><pre class="report" id="ctext" hidden></pre></div>';
    view.innerHTML = h;
    var sel = { avpu: "", skin: "" };
    function saveLog() { A.save("casualty", log); }
    function drawTq() {
      $("tqbox").innerHTML = log.tq ? '<div class="tq on">' + icon("clock") + "<div><b>Tourniquet on at " + hhmm(new Date(log.tq)) + "</b><span>" + dur(Date.now() - log.tq) +
        ' ago. Do not loosen it. Tell whoever takes over.</span></div><button class="btn" id="tqclear" aria-label="Remove tourniquet time">' + icon("x", "ic-sm") + "</button></div>"
        : '<button class="btn danger block" id="tqset">' + icon("clock", "ic-sm") + "Tourniquet applied now</button>";
      if ($("tqset")) $("tqset").onclick = function () { log.tq = Date.now(); log.obs.unshift({ t: log.tq, text: "Tourniquet applied" }); saveLog(); drawTq(); drawObs(); };
      if ($("tqclear")) $("tqclear").onclick = function () { if (confirm("Clear the tourniquet time?")) { log.tq = null; saveLog(); drawTq(); } };
    }
    function drawObs() {
      $("obslist").innerHTML = log.obs.length ? '<ul class="obs">' + log.obs.map(function (o) {
        return "<li><b>" + hhmm(new Date(o.t)) + "</b><span>" + esc(o.text) + "</span></li>";
      }).join("") + "</ul>" : '<p class="muted small">No observations yet. Record every 10–15 minutes at first, then every hour if they are stable.</p>';
    }
    var refresh = setInterval(drawTq, 60000);
    A.onLeave(function () { clearInterval(refresh); });
    $("cwho").oninput = function () { log.who = $("cwho").value; saveLog(); };
    view.querySelectorAll("[data-avpu]").forEach(function (b) { b.onclick = function () { sel.avpu = b.getAttribute("data-avpu"); view.querySelectorAll("[data-avpu]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); }; });
    view.querySelectorAll("[data-skin]").forEach(function (b) { b.onclick = function () { sel.skin = b.getAttribute("data-skin"); view.querySelectorAll("[data-skin]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); }; });
    $("oadd").onclick = function () {
      var parts = [];
      if (sel.avpu) parts.push("Response: " + sel.avpu);
      if ($("obr").value) parts.push("Breathing " + $("obr").value + "/min");
      if ($("opu").value) parts.push("Pulse " + $("opu").value + "/min");
      if (sel.skin) parts.push("Skin: " + sel.skin);
      if ($("onote").value.trim()) parts.push($("onote").value.trim());
      if (!parts.length) return;
      log.obs.unshift({ t: Date.now(), text: parts.join(" · ") });
      saveLog();
      sel = { avpu: "", skin: "" };
      view.querySelectorAll("[data-avpu],[data-skin]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      $("obr").value = $("opu").value = $("onote").value = "";
      drawObs();
    };
    $("cshow").onclick = function () {
      var t = $("ctext");
      t.hidden = !t.hidden;
      t.textContent = "CASUALTY: " + (log.who || "-") + "\n" + (log.tq ? "TOURNIQUET ON AT " + hhmm(new Date(log.tq)) + " (" + new Date(log.tq).toLocaleDateString("en-GB") + ")\n" : "") +
        log.obs.slice().reverse().map(function (o) { return hhmm(new Date(o.t)) + "  " + o.text; }).join("\n");
    };
    $("cclear").onclick = function () { if (confirm("Start a new casualty log? The current one will be deleted.")) { log = { who: "", tq: null, obs: [] }; saveLog(); A.render(); } };
    drawTq(); drawObs();
  }

  // ------------------------------------------------------------------ boil timer
  function viewBoil(p, q, tab) {
    A.setChrome("Boil timer", { tab: tab });
    var h = '<p class="lead">Bring water to a full, rolling boil (big bubbles that keep coming when you stir), then keep it boiling for 1 minute. That kills bacteria, viruses and parasites. Guide: <a href="#/a/settle-strain-boil">settle, strain, boil</a>.</p>';
    h += '<div class="big-stat" id="bstat"><span class="k" id="bk">Ready</span><b id="bt">–</b><span class="sub" id="bs">Put the pot on, then press Start.</span></div>';
    h += '<button class="btn primary block big" id="bgo">' + icon("flame") + "Start heating</button>";
    h += '<p class="small muted">Typical time to the boil for 1 litre: 5–10 min on a good fire, longer in wind or with a big pot. Keep a lid on to save fuel. Boiling does not remove chemicals or salt: see <a href="#/a/boiling-limits">what boiling doesn\'t remove</a>.</p>';
    view.innerHTML = h;
    var state = "idle", t0 = 0, timer = null;
    function stop() { clearInterval(timer); timer = null; A.native("keepScreenOn", false); }
    A.onLeave(stop);
    function upd() {
      var s = (Date.now() - t0) / 1000;
      if (state === "heating") { $("bk").textContent = "Heating"; $("bt").textContent = mmss(s); $("bs").textContent = "Press when it reaches a rolling boil."; }
      if (state === "boiling") {
        var left = 60 - s;
        $("bk").textContent = "Keep it boiling"; $("bt").textContent = mmss(left); $("bs").textContent = "Don't let it drop off the boil.";
        if (left <= 0) {
          state = "done"; stop();
          $("bstat").className = "big-stat ok"; $("bk").textContent = "Done"; $("bt").textContent = "Safe";
          $("bs").textContent = "Let it cool with the lid on. Store it covered, in a clean container.";
          $("bgo").innerHTML = icon("rotate-ccw") + "Boil another";
          A.native("startPattern", "sound", JSON.stringify([300, 200, 300, 200, 300]), false, 1800, false, 5000);
        }
      }
    }
    $("bgo").onclick = function () {
      if (state === "idle" || state === "done") {
        state = "heating"; t0 = Date.now(); $("bstat").className = "big-stat";
        $("bgo").innerHTML = icon("flame") + "It's at a rolling boil";
        A.native("keepScreenOn", true);
        clearInterval(timer); timer = setInterval(upd, 500); upd();
      } else if (state === "heating") {
        state = "boiling"; t0 = Date.now();
        $("bgo").innerHTML = icon("square") + "Cancel";
        upd();
      } else {
        state = "idle"; stop(); $("bk").textContent = "Ready"; $("bt").textContent = "–"; $("bs").textContent = "Put the pot on, then press Start.";
        $("bgo").innerHTML = icon("flame") + "Start heating";
      }
    };
  }

  // ------------------------------------------------------------------ calculators
  var UNITS = {
    Length: [["m", 1], ["km", 1000], ["cm", 0.01], ["mile", 1609.344], ["yard", 0.9144], ["foot", 0.3048], ["inch", 0.0254]],
    Weight: [["kg", 1], ["g", 0.001], ["lb", 0.45359237], ["oz", 0.028349523], ["stone", 6.35029318]],
    Volume: [["litre", 1], ["ml", 0.001], ["UK pint", 0.56826125], ["UK gallon", 4.54609], ["US gallon", 3.785411784], ["US cup", 0.2365882]],
    Speed: [["km/h", 1], ["mph", 1.609344], ["knot", 1.852], ["m/s", 3.6]]
  };
  function viewCalc(p, q, tab) {
    A.setChrome("Calculators", { tab: tab });
    var m = q.m || "walk";
    var h = '<div class="chips calc-tabs" role="group">' + [["walk", "Walking time"], ["chill", "Wind chill"], ["water", "Water"], ["units", "Units"]].map(function (x) {
      return '<a class="chip" href="#/tool/calc?m=' + x[0] + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + "</a>";
    }).join("") + "</div>";
    var s = A.settings;
    if (m === "walk") {
      h += '<div class="form two-col"><div><label for="ckm">Distance (km)</label><input id="ckm" type="number" inputmode="decimal" value="' + (s.cKm || 8) + '"></div><div><label for="cup">Total climb (m)</label><input id="cup" type="number" inputmode="decimal" value="' + (s.cUp || 400) + '"></div></div>';
      h += '<div class="seg" role="group" aria-label="Conditions">' + [["1", "Good path"], ["1.25", "Rough / pack"], ["1.5", "Bad: night, snow"]].map(function (x) {
        return '<button data-f="' + x[0] + '" aria-pressed="' + ((s.cF || "1") === x[0]) + '">' + x[1] + "</button>";
      }).join("") + '</div><div class="calc-out" id="cout"></div>';
    } else if (m === "chill") {
      h += '<div class="form two-col"><div><label for="ct">Air temperature (°C)</label><input id="ct" type="number" inputmode="decimal" value="' + (s.cT != null ? s.cT : 2) + '"></div><div><label for="cw">Wind (mph)</label><input id="cw" type="number" inputmode="decimal" value="' + (s.cW || 20) + '"></div></div><div class="calc-out" id="cout"></div>';
    } else if (m === "water") {
      h += '<div class="form two-col"><div><label for="cwt">Temperature (°C)</label><input id="cwt" type="number" inputmode="decimal" value="' + (s.cWt || 15) + '"></div><div><label for="cwh">Hours active a day</label><input id="cwh" type="number" inputmode="decimal" value="' + (s.cWh || 6) + '"></div>' +
        '<div><label for="cwp">People</label><input id="cwp" type="number" inputmode="numeric" value="' + (s.cWp || 1) + '"></div><div><label for="cwd">Days</label><input id="cwd" type="number" inputmode="numeric" value="' + (s.cWd || 3) + '"></div></div>';
      h += '<div class="seg" role="group" aria-label="Effort">' + [["light", "Light"], ["moderate", "Moderate"], ["hard", "Hard"]].map(function (x) {
        return '<button data-e="' + x[0] + '" aria-pressed="' + ((s.cWe || "moderate") === x[0]) + '">' + x[1] + "</button>";
      }).join("") + '</div><div class="calc-out" id="cout"></div>';
    } else {
      var cat = s.uCat || "Length";
      h += '<div class="seg four" role="group">' + Object.keys(UNITS).map(function (k) { return '<button data-cat="' + k + '" aria-pressed="' + (cat === k) + '">' + k + "</button>"; }).join("") + "</div>";
      h += '<div class="form two-col"><div><label for="uv">Value</label><input id="uv" type="number" inputmode="decimal" value="' + (s.uV || 1) + '"></div><div><label for="uu">Unit</label><select id="uu">' +
        UNITS[cat].map(function (u) { return "<option" + (u[0] === s.uU ? " selected" : "") + ">" + u[0] + "</option>"; }).join("") + '</select></div></div><div class="calc-out" id="cout"></div>';
      h += '<div class="section"><span class="label">Temperature</span><div class="form two-col"><div><label for="tc">°C</label><input id="tc" type="number" inputmode="decimal" value="0"></div><div><label for="tf">°F</label><input id="tf" type="number" inputmode="decimal" value="32"></div></div></div>';
    }
    view.innerHTML = h;
    function num(id) { return parseFloat($(id).value) || 0; }
    function calc() {
      if (m === "walk") {
        var km = num("ckm"), up = num("cup"), f = parseFloat(A.settings.cF || "1");
        A.setSetting("cKm", km); A.setSetting("cUp", up);
        var mins = G.naismith(km, up) * f, arrive = new Date(Date.now() + mins * 60000);
        var pos = position(), t = G.sunTimes(new Date(), pos.lat, pos.lon);
        var late = t.sunset && arrive > t.sunset;
        $("cout").innerHTML = "<b>" + dur(mins * 60000) + "</b><span>Leave now, arrive about " + hhmm(arrive) + ". Sunset " + hhmm(t.sunset) + ".</span>" +
          (late ? '<span class="warn-text">' + icon("triangle-alert", "ic-sm") + "You would finish after sunset. Leave earlier, shorten the route, or plan a safe stop.</span>" : "") +
          '<span class="small muted">Naismith: 5 km/h, plus 1 min for every 10 m of climb. Add rests: 10 min an hour.</span>';
      } else if (m === "chill") {
        var tc = num("ct"), mph = num("cw"), kmh = mph * 1.609344;
        A.setSetting("cT", tc); A.setSetting("cW", mph);
        var wc = G.windChill(tc, kmh);
        $("cout").innerHTML = "<b>Feels like " + Math.round(wc) + " °C</b><span>" + (wc <= -27 ? "Frostbite possible on exposed skin within 30 minutes." : wc <= -10 ? "Very cold: cover all skin, watch for frostnip." : wc <= 0 ? "Cold: hat, gloves and windproof layer." : "Cool: wind still strips heat, especially when wet.") +
          '</span><span class="small muted">Met Office / JAG-TI formula; valid at 10 °C or below with wind over 3 mph. Being wet makes it far worse.</span>';
      } else if (m === "water") {
        var l = G.waterNeed(num("cwt"), num("cwh"), A.settings.cWe || "moderate"), ppl = Math.max(1, num("cwp")), days = Math.max(1, num("cwd"));
        A.setSetting("cWt", num("cwt")); A.setSetting("cWh", num("cwh")); A.setSetting("cWp", ppl); A.setSetting("cWd", days);
        $("cout").innerHTML = "<b>" + l + " litres per person a day</b><span>" + (l * ppl).toFixed(1) + " L a day for " + ppl + (ppl > 1 ? " people" : " person") + "; " + Math.ceil(l * ppl * days) + " L for " + days + " days.</span>" +
          '<span class="small muted">Rough guide: drink enough that your urine is pale. Add more for illness, diarrhoea or altitude. Never ration water you have; ration sweat instead.</span>';
      } else {
        var cat = A.settings.uCat || "Length", v = num("uv"), uname = $("uu").value;
        A.setSetting("uV", v); A.setSetting("uU", uname);
        var base = v * UNITS[cat].filter(function (u) { return u[0] === uname; })[0][1];
        $("cout").innerHTML = '<ul class="conv">' + UNITS[cat].filter(function (u) { return u[0] !== uname; }).map(function (u) {
          var x = base / u[1];
          return "<li><b>" + (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(3)) + "</b> " + u[0] + "</li>";
        }).join("") + "</ul>";
      }
    }
    view.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", function () { if (i.id !== "tc" && i.id !== "tf") calc(); }); });
    view.querySelectorAll("select").forEach(function (i) { i.addEventListener("change", calc); });
    view.querySelectorAll("[data-f]").forEach(function (b) { b.onclick = function () { A.setSetting("cF", b.getAttribute("data-f")); view.querySelectorAll("[data-f]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); calc(); }; });
    view.querySelectorAll("[data-e]").forEach(function (b) { b.onclick = function () { A.setSetting("cWe", b.getAttribute("data-e")); view.querySelectorAll("[data-e]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); calc(); }; });
    view.querySelectorAll("[data-cat]").forEach(function (b) { b.onclick = function () { A.setSetting("uCat", b.getAttribute("data-cat")); A.setSetting("uU", null); A.render(); }; });
    if ($("tc")) {
      $("tc").oninput = function () { $("tf").value = (num("tc") * 9 / 5 + 32).toFixed(1); };
      $("tf").oninput = function () { $("tc").value = ((num("tf") - 32) * 5 / 9).toFixed(1); };
    }
    calc();
  }

  // ------------------------------------------------------------------ field notebook
  var DAILY = ["Water collected and boiled for the day", "Firewood gathered (three times what you think) and kept dry", "Shelter checked and repaired",
    "Signal kit ready and visible (bright cloth, fire materials)", "Eaten something, little and often", "Feet checked, dried and socks changed",
    "Hands washed before food; latrine away from water", "Notes written: date, plan, what changed", "Phone switched off and kept warm"];
  function viewNotebook(p, q, tab) {
    A.setChrome("Notebook", { tab: tab });
    var m = q.m || "notes";
    var h = '<div class="seg" role="group">' + [["notes", "Notes"], ["incidents", "Incident log"], ["daily", "Daily checks"]].map(function (x) {
      return '<a class="segb" href="#/tool/notebook?m=' + x[0] + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + "</a>";
    }).join("") + "</div>";
    if (m === "daily") {
      var today = new Date().toDateString(), d = A.load("daily", {});
      if (d.date !== today) d = { date: today, ticks: {} };
      h += '<p class="lead">' + new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + '. A routine keeps you safe and sane. Guide: <a href="#/a/daily-routine">the daily routine</a>.</p>';
      h += '<ul class="check-list daily">' + DAILY.map(function (t, i) {
        return '<li><label><input type="checkbox" data-i="' + i + '"' + (d.ticks[i] ? " checked" : "") + "><span>" + esc(t) + "</span></label></li>";
      }).join("") + "</ul>";
      h += '<p><a class="btn" href="#/a/kit-checklist">' + icon("list-checks", "ic-sm") + "Kit checklist</a></p>";
      view.innerHTML = h;
      view.querySelectorAll("[data-i]").forEach(function (cb) {
        cb.onchange = function () { d.ticks[cb.getAttribute("data-i")] = cb.checked ? 1 : 0; A.save("daily", d); };
      });
      return;
    }
    var key = m === "incidents" ? "incidents" : "notes";
    var f = lastFix();
    h += '<div class="form"><label for="ntext">' + (m === "incidents" ? "What happened" : "New note") + '</label><textarea id="ntext" rows="4" placeholder="' + (m === "incidents" ? "e.g. Ankle injury on descent, splinted, moving slowly to the bothy" : "e.g. Decided to stay put until morning; water from the stream 50 m south") + '"></textarea></div>';
    h += '<label class="switch"><span>Attach my last GPS position' + (f ? " (" + ageText(f.time) + ")" : " (none yet)") + '</span><input type="checkbox" id="ngps"' + (f ? " checked" : " disabled") + "></label>";
    h += '<button class="btn primary block" id="nadd">' + icon("plus", "ic-sm") + "Save with the time now</button>";
    h += '<div class="section"><span class="label">' + (m === "incidents" ? "Incident log" : "Notes") + '</span><div id="nlist"></div></div>';
    view.innerHTML = h;
    function draw() {
      var items = A.load(key, []);
      $("nlist").innerHTML = items.length ? '<ul class="obs">' + items.map(function (it, i) {
        var dt = new Date(it.t);
        return "<li><b>" + hhmm(dt) + '<span class="d">' + dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + "</span></b><span>" + esc(it.text).replace(/\n/g, "<br>") +
          (it.grid ? '<span class="grid-tag">' + icon("map-pin", "ic-sm") + esc(it.grid) + "</span>" : "") + '</span><button class="icon-btn" data-del="' + i + '" aria-label="Delete">' + icon("x") + "</button></li>";
      }).join("") + "</ul>" : '<p class="muted small">Nothing yet. Notes stay on this phone only.</p>';
      view.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () { if (!confirm("Delete this entry?")) return; var it = A.load(key, []); it.splice(+b.getAttribute("data-del"), 1); A.save(key, it); draw(); };
      });
    }
    $("nadd").onclick = function () {
      var text = $("ntext").value.trim();
      if (!text) return;
      var it = { t: Date.now(), text: text };
      if ($("ngps").checked && f) { var g = G.toOSGB(f.lat, f.lon); it.grid = g ? G.gridRef(g, 8) : f.lat.toFixed(5) + ", " + f.lon.toFixed(5); }
      var items = A.load(key, []);
      items.unshift(it);
      A.save(key, items);
      $("ntext").value = "";
      draw();
    };
    draw();
  }

  // ------------------------------------------------------------------ battery and power
  function viewBattery(p, q, tab) {
    A.setChrome("Battery", { tab: tab });
    var st = A.nativeState();
    var h = "";
    if (st && st.battery >= 0) {
      var bright = st.brightness >= 0 ? st.brightness : (st.systemBrightness >= 0 ? st.systemBrightness : 0.4);
      // A 10-minute session: LCD backlight + processor while reading, plus switching on and off (~15 mAh).
      var sessionMah = (110 + 330 * bright) / 6 + 15;
      var sessions = Math.floor(capacityMah(st) * 0.9 / sessionMah);
      h += '<div class="big-stat' + (st.battery < 20 ? " warn" : "") + '"><span class="k">Battery</span><b>' + st.battery + "%</b><span class=\"sub\">" + (st.charging ? "Charging" : "Not charging") +
        (st.batteryTempC != null ? " · " + st.batteryTempC + " °C" : "") + "</span></div>";
      h += '<div class="big-stat"><span class="k">Estimate</span><b>About ' + sessions + " sessions</b><span class=\"sub\">of 10 minutes each at today's brightness (" + Math.round(bright * 100) + "%), switching the phone off in between. Lower the brightness to get more.</span></div>";
    } else {
      h += phoneOnly("Battery details are shown in the app on the phone.");
    }
    h += '<div class="section"><span class="label">Make it last</span><ul class="tips">' +
      "<li><b>Power off between uses.</b> Hold the power button → Power off. A phone left on standby drains in days; switched off it keeps its charge for weeks.</li>" +
      "<li><b>Keep it warm.</b> Below about 5 °C the battery can appear empty. Keep it in an inside pocket and warm it before use.</li>" +
      "<li><b>Dim the screen.</b> The screen is the biggest drain. Use the brightness slider in Settings; Night red at low brightness is the cheapest to read.</li>" +
      "<li><b>Map and GPS cost more.</b> The map draws with the graphics chip, roughly 2–3 times the drain of reading a guide, and GPS adds more. Get a fix, note your grid reference, then close the map.</li>" +
      "<li><b>Signals cost the most.</b> Torch, loud beeps and a flashing screen drain fast: check the estimate on the Signal screen.</li>" +
      "<li><b>Store it at about 50%.</b> For months on a shelf, charge to around half and switch off. Top up every few months.</li></ul></div>";
    h += '<div class="section"><span class="label">Solar charging</span><p>Your 20 W panel can fill this phone in a few hours of good sun, much longer in cloud. Angle it straight at the sun, keep it cool, and charge the phone switched off. Guide: <a href="#/a/solar-panel">your solar panel</a>, <a href="#/a/batteries-electronics">keeping electronics alive</a>.</p></div>';
    h += '<p><a class="btn" href="#/poweroff">' + icon("power", "ic-sm") + 'Before you power off</a> <a class="btn" href="#" id="bsys">' + icon("settings", "ic-sm") + "Phone's battery settings</a></p>";
    view.innerHTML = h;
    $("bsys").onclick = function (e) { e.preventDefault(); if (!A.native("launchTool", "battery")) alert("Only on the phone."); };
  }

  // ------------------------------------------------------------------ phone mode (also the hidden long-press menu)
  function viewPhoneMode(p, q, tab, token, hidden) {
    A.setChrome("Phone mode", { tab: tab });
    var s = A.nativeJson("phoneModeStatus") || { owner: false, mode: "none", pinned: false, home: "none" };
    var homeName = { guide: "This guide", samsung: "Samsung home screen", ask: "Asks each time", none: "None" }[s.home] || s.home;
    var h = '<h1 class="page">Phone mode</h1>';
    h += '<div class="status-grid"><span>Owner permission</span><b>' + (s.owner ? "Yes" : "No") + "</b><span>Mode</span><b>" + (s.mode === "survival" ? "Survival" : s.mode === "normal" ? "Normal phone" : "–") +
      "</b><span>Pinned</span><b>" + (s.pinned ? "Yes" : "No") + (s.suspended ? " (paused until restart)" : "") + "</b><span>Home button opens</span><b>" + esc(homeName) + "</b></div>";
    if (!A.NATIVE) h += phoneOnly("Phone mode is controlled from the app on the phone.");
    else if (!s.owner) h += '<div class="banner warn">' + icon("triangle-alert") + '<span>The guide is not the "device owner", so it can\'t change the phone\'s mode. To set that up again you need a PC with adb: <code>' + esc(s.restoreCommand || "") + "</code>. It only works on a phone with no accounts.</span></div>";
    h += '<div class="mode-cards">';
    h += '<button class="mode-card' + (s.mode === "survival" ? " on" : "") + '" data-mode="survival"' + (s.owner ? "" : " disabled") + ">" + A.iconTile("shield", "grp-urgent") +
      "<span><b>Survival mode</b><span>The guide is the home screen and stays pinned. The phone does nothing else, so the battery lasts. FM radio, camera, calculator, clock and settings still open from Tools.</span></span></button>";
    h += '<button class="mode-card' + (s.mode === "normal" ? " on" : "") + '" data-mode="normal"' + (s.owner ? "" : " disabled") + ">" + A.iconTile("smartphone", "grp-reference") +
      "<span><b>Normal phone</b><span>Samsung's home screen comes back and you can use other apps. The guide stays installed as a normal app. Switching back is one tap here.</span></span></button>";
    h += "</div>";
    h += '<p class="small muted">Your choice is saved and applied again every time the phone starts.</p>';
    h += '<div id="pmmsg"></div>';
    h += '<div class="section"><span class="label">Bring back removed apps</span><p>Puts back every built-in app that was removed from this phone: Google Play, YouTube, Samsung apps, messages, contacts and so on. They use more battery and some need the internet.</p>' +
      '<button class="btn block" id="restore"' + (s.owner ? "" : " disabled") + ">" + icon("rotate-ccw", "ic-sm") + 'Restore all phone apps</button><div id="restout"></div></div>';
    h += '<div class="section"><span class="label">Advanced</span>';
    if (hidden) h += '<button class="btn block" id="unpin">Unpin until restart and open phone Settings</button>';
    h += '<button class="btn danger block" id="rmowner"' + (s.owner ? "" : " disabled") + ">Remove owner permission</button>" +
      '<p class="small muted">Only needed before selling or factory-resetting the phone. After this, the guide can\'t switch modes. Getting survival mode back needs a PC with adb and this command:<br><code>' + esc(s.restoreCommand || "adb shell dpm set-device-owner uk.theseus.survival/.KioskAdminReceiver") + "</code></p></div>";
    view.innerHTML = h;
    view.querySelectorAll("[data-mode]").forEach(function (b) {
      b.onclick = function () {
        var mode = b.getAttribute("data-mode");
        if (mode === s.mode) return;
        if (mode === "normal" && !confirm("Switch to a normal phone? Samsung's home screen comes back and the guide is no longer pinned.")) return;
        var r = A.native("setPhoneMode", mode);
        if (r === "no-other-home") {
          $("pmmsg").innerHTML = '<div class="banner warn">' + icon("triangle-alert") + "<span>There's no other home screen on this phone, so it can't switch to normal mode. Samsung's launcher " +
            (s.samsungLauncher === "disabled" ? "is disabled: run <code>adb shell pm enable com.sec.android.app.launcher</code> from a PC." : "is missing: try <b>Restore all phone apps</b> first.") + "</span></div>";
          return;
        }
        if (r !== "ok") { $("pmmsg").innerHTML = '<div class="banner warn">' + icon("triangle-alert") + "<span>That didn't work (" + esc(r || "error") + ").</span></div>"; return; }
        A.render();
      };
    });
    $("restore").onclick = function () {
      if (!confirm("Restore all the phone's removed apps? This brings back Google Play, YouTube, Samsung apps and others. They use more battery.")) return;
      $("restore").disabled = true;
      $("restout").innerHTML = '<p class="small">Starting…</p>';
      A.native("restoreAllApps");
    };
    listen("restore-progress", function (d) { $("restout").innerHTML = '<p class="small">Restoring ' + d.done + " of " + d.total + "… <code>" + esc(d.pkg) + "</code></p>"; });
    listen("restore-done", function (d) {
      $("restore").disabled = false;
      $("restout").innerHTML = d.ok ? '<div class="banner info">' + icon("check") + "<span>" + (d.total ? "Restored " + d.restored + " of " + d.total + " apps." + (d.failed && d.failed.length ? " " + d.failed.length + " couldn't be restored." : "") : "Nothing to restore: all built-in apps are already installed.") + "</span></div>"
        : '<div class="banner warn">' + icon("triangle-alert") + "<span>Couldn't restore apps (" + esc(d.error || "") + ").</span></div>";
    });
    if ($("unpin")) $("unpin").onclick = function () { if (confirm("Unpin the guide and open the phone's Settings? The pin comes back after a restart.")) A.native("exitKiosk"); };
    $("rmowner").onclick = function () {
      if (!confirm("Remove the guide's owner permission? Only do this before selling or factory-resetting the phone.")) return;
      if (!confirm("Are you sure? Getting survival mode back needs a PC with adb.")) return;
      var ok = A.native("removeDeviceOwner");
      alert(ok ? "Owner permission removed. The guide is now an ordinary app." : "Couldn't remove owner permission.");
      A.render();
    };
  }

  function viewTorch(p, q, tab) {
    A.setChrome("Torch", { tab: tab });
    var st = A.nativeState(), on = !!(st && st.torch);
    view.innerHTML = phoneOnly() + '<button class="torch-big' + (on ? " on" : "") + '" id="tb">' + icon("flashlight") + "<b>" + (on ? "Torch on" : "Torch off") + "</b><span>Tap to switch</span></button>" +
      '<p class="small muted center">The torch stays on until you switch it off. For distress signals use <a href="#/tool/signal">Signal</a>.</p>';
    $("tb").onclick = function () { A.native("setTorch", !on); A.render(); };
  }

  // ------------------------------------------------------------------ map (loaded on demand)
  A.route("map", function (p, q, tab, token) {
    A.setChrome("Map", { tab: tab });
    view.innerHTML = '<p class="muted" id="loading">Loading the map…</p>';
    A.loadCss("lib/maplibre-gl.css");
    return Promise.all([A.loadScript("lib/maplibre-gl.js"), A.loadScript("lib/pmtiles.js")])
      .then(function () { return A.loadScript("map.js"); })
      .then(function () { if (A.isCurrent(token)) return window.MapView.open(q, tab, token); })
      .catch(function (e) { view.innerHTML = '<p class="empty">The map could not be loaded (' + esc(e.message) + ").</p>"; });
  });

  // ------------------------------------------------------------------ routes
  var TOOLS = { compass: viewCompass, gps: viewGps, sun: viewSun, signal: viewSignal, morse: viewMorse, level: viewLevel, pace: viewPace,
    cpr: viewCpr, casualty: viewCasualty, boil: viewBoil, calc: viewCalc, notebook: viewNotebook, battery: viewBattery,
    "phone-mode": viewPhoneMode, torch: viewTorch };
  A.route("tools", viewTools);
  A.route("tool", function (p, q, tab, token) {
    if (p[1] === "map") { location.replace("#/map"); return; }
    var f = TOOLS[p[1]];
    if (!f) { A.setChrome("Not found", { tab: tab }); view.innerHTML = '<p class="empty">That tool is not in this guide.</p>'; return; }
    return f(p, q, tab, token);
  });
  A.route("kiosk", function (p, q, tab, token) { return viewPhoneMode(p, q, tab, token, true); });
  // Shared with map.js.
  A.tools = { waypoints: waypoints, addWaypoint: addWaypoint, lastFix: lastFix, fillReport: fillReport, sensor: sensor, listen: listen,
    dist: dist, deg3: deg3, dur: dur, hhmm: hhmm, decl: decl, position: position, cardinal: cardinal, declText: declText };
})();
