// Desktop-browser smoke test of the offline web UI, served like the app serves it (tools/serve_test.mjs, with the
// Keswick map samples from tools/testdata at /maps/...).
//
//   NODE_PATH=$(npm root -g) node tools/ui_smoke_test.mjs [screenshot-dir]
//
// Needs the `playwright` npm package and Chromium (WebGL via SwiftShader for the map). At 360x800 (Galaxy A21s) in
// the dark, daylight and night-red themes it visits every group, category, article, species, flow node and tool,
// and checks: no network beyond the test server, no JavaScript errors, every icon resolves, no horizontal overflow,
// tap targets >= 48 px, no call/SMS links, typo'd and synonym searches, photos decode, the map renders and searches,
// the viewer, saved items, filters, low-power mode and themes. Also checks the offline maths in geo.js.
// Exit code 1 on any failure.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { serve } from "./serve_test.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // ESM imports ignore NODE_PATH; require() honours it

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "app/src/main/assets");
const shots = process.argv[2];
const index = JSON.parse(fs.readFileSync(path.join(assets, "content/index.json"), "utf8"));
const PORT = 8137;
const base = `http://127.0.0.1:${PORT}/index.html`;

// Articles that may tell you what to say once you reach a phone or a person.
const CALL_OK = new Set(["when-you-reach-help", "finding-help", "when-to-get-help", "kit-phone", "coast-and-tides"]);
const CALL_RE = /\b(call|dial)(ing)?\s+(999|112)\b/i;

const failures = [];
const fail = (m) => { failures.push(m); console.log("FAIL:", m); };

// ------------------------------------------------------------------ geo.js maths (no browser needed)
{
  const G = require(path.join(assets, "geo.js"));
  const g = G.toOSGB(56.796849, -5.003539); // Ben Nevis summit
  if (G.gridRef(g, 6) !== "NN 166 712") fail(`geo: Ben Nevis grid ref ${G.gridRef(g, 6)}`);
  const back = G.fromOSGB(g.e, g.n);
  if (Math.abs(back.lat - 56.796849) > 1e-5 || Math.abs(back.lon + 5.003539) > 1e-5) fail("geo: OSGB round trip");
  const p = G.parseGridRef("NY 266 224");
  if (!p || G.gridRef(p, 6) !== "NY 266 224") fail("geo: parseGridRef");
  const d = G.declination(51.5, -0.1, 0, new Date(Date.UTC(2026, 9, 20)));
  if (Math.abs(d - 1.22) > 0.05) fail(`geo: WMM declination London ${d}`);
  const t = G.sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 51.5, -0.12);
  if (!t.sunrise || Math.abs(t.sunrise.getUTCHours() * 60 + t.sunrise.getUTCMinutes() - (3 * 60 + 43)) > 3) fail(`geo: London midsummer sunrise ${t.sunrise}`);
  if (Math.abs(G.naismith(5, 300) - 90) > 0.01) fail("geo: Naismith");
}

const server = await serve(PORT);
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
});
// Galaxy A21s: 720x1600 px at ~2x density -> 360x800 CSS px.
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();
page.on("pageerror", (e) => fail(`JS error: ${e.message}`));
let expect404 = false; // the "map not installed" check below fetches missing files on purpose
page.on("console", (m) => { if (m.type() === "error" && !(expect404 && /404/.test(m.text()))) fail(`console error: ${m.text()}`); });
page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith("http://127.0.0.1:") && !u.startsWith("data:") && !u.startsWith("blob:")) fail(`network request: ${u}`);
});
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Test point" : undefined));

async function go(hash, wait) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 8000 }).catch(() => fail(`${hash}: did not load`));
  if (wait) await page.waitForTimeout(wait);
}
async function shot(name) {
  if (shots) await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: false });
}
async function setTheme(theme) {
  await page.evaluate((t) => { const s = JSON.parse(localStorage.getItem("settings") || "{}"); s.theme = t; localStorage.setItem("settings", JSON.stringify(s)); }, theme);
  await page.reload();
  await page.waitForSelector("#bar");
}

