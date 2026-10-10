/* Survival Guide web UI. Vanilla JS, no frameworks, no network.
 *
 * Routes (hash based so the WebView back button and history work):
 *   tabs:   #/  #/search?q=  #/species?g=&st=&q=  #/saved  #/tools
 *   guide:  #/g/<group>  #/c/<category>  #/a/<article>  #/s/<species>  #/f/<flow>/<node>
 *   extra:  #/cards  #/season?m=  #/report  #/settings  #/credits  #/about  #/kiosk  #/poweroff
 *   tools:  #/tool/<id> and #/map (registered by tools.js)
 *
 * Timers only ever run while a tool that needs them is on screen (metronome, boil timer, beacons).
 * This device has no SIM card and cannot call or text anyone; nothing here may suggest otherwise.
 */
(function () {
  "use strict";

  var IDX = window.GUIDE_INDEX;
  var ART = IDX.articles, SPP = IDX.species, CATS = IDX.categories, FLOWS = IDX.flows_meta || {};
  var GROUPS = {};
  IDX.groups.forEach(function (g) { GROUPS[g.id] = g; });
  var NATIVE = typeof window.Android !== "undefined";
  var view = document.getElementById("view");
  var titleEl = document.getElementById("title");
  var barEl = document.getElementById("bar");
  var backBtn = document.getElementById("back");
  var saveBtn = document.getElementById("save");
  var battEl = document.getElementById("batt");
  var powerBtn = document.getElementById("power");
  var sensorEl = document.getElementById("sensor");

  // icons: arrow-left bookmark house search leaf wrench x chevron-left chevron-right power
  // icons: skull triangle-alert check heart shield circle-alert info lightbulb scale list-checks list-ordered
  // icons: flashlight radio camera calculator alarm-clock battery-medium settings map-pin sliders-horizontal
  // icons: images calendar trees paw-print mushroom sprout megaphone image-off brain clock gauge book-open
  // icons: volume-2 square package arrow-up-right rotate-ccw flag satellite list-tree star calendar-range
  var STATUS_LABEL = {
    deadly: "Deadly", poisonous: "Poisonous", venomous: "Venomous", psychoactive: "Psychoactive", caution: "Caution",
    invasive: "Invasive", edible: "Edible", medicinal: "Medicinal", protected: "Protected", info: "Useful"
  };
  var STATUS_ICON = { deadly: "skull", poisonous: "triangle-alert", venomous: "triangle-alert", caution: "circle-alert",
    edible: "check", medicinal: "heart", protected: "shield", psychoactive: "brain" };
  var GROUP_ICON = { plant: "sprout", fungus: "mushroom", animal: "paw-print" };
  var GROUP_LABEL = { plant: "Plants", fungus: "Fungi", animal: "Animals" };
  var TYPE_LABEL = { plant: "Plant", fungus: "Fungus", animal: "Animal" };
  var LEVEL_LABEL = { easy: "Easy", moderate: "Moderate", hard: "Hard" };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var CALLOUT_ICON = { quick: "list-ordered", danger: "triangle-alert", warn: "triangle-alert", note: "info",
    tip: "lightbulb", law: "scale", checklist: "list-checks" };

  // ------------------------------------------------------------------ icons (inline sprite)
  (function () {
    var out = ['<svg id="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'];
    Object.keys(window.ICONS || {}).forEach(function (n) {
      out.push('<symbol id="i-' + n + '" viewBox="0 0 24 24">' + window.ICONS[n] + "</symbol>");
    });
    out.push("</svg>");
    document.body.insertAdjacentHTML("afterbegin", out.join(""));
  })();
  function icon(name, cls) {
    return '<svg class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  function iconTile(name, catClass, extra) {
    return '<span class="ic-tile ' + (catClass || "") + (extra ? " " + extra : "") + '">' + icon(name) + "</span>";
  }

  // ------------------------------------------------------------------ storage
  function load(key, dflt) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or disabled */ }
  }
  var settings = load("settings", {});
  function setSetting(k, v) { settings[k] = v; save("settings", settings); }

  function isFav(key) { return load("favs", []).indexOf(key) >= 0; }
  function toggleFav(key) {
    var f = load("favs", []), i = f.indexOf(key);
    if (i >= 0) f.splice(i, 1); else f.unshift(key);
    save("favs", f);
    return i < 0;
  }
  function addRecent(key) {
    var r = load("recent", []).filter(function (k) { return k !== key; });
    r.unshift(key);
    save("recent", r.slice(0, 30));
  }

  // ------------------------------------------------------------------ native bridge
  function native(fn) {
    if (!NATIVE || typeof window.Android[fn] !== "function") return null;
    try { return window.Android[fn].apply(window.Android, Array.prototype.slice.call(arguments, 1)); } catch (e) { return null; }
  }
  function nativeJson(fn) {
    var s = native.apply(null, arguments);
    try { return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function nativeState() { return nativeJson("getState"); }
  // Events from the app: window.__native(event, data). Tools subscribe while their screen is open.
  var listeners = {};
  function onNative(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function offNative(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); }
  window.__native = function (ev, data) {
    (listeners[ev] || []).slice().forEach(function (fn) { try { fn(data || {}); } catch (e) { if (window.console) console.warn(e); } });
  };

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pill(s) {
    return '<span class="pill ' + s + '">' + (STATUS_ICON[s] ? icon(STATUS_ICON[s]) : "") + STATUS_LABEL[s] + "</span>";
  }
  function pills(st, max) {
    return '<span class="pills">' + st.slice(0, max || st.length).map(pill).join("") + "</span>";
  }
  function lowPower() { return !!settings.lowPower; }
  function thumbSrc(im) { return "img/t/" + im[0]; }
  function fullSrc(im) { return "img/" + im[0]; }
  function isDeadly(s) { return s.status.indexOf("deadly") >= 0; }
  function grpClass(catId) { var c = CATS[catId]; return c ? "grp-" + c.group : ""; }

  function articleVisual(a) {
    // A relevant photo where the article has one (e.g. lookalike comparisons), otherwise its own icon.
    var im = (a.images && a.images[0]) || (a.compare && SPP[a.compare[0]] && SPP[a.compare[0]].images[0]);
    if (im && !lowPower()) return '<img class="thumb" loading="lazy" decoding="async" alt="" src="' + thumbSrc(im) + '">';
    return iconTile(a.icon || CATS[a.cat].icon, grpClass(a.cat));
  }
  function speciesVisual(s) {
    if (s.images.length && !lowPower()) return '<img class="thumb" loading="lazy" decoding="async" alt="" src="' + thumbSrc(s.images[0]) + '">';
    return iconTile(GROUP_ICON[s.group], "g-" + s.group);
  }
  function itemFromKey(key) {
    var kind = key.charAt(0), id = key.slice(2);
    if (kind === "a" && ART[id]) return { kind: "a", id: id, item: ART[id] };
    if (kind === "s" && SPP[id]) return { kind: "s", id: id, item: SPP[id] };
    if (kind === "f" && FLOWS[id]) return { kind: "f", id: id, item: FLOWS[id] };
    return null;
  }
  function rowHtml(key, note) {
    var r = itemFromKey(key);
    if (!r) return "";
    if (r.kind === "a") {
      var a = r.item;
      return '<li><a class="row" href="#/a/' + a.id + '">' + articleVisual(a) +
        '<span class="txt"><span class="t">' + esc(a.title) + '</span><span class="s">' + esc(a.summary) + "</span>" +
        (note ? '<span class="xref">' + icon("arrow-up-right", "ic-sm") + esc(note) + "</span>" : "") + "</span>" +
        icon("chevron-right", "chev") + "</a></li>";
    }
    if (r.kind === "f") {
      var f = r.item;
      return '<li><a class="row" href="#/f/' + f.id + '">' + iconTile(f.icon, "grp-urgent") +
        '<span class="txt"><span class="t">' + esc(f.title) + '</span><span class="s">Step by step · ' + esc(f.summary) + "</span></span>" +
        icon("chevron-right", "chev") + "</a></li>";
    }
    var s = r.item;
    return '<li><a class="row" href="#/s/' + s.id + '">' + speciesVisual(s) +
      '<span class="txt"><span class="t">' + esc(s.name) + '</span><span class="s"><i>' + esc(s.latin) + "</i></span>" +
      pills(s.status, 3) + "</span>" + icon("chevron-right", "chev") + "</a></li>";
  }
  function speciesCard(id) {
    var s = SPP[id];
    if (!s) return "";
    var ph = s.images.length && !lowPower()
      ? '<img loading="lazy" decoding="async" alt="" src="' + thumbSrc(s.images[0]) + '">'
      : '<span class="noimg g-' + s.group + '">' + icon(GROUP_ICON[s.group]) + "</span>";
    // The most severe status, plus the psychoactive badge when it isn't already the first.
    var top = [s.status[0]];
    if (s.status.indexOf("psychoactive") > 0) top.push("psychoactive");
    return '<a class="scard' + (isDeadly(s) ? " deadly" : "") + '" href="#/s/' + id + '"><span class="ph">' + ph +
      '<span class="pills ph-pills">' + top.map(pill).join("") + "</span></span>" +
      '<span class="meta"><b>' + esc(s.name) + "</b><i>" + esc(s.latin) + "</i></span></a>";
  }

  // Load a JS payload once (bodies, search index, credits, map libraries).
  var scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise(function (resolve, reject) {
        var el = document.createElement("script");
        el.src = src;
        el.onload = resolve;
        el.onerror = function () { delete scriptCache[src]; reject(new Error("missing " + src)); };
        document.head.appendChild(el);
      });
    }
    return scriptCache[src];
  }
  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  }
  var BODIES = {};
  window.__body = function (key, html) { BODIES[key] = html; };
  function loadBody(key) {
    if (BODIES[key]) return Promise.resolve(BODIES[key]);
    return loadScript("content/" + key + ".js").then(function () { return BODIES[key]; });
  }
  function loadCredits() {
    return loadScript("content/credits.js").then(function () { return window.GUIDE_CREDITS || {}; });
  }

  // ------------------------------------------------------------------ router
  var ROOTS = { "": "home", search: "search", species: "species", saved: "saved", tools: "tools" };
  var TAB_OF = { g: "home", c: "home", a: "home", f: "home", cards: "home", season: "species", s: "species",
    favs: "saved", recent: "saved", report: "tools", settings: "tools", credits: "tools", about: "tools",
    kiosk: "tools", tool: "tools", map: "tools", poweroff: "home" };
  var ROUTES = {}; // extra routes registered by tools.js: head -> fn(parts, query, tab, token)
  var scrollPos = {};
  var currentHash = null;
  var renderToken = 0;
  var leaveFn = null; // called when the current screen is left (stops sensors, timers, speech)

  function parseRoute() {
    var h = location.hash.replace(/^#/, "") || "/";
    var q = {};
    var qi = h.indexOf("?");
    if (qi >= 0) {
      h.slice(qi + 1).split("&").forEach(function (p) {
        var kv = p.split("=");
        if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
      });
      h = h.slice(0, qi);
    }
    return { parts: h.split("/").filter(Boolean), q: q };
  }

  function setChrome(title, opts) {
    opts = opts || {};
    titleEl.textContent = title;
    backBtn.hidden = !!opts.root;
    barEl.className = opts.root ? "root" : "";
    saveBtn.hidden = !opts.saveKey;
    if (opts.saveKey) {
      var on = isFav(opts.saveKey);
      saveBtn.setAttribute("aria-pressed", on);
      saveBtn.setAttribute("aria-label", on ? "Saved" : "Save");
      saveBtn.onclick = function () {
        var now = toggleFav(opts.saveKey);
        saveBtn.setAttribute("aria-pressed", now);
        saveBtn.setAttribute("aria-label", now ? "Saved" : "Save");
      };
    }
    powerBtn.hidden = !opts.power;
    battEl.hidden = true;
    if (opts.battery) {
      var st = nativeState();
      if (st && st.battery >= 0) {
        battEl.innerHTML = icon("battery-medium", "ic-sm") + st.battery + "%";
        battEl.hidden = false;
      }
    }
    var tab = opts.tab;
    document.querySelectorAll("#nav a").forEach(function (a) {
      if (a.getAttribute("data-tab") === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  /** The small "sensor active" indicator in the header; label null hides it. */
  function sensorChip(label) {
    sensorEl.hidden = !label;
    if (label) sensorEl.innerHTML = '<span class="live"></span>' + esc(label);
  }

  function leave() {
    var f = leaveFn;
    leaveFn = null;
    if (f) { try { f(); } catch (e) { if (window.console) console.warn(e); } }
    sensorChip(null);
    native("ttsStop");
  }

  function render() {
    if (currentHash !== null) scrollPos[currentHash] = window.scrollY;
    leave();
    currentHash = location.hash || "#/";
    var r = parseRoute(), p = r.parts, token = ++renderToken;
    var head = p[0] || "";
    var tab = ROOTS[head] !== undefined ? ROOTS[head] : (TAB_OF[head] || "home");
    var done = function () {
      if (token !== renderToken) return;
      window.scrollTo(0, scrollPos[currentHash] || 0);
    };
    var out;
    if (ROUTES[head]) {
      out = ROUTES[head](p, r.q, tab, token);
    } else {
      switch (head) {
        case "": out = viewHome(tab); break;
        case "search": viewSearch(r.q, tab); break;
        case "species": out = viewBrowser(r.q, tab); break;
        case "saved": case "favs": case "recent": out = viewSaved(tab); break;
        case "g": out = viewGroup(p[1], tab); break;
        case "c": out = viewCategory(p[1], tab); break;
        case "a": out = viewArticle(p[1], token, tab); break;
        case "s": out = viewSpecies(p[1], token, tab); break;
        case "f": out = viewFlow(p[1], p[2], token, tab); break;
        case "cards": out = viewCards(token, tab); break;
        case "season": out = viewSeason(r.q, tab); break;
        case "report": out = viewReport(tab); break;
        case "settings": out = viewSettings(tab); break;
        case "credits": out = viewCredits(token, tab); break;
        case "about": out = viewAbout(tab); break;
        case "poweroff": out = viewPowerOff(tab); break;
        default: out = notFound();
      }
    }
    if (out && out.then) out.then(done); else done();
  }

  function notFound() {
    setChrome("Not found", { tab: "home" });
    view.innerHTML = '<p class="empty">That page is not in this guide.</p><p><a class="btn" href="#/">Go to the home screen</a></p>';
  }

  // ------------------------------------------------------------------ home
  function urgentTile(u) {
    var kind = u.to.charAt(0), id = u.to.slice(2);
    var href = kind === "a" ? "#/a/" + id : kind === "f" ? "#/f/" + id : "#/c/" + id;
    return '<a class="utile" href="' + href + '">' + icon(u.icon) + "<span><b>" + esc(u.title) + '</b><span class="sub">' + esc(u.sub) + "</span></span></a>";
  }
  function inSeason(s, m) {
    return (s.harvest || []).filter(function (h) { return h[1] <= h[2] ? (m >= h[1] && m <= h[2]) : (m >= h[1] || m <= h[2]); });
  }
  function viewHome(tab) {
    setChrome("Survival Guide", { root: true, tab: tab, battery: true, power: true });
    var recent = load("recent", []).filter(itemFromKey);
    var h = "";
    h += '<a class="searchbox" href="#/search" data-search>' + icon("search") + '<span class="ph-text">Search guides and species</span></a>';
    h += '<div class="section first"><span class="label urgent-label">Urgent</span><div class="urgent">' + IDX.urgent.map(urgentTile).join("") + "</div></div>";
    var otherFlows = IDX.flows.filter(function (f) { return !IDX.urgent.some(function (u) { return u.to === "f:" + f; }); });
    if (otherFlows.length) {
      h += '<div class="section"><span class="label">Step by step</span><ul class="list">' + otherFlows.map(function (f) { return rowHtml("f:" + f); }).join("") + "</ul></div>";
    }
    h += '<div class="section"><span class="label">The guide</span><div class="groups">';
    IDX.groups.forEach(function (g) {
      h += '<a class="group-card grp-' + g.id + '" href="#/g/' + g.id + '">' + iconTile(g.icon, "grp-" + g.id) +
        '<span class="txt"><b>' + esc(g.title) + '</b><span class="sub">' + esc(g.short) + "</span></span>" + icon("chevron-right", "chev") + "</a>";
    });
    h += "</div></div>";
    h += '<div class="section"><span class="label">Tools</span><div class="quick-tools">' +
      [["map", "map", "Map"], ["tool/compass", "compass", "Compass"], ["tool/gps", "locate-fixed", "Position"], ["tool/signal", "siren", "Signal"]]
        .map(function (t) { return '<a href="#/' + t[0] + '">' + icon(t[1], "ic-lg") + "<span>" + t[2] + "</span></a>"; }).join("") + "</div></div>";
    var m = new Date().getMonth() + 1;
    var now = Object.keys(SPP).filter(function (id) { return inSeason(SPP[id], m).length; });
    if (now.length) {
      var pick = now.filter(function (id) { return SPP[id].images.length; }).slice(0, 4);
      h += '<div class="section"><span class="label">In season in ' + MONTHS[m - 1] + '</span><a class="season-card" href="#/season">' +
        '<span class="faces">' + (lowPower() ? "" : pick.map(function (id) { return '<img loading="lazy" alt="" src="' + thumbSrc(SPP[id].images[0]) + '">'; }).join("")) + "</span>" +
        '<span class="txt"><b>' + now.length + ' things to forage now</b><span class="sub">Only with certain identification</span></span>' + icon("chevron-right", "chev") + "</a></div>";
    }
    if (recent.length) {
      h += '<div class="section"><span class="label">Recently viewed</span><ul class="list">' +
        recent.slice(0, 3).map(function (k) { return rowHtml(k); }).join("") + "</ul></div>";
    }
    h += '<div class="foot"><a href="#/report">Location report</a><a href="#/settings">Settings</a><a href="#/about">About</a><a href="#/credits">Photo credits</a></div>';
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ search
  var SEARCH = null, VOCAB = null, SYN = null;
  var STOP = {};
  ("a an and are as at be but by can do for from has have if in into is it its not of on or so that the their them then there these they this to too was were what when where which while who will with you your its dont than also may more most one some any all each other out up use used using very only just should would could been being over under about after before such how why per off own same both few many much now new well get got make made").split(" ").forEach(function (w) { STOP[w] = 1; });

  function norm(s) {
    s = String(s).toLowerCase();
    if (s.normalize) s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return s.replace(/'/g, "");
  }
  function stem(w) {
    var n = w.length;
    if (n > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (n > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
    if (n > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function qtokens(q) {
    return (norm(q).match(/[a-z0-9]+/g) || []).filter(function (w) { return w.length > 1 && !STOP[w]; });
  }
  // Damerau-Levenshtein (optimal string alignment) with an early exit above max.
  function editDistance(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = new Array(lb + 1), cur;
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur = new Array(lb + 1);
      cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }
  function search(q) {
    var toks = qtokens(q);
    if (!toks.length) return [];
    var terms = SEARCH.terms;
    var total = {}, hits = {};
    if (!SYN) {
      SYN = {};
      (SEARCH.syn || []).forEach(function (g) { g.forEach(function (w) { SYN[w] = (SYN[w] || []).concat(g); }); });
    }
    toks.forEach(function (raw, ti) {
      var t = stem(raw), last = ti === toks.length - 1;
      var best = {};
      var maxd = t.length >= 7 ? 2 : (t.length >= 4 ? 1 : 0);
      // A correctly spelt word that exists in the guide shouldn't be swamped by look-alike words
      // ("whistle" vs "thistle"); typos ("nettel") have no exact entry, so fuzzy matches count fully.
      var fuzzyFactor = terms[t] || terms[raw] ? 0.2 : 1;
      // Synonyms ("shrooms" -> fungi, "haemorrhage" -> bleeding) count almost as much as the word itself.
      var syn = {};
      (SYN[t] || []).concat(SYN[raw] || []).forEach(function (w) { if (w !== t) syn[w] = 1; });
      for (var k = 0; k < VOCAB.length; k++) {
        var term = VOCAB[k], w = 0;
        if (term === t || term === raw) w = 1;
        else if (syn[term]) w = 0.75;
        else if (term.indexOf(t) === 0 && t.length >= 2) w = last ? 0.8 : 0.6;
        else if (maxd) {
          var d = editDistance(t, term, maxd);
          if (d <= maxd) w = (d === 1 ? 0.65 : 0.4) * fuzzyFactor;
          else if (last && term.length > t.length && t.length >= 4 && editDistance(t, term.slice(0, t.length), 1) <= 1) w = 0.45 * fuzzyFactor;
        }
        if (!w) continue;
        var post = terms[term];
        for (var x = 0; x < post.length; x += 2) {
          var doc = post[x], sc = post[x + 1] * w;
          if (!best[doc] || best[doc] < sc) best[doc] = sc;
        }
      }
      Object.keys(best).forEach(function (doc) {
        total[doc] = (total[doc] || 0) + best[doc];
        hits[doc] = (hits[doc] || 0) + 1;
      });
    });
    var n = toks.length;
    var stems = toks.map(stem);
    return Object.keys(total).map(function (doc) {
      var cover = hits[doc] / n;
      var key = SEARCH.docs[doc];
      return { key: key, score: total[doc] * cover * cover * titleBoost(key, stems) };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 40);
  }

  // Results whose title (or species name) matches every query word rank higher, and shorter titles
  // more so: "nettel" should put "Common nettle" above "Cordage from nettle and bramble".
  var titleTokCache = {};
  function titleBoost(key, stems) {
    var r = itemFromKey(key);
    if (!r) return 1;
    var c = titleTokCache[key];
    if (!c) {
      var name = r.kind === "s" ? r.item.name : r.item.title;
      var alt = r.kind === "s" ? r.item.latin + " " + r.item.aka.join(" ") : "";
      c = titleTokCache[key] = { name: qtokens(name).map(stem), all: qtokens(name + " " + alt).map(stem) };
    }
    var hit = stems.every(function (q) {
      var known = !!SEARCH.terms[q];
      return c.all.some(function (w) { return w.indexOf(q) === 0 || (!known && q.length >= 4 && editDistance(q, w, 1) <= 1); });
    });
    // Shorter names are closer matches: "Common nettle" (2 words) beats "Cordage from nettle and bramble".
    return hit ? 1.5 + 2.5 / Math.max(1, c.name.length) : 1;
  }

  var SUGGEST = ["Hypothermia", "Signal for help", "Boil water", "Ferro rod", "Death cap", "Nettle", "Grid reference", "Bleeding", "Wild garlic", "Ticks"];
  function viewSearch(q, tab) {
    setChrome("Search", { root: true, tab: tab });
    var val = q.q || "";
    view.innerHTML = '<label class="searchbox">' + icon("search") +
      '<input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nettle, CPR, ferro rod…" aria-label="Search the guide" value="' + esc(val) + '">' +
      '<button class="icon-btn clear" id="qclear" type="button" aria-label="Clear search"' + (val ? "" : " hidden") + ">" + icon("x") + "</button></label>" +
      '<div id="results"></div>';
    var inp = document.getElementById("q"), clr = document.getElementById("qclear");
    inp.addEventListener("input", function () {
      clr.hidden = !inp.value;
      history.replaceState(null, "", "#/search" + (inp.value ? "?q=" + encodeURIComponent(inp.value) : ""));
      currentHash = location.hash;
      runSearch(inp.value);
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
    clr.onclick = function (e) { e.preventDefault(); inp.value = ""; inp.dispatchEvent(new Event("input")); inp.focus(); };
    runSearch(val);
    return inp;
  }
  function runSearch(q) {
    var res = document.getElementById("results");
    if (!res) return;
    if (!q.trim()) {
      res.innerHTML = '<div class="section"><span class="label">Try</span><div class="chips" style="flex-wrap:wrap;overflow:visible">' +
        SUGGEST.map(function (s) { return '<button class="chip" data-suggest="' + esc(s) + '">' + esc(s) + "</button>"; }).join("") + "</div></div>";
      res.querySelectorAll("[data-suggest]").forEach(function (b) {
        b.onclick = function () { var i = document.getElementById("q"); i.value = b.getAttribute("data-suggest"); i.dispatchEvent(new Event("input")); };
      });
      return;
    }
    if (!SEARCH) {
      res.innerHTML = '<p class="count">Loading search index…</p>';
      loadScript("content/search.js").then(function () {
        SEARCH = window.GUIDE_SEARCH;
        VOCAB = Object.keys(SEARCH.terms);
        var cur = document.getElementById("q");
        if (cur) runSearch(cur.value);
      });
      return;
    }
    var out = search(q);
    if (!out.length) {
      res.innerHTML = '<p class="empty">No matches for “' + esc(q) + '”. Try fewer or different words.</p>';
      return;
    }
    res.innerHTML = '<p class="count">' + out.length + (out.length === 40 ? "+" : "") + ' results</p><ul class="list">' +
      out.map(function (r) { return rowHtml(r.key); }).join("") + '</ul><div class="kbd-gap"></div>';
  }
  // Opening search synchronously inside the tap lets Android show the keyboard straight away.
  function openSearch() {
    if (location.hash.indexOf("#/search") !== 0) {
      if (currentHash !== null) scrollPos[currentHash] = window.scrollY;
      history.pushState(null, "", "#/search");
    }
    currentHash = location.hash;
    ++renderToken;
    var inp = viewSearch(parseRoute().q, "search");
    window.scrollTo(0, 0);
    inp.focus();
  }

  // ------------------------------------------------------------------ groups and categories
  function viewGroup(id, tab) {
    var g = GROUPS[id];
    if (!g) return notFound();
    setChrome(g.title, { tab: tab });
    var h = '<div class="cat-head grp-' + g.id + '">' + iconTile(g.icon, "grp-" + g.id, "page-icon") + '<h1 class="page">' + esc(g.title) + "</h1></div>";
    h += '<p class="lead">' + esc(g.intro) + "</p>";
    if (g.links && g.links.length) {
      h += '<div class="actions">' + g.links.map(function (lk) {
        return '<a class="action" href="' + esc(lk.to) + '"><span class="badge-ic">' + icon(lk.icon, "ic-lg") + '</span><span class="txt"><b>' +
          esc(lk.title) + '</b><span class="sub">' + esc(lk.sub) + "</span></span>" + icon("chevron-right", "chev") + "</a>";
      }).join("") + "</div>";
    }
    h += '<div class="section"><span class="label">' + g.categories.length + (g.categories.length === 1 ? " section" : " sections") + '</span><div class="tiles">';
    g.categories.forEach(function (cid) {
      var c = CATS[cid];
      h += '<a class="tile grp-' + g.id + '" href="#/c/' + c.id + '">' + iconTile(c.icon, "") +
        "<span><b>" + esc(c.title) + '</b><span class="sub">' + esc(c.short) + "</span></span></a>";
    });
    h += "</div></div>";
    view.innerHTML = h;
  }

  function viewCategory(id, tab) {
    var c = CATS[id];
    if (!c) return notFound();
    var g = GROUPS[c.group];
    setChrome(c.title, { tab: tab });
    var h = '<a class="crumb grp-' + g.id + '" href="#/g/' + g.id + '"><span class="dot"></span>' + esc(g.title) + "</a>";
    h += '<div class="cat-head grp-' + g.id + '">' + iconTile(c.icon, "grp-" + g.id, "page-icon") + '<h1 class="page">' + esc(c.title) + "</h1></div>";
    h += '<p class="lead">' + esc(c.intro) + "</p>";
    if (id === "first-aid" || id === "medicine") h += '<div class="banner info">' + icon("info") + '<span>First-aid information, not a substitute for training. This phone can\'t call: see <a href="#/a/when-to-get-help">sending for help</a>.</span></div>';
    if (id === "lost") h += '<div class="banner info">' + icon("info") + "<span>This phone has no SIM card and <b>cannot call 999 or 112</b>. Get help by signalling, being found, or reaching a working phone or a person.</span></div>";
    if (id === "identify" || id === "lookalikes") {
      h += '<div class="banner">' + icon("triangle-alert") + "<span>Never eat any wild plant or fungus unless you are 100% certain what it is. This guide is not a substitute for expert identification.</span></div>";
      h += '<a class="action primary" href="#/species"><span class="badge-ic">' + icon("leaf", "ic-lg") + '</span><span class="txt"><b>Browse all ' +
        Object.keys(SPP).length + ' species</b><span class="sub">Plants, fungi, animals and psychoactive species, with photos</span></span>' + icon("chevron-right", "chev") + "</a>";
    }
    var start = ART[c.start];
    if (start) {
      h += '<a class="start-here grp-' + g.id + '" href="#/a/' + start.id + '"><span class="tag">' + icon("flag", "ic-sm") + "Start here</span>" +
        '<span class="row-in">' + articleVisual(start) + '<span class="txt"><b>' + esc(start.title) + '</b><span class="sub">' + esc(start.summary) + "</span></span>" +
        icon("chevron-right", "chev") + "</span></a>";
    }
    c.topics.forEach(function (t) {
      var items = t.items.filter(function (x) { return x !== c.start; });
      if (!items.length) return;
      h += '<div class="section topic"><span class="label">' + esc(t.title) + '</span><ul class="list">' + items.map(function (x) {
        if (x.charAt(0) === "@") {
          var a = ART[x.slice(1)];
          return a ? rowHtml("a:" + a.id, "In " + CATS[a.cat].title) : "";
        }
        return rowHtml("a:" + x);
      }).join("") + "</ul></div>";
    });
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ saved
  function viewSaved(tab) {
    setChrome("Saved", { root: true, tab: tab });
    var favs = load("favs", []).filter(itemFromKey), recent = load("recent", []).filter(itemFromKey);
    var h = '<span class="label">Saved</span>';
    h += favs.length ? '<ul class="list">' + favs.map(function (k) { return rowHtml(k); }).join("") + "</ul>"
      : '<div class="banner info">' + icon("bookmark") + "<span>Tap the bookmark at the top of any guide or species to keep it here.</span></div>";
    h += '<div class="section"><span class="label">Recently viewed</span>';
    h += recent.length ? '<ul class="list">' + recent.slice(0, 15).map(function (k) { return rowHtml(k); }).join("") + '</ul><button class="btn" id="clear-recent" style="margin-top:8px">Clear recently viewed</button>'
      : '<p class="muted small">Nothing viewed yet.</p>';
    h += "</div>";
    view.innerHTML = h;
    var b = document.getElementById("clear-recent");
    if (b) b.onclick = function () { save("recent", []); render(); };
  }

  // ------------------------------------------------------------------ species browser
  function viewBrowser(q, tab) {
    setChrome("Species", { root: true, tab: tab });
    var g = q.g || "", st = q.st || "", text = q.q || "";
    // "Psychoactive" sits with the groups as its own tab: it spans plants and fungi.
    var groups = [["", "All", ""], ["plant", "Plants", "g-plant"], ["fungus", "Fungi", "g-fungus"], ["animal", "Animals", "g-animal"], ["psychoactive", "Psychoactive", "g-psy"]];
    var stats = [["edible", "Edible"], ["medicinal", "Medicinal"], ["caution", "Caution"], ["poisonous", "Poisonous"], ["deadly", "Deadly"], ["venomous", "Venomous"], ["protected", "Protected"], ["invasive", "Invasive"]];
    var h = '<input class="filter-input" id="sf" type="search" placeholder="Filter by name…" autocomplete="off" value="' + esc(text) + '" style="margin-top:0" aria-label="Filter species by name">';
    h += '<div class="chips" role="group" aria-label="Group" style="margin-top:8px">' + groups.map(function (x) {
      return '<button class="chip ' + x[2] + '" data-g="' + x[0] + '" aria-pressed="' + (g === x[0]) + '">' + (x[2] ? '<span class="dot"></span>' : "") + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="chips" role="group" aria-label="Status">' + stats.map(function (x) {
      return '<button class="chip" data-st="' + x[0] + '" aria-pressed="' + (st === x[0]) + '">' + (STATUS_ICON[x[0]] ? icon(STATUS_ICON[x[0]]) : "") + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div id="sbanner"></div><p class="count" id="count"></p><div class="sgrid" id="sgrid"></div>';
    view.innerHTML = h;

    function banner() {
      document.getElementById("sbanner").innerHTML = g === "psychoactive"
        ? '<div class="banner psy">' + icon("brain") + '<span>For identification, safety, the law and first aid only. In the outdoors, impairment kills, and several of these have deadly lookalikes. <a href="#/a/psychoactive-safety">Read the safety guide</a>.</span></div>'
        : '<div class="banner warn">' + icon("triangle-alert") + "<span>Identify with several features, never one. Never eat wild fungi unless an expert has confirmed them in person.</span></div>";
    }
    function apply() {
      var t = norm(document.getElementById("sf").value.trim());
      var ids = Object.keys(SPP).filter(function (id) {
        var s = SPP[id];
        if (g === "psychoactive") { if (s.status.indexOf("psychoactive") < 0) return false; }
        else if (g && s.group !== g) return false;
        if (st && s.status.indexOf(st) < 0) return false;
        if (t && norm(s.name + " " + s.latin + " " + s.aka.join(" ") + " " + s.tags.join(" ")).indexOf(t) < 0) return false;
        return true;
      }).sort(function (a, b) { return SPP[a].name.localeCompare(SPP[b].name); });
      document.getElementById("count").textContent = ids.length + " species";
      document.getElementById("sgrid").innerHTML = ids.length ? ids.map(speciesCard).join("")
        : '<p class="empty" style="grid-column:1/-1">No species match these filters.</p>';
      banner();
    }
    function updateHash() {
      var parts = [];
      if (g) parts.push("g=" + g);
      if (st) parts.push("st=" + st);
      var t = document.getElementById("sf").value.trim();
      if (t) parts.push("q=" + encodeURIComponent(t));
      history.replaceState(null, "", "#/species" + (parts.length ? "?" + parts.join("&") : ""));
      currentHash = location.hash;
    }
    view.querySelectorAll(".chip").forEach(function (b) {
      b.onclick = function () {
        if (b.hasAttribute("data-g")) g = b.getAttribute("data-g");
        else st = st === b.getAttribute("data-st") ? "" : b.getAttribute("data-st"); // tap again to clear
        view.querySelectorAll(".chip").forEach(function (c) {
          c.setAttribute("aria-pressed", c.hasAttribute("data-g") ? c.getAttribute("data-g") === g : c.getAttribute("data-st") === st);
        });
        updateHash();
        apply();
      };
    });
    document.getElementById("sf").addEventListener("input", function () { updateHash(); apply(); });
    apply();
  }

  // ------------------------------------------------------------------ photo viewer
  // items: [{src, caption, photo}] ; pure pointer events, no timers.
  var V = { items: [], i: 0, s: 1, x: 0, y: 0, pts: {}, start: null, lastTap: 0, open: false };
  var vEl = document.getElementById("viewer"), vImg = document.getElementById("viewer-img");
  function vApply() { vImg.style.transform = "translate(" + V.x + "px," + V.y + "px) scale(" + V.s + ")"; }
  function vReset() { V.s = 1; V.x = 0; V.y = 0; V.pts = {}; V.start = null; vImg.style.transform = ""; }
  function vShow() {
    var it = V.items[V.i];
    vReset();
    vImg.src = it.src;
    vImg.alt = it.caption || "";
    document.getElementById("viewer-prev").hidden = V.i === 0;
    document.getElementById("viewer-next").hidden = V.i >= V.items.length - 1;
    var cap = document.getElementById("viewer-caption");
    var base = (it.caption || "") + (V.items.length > 1 ? " · " + (V.i + 1) + "/" + V.items.length : "");
    cap.textContent = base;
    if (it.photo) {
      loadCredits().then(function (cr) {
        var c = cr[it.photo];
        if (c && V.open && V.items[V.i] === it) cap.textContent = base + " · Photo: " + c.author + " · " + c.license;
      });
    }
  }
  function openViewer(items, i) {
    V.items = items; V.i = i; V.open = true;
    vEl.hidden = false;
    vShow();
    history.pushState({ viewer: true }, "");
  }
  function photoItems(ims, label) {
    return ims.map(function (im) { return { src: fullSrc(im), caption: label, photo: im[0] }; });
  }
  function closeViewer(fromPop) {
    if (!V.open) return;
    V.open = false;
    vEl.hidden = true;
    vImg.removeAttribute("src");
    if (!fromPop) history.back();
  }
  window.addEventListener("popstate", function () {
    if (V.open) { closeViewer(true); return; }
    if ((location.hash || "#/") !== currentHash) render();
  });
  document.getElementById("viewer-close").onclick = function () { closeViewer(false); };
  document.getElementById("viewer-prev").onclick = function () { if (V.i > 0) { V.i--; vShow(); } };
  document.getElementById("viewer-next").onclick = function () { if (V.i < V.items.length - 1) { V.i++; vShow(); } };
  function imgBox() { var r = vImg.getBoundingClientRect(); return { left: r.left - V.x, top: r.top - V.y }; }
  function zoomAt(cx, cy, ns) {
    ns = Math.max(1, Math.min(8, ns));
    var b = imgBox();
    var px = (cx - b.left - V.x) / V.s, py = (cy - b.top - V.y) / V.s;
    V.s = ns;
    V.x = cx - b.left - px * ns;
    V.y = cy - b.top - py * ns;
    if (ns === 1) { V.x = 0; V.y = 0; }
    vApply();
  }
  var stage = document.getElementById("viewer-stage");
  stage.addEventListener("pointerdown", function (e) {
    stage.setPointerCapture(e.pointerId);
    V.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(V.pts);
    if (ids.length === 2) {
      var a = V.pts[ids[0]], b = V.pts[ids[1]];
      V.start = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: V.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: V.x, y: V.y };
    } else if (ids.length === 1) {
      V.start = { px: e.clientX, py: e.clientY, x: V.x, y: V.y, moved: false };
    }
  });
  stage.addEventListener("pointermove", function (e) {
    if (!V.pts[e.pointerId] || !V.start) return;
    V.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(V.pts);
    if (ids.length >= 2 && V.start.d) {
      var a = V.pts[ids[0]], b = V.pts[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      var ns = Math.max(1, Math.min(8, V.start.s * d / V.start.d));
      var box = imgBox();
      var px = (V.start.cx - box.left - V.start.x) / V.start.s, py = (V.start.cy - box.top - V.start.y) / V.start.s;
      V.s = ns;
      V.x = cx - box.left - px * ns;
      V.y = cy - box.top - py * ns;
      if (ns === 1) { V.x = 0; V.y = 0; }
      vApply();
    } else if (ids.length === 1 && V.start.px !== undefined) {
      var dx = e.clientX - V.start.px, dy = e.clientY - V.start.py;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) V.start.moved = true;
      if (V.s > 1) { V.x = V.start.x + dx; V.y = V.start.y + dy; vApply(); }
    }
  });
  function endPointer(e) {
    if (!V.pts[e.pointerId]) return;
    var wasSingle = Object.keys(V.pts).length === 1;
    var st = V.start;
    delete V.pts[e.pointerId];
    var ids = Object.keys(V.pts);
    if (wasSingle && st && st.px !== undefined) {
      var dx = e.clientX - st.px;
      if (!st.moved) {
        var now = e.timeStamp;
        if (now - V.lastTap < 320) { zoomAt(e.clientX, e.clientY, V.s > 1 ? 1 : 2.5); V.lastTap = 0; }
        else V.lastTap = now;
      } else if (V.s === 1 && Math.abs(dx) > 60) {
        if (dx < 0 && V.i < V.items.length - 1) { V.i++; vShow(); }
        else if (dx > 0 && V.i > 0) { V.i--; vShow(); }
      }
    }
    if (ids.length === 1) {
      var p = V.pts[ids[0]];
      V.start = { px: p.x, py: p.y, x: V.x, y: V.y, moved: true };
    } else if (!ids.length) V.start = null;
  }
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  function creditLine(el, ims) {
    loadCredits().then(function (cr) {
      var names = ims.map(function (im) { var c = cr[im[0]]; return c ? esc(c.author) + " (" + esc(c.license) + ")" : ""; }).filter(Boolean);
      if (names.length && el) el.innerHTML = "Photo" + (names.length > 1 ? "s" : "") + ": " + names.join("; ") + ' · <a href="#/credits">licences</a>';
    });
  }

  // ------------------------------------------------------------------ article page
  function decorateBody(root) {
    root.querySelectorAll("section.quick, section.callout").forEach(function (sec) {
      var kind = sec.classList.contains("quick") ? "quick" : (sec.className.split(" ")[1] || "note");
      var h = sec.querySelector("h2");
      if (h && CALLOUT_ICON[kind]) h.insertAdjacentHTML("afterbegin", icon(CALLOUT_ICON[kind]));
    });
    root.querySelectorAll("img[data-zoom]").forEach(function (img) {
      img.onclick = function () { openViewer([{ src: img.getAttribute("src"), caption: img.alt }], 0); };
    });
  }
  function insertAfterQuick(container, html) {
    if (!html) return;
    var q = container.querySelector(".quick");
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var ref = q ? q.nextSibling : container.firstChild;
    while (tmp.firstChild) container.insertBefore(tmp.firstChild, ref);
  }
  function wireChecklists(root, key) {
    var state = load("checks", {});
    root.querySelectorAll(".checklist ul, .checklist ol").forEach(function (list, li) {
      list.classList.add("check-list");
      Array.prototype.forEach.call(list.children, function (item, ii) {
        var id = key + ":" + li + ":" + ii;
        // The whole row is the tap target; text and links stay together beside the tick box.
        var label = document.createElement("label"), wrap = document.createElement("span");
        while (item.firstChild) wrap.appendChild(item.firstChild);
        label.appendChild(wrap);
        item.appendChild(label);
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!state[id];
        cb.setAttribute("aria-label", "Packed / checked");
        cb.onchange = function () { var s = load("checks", {}); if (cb.checked) s[id] = 1; else delete s[id]; save("checks", s); };
        label.insertBefore(cb, label.firstChild);
      });
    });
  }
  function articleGallery(a, force) {
    if (!a.images || !a.images.length) return "";
    var im = a.images[0];
    if (lowPower() && !force) return '<div class="gallery"><button class="photo-off" data-show>' + icon("image-off") + "Low-power mode: tap to show photo</button></div>";
    return '<figure class="gallery"><img class="main" loading="lazy" decoding="async" src="' + fullSrc(im) + '" width="' + im[1] + '" height="' + im[2] + '" alt="' + esc(a.title) + '" data-photo>' +
      '<figcaption class="credit" id="a-credit"></figcaption></figure>';
  }
  function wireArticleGallery(root, a) {
    var g = root.querySelector("[data-photo]");
    if (g) { g.onclick = function () { openViewer(photoItems(a.images, a.title), 0); }; creditLine(document.getElementById("a-credit"), a.images); }
    var off = root.querySelector("[data-show]");
    if (off) off.onclick = function () {
      var box = off.parentNode;
      box.insertAdjacentHTML("afterend", articleGallery(a, true));
      box.parentNode.removeChild(box);
      wireArticleGallery(root, a);
    };
  }
  function metaChips(a) {
    var out = [];
    if (a.time) out.push('<span class="mchip">' + icon("clock", "ic-sm") + esc(a.time) + "</span>");
    if (a.level) out.push('<span class="mchip lv-' + a.level + '">' + icon("gauge", "ic-sm") + LEVEL_LABEL[a.level] + "</span>");
    out.push('<span class="mchip">' + icon("book-open", "ic-sm") + a.read + " min read</span>");
    return out.join("");
  }

  // Read aloud: shown only when an offline English voice works. The first article view checks once.
  var tts = { available: -1, speaking: false };
  onNative("tts", function (d) {
    if (d.available !== undefined) tts.available = d.available ? 1 : 0;
    if (d.speaking !== undefined) tts.speaking = d.speaking;
    var b = document.getElementById("tts");
    if (b) {
      b.hidden = tts.available !== 1;
      b.innerHTML = icon(tts.speaking ? "square" : "volume-2", "ic-sm") + (tts.speaking ? "Stop reading" : "Read aloud");
    }
  });
  function wireTts(body) {
    if (!NATIVE) return;
    if (tts.available < 0) {
      var st = nativeState();
      tts.available = st && st.tts !== undefined ? st.tts : -1;
      if (tts.available < 0) native("ttsCheck");
    }
    var b = document.getElementById("tts");
    if (!b) return;
    b.hidden = tts.available !== 1;
    tts.speaking = false;
    b.onclick = function () {
      if (tts.speaking) { native("ttsStop"); tts.speaking = false; window.__native("tts", { speaking: false }); return; }
      var clone = body.cloneNode(true);
      var src = clone.querySelector("#sources");
      if (src) { while (src.nextSibling) src.parentNode.removeChild(src.nextSibling); src.parentNode.removeChild(src); }
      var text = document.querySelector("h1.page").textContent + ".\n" + clone.innerText;
      native("ttsSpeak", text);
    };
  }

  function viewArticle(id, token, tab) {
    var a = ART[id];
    if (!a) return notFound();
    var c = CATS[a.cat], g = GROUPS[c.group];
    setChrome(c.title, { tab: tab, saveKey: "a:" + id });
    addRecent("a:" + id);
    var h = '<a class="crumb grp-' + g.id + '" href="#/c/' + c.id + '"><span class="dot"></span>' + esc(g.title) + " › " + esc(c.title) + "</a>" +
      '<h1 class="page">' + esc(a.title) + "</h1>" +
      '<div class="meta-row">' + metaChips(a) + (NATIVE ? '<button class="mchip tts" id="tts" hidden>' + icon("volume-2", "ic-sm") + "Read aloud</button>" : "") + "</div>";
    if (a.needs && a.needs.length) {
      h += '<div class="needs"><span class="k">' + icon("package", "ic-sm") + "You'll need</span>" + a.needs.map(function (n) {
        return n[1] ? '<a class="need" href="#/a/' + n[1] + '">' + esc(n[0]) + "</a>" : '<span class="need">' + esc(n[0]) + "</span>";
      }).join("") + "</div>";
    }
    h += '<div class="body" id="body"><p class="muted" id="loading">Loading…</p></div>';
    if (a.related && a.related.length) {
      h += '<div class="section related"><span class="label">Related</span><ul class="list">' + a.related.map(function (r) { return rowHtml("a:" + r); }).join("") + "</ul></div>";
    }
    view.innerHTML = h;
    return loadBody("a/" + id).then(function (html) {
      if (token !== renderToken) return;
      var body = document.getElementById("body");
      body.innerHTML = html;
      var extra = "";
      if (a.compare) extra += '<div class="compare">' + a.compare.map(speciesCard).join("") + "</div>";
      extra += articleGallery(a);
      insertAfterQuick(body, extra);
      if (c.group === "stay-alive" && a.cat === "first-aid") {
        body.insertAdjacentHTML("afterbegin", '<p class="small muted" style="margin:0 0 12px">First-aid information, not a substitute for training.</p>');
      }
      decorateBody(body);
      wireArticleGallery(body, a);
      wireChecklists(body, "a:" + id);
      wireTts(body);
    }, function () {
      document.getElementById("body").innerHTML = '<p class="empty">This article could not be loaded.</p>';
    });
  }

  // ------------------------------------------------------------------ species page
  function heroHtml(s, force) {
    var ims = s.images;
    if (!ims.length) return '<div class="hero none g-' + s.group + '">' + icon(GROUP_ICON[s.group]) + "</div>";
    if (lowPower() && !force) return '<div class="hero"><button class="photo-off" id="show-photos">' + icon("image-off") + "Low-power mode: tap to show photos</button></div>";
    var h = '<div class="hero"><img id="hero-img" src="' + fullSrc(ims[0]) + '" width="' + ims[0][1] + '" height="' + ims[0][2] + '" alt="' + esc(s.name) + '">';
    if (ims.length > 1) h += '<span class="count-chip">' + icon("images", "ic-sm") + ims.length + " photos</span>";
    h += "</div>";
    if (ims.length > 1) {
      h += '<div class="strip">' + ims.map(function (im, i) {
        return '<button data-i="' + i + '" aria-label="Photo ' + (i + 1) + '"><img loading="lazy" alt="" src="' + thumbSrc(im) + '"></button>';
      }).join("") + "</div>";
    }
    h += '<p class="credit" id="sp-credit"></p>';
    return h;
  }
  function viewSpecies(id, token, tab) {
    var s = SPP[id];
    if (!s) return notFound();
    setChrome(GROUP_LABEL[s.group], { tab: tab, saveKey: "s:" + id });
    addRecent("s:" + id);
    var h = '<div id="hero-wrap">' + heroHtml(s) + "</div>";
    h += '<div class="sp-title"><div class="tt"><h1 class="page">' + esc(s.name) + '</h1><p class="latin">' + esc(s.latin) + "</p>" + pills(s.status) + "</div></div>";
    if (s.group === "fungus") {
      h += '<div class="banner">' + icon("triangle-alert") + "<span>Never eat any wild fungus unless an expert has confirmed it in person. Several UK fungi kill, with symptoms delayed for hours or days.</span></div>";
    } else if (s.status.indexOf("edible") >= 0 && s.group === "plant") {
      h += '<div class="banner warn">' + icon("triangle-alert") + "<span>Only eat a wild plant if you are 100% certain what it is, using several features. If in doubt, leave it out.</span></div>";
    }
    if (s.status.indexOf("psychoactive") >= 0) {
      h += '<div class="banner psy">' + icon("brain") + '<span><b>Psychoactive.</b> Covered for identification, safety, the law and first aid only. Impairment outdoors kills. <a href="#/a/psychoactive-safety">Safety and the law</a>.</span></div>';
    }
    if (s.harvest && s.harvest.length) {
      h += '<div class="harvest">' + icon("calendar-range", "ic-sm") + "<span>" + s.harvest.map(function (x) {
        return esc(x[0]) + " " + MONTHS[x[1] - 1].slice(0, 3) + (x[2] !== x[1] ? "–" + MONTHS[x[2] - 1].slice(0, 3) : "");
      }).join(" · ") + "</span></div>";
    }
    h += '<div class="facts">' +
      '<div class="f">' + icon("calendar") + '<span><span class="k">Season</span><span class="v">' + esc(s.season) + "</span></span></div>" +
      '<div class="f">' + icon("trees") + '<span><span class="k">Habitat</span><span class="v">' + esc(s.habitat) + "</span></span></div>" +
      '<div class="f">' + icon(GROUP_ICON[s.group]) + '<span><span class="k">Type</span><span class="v">' + TYPE_LABEL[s.group] + (s.kind ? " · " + esc(s.kind) : "") +
      (s.aka.length ? '<br><span class="muted">Also called ' + esc(s.aka.join(", ")) + "</span>" : "") + "</span></span></div>" +
      "</div>";
    h += '<p class="lead">' + esc(s.summary) + "</p>";
    h += '<div class="body" id="body"></div>';
    view.innerHTML = h;
    wireHero(s);
    return loadBody("s/" + id).then(function (html) {
      if (token !== renderToken) return;
      var body = document.getElementById("body");
      body.innerHTML = html;
      if (s.lookalikes.length) {
        var dangerous = s.lookalikes.some(function (l) { return SPP[l] && (isDeadly(SPP[l]) || SPP[l].status.indexOf("poisonous") >= 0); });
        var look = '<div class="look-wrap"><h2>' + (dangerous ? "Don't confuse with" : "Similar species") + "</h2>" +
          (dangerous ? '<p class="small muted" style="margin:0">Includes poisonous or deadly lookalikes.</p>' : "") +
          '<div class="look">' + s.lookalikes.map(speciesCard).join("") + "</div></div>";
        // Place the lookalikes straight after the identification section.
        var idH = Array.prototype.filter.call(body.querySelectorAll("h2"), function (x) { return /identification/i.test(x.textContent); })[0];
        var next = null;
        if (idH) { next = idH.nextElementSibling; while (next && next.tagName !== "H2") next = next.nextElementSibling; }
        var tmp = document.createElement("div");
        tmp.innerHTML = look;
        body.insertBefore(tmp.firstChild, next);
      }
      decorateBody(body);
    });
  }
  function wireHero(s) {
    var img = document.getElementById("hero-img");
    if (img) img.onclick = function () { openViewer(photoItems(s.images, s.name), 0); };
    view.querySelectorAll(".strip [data-i]").forEach(function (b) {
      b.onclick = function () { openViewer(photoItems(s.images, s.name), +b.getAttribute("data-i")); };
    });
    var off = document.getElementById("show-photos");
    if (off) off.onclick = function () { document.getElementById("hero-wrap").innerHTML = heroHtml(s, true); wireHero(s); };
    var cr = document.getElementById("sp-credit");
    if (cr) creditLine(cr, s.images);
  }

  // ------------------------------------------------------------------ decision flows
  // One node per screen; each answer is a new history entry, so Back goes to the previous question.
  function viewFlow(id, node, token, tab) {
    var meta = FLOWS[id];
    if (!meta) return notFound();
    setChrome(meta.title, { tab: tab, saveKey: "f:" + id });
    view.innerHTML = '<p class="muted" id="loading">Loading…</p>';
    return loadBody("f/" + id).then(function (flow) {
      if (token !== renderToken) return;
      var nid = node && flow.nodes[node] ? node : flow.start;
      var n = flow.nodes[nid];
      var trail = load("flow-trail", {});
      var depth = nid === flow.start ? 1 : (trail[id] && trail[id][nid]) || 2;
      var h = '<div class="flow-head">' + iconTile(meta.icon, "grp-urgent") + "<div><b>" + esc(meta.title) + '</b><span class="sub">Step ' + depth + "</span></div></div>";
      h += '<div class="flow-card' + (n.opts.length ? "" : " end") + '"><div class="body">' + n.html + "</div>";
      if (n.q) h += '<p class="flow-q">' + n.q + "</p>";
      h += "</div>";
      if (n.opts.length) {
        h += '<div class="flow-opts">' + n.opts.map(function (o) {
          return '<a class="opt" href="#/f/' + id + "/" + o[1] + '" data-next="' + o[1] + '">' + o[0] + icon("chevron-right", "chev") + "</a>";
        }).join("") + "</div>";
      }
      if (n.links.length) {
        h += '<div class="flow-links">' + n.links.map(function (href) {
          var m = href.match(/^#\/(a|s|f|c|tool)\/(.+)$/), label = href;
          if (m && m[1] === "a" && ART[m[2]]) label = ART[m[2]].title;
          else if (m && m[1] === "s" && SPP[m[2]]) label = SPP[m[2]].name;
          else if (m && m[1] === "f" && FLOWS[m[2]]) label = FLOWS[m[2]].title;
          else if (m && m[1] === "c" && CATS[m[2]]) label = CATS[m[2]].title;
          else if (m && m[1] === "tool") label = (TOOL_NAMES[m[2]] || m[2]) + " tool";
          return '<a class="btn" href="' + esc(href) + '">' + icon(m && m[1] === "tool" ? "wrench" : "book-open", "ic-sm") + esc(label) + "</a>";
        }).join("") + "</div>";
      }
      if (nid !== flow.start) h += '<p class="flow-restart"><a href="#/f/' + id + '">' + icon("rotate-ccw", "ic-sm") + "Start again</a></p>";
      view.innerHTML = h;
      decorateBody(view);
      view.querySelectorAll("[data-next]").forEach(function (a) {
        a.addEventListener("click", function () {
          var t = load("flow-trail", {});
          t[id] = t[id] || {};
          t[id][a.getAttribute("data-next")] = depth + 1;
          save("flow-trail", t);
        });
      });
    });
  }
  var TOOL_NAMES = { compass: "Compass", gps: "Position", map: "Map", sun: "Sun and moon", signal: "Signal", morse: "Morse",
    level: "Clinometer", pace: "Pace counter", cpr: "CPR metronome", casualty: "Casualty log", boil: "Boil timer",
    calc: "Calculators", notebook: "Notebook", battery: "Battery", torch: "Torch", "phone-mode": "Phone mode" };

  // ------------------------------------------------------------------ first-aid quick cards
  function viewCards(token, tab) {
    setChrome("First-aid cards", { tab: tab });
    view.innerHTML = '<h1 class="page">First-aid quick cards</h1><p class="lead">The quick steps from the key first-aid guides. Tap a title for the full guide.</p><div id="cards"><p class="muted" id="loading">Loading…</p></div>';
    return Promise.all(IDX.cards.map(function (id) { return loadBody("a/" + id); })).then(function (bodies) {
      if (token !== renderToken) return;
      var tmp = document.createElement("div");
      document.getElementById("cards").innerHTML = IDX.cards.map(function (id, i) {
        tmp.innerHTML = bodies[i];
        var q = tmp.querySelector(".quick");
        var steps = q ? q.querySelector("ol, ul") : null;
        // Steps can contain links of their own, so the card is not one big link.
        return '<div class="qcard"><a class="qtitle" href="#/a/' + id + '">' + esc(ART[id].title) + icon("chevron-right", "ic-sm") + "</a>" +
          (steps ? '<div class="quick bare">' + steps.outerHTML + "</div>" : "") + "</div>";
      }).join("");
    });
  }

  // ------------------------------------------------------------------ in season now
  function viewSeason(q, tab) {
    setChrome("In season", { tab: tab });
    var m = +(q.m || new Date().getMonth() + 1);
    if (!(m >= 1 && m <= 12)) m = new Date().getMonth() + 1;
    var h = '<h1 class="page">In season: ' + MONTHS[m - 1] + "</h1>";
    h += '<div class="chips months" role="group" aria-label="Month">' + MONTHS.map(function (name, i) {
      return '<a class="chip" href="#/season?m=' + (i + 1) + '" aria-pressed="' + (i + 1 === m) + '">' + name.slice(0, 3) + "</a>";
    }).join("") + "</div>";
    h += '<div class="banner warn">' + icon("triangle-alert") + '<span>Only eat what you can identify with complete certainty, using several features. Most have poisonous lookalikes: check the species page every time. Fungi: only with an expert, in person.</span></div>';
    var rows = { plant: [], fungus: [], animal: [] };
    Object.keys(SPP).forEach(function (id) {
      var parts = inSeason(SPP[id], m);
      if (parts.length) rows[SPP[id].group].push([id, parts.map(function (p) { return p[0]; }).join(", ")]);
    });
    ["plant", "fungus", "animal"].forEach(function (gk) {
      var list = rows[gk].sort(function (a, b) { return SPP[a[0]].name.localeCompare(SPP[b[0]].name); });
      if (!list.length) return;
      h += '<div class="section"><span class="label">' + GROUP_LABEL[gk] + " · " + list.length + '</span><ul class="list">' + list.map(function (x) {
        var s = SPP[x[0]];
        return '<li><a class="row" href="#/s/' + s.id + '">' + speciesVisual(s) + '<span class="txt"><span class="t">' + esc(s.name) +
          '</span><span class="s">' + esc(x[1]) + "</span>" + pills(s.status, 2) + "</span>" + icon("chevron-right", "chev") + "</a></li>";
      }).join("") + "</ul></div>";
    });
    h += '<p class="small muted">Months are typical for the UK; the south is often 2–3 weeks ahead of Scotland. See also the <a href="#/a/foraging-calendar">seasonal calendar</a>.</p>';
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ location report
  // What to hand to a messenger, a passer-by or rescuers. The GPS tool fills in the grid reference.
  function viewReport(tab) {
    setChrome("Location report", { tab: tab });
    var r = load("report", {});
    var fields = [
      ["grid", "OS grid reference", "e.g. NN 166 712"],
      ["place", "Nearest named place or landmark", "e.g. 300 m north of the bothy, on the main path"],
      ["what", "What has happened", "e.g. walker fallen, suspected broken ankle"],
      ["who", "People and their condition", "e.g. 2 people; 1 injured, 54, conscious, cold"],
      ["have", "What you have", "e.g. tarp, stove, torch, food for 1 day"],
      ["signal", "How you will signal", "e.g. orange tarp, whistle, torch"]
    ];
    var h = '<h1 class="page">Location report</h1><p class="lead">Fill this in calmly. Hand it, or show this screen, to whoever goes for help, a passer-by with a phone, or rescuers.</p>';
    h += '<a class="action" href="#/tool/gps"><span class="badge-ic">' + icon("locate-fixed", "ic-lg") + '</span><span class="txt"><b>Fill in my grid reference</b><span class="sub">' +
      (r.gridAuto ? "From GPS " + esc(r.gridAuto) : "Uses GPS for a minute or two, then switches it off") + "</span></span>" + icon("chevron-right", "chev") + "</a>";
    h += '<div class="form">' + fields.map(function (f) {
      return '<label for="r-' + f[0] + '">' + f[1] + '</label><input id="r-' + f[0] + '" data-k="' + f[0] + '" placeholder="' + esc(f[2]) + '" value="' + esc(r[f[0]] || "") + '" autocomplete="off">';
    }).join("") + "</div>";
    h += '<div class="section"><span class="label">Show this to rescuers</span><pre class="report" id="report-out"></pre></div>';
    h += '<div class="btn-row"><button class="btn" id="r-clear">Clear the form</button><a class="btn" href="#/a/when-you-reach-help">What to tell 999</a></div>';
    view.innerHTML = h;
    function out() {
      var x = load("report", {});
      var d = new Date(x.t || Date.now());
      document.getElementById("report-out").textContent = [
        "EMERGENCY: " + (x.what || "[what has happened]"),
        "Grid ref: " + (x.grid || "[grid reference]") + (x.latlon ? "  (" + x.latlon + ")" : ""),
        "Near: " + (x.place || "[landmark]"),
        "People: " + (x.who || "[number, condition]"),
        "We have: " + (x.have || "[kit]"),
        "Signal: " + (x.signal || "[how we'll signal]"),
        "Written: " + (x.t ? d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "[time]")
      ].join("\n");
    }
    view.querySelectorAll(".form input").forEach(function (inp) {
      inp.addEventListener("input", function () { var x = load("report", {}); x[inp.getAttribute("data-k")] = inp.value; x.t = Date.now(); save("report", x); out(); });
    });
    document.getElementById("r-clear").onclick = function () { if (confirm("Clear the report?")) { save("report", {}); render(); } };
    out();
  }

  // ------------------------------------------------------------------ settings
  function applySettings() {
    var root = document.documentElement;
    root.setAttribute("data-theme", settings.theme || "dark");
    root.style.setProperty("--fs", (settings.fs || 18) + "px");
    document.getElementById("dim").style.opacity = (settings.dim || 0) / 100;
    var bar = getComputedStyle(root).getPropertyValue("--bg").trim();
    if (bar) native("setSystemBarColor", bar.length === 4 ? "#" + bar[1] + bar[1] + bar[2] + bar[2] + bar[3] + bar[3] : bar);
    if (window.App && App.onTheme) App.onTheme(settings.theme || "dark");
  }
  function viewSettings(tab) {
    setChrome("Settings", { tab: tab });
    var st = nativeState();
    var bright = st ? st.brightness : -1;
    var theme = settings.theme || "dark";
    var h = '<span class="label">Display</span><div class="group">';
    h += '<div class="setting"><div class="h">Theme</div><div class="seg">' +
      [["dark", "Dark"], ["light", "Daylight"], ["red", "Night red"]].map(function (t) {
        return '<button data-theme-opt="' + t[0] + '" aria-pressed="' + (theme === t[0]) + '">' + t[1] + "</button>";
      }).join("") + '</div><p class="desc">Daylight is high contrast for direct sun. Night red is red on black to keep your night vision.</p></div>';
    h += '<div class="setting"><div class="h"><label for="fs">Text size</label><span class="v" id="fsv">' + (settings.fs || 18) + " px</span></div>" +
      '<input id="fs" type="range" min="14" max="30" step="1" value="' + (settings.fs || 18) + '"></div>';
    h += '<div class="setting"><div class="h">Screen brightness</div>' +
      '<label class="switch"><span>Follow phone setting</span><input type="checkbox" id="bsys"' + (bright < 0 ? " checked" : "") + (NATIVE ? "" : " disabled") + "></label>" +
      '<input id="bright" type="range" min="0" max="100" step="1" value="30"' + (bright < 0 || !NATIVE ? " disabled" : "") + ' aria-label="Brightness">' +
      '<p class="desc">Only while the guide is open. The low end is dimmer than the phone\'s own minimum.' + (NATIVE ? "" : " Phone only.") + "</p></div>";
    h += '<div class="setting"><div class="h"><label for="dimr">Extra dimming</label><span class="v" id="dimv">' + (settings.dim || 0) + "%</span></div>" +
      '<input id="dimr" type="range" min="0" max="80" step="5" value="' + (settings.dim || 0) + '"><p class="desc">Darkens the page on top of the backlight, for reading at night.</p></div>';
    h += "</div>";
    h += '<span class="label">Battery</span><div class="group"><div class="setting"><label class="switch"><span>Low-power mode</span><input type="checkbox" id="lowp"' + (settings.lowPower ? " checked" : "") + "></label>" +
      '<p class="desc">Hides photos until you tap them. Saves battery and memory.</p></div></div>';
    h += '<span class="label">Phone</span><ul class="list">' +
      '<li><a class="row" href="#/tool/phone-mode">' + iconTile("smartphone", "grp-reference") + '<span class="txt"><span class="t">Phone mode</span><span class="s">Survival mode or normal phone, restore apps</span></span>' + icon("chevron-right", "chev") + "</a></li>" +
      '<li><a class="row" href="#/tool/battery">' + iconTile("battery-medium", "grp-reference") + '<span class="txt"><span class="t">Battery and power</span><span class="s">Sessions left, storage and solar charging</span></span>' + icon("chevron-right", "chev") + "</a></li></ul>";
    h += '<span class="label">Your data</span><div class="group"><div class="setting"><div class="btn-row" style="margin:0">' +
      '<button class="btn" id="clr-recent">Clear recent</button><button class="btn" id="clr-favs">Clear saved</button><button class="btn" id="clr-checks">Clear ticks</button></div></div></div>';
    view.innerHTML = h;
    view.querySelectorAll("[data-theme-opt]").forEach(function (b) {
      b.onclick = function () { setSetting("theme", b.getAttribute("data-theme-opt")); applySettings(); render(); };
    });
    var fs = document.getElementById("fs");
    fs.oninput = function () { setSetting("fs", +fs.value); document.getElementById("fsv").textContent = fs.value + " px"; applySettings(); };
    var br = document.getElementById("bright"), bsys = document.getElementById("bsys");
    if (bright >= 0) br.value = Math.round(Math.sqrt(bright) * 100);
    br.oninput = function () { native("setBrightness", Math.pow(+br.value / 100, 2)); };
    bsys.onchange = function () { br.disabled = bsys.checked; native("setBrightness", bsys.checked ? -1 : Math.pow(+br.value / 100, 2)); };
    var dimr = document.getElementById("dimr");
    dimr.oninput = function () { setSetting("dim", +dimr.value); document.getElementById("dimv").textContent = dimr.value + "%"; applySettings(); };
    document.getElementById("lowp").onchange = function (e) { setSetting("lowPower", e.target.checked); };
    document.getElementById("clr-recent").onclick = function () { if (confirm("Clear recently viewed?")) save("recent", []); };
    document.getElementById("clr-favs").onclick = function () { if (confirm("Clear all saved items?")) save("favs", []); };
    document.getElementById("clr-checks").onclick = function () { if (confirm("Untick all checklist items?")) save("checks", {}); };
  }

  // ------------------------------------------------------------------ credits + about
  function viewCredits(token, tab) {
    setChrome("Photo credits", { tab: tab });
    view.innerHTML = '<p class="muted">Loading…</p>';
    return loadCredits().then(function (cr) {
      if (token !== renderToken) return;
      var owners = {};
      Object.keys(SPP).forEach(function (id) { SPP[id].images.forEach(function (im) { owners[im[0]] = SPP[id].name; }); });
      Object.keys(ART).forEach(function (id) { (ART[id].images || []).forEach(function (im) { owners[im[0]] = ART[id].title; }); });
      var names = Object.keys(cr).sort(function (a, b) { return (owners[a] || "").localeCompare(owners[b] || ""); });
      var h = '<h1 class="page">Credits</h1>';
      h += '<div class="section first"><span class="label">Map data</span><div class="body small"><p>Map © <b>OpenStreetMap contributors</b>, available under the Open Database Licence (ODbL), openstreetmap.org/copyright. Vector tiles built with Protomaps (protomaps.com).</p>' +
        "<p>Contours derived from <b>OS Terrain 50</b>. Contains OS data © Crown copyright and database right. Open Government Licence v3.0.</p>" +
        "<p>Magnetic declination: World Magnetic Model WMM2025, NOAA NCEI and British Geological Survey (public domain).</p></div></div>";
      h += '<div class="section"><span class="label">Photos</span><p class="small">All ' + names.length + " photos come from Wikimedia Commons and are used under the licences shown (public domain, CC0, CC BY or CC BY-SA). They were resized and converted to WebP. CC BY-SA photos remain under CC BY-SA. Licence texts: creativecommons.org/licenses.</p>";
      h += '<ul class="list">' + names.map(function (n) {
        var c = cr[n];
        return '<li><div class="row" style="align-items:flex-start">' + (lowPower() ? "" : '<img class="thumb" loading="lazy" alt="" src="img/t/' + n + '">') +
          '<span class="txt"><span class="t">' + esc(owners[n] || n) + '</span><span class="s">' + esc(c.author) + " · " + esc(c.license) +
          '</span><span class="s">' + esc(c.source) + "</span></span></div></li>";
      }).join("") + "</ul></div>";
      view.innerHTML = h;
    }, function () { view.innerHTML = '<p class="empty">No photo credits found.</p>'; });
  }
  function viewAbout(tab) {
    setChrome("About", { tab: tab });
    var st = nativeState();
    var h = '<h1 class="page">About this guide</h1>';
    h += '<div class="banner">' + icon("triangle-alert") + "<span>General information for a dedicated offline survival phone. It is not a substitute for first-aid training, expert identification of plants and fungi, or professional rescue.</span></div>";
    h += '<div class="body">';
    h += '<h2>This phone can\'t call</h2><p>It has no SIM card, and in the UK a phone without a SIM cannot reach 999 or 112. Getting help means signalling, being found, or reaching a working phone or a person. See <a href="#/c/lost">Lost in the hills or forest</a> and <a href="#/c/self-rescue">Self-rescue</a>.</p>';
    h += "<h2>Foraging and psychoactive species</h2><p>Never eat any wild plant, berry or fungus unless you are 100% certain what it is, using several features, ideally confirmed in person by an expert. Psychoactive species are included only so you can recognise them, stay safe, know the law and give first aid.</p>";
    h += "<h2>First aid</h2><p>First-aid content follows NHS, St John Ambulance, British Red Cross and Resuscitation Council UK public guidance as written at the time. Training matters more than reading.</p>";
    h += "<h2>The law</h2><p>UK wildlife, access, fishing and drugs law applies. Most wild animals are protected; uprooting wild plants without the landowner's permission is illegal; many traps and snares are banned; psilocybin mushrooms are Class A.</p>";
    h += "<h2>Contents</h2><p>" + IDX.counts.articles + " guides, " + IDX.flows.length + " step-by-step flows, " + IDX.counts.species + " species, " + IDX.counts.photos + ' photos. Every guide lists its sources. <a href="#/credits">Credits</a>.</p>';
    h += "<h2>Offline and battery</h2><p>The guide never uses the network: no internet permission, no Google services, no background services or wakelocks. Sensors and GPS run only while their tool is on screen and switch off by themselves. The map reads its data from the phone's storage.</p>";
    h += "<h2>Licences</h2><ul><li>Icons: Lucide (ISC licence), plus a few custom icons in the same style.</li><li>Typeface: Atkinson Hyperlegible, © 2020 Braille Institute of America, SIL Open Font License 1.1.</li>" +
      "<li>Map: MapLibre GL JS (BSD 3-Clause), PMTiles (BSD 3-Clause, Protomaps), Noto Sans glyphs (SIL OFL 1.1). Map data © OpenStreetMap contributors (ODbL); contours contain OS data © Crown copyright (OGL v3).</li>" +
      "<li>Magnetic model: WMM2025 (NOAA/BGS, public domain).</li><li>Photos: Wikimedia Commons contributors, licences as listed in Credits.</li></ul>";
    if (st) h += '<p class="muted">Version ' + esc(st.version) + "</p>";
    h += "</div>";
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ before you power off
  function viewPowerOff(tab) {
    setChrome("Before you power off", { tab: tab });
    var st = nativeState();
    var items = [
      ["Torch and signals off", "Check the torch isn't still on."],
      ["Waypoint saved", "Save your position (camp, car, casualty) in the Position tool."],
      ["Notes written", "Time, place, what you've decided. Your future self will thank you."],
      ["Next check-in time decided", "Switch on again at a set time, not 'every so often'."],
      ["Phone in a warm inside pocket", "Cold batteries die fast. Keep it dry, in a sealed bag."]
    ];
    var h = '<h1 class="page">Before you power off</h1>';
    if (st && st.battery >= 0) h += '<div class="status"><span>Battery <b>' + st.battery + "%</b></span>" + (st.charging ? "<span><b>Charging</b></span>" : "") + "</div>";
    h += '<div class="checklist"><ul>' + items.map(function (x) { return "<li><b>" + x[0] + "</b> " + x[1] + "</li>"; }).join("") + "</ul></div>";
    h += '<div class="power-how">' + icon("power", "ic-lg") + "<div><b>Hold the power button → Power off</b><span>The guide can't switch the phone off itself. Powering off between uses saves far more battery than anything else.</span></div></div>";
    h += '<p><a class="btn" href="#/tool/battery">' + icon("battery-medium", "ic-sm") + "Battery and power</a></p>";
    view.innerHTML = h;
    wireChecklists(view, "poweroff-" + new Date().toDateString());
  }

  // ------------------------------------------------------------------ global wiring
  // Long-press the title for 5 seconds to open the hidden menu (phone mode). Measured on release: no timers.
  var pressStart = 0;
  titleEl.addEventListener("pointerdown", function (e) { pressStart = e.timeStamp; });
  titleEl.addEventListener("pointerup", function (e) {
    if (pressStart && e.timeStamp - pressStart >= 5000) location.hash = "#/kiosk";
    pressStart = 0;
  });
  titleEl.addEventListener("pointercancel", function () { pressStart = 0; });
  titleEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  backBtn.onclick = function () {
    if (history.length > 1) history.back(); else location.hash = "#/";
  };
  powerBtn.onclick = function () { location.hash = "#/poweroff"; };
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('[data-search], #nav a[data-tab="search"]') : null;
    if (a) { e.preventDefault(); openSearch(); }
  });
  window.appGoHome = function () { if (location.hash === "#/" || !location.hash) render(); else location.hash = "#/"; };
  window.addEventListener("hashchange", function () { if ((location.hash || "#/") !== currentHash) render(); });
  onNative("resume", function () { if (/^#\/?$/.test(location.hash || "#/")) render(); });

  // The API tools.js and map.js build on.
  window.App = {
    IDX: IDX, NATIVE: NATIVE, view: view, settings: settings, MONTHS: MONTHS, TOOL_NAMES: TOOL_NAMES,
    icon: icon, iconTile: iconTile, esc: esc, load: load, save: save, setSetting: setSetting,
    native: native, nativeJson: nativeJson, nativeState: nativeState, onNative: onNative, offNative: offNative,
    setChrome: setChrome, sensorChip: sensorChip, render: render, rowHtml: rowHtml, loadScript: loadScript, loadCss: loadCss,
    wireChecklists: wireChecklists, openViewer: openViewer,
    route: function (head, fn) { ROUTES[head] = fn; },
    onLeave: function (fn) { var prev = leaveFn; leaveFn = prev ? function () { prev(); fn(); } : fn; },
    isCurrent: function (token) { return token === renderToken; },
    start: function () { applySettings(); render(); }
  };
})();
