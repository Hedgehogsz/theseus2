/* Survival Guide web UI. Vanilla JS, no frameworks, no network, no timers or polling.
 *
 * Routes (hash based so the WebView back button and history work):
 *   tabs:   #/  #/search?q=  #/species?g=&st=&q=  #/saved  #/tools
 *   pages:  #/c/<category>  #/a/<article>  #/s/<species>  #/report  #/settings  #/credits  #/about  #/kiosk
 *
 * This device has no SIM card and cannot call or text anyone; nothing here may suggest otherwise.
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
  var barEl = document.getElementById("bar");
  var backBtn = document.getElementById("back");
  var saveBtn = document.getElementById("save");
  var battEl = document.getElementById("batt");

  // icons: arrow-left bookmark house search leaf wrench x chevron-left chevron-right
  // icons: skull triangle-alert check heart shield circle-alert info lightbulb scale list-checks list-ordered
  // icons: flashlight radio camera calculator alarm-clock battery-medium settings map-pin sliders-horizontal
  // icons: images calendar trees paw-print mushroom sprout megaphone image-off
  var STATUS_LABEL = {
    deadly: "Deadly", poisonous: "Poisonous", venomous: "Venomous", caution: "Caution",
    invasive: "Invasive", edible: "Edible", medicinal: "Medicinal", protected: "Protected", info: "Useful"
  };
  var STATUS_ICON = { deadly: "skull", poisonous: "triangle-alert", venomous: "triangle-alert", caution: "circle-alert",
    edible: "check", medicinal: "heart", protected: "shield" };
  var GROUP_ICON = { plant: "sprout", fungus: "mushroom", animal: "paw-print" };
  var GROUP_LABEL = { plant: "Plants", fungus: "Fungi", animal: "Animals" };
  var TYPE_LABEL = { plant: "Plant", fungus: "Fungus", animal: "Animal" };
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
  function native(fn) {
    if (!NATIVE) return null;
    try { return window.Android[fn].apply(window.Android, Array.prototype.slice.call(arguments, 1)); } catch (e) { return null; }
  }
  function nativeState() {
    var s = native("getState");
    try { return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function lowPower() { return !!settings.lowPower; }
  function thumbSrc(im) { return "img/t/" + im[0]; }
  function fullSrc(im) { return "img/" + im[0]; }
  function isDeadly(s) { return s.status.indexOf("deadly") >= 0; }

  function articleVisual(a) {
    // A relevant photo where the article has one (e.g. lookalike comparisons), otherwise its own icon.
    var im = (a.images && a.images[0]) || (a.compare && SPP[a.compare[0]] && SPP[a.compare[0]].images[0]);
    if (im && !lowPower()) return '<img class="thumb" loading="lazy" decoding="async" alt="" src="' + thumbSrc(im) + '">';
    return iconTile(a.icon || CATS[a.cat].icon, "c-" + a.cat);
  }
  function speciesVisual(s) {
    if (s.images.length && !lowPower()) return '<img class="thumb" loading="lazy" decoding="async" alt="" src="' + thumbSrc(s.images[0]) + '">';
    return iconTile(GROUP_ICON[s.group], "g-" + s.group);
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
      return '<li><a class="row" href="#/a/' + a.id + '">' + articleVisual(a) +
        '<span class="txt"><span class="t">' + esc(a.title) + '</span><span class="s">' + esc(a.summary) + "</span></span>" +
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
    return '<a class="scard' + (isDeadly(s) ? " deadly" : "") + '" href="#/s/' + id + '"><span class="ph">' + ph +
      '<span class="pills ph-pills">' + pill(s.status[0]) + "</span></span>" +
      '<span class="meta"><b>' + esc(s.name) + "</b><i>" + esc(s.latin) + "</i></span></a>";
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
  var ROOTS = { "": "home", search: "search", species: "species", saved: "saved", tools: "tools" };
  var TAB_OF = { c: "home", a: "home", s: "species", favs: "saved", recent: "saved", report: "tools", settings: "tools",
    credits: "tools", about: "tools", kiosk: "tools" };
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

  function render() {
    if (currentHash !== null) scrollPos[currentHash] = window.scrollY;
    currentHash = location.hash || "#/";
    var r = parseRoute(), p = r.parts, token = ++renderToken;
    var head = p[0] || "";
    var tab = ROOTS[head] !== undefined ? ROOTS[head] : (TAB_OF[head] || "home");
    var done = function () {
      if (token !== renderToken) return;
      window.scrollTo(0, scrollPos[currentHash] || 0);
    };
    var out;
    switch (head) {
      case "": out = viewHome(tab); break;
      case "search": viewSearch(r.q, tab); break;
      case "species": out = viewBrowser(r.q, tab); break;
      case "saved": case "favs": case "recent": out = viewSaved(tab); break;
      case "tools": out = viewTools(tab); break;
      case "c": out = viewCategory(p[1], tab); break;
      case "a": out = viewArticle(p[1], token, tab); break;
      case "s": out = viewSpecies(p[1], token, tab); break;
      case "report": out = viewReport(tab); break;
      case "settings": out = viewSettings(tab); break;
      case "credits": out = viewCredits(token, tab); break;
      case "about": out = viewAbout(tab); break;
      case "kiosk": out = viewKiosk(tab); break;
      default: out = notFound();
    }
    if (out && out.then) out.then(done); else done();
  }

  function notFound() {
    setChrome("Not found", { tab: "home" });
    view.innerHTML = '<p class="empty">That page is not in this guide.</p><p><a class="btn" href="#/">Go to the home screen</a></p>';
  }

  // ------------------------------------------------------------------ home
  function viewHome(tab) {
    setChrome("Survival Guide", { root: true, tab: tab, battery: true });
    var recent = load("recent", []).filter(itemFromKey);
    var h = "";
    h += '<a class="searchbox" href="#/search" data-search>' + icon("search") + '<span class="ph-text">Search guides and species</span></a>';
    h += '<div class="actions">' +
      '<a class="action primary" href="#/a/emergency-priorities"><span class="badge-ic">' + icon("list-checks", "ic-lg") + "</span>" +
      '<span class="txt"><b>What to do first</b><span class="sub">Safety, life threats, shelter, then help</span></span>' + icon("chevron-right", "chev") + "</a>" +
      '<a class="action" href="#/a/signalling-rescue"><span class="badge-ic">' + icon("megaphone", "ic-lg") + "</span>" +
      '<span class="txt"><b>Signal for help</b><span class="sub">6 whistle blasts or flashes a minute · SOS · V · X</span></span>' + icon("chevron-right", "chev") + "</a>" +
      "</div>";
    h += '<div class="section"><span class="label">Guides</span><div class="tiles">';
    IDX.categories.forEach(function (c) {
      h += '<a class="tile c-' + c.id + '" href="#/c/' + c.id + '">' + iconTile(c.icon, "") +
        "<span><b>" + esc(c.title) + '</b><span class="sub">' + esc(c.short) + "</span></span></a>";
    });
    h += "</div></div>";
    if (recent.length) {
      h += '<div class="section"><span class="label">Recently viewed</span><ul class="list">' +
        recent.slice(0, 3).map(rowHtml).join("") + "</ul></div>";
    }
    h += '<div class="foot"><a href="#/report">Location report</a><a href="#/settings">Settings</a><a href="#/about">About</a><a href="#/credits">Photo credits</a></div>';
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ search
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
      // A correctly spelt word that exists in the guide shouldn't be swamped by look-alike words
      // ("whistle" vs "thistle"); typos ("nettel") have no exact entry, so fuzzy matches count fully.
      var fuzzyFactor = terms[t] || terms[raw] ? 0.2 : 1;
      for (var k = 0; k < VOCAB.length; k++) {
        var term = VOCAB[k], w = 0;
        if (term === t || term === raw) w = 1;
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
      var name = r.kind === "a" ? r.item.title : r.item.name;
      var alt = r.kind === "a" ? "" : r.item.latin + " " + r.item.aka.join(" ");
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

  // ------------------------------------------------------------------ categories
  function viewCategory(id, tab) {
    var c = CATS[id];
    if (!c) return notFound();
    setChrome(c.title, { tab: tab });
    var h = '<div class="cat-head c-' + c.id + '">' + iconTile(c.icon, "", "page-icon") + '<h1 class="page">' + esc(c.title) + '</h1></div><p class="lead">' + esc(c.summary) + "</p>";
    if (id === "first-aid") h += '<div class="banner info">' + icon("info") + '<span>First-aid information, not a substitute for training. This phone can\'t call: see <a href="#/a/when-to-get-help">sending for help</a>.</span></div>';
    if (id === "emergency") h += '<div class="banner info">' + icon("info") + "<span>This phone has no SIM card and <b>cannot call 999 or 112</b>. Get help by signalling, being found, or reaching a working phone or a person.</span></div>";
    if (id === "identify") {
      var counts = { plant: 0, fungus: 0, animal: 0 }, deadly = 0;
      Object.keys(SPP).forEach(function (k) { counts[SPP[k].group]++; if (isDeadly(SPP[k])) deadly++; });
      h += '<div class="banner">' + icon("triangle-alert") + "<span>Never eat any wild plant or fungus unless you are 100% certain what it is. This guide is not a substitute for expert identification.</span></div>";
      h += '<a class="action primary" href="#/species"><span class="badge-ic">' + icon("leaf", "ic-lg") + '</span><span class="txt"><b>Browse all ' +
        Object.keys(SPP).length + ' species</b><span class="sub">' + counts.plant + " plants · " + counts.fungus + " fungi · " + counts.animal + " animals · " + deadly + " deadly</span></span>" + icon("chevron-right", "chev") + "</a>";
      h += '<div class="chips" style="margin-top:8px">' +
        '<a class="chip g-plant" href="#/species?g=plant"><span class="dot"></span>Plants</a>' +
        '<a class="chip g-fungus" href="#/species?g=fungus"><span class="dot"></span>Fungi</a>' +
        '<a class="chip g-animal" href="#/species?g=animal"><span class="dot"></span>Animals</a>' +
        '<a class="chip" href="#/species?st=deadly">' + icon("skull") + "Deadly</a></div>";
      h += '<div class="section"><span class="label">Lookalikes and ID guides</span>';
    } else {
      h += '<div class="section"><span class="label">' + c.articles.length + " guides</span>";
    }
    h += '<ul class="list">' + c.articles.map(function (a) { return rowHtml("a:" + a); }).join("") + "</ul></div>";
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ saved
  function viewSaved(tab) {
    setChrome("Saved", { root: true, tab: tab });
    var favs = load("favs", []).filter(itemFromKey), recent = load("recent", []).filter(itemFromKey);
    var h = '<span class="label">Saved</span>';
    h += favs.length ? '<ul class="list">' + favs.map(rowHtml).join("") + "</ul>"
      : '<div class="banner info">' + icon("bookmark") + "<span>Tap the bookmark at the top of any guide or species to keep it here.</span></div>";
    h += '<div class="section"><span class="label">Recently viewed</span>';
    h += recent.length ? '<ul class="list">' + recent.slice(0, 15).map(rowHtml).join("") + '</ul><button class="btn" id="clear-recent" style="margin-top:8px">Clear recently viewed</button>'
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
    var groups = [["", "All", ""], ["plant", "Plants", "g-plant"], ["fungus", "Fungi", "g-fungus"], ["animal", "Animals", "g-animal"]];
    var stats = [["edible", "Edible"], ["medicinal", "Medicinal"], ["caution", "Caution"], ["poisonous", "Poisonous"], ["deadly", "Deadly"], ["venomous", "Venomous"], ["protected", "Protected"]];
    var h = '<input class="filter-input" id="sf" type="search" placeholder="Filter by name…" autocomplete="off" value="' + esc(text) + '" style="margin-top:0">';
    h += '<div class="chips" role="group" aria-label="Group" style="margin-top:8px">' + groups.map(function (x) {
      return '<button class="chip ' + x[2] + '" data-g="' + x[0] + '" aria-pressed="' + (g === x[0]) + '">' + (x[2] ? '<span class="dot"></span>' : "") + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="chips" role="group" aria-label="Status">' + stats.map(function (x) {
      return '<button class="chip" data-st="' + x[0] + '" aria-pressed="' + (st === x[0]) + '">' + (STATUS_ICON[x[0]] ? icon(STATUS_ICON[x[0]]) : "") + x[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="banner warn">' + icon("triangle-alert") + "<span>Identify with several features, never one. Never eat wild fungi unless an expert has confirmed them in person.</span></div>";
    h += '<p class="count" id="count"></p><div class="sgrid" id="sgrid"></div>';
    view.innerHTML = h;

    function apply() {
      var t = norm(document.getElementById("sf").value.trim());
      var ids = Object.keys(SPP).filter(function (id) {
        var s = SPP[id];
        if (g && s.group !== g) return false;
        if (st && s.status.indexOf(st) < 0) return false;
        if (t && norm(s.name + " " + s.latin + " " + s.aka.join(" ") + " " + s.tags.join(" ")).indexOf(t) < 0) return false;
        return true;
      }).sort(function (a, b) { return SPP[a].name.localeCompare(SPP[b].name); });
      document.getElementById("count").textContent = ids.length + " species";
      document.getElementById("sgrid").innerHTML = ids.length ? ids.map(speciesCard).join("")
        : '<p class="empty" style="grid-column:1/-1">No species match these filters.</p>';
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

  function viewArticle(id, token, tab) {
    var a = ART[id];
    if (!a) return notFound();
    var c = CATS[a.cat];
    setChrome(c.title, { tab: tab, saveKey: "a:" + id });
    addRecent("a:" + id);
    view.innerHTML = '<a class="crumb c-' + a.cat + '" href="#/c/' + a.cat + '"><span class="dot"></span>' + esc(c.title) + "</a>" +
      '<h1 class="page">' + esc(a.title) + '</h1><div class="body" id="body"><p class="muted" id="loading">Loading…</p></div>';
    return loadBody("a/" + id).then(function (html) {
      if (token !== renderToken) return;
      var body = document.getElementById("body");
      body.innerHTML = html;
      var extra = "";
      if (a.compare) extra += '<div class="compare">' + a.compare.map(speciesCard).join("") + "</div>";
      extra += articleGallery(a);
      insertAfterQuick(body, extra);
      if (a.cat === "first-aid") {
        body.insertAdjacentHTML("afterbegin", '<p class="small muted" style="margin:0 0 12px">First-aid information, not a substitute for training.</p>');
      }
      decorateBody(body);
      wireArticleGallery(body, a);
      wireChecklists(body, "a:" + id);
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

  // ------------------------------------------------------------------ tools
  function viewTools(tab) {
    setChrome("Tools", { root: true, tab: tab });
    var st = nativeState();
    var torchOn = !!(st && st.torch);
    function tool(id, ic, label, sub) {
      return '<button class="tool c-accent" data-tool="' + id + '">' + iconTile(ic) + "<span><b>" + label + '</b><span class="sub">' + sub + "</span></span></button>";
    }
    var h = "";
    if (!NATIVE) h += '<div class="banner warn">' + icon("info") + "<span>These buttons only work inside the app on the phone.</span></div>";
    h += '<div class="tools">' +
      '<button class="tool c-accent' + (torchOn ? " on" : "") + '" id="torch">' + iconTile("flashlight") + "<span><b>Torch " + (torchOn ? "on" : "off") + '</b><span class="sub">Signal: 6 flashes a minute</span></span></button>' +
      tool("fm", "radio", "FM Radio", "Needs wired headphones") +
      tool("camera", "camera", "Camera", "Photograph for ID") +
      tool("calculator", "calculator", "Calculator", "Pacing and timings") +
      tool("clock", "alarm-clock", "Clock", "Alarm and stopwatch") +
      tool("battery", "battery-medium", "Battery", "Usage and saver") +
      "</div>";
    h += '<div class="actions"><a class="action" href="#/report"><span class="badge-ic">' + icon("map-pin", "ic-lg") + '</span><span class="txt"><b>Location report</b><span class="sub">Grid reference and details to hand to rescuers</span></span>' + icon("chevron-right", "chev") + "</a></div>";
    h += '<div class="section"><span class="label">This guide</span><ul class="list">' +
      '<li><a class="row" href="#/settings">' + iconTile("sliders-horizontal", "c-kit") + '<span class="txt"><span class="t">Settings</span><span class="s">Theme, text size, brightness, low-power mode</span></span>' + icon("chevron-right", "chev") + "</a></li>" +
      '<li><a class="row" href="#" data-tool-link="settings">' + iconTile("settings", "c-kit") + '<span class="txt"><span class="t">Phone settings</span><span class="s">Open Android settings</span></span>' + icon("chevron-right", "chev") + "</a></li>" +
      '<li><a class="row" href="#/about">' + iconTile("info", "c-kit") + '<span class="txt"><span class="t">About and licences</span><span class="s">Disclaimer, sources, icon and font licences</span></span>' + icon("chevron-right", "chev") + "</a></li>" +
      '<li><a class="row" href="#/credits">' + iconTile("images", "c-kit") + '<span class="txt"><span class="t">Photo credits</span><span class="s">' + IDX.counts.photos + " photos from Wikimedia Commons</span></span>" + icon("chevron-right", "chev") + "</a></li>" +
      "</ul></div>";
    if (st) {
      h += '<div class="section status"><span>Battery <b>' + (st.battery >= 0 ? st.battery + "%" : "?") + "</b>" + (st.charging ? " · charging" : "") + "</span>" +
        (st.batteryTempC != null ? "<span>Temp <b>" + st.batteryTempC + " °C</b></span>" : "") + "<span>Version <b>" + esc(st.version) + "</b></span></div>";
    }
    h += '<p class="small muted" style="margin-top:16px">The torch stays on until you switch it off: check it before putting the phone away.</p>';
    view.innerHTML = h;
    function launch(name) {
      var ok = native("launchTool", name);
      if (!ok) alert(NATIVE ? "That app is not available (it may have been removed or is blocked in kiosk mode)." : "Only available on the phone.");
    }
    view.querySelectorAll("[data-tool]").forEach(function (b) { b.onclick = function () { launch(b.getAttribute("data-tool")); }; });
    view.querySelectorAll("[data-tool-link]").forEach(function (b) { b.onclick = function (e) { e.preventDefault(); launch(b.getAttribute("data-tool-link")); }; });
    document.getElementById("torch").onclick = function () {
      var cur = nativeState();
      var ok = native("setTorch", !(cur && cur.torch));
      if (!ok) alert(NATIVE ? "The torch could not be switched (the camera may be in use)." : "Only available on the phone.");
      render();
    };
  }

  // Location report: what to hand to a messenger, a passer-by or rescuers. Works with no signal.
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
    var h = '<h1 class="page">Location report</h1><p class="lead">Fill this in calmly. Hand it, or show this screen, to whoever goes for help, a passer-by with a phone, or rescuers. Help: <a href="#/a/grid-references">reading a grid reference</a>.</p>';
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
        "Grid ref: " + (x.grid || "[grid reference]"),
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
      }).join("") + '</div><p class="desc">Daylight is high contrast for direct sun. Night red keeps your night vision.</p></div>';
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
    h += '<span class="label">Your data</span><div class="group"><div class="setting"><div class="btn-row" style="margin:0">' +
      '<button class="btn" id="clr-recent">Clear recent</button><button class="btn" id="clr-favs">Clear saved</button><button class="btn" id="clr-checks">Clear kit ticks</button></div></div></div>';
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
    document.getElementById("clr-checks").onclick = function () { if (confirm("Untick all kit checklist items?")) save("checks", {}); };
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
      var h = '<h1 class="page">Photo credits</h1><p class="lead">All ' + names.length + " photos come from Wikimedia Commons and are used under the licences shown (public domain, CC0, CC BY or CC BY-SA). They were resized and converted to WebP. CC BY-SA photos remain under CC BY-SA. Licence texts: creativecommons.org/licenses.</p>";
      h += '<ul class="list">' + names.map(function (n) {
        var c = cr[n];
        return '<li><div class="row" style="align-items:flex-start">' + (lowPower() ? "" : '<img class="thumb" loading="lazy" alt="" src="img/t/' + n + '">') +
          '<span class="txt"><span class="t">' + esc(owners[n] || n) + '</span><span class="s">' + esc(c.author) + " · " + esc(c.license) +
          '</span><span class="s">' + esc(c.source) + "</span></span></div></li>";
      }).join("") + "</ul>";
      view.innerHTML = h;
    }, function () { view.innerHTML = '<p class="empty">No photo credits found.</p>'; });
  }
  function viewAbout(tab) {
    setChrome("About", { tab: tab });
    var st = nativeState();
    var h = '<h1 class="page">About this guide</h1>';
    h += '<div class="banner">' + icon("triangle-alert") + "<span>General information for a dedicated offline survival phone. It is not a substitute for first-aid training, expert identification of plants and fungi, or professional rescue.</span></div>";
    h += '<div class="body">';
    h += '<h2>This phone can\'t call</h2><p>It has no SIM card, and in the UK a phone without a SIM cannot reach 999 or 112. Getting help means signalling, being found, or reaching a working phone or a person. See <a href="#/c/emergency">Emergency</a>.</p>';
    h += "<h2>Foraging</h2><p>Never eat any wild plant, berry or fungus unless you are 100% certain what it is, using several features, ideally confirmed in person by an expert. Several UK species kill, and some deadly fungi cause no symptoms for a day or more.</p>";
    h += "<h2>First aid</h2><p>First-aid content follows NHS, St John Ambulance and British Red Cross public guidance as written at the time. Training matters more than reading.</p>";
    h += "<h2>The law</h2><p>UK wildlife, access and fishing law applies. Most wild animals are protected; uprooting wild plants without the landowner's permission is illegal; many traps and snares are banned.</p>";
    h += "<h2>Contents</h2><p>" + IDX.counts.articles + " guides, " + IDX.counts.species + " species, " + IDX.counts.photos + ' photos. Every guide lists its sources. <a href="#/credits">Photo credits</a>.</p>';
    h += "<h2>Offline by design</h2><p>The guide never uses the network. It has no internet permission, runs no background services, keeps no wakelocks, uses no timers or polling, and follows the phone's screen timeout.</p>";
    h += "<h2>Licences</h2><ul><li>Icons: Lucide (ISC licence), plus a few custom icons in the same style.</li><li>Typeface: Atkinson Hyperlegible, © 2020 Braille Institute of America, SIL Open Font License 1.1.</li><li>Photos: Wikimedia Commons contributors, licences as listed in Photo credits.</li></ul>";
    if (st) h += '<p class="muted">Version ' + esc(st.version) + "</p>";
    h += "</div>";
    view.innerHTML = h;
  }

  // ------------------------------------------------------------------ hidden kiosk menu
  function viewKiosk(tab) {
    setChrome("Kiosk settings", { tab: tab });
    var st = nativeState() || {};
    var h = '<h1 class="page">Kiosk and device owner</h1>';
    h += '<div class="status"><span>Device owner <b>' + (st.deviceOwner ? "yes" : "no") + "</b></span><span>Pinned <b>" + (st.lockTask ? "yes" : "no") +
      "</b></span><span>Kiosk pin <b>" + (st.kioskEnabled ? "on" : "off") + "</b>" + (st.kioskSuspended ? " (paused until restart)" : "") + "</span></div>";
    h += '<div class="section"><button class="btn block" id="k-exit">Unpin and open phone Settings</button><p class="small muted">The pin comes back after the phone restarts.</p>';
    h += '<button class="btn block" id="k-toggle">' + (st.kioskEnabled ? "Turn kiosk pin off permanently" : "Turn kiosk pin on") + "</button>";
    h += '<button class="btn danger block" id="k-remove"' + (st.deviceOwner ? "" : " disabled") + ">Remove device owner</button>";
    h += '<p class="small muted">Removing device owner makes this an ordinary app again (needed before uninstalling it). To restore it, run the adb <code>dpm set-device-owner</code> command again.</p></div>';
    view.innerHTML = h;
    document.getElementById("k-exit").onclick = function () { if (confirm("Unpin the guide and open the phone's Settings?")) native("exitKiosk"); };
    document.getElementById("k-toggle").onclick = function () { native("setKioskEnabled", !st.kioskEnabled); render(); };
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

  backBtn.onclick = function () {
    if (history.length > 1) history.back(); else location.hash = "#/";
  };
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('[data-search], #nav a[data-tab="search"]') : null;
    if (a) { e.preventDefault(); openSearch(); }
  });
  window.appGoHome = function () { if (location.hash === "#/" || !location.hash) render(); else location.hash = "#/"; };

  window.addEventListener("hashchange", function () { if ((location.hash || "#/") !== currentHash) render(); });
  applySettings();
  render();
})();