// Layout checks on the page currently shown.
async function audit(label) {
  const r = await page.evaluate(() => {
    const out = { missing: [], dial: 0, overflow: 0, small: [] };
    for (const u of document.querySelectorAll("use")) {
      const id = (u.getAttribute("href") || "").slice(1);
      if (!document.getElementById(id)) out.missing.push(id);
    }
    out.dial = document.querySelectorAll("a[href^='tel:'], a[href^='sms:'], [data-dial]").length;
    out.overflow = document.documentElement.scrollWidth - window.innerWidth;
    const skip = "#viewer, .credit, .lead, .banner, .small, #sources, .count, p, li > span, td, th, figcaption, .muted, .maplibregl-map";
    for (const el of document.querySelectorAll("a, button, input, select, textarea, label.switch, .chip")) {
      if (el.closest(skip) && !el.matches(".btn, .chip, .row")) continue;
      if (el.closest("#body p, #body li, #body td, #body th, .flow-card, .qcard ol")) continue; // inline body links
      if (el.type === "checkbox" && el.closest("label")) continue;       // the label is the target
      if (el.type === "range") continue;
      if (el.closest(".map-search, .lock-row label")) continue;          // the search box itself is 48 px
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(el).visibility === "hidden") continue;
      if (b.height < 47.5 || b.width < 47.5) out.small.push(`${el.tagName.toLowerCase()}.${el.className || ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return out;
  });
  if (r.missing.length) fail(`${label}: missing icons ${[...new Set(r.missing)].join(", ")}`);
  if (r.dial) fail(`${label}: ${r.dial} call/SMS links`);
  if (r.overflow > 0) fail(`${label}: horizontal overflow ${r.overflow}px`);
  if (r.small.length) fail(`${label}: small tap targets: ${[...new Set(r.small)].slice(0, 5).join("; ")}`);
}

const t0 = Date.now();
await page.goto(base);
await page.waitForSelector(".urgent .utile");
console.log(`home rendered in ${Date.now() - t0} ms (desktop)`);
await page.evaluate(() => {
  localStorage.setItem("lastFixWeb", JSON.stringify({ lat: 54.6012, lon: -3.135, acc: 12, alt: 80, time: Date.now() - 120000 }));
});
if ((await page.$$eval(".groups .group-card", (t) => t.length)) !== index.groups.length) fail("home: group count");
if ((await page.$$eval(".urgent .utile", (t) => t.length)) !== index.urgent.length) fail("home: urgent tiles");

// Search via the bottom nav: input focused, typo tolerance and synonyms.
await page.click("#nav [data-tab='search']");
await page.waitForSelector("#q");
if (!(await page.evaluate(() => document.activeElement && document.activeElement.id === "q"))) fail("search input not focused");
for (const [q, expect] of [["nettel", "Common nettle"], ["hemlok", "Hemlock"], ["ferro rod", "Ferro rod technique"],
  ["cpr", "CPR for adults"], ["grid ref", "Reading OS grid references"], ["deth cap", "Death cap"], ["hypothermia", "Hypothermia"],
  ["chantrelle", "Chanterelle"], ["boil water", "Settle, strain, boil: making water safe"], ["adder bite", "Adder bite"],
  ["whistle", "Signal for help"], ["sos", "Signal for help"], ["liberty cap", "Liberty cap"], ["haemorrhage", "Severe bleeding and tourniquets"],
  ["power cut", "Power cut: the first hours"], ["someone injured", "Someone is injured"]]) {
  await page.fill("#q", q);
  await page.waitForSelector("#results .row", { timeout: 5000 }).catch(() => {});
  const titles = await page.$$eval("#results .row .t", (els) => els.slice(0, 6).map((e) => e.textContent));
  if (!titles.includes(expect)) fail(`search "${q}": expected "${expect}" in top 6, got ${JSON.stringify(titles)}`);
}
await page.fill("#q", "shrooms");
await page.waitForSelector("#results .row", { timeout: 5000 }).catch(() => fail("search synonyms: no results for shrooms"));
await page.fill("#q", "");

const TOOLS = ["compass", "gps", "sun", "signal", "morse", "level", "pace", "cpr", "casualty", "boil", "calc", "notebook", "battery", "phone-mode", "torch"];
const flows = {};
for (const f of index.flows) {
  const ctx = { __body: (k, v) => { flows[f] = v; } };
  vm.runInNewContext(fs.readFileSync(path.join(assets, "content/f", f + ".js"), "utf8"), ctx);
}

for (const theme of ["dark", "light", "red"]) {
  await setTheme(theme);
  const routes = ["#/", "#/search", "#/species", "#/species?g=psychoactive", "#/saved", "#/tools", "#/settings", "#/report", "#/about", "#/credits",
    "#/kiosk", "#/poweroff", "#/cards", "#/season", "#/a/signalling-rescue", "#/a/cooking-without-power", "#/s/death-cap", "#/s/liberty-cap", "#/f/injured",
    ...index.groups.map((g) => "#/g/" + g.id), ...TOOLS.map((t) => "#/tool/" + t), "#/tool/calc?m=units", "#/tool/notebook?m=daily", "#/tool/level?m=height"];
  for (const r of routes) {
    await go(r);
    await audit(`${theme} ${r}`);
  }
  await go("#/map?fix=1", 5000);
  await audit(`${theme} #/map`);
  if (!(await page.$(".maplibregl-canvas"))) fail(`${theme} map: no canvas`);
  await shot(`${theme}-map`);
  for (const [name, r] of [["home", "#/"], ["group", "#/g/situations"], ["category", "#/c/first-aid"], ["article", "#/a/cooking-without-power"],
    ["flow", "#/f/injured"], ["species", "#/species?g=psychoactive"], ["species-page", "#/s/liberty-cap"], ["tools", "#/tools"],
    ["compass", "#/tool/compass"], ["gps", "#/tool/gps"], ["sun", "#/tool/sun"], ["signal", "#/tool/signal"], ["cpr", "#/tool/cpr"],
    ["phone-mode", "#/tool/phone-mode"], ["battery", "#/tool/battery"], ["season", "#/season"]]) {
    await go(r);
    await shot(`${theme}-${name}`);
  }
}
await setTheme("dark");

for (const [cid, c] of Object.entries(index.categories)) {
  await go(`#/c/${cid}`);
  const n = await page.$$eval("#view .list .row, #view .start-here", (r) => r.length);
  if (n < c.articles.length) fail(`category ${cid}: ${n} rows < ${c.articles.length}`);
  if (!(await page.$(".start-here"))) fail(`category ${cid}: no Start here`);
  await audit(`category ${cid}`);
}

for (const id of Object.keys(index.articles)) {
  await go(`#/a/${id}`);
  const r = await page.$eval("#body", (b) => ({
    quick: b.querySelector(".quick") !== null, len: b.textContent.length, text: b.textContent,
    empty: [...b.querySelectorAll("a[href^='#/']")].filter((a) => /#\/(a|s|c|f|tool)\/$/.test(a.getAttribute("href"))).length,
  }));
  if (!r.quick || r.len < 200) fail(`article ${id}: missing quick box or body`);
  if (r.empty) fail(`article ${id}: empty links`);
  if (!CALL_OK.has(id) && CALL_RE.test(r.text)) fail(`article ${id}: tells the reader to call 999/112`);
  if (!(await page.$(".meta-row .mchip"))) fail(`article ${id}: no time/read chip`);
  if (!(await page.$(".related .row"))) fail(`article ${id}: no related articles`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (ov > 0) fail(`article ${id}: horizontal overflow ${ov}px`);
}

// Every node of every decision flow renders, and every answer leads to a node that exists.
for (const [fid, flow] of Object.entries(flows)) {
  for (const [nid, node] of Object.entries(flow.nodes)) {
    await go(`#/f/${fid}/${nid}`);
    const opts = await page.$$eval(".flow-opts .opt", (a) => a.length);
    if (opts !== node.opts.length) fail(`flow ${fid}/${nid}: ${opts} options shown, ${node.opts.length} expected`);
    for (const [, target] of node.opts) if (!flow.nodes[target]) fail(`flow ${fid}/${nid}: answer leads to missing node ${target}`);
  }
}

let imgs = 0;
for (const id of Object.keys(index.species)) {
  await go(`#/s/${id}`);
  if (!(await page.$$eval(".sp-title .pill", (b) => b.length))) fail(`species ${id}: no status pill`);
  const text = await page.$eval("#view", (v) => v.textContent);
  if (CALL_RE.test(text)) fail(`species ${id}: tells the reader to call 999/112`);
  if (index.species[id].status.includes("psychoactive") && !(await page.$(".banner.psy"))) fail(`species ${id}: no psychoactive banner`);
  const hero = await page.$("#hero-img");
  if (hero) {
    const w = await page.waitForFunction((el) => el.complete && el.naturalWidth, hero, { timeout: 5000 }).then(() => 1).catch(() => 0);
    if (!w) fail(`species ${id}: hero photo did not decode`); else imgs++;
  }
}
console.log(`decoded ${imgs} species hero photos`);

// Image viewer opens and closes with back; diagrams zoom.
await go("#/s/nettle");
const hero = await page.$("#hero-img");
if (hero) {
  await hero.click();
  if (await page.$eval("#viewer", (v) => v.hidden)) fail("viewer did not open");
  await page.goBack();
  await page.waitForTimeout(100);
  if (!(await page.$eval("#viewer", (v) => v.hidden))) fail("viewer did not close on back");
}

// Saved
await go("#/a/hypothermia");
await page.click("#save");
await go("#/saved");
if (!(await page.$$eval(".list .row", (r) => r.length))) fail("saved item not listed");

// Species filters: the psychoactive tab, and deadly fungi.
await go("#/species?g=psychoactive");
if ((await page.$$eval("#sgrid .scard", (r) => r.length)) < 14) fail("psychoactive tab shows fewer than 14 species");
await go("#/species?g=fungus&st=deadly");
if ((await page.$$eval("#sgrid .scard", (r) => r.length)) < 5) fail("deadly fungi filter too small");

// In season: something to show every month.
for (let m = 1; m <= 12; m++) {
  await go(`#/season?m=${m}`);
  if (!(await page.$$eval("#view .list .row", (r) => r.length))) fail(`season: nothing in month ${m}`);
}

// Flow navigation by tapping answers.
await go("#/f/lost");
const first = await page.$(".flow-opts .opt");
if (first) { await first.click(); await page.waitForTimeout(150); if (!/#\/f\/lost\/.+/.test(page.url())) fail("flow: answer did not move on"); }

// Calculators and notebook work without the phone.
await go("#/tool/calc");
if (!/h|min/.test(await page.$eval("#cout", (e) => e.textContent))) fail("calc: no walking time");
await go("#/tool/notebook");
await page.fill("#ntext", "Test note");
await page.click("#nadd");
if (!(await page.$$eval(".obs li", (l) => l.length))) fail("notebook: note not saved");
if (!/NY 2/.test(await page.$eval(".obs li", (l) => l.textContent))) fail("notebook: GPS grid reference not attached");
await go("#/tool/casualty");
await page.click("[data-avpu='Voice']");
await page.fill("#opu", "96");
await page.click("#oadd");
if (!/Pulse 96/.test(await page.$eval("#obslist", (e) => e.textContent))) fail("casualty log: observation not recorded");

// Map: renders, tapping shows a grid reference, offline place search finds Keswick, waypoints show.
await go("#/map?fix=1", 4000);
await page.mouse.click(180, 400);
await page.waitForSelector("#msheet:not([hidden])", { timeout: 3000 }).catch(() => fail("map: tap shows no sheet"));
if (!/NY \d{4} \d{4}/.test(await page.$eval("#msheet", (e) => e.textContent))) fail("map: tap sheet has no grid reference");
await page.fill("#msq", "Keswick");
await page.waitForSelector(".mres", { timeout: 5000 }).catch(() => fail("map: place search found nothing"));
await page.click("#mgrid");
await page.waitForTimeout(500);
await shot("dark-map-grid");
await go("#/");

// Low-power hides photos; red theme applies.
await go("#/settings");
await page.check("#lowp");
await go("#/s/elder");
if (await page.$("#hero-img")) fail("low-power mode still shows photo");
await go("#/settings");
await page.uncheck("#lowp");
await page.click("[data-theme-opt='red']");
if ((await page.getAttribute("html", "data-theme")) !== "red") fail("red theme not applied");
await go("#/settings");
await page.click("[data-theme-opt='dark']");

await go("#/nonsense");
if (!(await page.$(".empty"))) fail("unknown route did not show not-found");

// Map files missing: a friendly screen with the adb commands.
server.close();
const bare = await serve(PORT + 1, { noMaps: true });
expect404 = true;
await page.goto(`http://127.0.0.1:${PORT + 1}/index.html#/map`);
await page.waitForSelector("pre.cmd", { timeout: 8000 }).catch(() => fail("map not installed: no adb instructions"));
await shot("dark-map-missing");
bare.close();

await browser.close();
console.log(failures.length ? `${failures.length} failures` : "UI smoke test OK");
process.exit(failures.length ? 1 : 0);
