/* Survival Guide web UI. Vanilla JS, no frameworks, no network, no timers or polling.
 *
 * Routes (hash based so the WebView back button and history work):
 *   #/                      home (search, emergency strip, categories, favourites, recent)
 *   #/c/<category>          category article list
 *   #/a/<article>           article
 *   #/s/<species>           species page
 *   #/species?g=&st=&q=     species browser with filters
 *   #/favs  #/recent  #/tools  #/report  #/settings  #/credits  #/about  #/kiosk
 */
(function () {
  "use strict";

  var IDX = window.GUIDE_INDEX;
  var ART = IDX.articles, SPP = IDX.species;
  var CATS = {};
  IDX.categories.forEach(function (c) { CATS[c.id] = c; });
  var NATIVE = typeof window.Android !== "undefined";
  var view = document.getElementById("view");
  var titleEl = document.getElementById("title");

  var STATUS_LABEL = {
    deadly: "DEADLY", poisonous: "Poisonous", venomous: "Venomous", caution: "Caution",
    invasive: "Invasive", edible: "Edible", medicinal: "Medicinal", protected: "Protected", info: "Info"
  };
  var GROUP_ICON = { plant: "🌿", fungus: "🍄", animal: "🐾" };
  var GROUP_LABEL = { plant: "Plants", fungus: "Fungi", animal: "Animals" };
  var TYPE_LABEL = { plant: "Plant", fungus: "Fungus", animal: "Animal" };

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

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function badges(st) {
    return '<span class="badges">' + st.map(function (s) {
      return '<span class="badge ' + s + '">' + STATUS_LABEL[s] + "</span>";
    }).join("") + "</span>";
  }
  function native(fn) {
    if (!NATIVE) return null;
    try { return window.Android[fn].apply(window.Android, Array.prototype.slice.call(arguments, 1)); } catch (e) { return null; }
  }
  function nativeState() {
    var s = native("getState");
    try { return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function lowPower() { return !!settings.lowPower; }
  function imgName(im) { return im[0]; }
  function thumbSrc(im) { return "img/t/" + im[0]; }
  function fullSrc(im) { return "img/" + im[0]; }

  function thumbHtml(item, isSpecies) {
    var ims = item.images || [];
    if (!ims.length || lowPower()) {
      return '<span class="thumb" aria-hidden="true">' + (isSpecies ? GROUP_ICON[item.group] : (CATS[item.cat] || {}).icon || "📄") + "</span>";
    }
    return '<img class="thumb" loading="lazy" decoding="async" alt="" width="64" height="64" src="' + thumbSrc(ims[0]) + '">';
  }

  function itemFromKey(key) {
    var kind = key.charAt(0), id = key.slice(2);
    if (kind === "a" && ART[id]) return { kind: "a", id: id, item: ART[id] };
    if (kind === "s" && SPP[id]) return { kind: "s", id: id, item: SPP[id] };
    return null;
  }
  function rowHtml(key) {
    var r = itemFromKey(key);
    if (!r) return "";
    if (r.kind === "a") {
      var a = r.item;
      return '<li><a class="row" href="#/a/' + a.id + '">' + thumbHtml(a, false) +
        '<span class="txt"><span class="t">' + esc(a.title) + '</span><span class="s">' + esc(a.summary) + "</span></span></a></li>";
    }
    var s = r.item;
    return '<li><a class="row' + (s.status.indexOf("deadly") >= 0 ? " deadly" : "") + '" href="#/s/' + s.id + '">' + thumbHtml(s, true) +
      '<span class="txt"><span class="t">' + esc(s.name) + '</span><span class="s"><i>' + esc(s.latin) + "</i></span>" +
      badges(s.status) + "</span></a></li>";
  }

  // Load a JS payload once (bodies, search index, credits). Works on file:// with no network.
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
  var scrollPos = {};
  var currentHash = null;
  var renderToken = 0;

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
    var parts = h.split("/").filter(Boolean);
    return { parts: parts, q: q };
  }

  function setTitle(t) { titleEl.textContent = t; }

  function render() {
    if (currentHash !== null) scrollPos[currentHash] = window.scrollY;
    currentHash = location.hash || "#/";
    var r = parseRoute(), p = r.parts, token = ++renderToken;
    document.getElementById("back").hidden = p.length === 0;
    var done = function () {
      if (token !== renderToken) return;
      window.scrollTo(0, scrollPos[currentHash] || 0);
    };
    var out;
    switch (p[0]) {
      case undefined: out = viewHome(); break;
      case "c": out = viewCategory(p[1]); break;
      case "a": out = viewArticle(p[1], token); break;
      case "s": out = viewSpecies(p[1], token); break;
      case "species": out = viewBrowser(r.q); break;
      case "favs": out = viewKeyList("Favourites", load("favs", []), "Tap ☆ on any article or species to keep it here."); break;
      case "recent": out = viewKeyList("Recently viewed", load("recent", []), "Nothing viewed yet."); break;
      case "tools": out = viewTools(); break;
      case "report": out = viewReport(); break;
      case "settings": out = viewSettings(); break;
      case "credits": out = viewCredits(token); break;
      case "about": out = viewAbout(); break;
      case "kiosk": out = viewKiosk(); break;
      default: out = viewNotFound();
    }
    if (out && out.then) out.then(done); else done();
  }

  function notFound() {
    setTitle("Not found");
    view.innerHTML = '<p class="empty">That page is not in this guide.</p><p><a class="btn" href="#/">Go to the home screen</a></p>';
  }
  function viewNotFound() { notFound(); }

  // ------------------------------------------------------------------ home + search
  function callStrip() {
    return '<div class="call-strip">' +
      '<a class="call" href="tel:999" data-dial="999">Call 999<small>Police · Ambulance · Fire · Coastguard · Mountain rescue</small></a>' +
      '<a class="call" href="tel:112" data-dial="112">Call 112<small>Same service · free · phone needs a SIM</small></a>' +
      "</div>";
  }

  function viewHome() {
    setTitle("Survival Guide");
    var st = nativeState();
    var favs = load("favs", []), recent = load("recent", []);
    var h = "";
    h += '<div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>' +
      '<input id="q" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search: nettle, CPR, ferro rod…" aria-label="Search the guide"></div>';
    h += '<div id="results"></div><div id="home-body">';
    h += callStrip();
    h += '<div class="btn-row"><a class="btn" href="#/a/emergency-priorities">⚠️ What to do first</a><a class="btn" href="#/report">📍 Location report</a><a class="btn" href="#/tools">🔦 Tools</a></div>';
    h += '<div class="tiles">';
    IDX.categories.forEach(function (c) {
      var n = c.id === "identify" ? Object.keys(SPP).length + " species · " : "";
      h += '<a class="tile' + (c.id === "emergency" ? " emergency" : "") + '" href="#/c/' + c.id + '"><span class="ico" aria-hidden="true">' + c.icon +
        "</span><b>" + esc(c.title) + "</b><span>" + n + esc(c.summary) + "</span></a>";
    });
    h += "</div>";
    if (favs.length) {
      h += '<h2 class="section-title">Favourites</h2><ul class="list">' + favs.slice(0, 6).map(rowHtml).join("") + "</ul>";
      if (favs.length > 6) h += '<p><a href="#/favs">All favourites (' + favs.length + ")</a></p>";
    }
    if (recent.length) {
      h += '<h2 class="section-title">Recently viewed</h2><ul class="list">' + recent.slice(0, 5).map(rowHtml).join("") + "</ul>";
      if (recent.length > 5) h += '<p><a href="#/recent">More recently viewed</a></p>';
    }
    h += '<p class="foot"><a href="#/species">Species guide</a> · <a href="#/favs">Favourites</a> · <a href="#/settings">Settings</a> · <a href="#/credits">Photo credits</a> · <a href="#/about">About &amp; disclaimer</a>';
    if (st && st.battery >= 0) h += "<br>Battery " + st.battery + "%" + (st.charging ? " (charging)" : "");
    h += "</p></div>";
    view.innerHTML = h;
    var q = document.getElementById("q");
    q.value = homeQuery;
    q.addEventListener("input", function () { homeQuery = q.value; runSearch(q.value); });
    q.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { q.blur(); }
    });
    if (homeQuery) runSearch(homeQuery);
    if (pendingFocus) { pendingFocus = false; q.focus(); }
  }

  var pendingFocus = false;
  var homeQuery = ""; // kept while browsing results, cleared by the Home button
  var SEARCH = null, VOCAB = null;
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
    toks.forEach(function (raw, ti) {
      var t = stem(raw), last = ti === toks.length - 1;
      var best = {};
      var maxd = t.length >= 7 ? 2 : (t.length >= 4 ? 1 : 0);
      for (var k = 0; k < VOCAB.length; k++) {
        var term = VOCAB[k], w = 0;
        if (term === t || term === raw) w = 1;
        else if (term.indexOf(t) === 0 && t.length >= 2) w = last ? 0.8 : 0.6;
        else if (maxd) {
          var d = editDistance(t, term, maxd);
          if (d <= maxd) w = d === 1 ? 0.65 : 0.4;
          else if (last && term.length > t.length && editDistance(t, term.slice(0, t.length), 1) <= 1 && t.length >= 4) w = 0.45;
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
    return Object.keys(total).map(function (doc) {
      var cover = hits[doc] / n;
      return { key: SEARCH.docs[doc], score: total[doc] * cover * cover };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 40);
  }

  function runSearch(q) {
    var res = document.getElementById("results"), body = document.getElementById("home-body");
    if (!res) return;
    if (!q.trim()) { res.innerHTML = ""; body.hidden = false; return; }
    body.hidden = true;
    if (!SEARCH) {
      res.innerHTML = '<p class="hint">Loading search index…</p>';
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
    res.innerHTML = '<p class="hint">' + out.length + (out.length === 40 ? "+" : "") + ' results</p><ul class="list">' +
      out.map(function (r) { return rowHtml(r.key); }).join("") + '</ul><div class="kbd-gap"></div>';
  }

  // ------------------------------------------------------------------ categories + lists
  function viewCategory(id) {
    var c = CATS[id];
    if (!c) return notFound();
    setTitle(c.title);
    var h = '<h1 class="page">' + c.icon + " " + esc(c.title) + '</h1><p class="lead">' + esc(c.summary) + "</p>";
    if (id === "emergency") h += callStrip();
    if (id === "first-aid") h += '<div class="banner warn">First-aid information only, not a substitute for training. In an emergency call <a href="tel:999" data-dial="999">999</a> or <a href="tel:112" data-dial="112">112</a> first.</div>';
    if (id === "identify") {
      var counts = { plant: 0, fungus: 0, animal: 0 }, deadly = 0;
      Object.keys(SPP).forEach(function (k) { counts[SPP[k].group]++; if (SPP[k].status.indexOf("deadly") >= 0) deadly++; });
      h += '<div class="banner">Never eat any wild plant or fungus unless you are 100% certain of its identity. This app is not a substitute for expert identification.</div>';
      h += '<a class="btn primary block" href="#/species">Browse all ' + Object.keys(SPP).length + " species</a>";
      h += '<div class="btn-row">' +
        '<a class="btn" href="#/species?g=plant">🌿 Plants (' + counts.plant + ")</a>" +
        '<a class="btn" href="#/species?g=fungus">🍄 Fungi (' + counts.fungus + ")</a>" +
        '<a class="btn" href="#/species?g=animal">🐾 Animals (' + counts.animal + ")</a>" +
        '<a class="btn danger" href="#/species?st=deadly">☠ Deadly (' + deadly + ")</a></div>";
      h += '<h2 class="section-title">Lookalikes and ID guides</h2>';
    }
    h += '<ul class="list">' + c.articles.map(function (a) { return rowHtml("a:" + a); }).join("") + "</ul>";
    view.innerHTML = h;
  }

  function viewKeyList(title, keys, emptyMsg) {
    setTitle(title);
    var rows = keys.map(rowHtml).join("");
    var h = '<h1 class="page">' + esc(title) + "</h1>";
    h += rows ? '<ul class="list">' + rows + "</ul>" : '<p class="empty">' + esc(emptyMsg) + "</p>";
    if (rows && title === "Recently viewed") h += '<p><button class="btn" id="clear-recent">Clear recently viewed</button></p>';
    view.innerHTML = h;
    var btn = document.getElementById("clear-recent");
    if (btn) btn.onclick = function () { save("recent", []); render(); };
  }

  // ------------------------------------------------------------------ species browser
  function viewBrowser(q) {
    setTitle("Species guide");
    var g = q.g || "", st = q.st || "", text = q.q || "";
    var groups = [["", "All"], ["plant", "🌿 Plants"], ["fungus", "🍄 Fungi"], ["animal", "🐾 Animals"]];
    var stats = [["", "Any"], ["edible", "Edible"], ["medicinal", "Medicinal"], ["caution", "Caution"], ["poisonous", "Poisonous"], ["deadly", "☠ Deadly"], ["venomous", "Venomous"], ["protected", "Protected"]];
    var h = '<h1 class="page">Species guide</h1>';
    h += '<div class="banner warn">Identify with several features, never one. Never eat wild fungi unless an expert has confirmed them in person.</div>';
    h += '<div class="chips" role="group" aria-label="Group">' + groups.map(function (x) {
      return '<button class="chip" data-g="' + x[0] + '" aria-pressed="' + (g === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="chips" role="group" aria-label="Status">' + stats.map(function (x) {
      return '<button class="chip" data-st="' + x[0] + '" aria-pressed="' + (st === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<input class="filter-input" id="sf" type="search" placeholder="Filter by name…" autocomplete="off" value="' + esc(text) + '">';
    h += '<p class="hint" id="count"></p><ul class="list" id="splist"></ul>';
    view.innerHTML = h;

    function apply() {
      var t = norm(document.getElementById("sf").value.trim());
      var ids = Object.keys(SPP).filter(function (id) {
        var s = SPP[id];
        if (g && s.group !== g) return false;
        if (st && s.status.indexOf(st) < 0) return false;
        if (t) {
          var hay = norm(s.name + " " + s.latin + " " + s.aka.join(" ") + " " + s.tags.join(" "));
          if (hay.indexOf(t) < 0) return false;
        }
        return true;
      }).sort(function (a, b) { return SPP[a].name.localeCompare(SPP[b].name); });
      document.getElementById("count").textContent = ids.length + " species";
      document.getElementById("splist").innerHTML = ids.length
        ? ids.map(function (id) { return rowHtml("s:" + id); }).join("")
        : '<li class="empty">No species match these filters.</li>';
    }
    function updateHash() {
      var parts = [];
      if (g) parts.push("g=" + g);
      if (st) parts.push("st=" + st);
      var t = document.getElementById("sf").value.trim();
      if (t) parts.push("q=" + encodeURIComponent(t));
      var nh = "#/species" + (parts.length ? "?" + parts.join("&") : "");
      history.replaceState(null, "", nh);
      currentHash = nh;
    }
    view.querySelectorAll(".chip").forEach(function (b) {
      b.onclick = function () {
        if (b.hasAttribute("data-g")) g = b.getAttribute("data-g"); else st = b.getAttribute("data-st");
        view.querySelectorAll(".chip").forEach(function (c) {
          var on = c.hasAttribute("data-g") ? c.getAttribute("data-g") === g : c.getAttribute("data-st") === st;
          c.setAttribute("aria-pressed", on);
        });
        updateHash();
        apply();
      };
    });
    document.getElementById("sf").addEventListener("input", function () { updateHash(); apply(); });
    apply();
  }

  // ------------------------------------------------------------------ photos
  function galleryHtml(ims, label) {
    if (!ims || !ims.length) return "";
    var h = '<div class="gallery" data-label="' + esc(label) + '">';
    ims.forEach(function (im, i) {
      var attrs = ' data-i="' + i + '" alt="Photo ' + (i + 1) + " of " + esc(label) + '"';
      if (i === 0) {
        h += lowPower()
          ? '<button class="photo-off" data-show="' + i + '">📷 Low-power mode: tap to show photo</button>'
          : '<img class="main" loading="lazy" decoding="async" src="' + fullSrc(im) + '" width="' + im[1] + '" height="' + im[2] + '"' + attrs + ">";
        if (ims.length > 1) h += '<div class="more">';
      } else {
        h += lowPower()
          ? '<button class="photo-off" data-show="' + i + '">Photo ' + (i + 1) + "</button>"
          : '<img loading="lazy" decoding="async" src="' + thumbSrc(im) + '" width="96" height="96"' + attrs + ">";
      }
    });
    if (ims.length > 1) h += "</div>";
    h += '<p class="credit" id="credit-line">Tap a photo to zoom. Photos: Wikimedia Commons, see credits.</p></div>';
    return h;
  }

  function wireGallery(root, ims, label) {
    var g = root.querySelector(".gallery");
    if (!g) return;
    g.addEventListener("click", function (e) {
      var t = e.target;
      if (t.hasAttribute("data-show")) {
        var i = +t.getAttribute("data-show"), im = ims[i];
        var img = document.createElement("img");
        img.src = i === 0 ? fullSrc(im) : thumbSrc(im);
        img.className = i === 0 ? "main" : "";
        img.setAttribute("data-i", i);
        img.alt = "Photo " + (i + 1) + " of " + label;
        t.parentNode.replaceChild(img, t);
        return;
      }
      if (t.tagName === "IMG" && t.hasAttribute("data-i")) openViewer(ims, +t.getAttribute("data-i"), label);
    });
    loadCredits().then(function (cr) {
      var line = g.querySelector("#credit-line");
      if (!line) return;
      var names = ims.map(function (im) {
        var c = cr[imgName(im)];
        return c ? esc(c.author) + " (" + esc(c.license) + ")" : "";
      }).filter(Boolean);
      if (names.length) line.innerHTML = "Photos: " + names.join("; ") + ' · <a href="#/credits">licences</a>';
    });
  }

  // Full-screen viewer with pinch-zoom and pan. Pure pointer events; no timers.
  var V = { ims: [], i: 0, label: "", s: 1, x: 0, y: 0, pts: {}, start: null, lastTap: 0, open: false };
  var vEl = document.getElementById("viewer"), vImg = document.getElementById("viewer-img");
  function vApply() { vImg.style.transform = "translate(" + V.x + "px," + V.y + "px) scale(" + V.s + ")"; }
  function vReset() {
    V.s = 1; V.x = 0; V.y = 0; V.pts = {}; V.start = null;
    vImg.style.transform = "";
    vImg.style.transformOrigin = "0 0";
  }
  function vShow() {
    var im = V.ims[V.i];
    vReset();
    vImg.src = fullSrc(im);
    vImg.alt = V.label;
    document.getElementById("viewer-prev").hidden = V.i === 0;
    document.getElementById("viewer-next").hidden = V.i >= V.ims.length - 1;
    var cap = document.getElementById("viewer-caption");
    cap.textContent = V.label + (V.ims.length > 1 ? " · " + (V.i + 1) + "/" + V.ims.length : "");
    loadCredits().then(function (cr) {
      var c = cr[imgName(im)];
      if (c) cap.textContent = V.label + (V.ims.length > 1 ? " · " + (V.i + 1) + "/" + V.ims.length : "") + " · Photo: " + c.author + " · " + c.license;
    });
  }
  function openViewer(ims, i, label) {
    V.ims = ims; V.i = i; V.label = label; V.open = true;
    vEl.hidden = false;
    vShow();
    history.pushState({ viewer: true }, "");
  }
  function closeViewer(fromPop) {
    if (!V.open) return;
    V.open = false;
    vEl.hidden = true;
    vImg.removeAttribute("src");
    if (!fromPop) history.back();
  }
  window.addEventListener("popstate", function () { if (V.open) closeViewer(true); });
  document.getElementById("viewer-close").onclick = function () { closeViewer(false); };
  document.getElementById("viewer-prev").onclick = function () { if (V.i > 0) { V.i--; vShow(); } };
  document.getElementById("viewer-next").onclick = function () { if (V.i < V.ims.length - 1) { V.i++; vShow(); } };

  // Image coordinates: the image is laid out centred; we transform around its top-left corner.
  function imgBox() { var r = vImg.getBoundingClientRect(); return { left: r.left - V.x, top: r.top - V.y }; }
  function zoomAt(cx, cy, ns) {
    ns = Math.max(1, Math.min(8, ns));
    var b = imgBox();
    // keep the point under (cx, cy) fixed
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
        if (dx < 0 && V.i < V.ims.length - 1) { V.i++; vShow(); }
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

  // ------------------------------------------------------------------ article + species pages
  function favButton(key) {
    return '<button class="icon-btn fav" id="favbtn" aria-label="Favourite" aria-pressed="' + isFav(key) + '">' + (isFav(key) ? "★" : "☆") + "</button>";
  }
  function wireFav(key) {
    var b = document.getElementById("favbtn");
    if (b) b.onclick = function () { var on = toggleFav(key); b.setAttribute("aria-pressed", on); b.textContent = on ? "★" : "☆"; };
  }

  function compareHtml(ids) {
    return '<div class="compare">' + ids.map(function (id) {
      var s = SPP[id];
      if (!s) return "";
      var ims = s.images || [];
      var pic = ims.length && !lowPower()
        ? '<img loading="lazy" decoding="async" src="' + fullSrc(ims[0]) + '" alt="' + esc(s.name) + '">'
        : '<span class="noimg">' + GROUP_ICON[s.group] + "</span>";
      return '<a class="card' + (s.status.indexOf("deadly") >= 0 ? " deadly" : "") + '" href="#/s/' + id + '">' + pic +
        '<span class="c"><b>' + esc(s.name) + "</b><i>" + esc(s.latin) + "</i>" + badges(s.status) + "</span></a>";
    }).join("") + "</div>";
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
    // Lists in a "checklist" section get persistent tick boxes (kit checklist).
    var state = load("checks", {});
    root.querySelectorAll(".checklist ul, .checklist ol").forEach(function (list, li) {
      list.classList.add("check-list");
      list.querySelectorAll(":scope > li").forEach(function (item, ii) {
        var id = key + ":" + li + ":" + ii;
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!state[id];
        cb.setAttribute("aria-label", "Packed / checked");
        cb.onchange = function () { var s = load("checks", {}); if (cb.checked) s[id] = 1; else delete s[id]; save("checks", s); };
        item.insertBefore(cb, item.firstChild);
      });
    });
  }

  function viewArticle(id, token) {
    var a = ART[id];
    if (!a) return notFound();
    var c = CATS[a.cat];
    setTitle(a.title);
    addRecent("a:" + id);
    view.innerHTML = '<p class="crumb"><a href="#/c/' + a.cat + '">' + c.icon + " " + esc(c.title) + "</a></p>" +
      favButton("a:" + id) + '<h1 class="page">' + esc(a.title) + '</h1><div class="body" id="body"><p class="muted" id="loading">Loading…</p></div>';
    wireFav("a:" + id);
    return loadBody("a/" + id).then(function (html) {
      if (token !== renderToken) return;
      var body = document.getElementById("body");
      body.innerHTML = html;
      var extra = "";
      if (a.compare) extra += compareHtml(a.compare);
      if (a.images) extra += galleryHtml(a.images, a.title);
      insertAfterQuick(body, extra);
      if (a.cat === "first-aid") {
        body.insertAdjacentHTML("afterbegin", '<p class="small muted">First-aid information, not a substitute for training. Emergency: <a href="tel:999" data-dial="999">999</a> / <a href="tel:112" data-dial="112">112</a>.</p>');
      }
      if (a.images) wireGallery(body, a.images, a.title);
      wireChecklists(body, "a:" + id);
    }, function () {
      document.getElementById("body").innerHTML = '<p class="empty">This article could not be loaded.</p>';
    });
  }

  function viewSpecies(id, token) {
    var s = SPP[id];
    if (!s) return notFound();
    setTitle(s.name);
    addRecent("s:" + id);
    var h = '<p class="crumb"><a href="#/species?g=' + s.group + '">' + GROUP_ICON[s.group] + " " + GROUP_LABEL[s.group] + "</a></p>";
    h += favButton("s:" + id) + '<h1 class="page">' + esc(s.name) + '</h1><p class="latin">' + esc(s.latin) + "</p>" + badges(s.status);
    if (s.group === "fungus") {
      h += '<div class="banner">Never eat any wild fungus unless its identity has been confirmed in person by an expert. Several UK fungi kill, with symptoms delayed for hours or days.</div>';
    } else if (s.status.indexOf("edible") >= 0 && s.group === "plant") {
      h += '<div class="banner warn">Only eat a wild plant if you are 100% certain of its identity, using several features. If in doubt, leave it out.</div>';
    }
    h += galleryHtml(s.images, s.name);
    h += '<dl class="facts">';
    if (s.aka.length) h += "<dt>Also called</dt><dd>" + esc(s.aka.join(", ")) + "</dd>";
    h += "<dt>Type</dt><dd>" + TYPE_LABEL[s.group] + (s.kind ? " · " + esc(s.kind) : "") + "</dd>";
    h += "<dt>Season</dt><dd>" + esc(s.season) + "</dd>";
    h += "<dt>Habitat</dt><dd>" + esc(s.habitat) + "</dd></dl>";
    h += '<p class="lead">' + esc(s.summary) + "</p>";
    if (s.lookalikes.length) {
      var dangerous = s.lookalikes.filter(function (l) { return SPP[l] && (SPP[l].status.indexOf("deadly") >= 0 || SPP[l].status.indexOf("poisonous") >= 0); });
      h += '<h2 class="section-title">' + (dangerous.length ? "⚠ Lookalikes, including dangerous ones" : "Lookalikes") + "</h2>";
      h += '<ul class="list">' + s.lookalikes.map(function (l) { return rowHtml("s:" + l); }).join("") + "</ul>";
    }
    h += '<div class="body" id="body"></div>';
    view.innerHTML = h;
    wireFav("s:" + id);
    wireGallery(view, s.images, s.name);
    return loadBody("s/" + id).then(function (html) {
      if (token !== renderToken) return;
      document.getElementById("body").innerHTML = html;
    });
  }

  // ------------------------------------------------------------------ tools
  function viewTools() {
    setTitle("Tools");
    var st = nativeState();
    var h = '<h1 class="page">Tools</h1>';
    h += callStrip();
    if (!NATIVE) h += '<div class="banner warn">The tool buttons only work inside the app on the phone.</div>';
    h += '<div class="tools">' +
      '<button class="btn' + (st && st.torch ? " on" : "") + '" id="torch"><span class="ico">🔦</span>Torch ' + (st && st.torch ? "ON" : "off") + "</button>" +
      '<button class="btn" data-tool="fm"><span class="ico">📻</span>FM Radio</button>' +
      '<button class="btn" data-tool="camera"><span class="ico">📷</span>Camera</button>' +
      '<button class="btn" data-tool="calculator"><span class="ico">🧮</span>Calculator</button>' +
      '<button class="btn" data-tool="clock"><span class="ico">⏰</span>Clock / alarm</button>' +
      '<button class="btn" data-tool="battery"><span class="ico">🔋</span>Battery</button>' +
      '<a class="btn" href="#/report"><span class="ico">📍</span>Location report</a>' +
      '<a class="btn" href="#/settings"><span class="ico">⚙️</span>Guide settings</a>' +
      "</div>";
    h += '<p class="hint">FM Radio needs wired headphones as its aerial. The torch stays on until you switch it off: check it before putting the phone away.</p>';
    if (st) {
      h += '<div class="status">Battery: ' + (st.battery >= 0 ? st.battery + "%" : "unknown") + (st.charging ? " · charging" : "") +
        (st.batteryTempC != null ? " · " + st.batteryTempC + " °C" : "") + "<br>Guide version " + esc(st.version) + "</div>";
    }
    h += '<p><a href="#/a/batteries-electronics">Keeping the phone and batteries alive</a> · <a href="#/a/solar-panel">Solar charging</a></p>';
    view.innerHTML = h;
    view.querySelectorAll("[data-tool]").forEach(function (b) {
      b.onclick = function () {
        var ok = native("launchTool", b.getAttribute("data-tool"));
        if (!ok) alert(NATIVE ? "That app is not available (it may have been removed or is blocked in kiosk mode)." : "Only available on the phone.");
      };
    });
    document.getElementById("torch").onclick = function () {
      var cur = nativeState();
      var want = !(cur && cur.torch);
      var ok = native("setTorch", want);
      if (!ok) alert(NATIVE ? "The torch could not be switched (camera may be in use)." : "Only available on the phone.");
      render();
    };
  }

  // Location report builder: compose what to say to 999 / 112 (or text to 999 if registered).
  function viewReport() {
    setTitle("Location report");
    var r = load("report", {});
    var fields = [
      ["grid", "OS grid reference (2 letters + 6–10 digits)", "e.g. NN 166 712"],
      ["place", "Nearest named place / landmark / path", "e.g. 300 m north of Loch X bothy, on the main path"],
      ["what", "What has happened", "e.g. walker fallen, suspected broken ankle, cannot walk"],
      ["who", "How many people; ages; conditions", "e.g. 2 people; 1 injured, 54, conscious, cold"],
      ["have", "What you have (shelter, food, light, battery %)", "e.g. tarp, stove, torch, phone 40%"],
      ["you", "Your name and how you will signal", "e.g. Sam; orange tarp; whistle; torch"]
    ];
    var h = '<h1 class="page">Location report</h1><p class="lead">Fill this in calmly, then read it out to the operator. Ask for <b>Police, then Mountain Rescue</b> on land, or <b>Coastguard</b> at the coast. Help: <a href="#/a/grid-references">reading a grid reference</a>.</p>';
    h += '<div class="form">' + fields.map(function (f) {
      return '<label for="r-' + f[0] + '">' + f[1] + '</label><input id="r-' + f[0] + '" data-k="' + f[0] + '" placeholder="' + esc(f[2]) + '" value="' + esc(r[f[0]] || "") + '" autocomplete="off">';
    }).join("") + "</div>";
    h += '<h2 class="section-title">Read this out</h2><div class="report" id="report-out"></div>';
    h += '<div class="btn-row"><a class="btn primary" href="tel:999" data-dial="999">Call 999</a><button class="btn" id="r-clear">Clear</button></div>';
    h += '<p class="hint">Emergency SMS (text to 999) only works if this phone number was registered in advance by texting "register" to 999, and only with mobile signal (airplane mode off). Calls to 999/112 are better whenever you can make one.</p>';
    view.innerHTML = h;
    function out() {
      var x = load("report", {});
      var lines = [];
      lines.push("EMERGENCY: " + (x.what || "[what has happened]"));
      lines.push("Location grid ref: " + (x.grid || "[grid ref]"));
      lines.push("Near: " + (x.place || "[landmark]"));
      lines.push("People: " + (x.who || "[number, condition]"));
      lines.push("We have: " + (x.have || "[kit]"));
      lines.push("Contact / signal: " + (x.you || "[name, signal]"));
      document.getElementById("report-out").textContent = lines.join("\n");
    }
    view.querySelectorAll(".form input").forEach(function (inp) {
      inp.addEventListener("input", function () { var x = load("report", {}); x[inp.getAttribute("data-k")] = inp.value; save("report", x); out(); });
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
    var bar = getComputedStyle(root).getPropertyValue("--surface").trim();
    if (bar) native("setSystemBarColor", bar.length === 4 ? "#" + bar[1] + bar[1] + bar[2] + bar[2] + bar[3] + bar[3] : bar);
  }

  function viewSettings() {
    setTitle("Settings");
    var st = nativeState();
    var bright = st ? st.brightness : -1;
    var theme = settings.theme || "dark";
    var h = '<h1 class="page">Settings</h1>';
    h += '<div class="setting"><span class="h" style="font-weight:700">Display mode</span><div class="chips">' +
      [["dark", "Dark"], ["light", "Bright sun (high contrast)"], ["red", "Night (red)"]].map(function (t) {
        return '<button class="chip" data-theme-opt="' + t[0] + '" aria-pressed="' + (theme === t[0]) + '">' + t[1] + "</button>";
      }).join("") + '</div><p class="desc">Dark is easiest on the eyes and battery. Use high contrast in bright sunlight; red at night to keep your night vision.</p></div>';
    h += '<div class="setting"><label class="h" for="fs">Text size: <span id="fsv">' + (settings.fs || 18) + "</span> px</label>" +
      '<input id="fs" type="range" min="14" max="30" step="1" value="' + (settings.fs || 18) + '"></div>';
    h += '<div class="setting"><span style="font-weight:700">Screen brightness</span>' +
      '<label class="check"><input type="checkbox" id="bsys"' + (bright < 0 ? " checked" : "") + (NATIVE ? "" : " disabled") + "> Follow phone setting</label>" +
      '<input id="bright" type="range" min="0" max="100" step="1" value="' + (bright < 0 ? 30 : Math.round(bright * 100)) + '"' + (bright < 0 || !NATIVE ? " disabled" : "") + ">" +
      '<p class="desc">Applies only while the guide is open. The bottom of the slider is dimmer than the phone\'s own minimum; the backlight is the biggest battery drain.' + (NATIVE ? "" : " (Phone only.)") + "</p></div>";
    h += '<div class="setting"><label class="h" for="dimr">Extra dimming: <span id="dimv">' + (settings.dim || 0) + "</span>%</label>" +
      '<input id="dimr" type="range" min="0" max="80" step="5" value="' + (settings.dim || 0) + '"><p class="desc">Darkens the page on top of the backlight, for reading in the dark.</p></div>';
    h += '<div class="setting"><label class="check"><input type="checkbox" id="lowp"' + (settings.lowPower ? " checked" : "") + "> Low-power mode</label>" +
      '<p class="desc">Hides photos until you tap them. Saves battery and memory.</p></div>';
    h += '<div class="setting"><span style="font-weight:700">Your data</span><div class="btn-row">' +
      '<button class="btn" id="clr-recent">Clear recently viewed</button><button class="btn" id="clr-favs">Clear favourites</button><button class="btn" id="clr-checks">Clear kit ticks</button></div></div>';
    h += '<p class="foot"><a href="#/about">About &amp; disclaimer</a> · <a href="#/credits">Photo credits &amp; licences</a></p>';
    view.innerHTML = h;

    view.querySelectorAll("[data-theme-opt]").forEach(function (b) {
      b.onclick = function () { setSetting("theme", b.getAttribute("data-theme-opt")); applySettings(); render(); };
    });
    var fs = document.getElementById("fs");
    fs.oninput = function () { setSetting("fs", +fs.value); document.getElementById("fsv").textContent = fs.value; applySettings(); };
    var br = document.getElementById("bright"), bsys = document.getElementById("bsys");
    br.oninput = function () { native("setBrightness", Math.pow(+br.value / 100, 2)); };
    bsys.onchange = function () {
      br.disabled = bsys.checked;
      native("setBrightness", bsys.checked ? -1 : Math.pow(+br.value / 100, 2));
    };
    if (bright >= 0) br.value = Math.round(Math.sqrt(bright) * 100);
    var dimr = document.getElementById("dimr");
    dimr.oninput = function () { setSetting("dim", +dimr.value); document.getElementById("dimv").textContent = dimr.value; applySettings(); };
    document.getElementById("lowp").onchange = function (e) { setSetting("lowPower", e.target.checked); };
    document.getElementById("clr-recent").onclick = function () { if (confirm("Clear recently viewed?")) save("recent", []); };
    document.getElementById("clr-favs").onclick = function () { if (confirm("Clear all favourites?")) save("favs", []); };
    document.getElementById("clr-checks").onclick = function () { if (confirm("Untick all kit checklist items?")) save("checks", {}); };
  }

  // ------------------------------------------------------------------ credits + about
  function viewCredits(token) {
    setTitle("Photo credits");
    view.innerHTML = '<h1 class="page">Photo credits &amp; licences</h1><p class="muted">Loading…</p>';
    return loadCredits().then(function (cr) {
      if (token !== renderToken) return;
      var owners = {};
      Object.keys(SPP).forEach(function (id) { (SPP[id].images || []).forEach(function (im) { owners[im[0]] = SPP[id].name; }); });
      Object.keys(ART).forEach(function (id) { (ART[id].images || []).forEach(function (im) { owners[im[0]] = ART[id].title; }); });
      var names = Object.keys(cr).sort(function (a, b) { return (owners[a] || "").localeCompare(owners[b] || ""); });
      var h = '<h1 class="page">Photo credits &amp; licences</h1>';
      h += '<p class="lead">All ' + names.length + " photos come from Wikimedia Commons and are used under the licences shown (public domain, CC0, CC BY or CC BY-SA). They were resized and converted to WebP for this offline app. CC BY-SA photos remain under CC BY-SA. Full licence texts: creativecommons.org/licenses.</p>";
      h += '<ul class="list">' + names.map(function (n) {
        var c = cr[n];
        return '<li class="row" style="align-items:flex-start">' + (lowPower() ? "" : '<img class="thumb" loading="lazy" alt="" src="img/t/' + n + '">') +
          '<span class="txt"><span class="t">' + esc(owners[n] || n) + '</span><span class="s">' + esc(c.author) + " · " + esc(c.license) +
          '</span><span class="s">' + esc(c.commons) + '</span><span class="s">' + esc(c.source) + "</span></span></li>";
      }).join("") + "</ul>";
      view.innerHTML = h;
    }, function () { view.innerHTML = '<p class="empty">No photo credits found.</p>'; });
  }

  function viewAbout() {
    setTitle("About");
    var st = nativeState();
    var h = '<h1 class="page">About this guide</h1>';
    h += '<div class="banner">This guide is general information for a dedicated offline survival phone. It is not a substitute for first-aid training, expert identification of plants and fungi, or professional rescue. <b>In an emergency call 999 or 112.</b></div>';
    h += '<div class="body">';
    h += "<h2>Foraging</h2><p>Never eat any wild plant, berry or fungus unless you are 100% certain what it is, using several features, ideally confirmed in person by an expert. Several UK species kill, and some deadly fungi cause no symptoms for a day or more. Photos and descriptions here cannot replace a specimen in an expert's hand.</p>";
    h += "<h2>First aid</h2><p>First-aid content follows NHS, St John Ambulance and British Red Cross public guidance as written at the time of writing. Guidance changes; training matters more than reading.</p>";
    h += "<h2>The law</h2><p>UK wildlife, access and fishing law applies. Most wild animals are protected; uprooting wild plants without the landowner's permission is illegal; many traps and snares are banned. The guide says where something is restricted.</p>";
    h += "<h2>Contents</h2><p>" + IDX.counts.articles + " articles, " + IDX.counts.species + " species, " + IDX.counts.photos + ' photos. Every article ends with its sources. <a href="#/credits">Photo credits &amp; licences</a>.</p>';
    h += "<h2>Offline by design</h2><p>The guide never uses the network: no fonts, images, analytics or updates are fetched. The app has no internet permission. It runs no background services, keeps no wakelocks, uses no timers or polling, and follows the phone's screen timeout.</p>";
    if (st) h += "<p class=\"muted\">Version " + esc(st.version) + "</p>";
    h += "</div>";
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ hidden kiosk menu
  function viewKiosk() {
    setTitle("Kiosk settings");
    var st = nativeState() || {};
    var h = '<h1 class="page">Kiosk / device owner</h1>';
    h += '<div class="status">Device owner: <b>' + (st.deviceOwner ? "yes" : "no") + "</b><br>Pinned (lock task): <b>" + (st.lockTask ? "yes" : "no") +
      "</b><br>Kiosk pin enabled: <b>" + (st.kioskEnabled ? "yes" : "no") + "</b>" + (st.kioskSuspended ? " (paused until restart)" : "") + "</div>";
    h += '<button class="btn block" id="k-exit">Unpin and open phone Settings</button><p class="hint">The pin comes back after the phone restarts.</p>';
    h += '<button class="btn block" id="k-toggle">' + (st.kioskEnabled ? "Turn kiosk pin off permanently" : "Turn kiosk pin on") + "</button>";
    h += '<button class="btn danger block" id="k-remove"' + (st.deviceOwner ? "" : " disabled") + ">Remove device owner</button>";
    h += '<p class="hint">Removing device owner makes this an ordinary app again (needed before uninstalling it). To restore it, run the adb <code>dpm set-device-owner</code> command again.</p>';
    view.innerHTML = h;
    document.getElementById("k-exit").onclick = function () {
      if (confirm("Unpin the guide and open the phone's Settings?")) native("exitKiosk");
    };
    document.getElementById("k-toggle").onclick = function () {
      native("setKioskEnabled", !st.kioskEnabled);
      render();
    };
    document.getElementById("k-remove").onclick = function () {
      if (confirm("Remove device owner? The guide will no longer be pinned or protected.") && confirm("Are you sure? Restoring it needs a PC with adb.")) {
        var ok = native("removeDeviceOwner");
        alert(ok ? "Device owner removed." : "Could not remove device owner.");
        render();
      }
    };
  }

  // ------------------------------------------------------------------ global wiring
  // Long-press the title for 5 seconds to open the hidden kiosk menu. Measured on release: no timers.
  var pressStart = 0;
  titleEl.addEventListener("pointerdown", function (e) { pressStart = e.timeStamp; });
  titleEl.addEventListener("pointerup", function (e) {
    if (pressStart && e.timeStamp - pressStart >= 5000) location.hash = "#/kiosk";
    pressStart = 0;
  });
  titleEl.addEventListener("pointercancel", function () { pressStart = 0; });
  titleEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  document.getElementById("back").onclick = function () { history.back(); };
  document.getElementById("homeBtn").onclick = function () { goHome(false); };
  document.getElementById("searchBtn").onclick = function () { goHome(true); };

  function goHome(focusSearch) {
    pendingFocus = focusSearch;
    homeQuery = "";
    if (location.hash === "#/" || location.hash === "" || location.hash === "#") {
      render();
    } else {
      location.hash = "#/";
    }
  }
  window.appGoHome = function () { goHome(false); };

  // Phone links: use the native dialer bridge (tel: also works as a fallback).
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("[data-dial]") : null;
    if (a && NATIVE) {
      e.preventDefault();
      native("dial", a.getAttribute("data-dial"));
    }
  });

  window.addEventListener("hashchange", render);
  applySettings();
  render();
})();
