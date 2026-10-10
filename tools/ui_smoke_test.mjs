// Desktop-browser smoke test of the offline web UI (file:// with no server, like the WebView).
//
//   NODE_PATH=$(npm root -g) node tools/ui_smoke_test.mjs [screenshot-dir]
//
// Needs the `playwright` npm package and a Chromium build. At 360x800 (Galaxy A21s) in the dark and
// daylight themes it visits every route, category, article and species, and checks: no network, no
// JavaScript errors, every icon resolves, no horizontal overflow, tap targets >= 48 px, no call/SMS
// links, typo'd searches, photos decode, viewer, saved items, filters, low-power and themes.
// Exit code 1 on any failure.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ESM imports ignore NODE_PATH, so resolve playwright through require() (which honours it).
const { chromium } = createRequire(import.meta.url)("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "app/src/main/assets");
const base = pathToFileURL(path.join(assets, "index.html")).href;
const shots = process.argv[2];
const index = JSON.parse(fs.readFileSync(path.join(assets, "content/index.json"), "utf8"));

// Articles that may tell you what to say once you reach a phone or a person.
const CALL_OK = new Set(["when-you-reach-help", "finding-help", "when-to-get-help", "kit-phone", "coast-and-tides"]);
const CALL_RE = /\b(call|dial)(ing)?\s+(999|112)\b/i;

const failures = [];
const fail = (m) => { failures.push(m); console.log("FAIL:", m); };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
// Galaxy A21s: 720x1600 px at ~2x density -> 360x800 CSS px.
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();
page.on("pageerror", (e) => fail(`JS error: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") fail(`console error: ${m.text()}`); });
page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) fail(`network request: ${r.url()}`); });

async function go(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 5000 }).catch(() => fail(`${hash}: body did not load`));
}
async function shot(name) {
  if (shots) await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: false });
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
    const skip = "#viewer, .credit, .lead, .banner, .small, #sources, .count, p, li > span, td, th, figcaption, .muted";
    for (const el of document.querySelectorAll("a, button, input, select, label.switch, .chip")) {
      if (el.closest(skip) && !el.matches(".btn, .chip, .row")) continue;
      if (el.closest("#body p, #body li, #body td, #body th")) continue; // inline body links
      if (el.type === "checkbox" && el.closest("label")) continue;       // the label is the target
      if (el.type === "range") continue;
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

async function setTheme(theme) {
  await page.evaluate((t) => {
    const s = JSON.parse(localStorage.getItem("settings") || "{}");
    s.theme = t; localStorage.setItem("settings", JSON.stringify(s));
  }, theme);
  await page.reload();
  await page.waitForSelector("#bar");
}

const t0 = Date.now();
await page.goto(base);
await page.waitForSelector(".tiles .tile");
console.log(`home rendered in ${Date.now() - t0} ms (desktop)`);
if ((await page.$$eval(".tiles .tile", (t) => t.length)) !== index.categories.length) fail("home: tile count");
const firstActions = await page.$$eval(".actions .action b", (b) => b.map((x) => x.textContent));
if (firstActions[0] !== "What to do first" || firstActions[1] !== "Signal for help") fail(`home actions: ${JSON.stringify(firstActions)}`);

// Search via the bottom nav: input focused, typo tolerance.
await page.click("#nav [data-tab='search']");
await page.waitForSelector("#q");
if (!(await page.evaluate(() => document.activeElement && document.activeElement.id === "q"))) fail("search input not focused");
for (const [q, expect] of [["nettel", "Common nettle"], ["hemlok", "Hemlock"], ["ferro rod", "Ferro rod technique"],
  ["cpr", "CPR for adults"], ["grid ref", "Reading OS grid references"], ["deth cap", "Death cap"], ["hypothermia", "Hypothermia"],
  ["chantrelle", "Chanterelle"], ["boil water", "Settle, strain, boil: making water safe"], ["adder bite", "Adder bite"],
  ["whistle", "Signal for help"], ["sos", "Signal for help"]]) {
  await page.fill("#q", q);
  await page.waitForSelector("#results .row", { timeout: 5000 }).catch(() => {});
  const titles = await page.$$eval("#results .row .t", (els) => els.slice(0, 5).map((e) => e.textContent));
  if (!titles.includes(expect)) fail(`search "${q}": expected "${expect}" in top 5, got ${JSON.stringify(titles)}`);
}
await page.fill("#q", "");

for (const theme of ["dark", "light"]) {
  await setTheme(theme);
  for (const r of ["#/", "#/search", "#/species", "#/saved", "#/tools", "#/settings", "#/report", "#/about", "#/credits", "#/kiosk",
    "#/c/emergency", "#/a/signalling-rescue", "#/a/when-you-reach-help", "#/s/death-cap", "#/s/nettle", "#/a/kit-checklist"]) {
    await go(r);
    await audit(`${theme} ${r}`);
  }
  await go("#/"); await shot(`${theme}-01-home`);
  await go("#/c/emergency"); await shot(`${theme}-02-category`);
  await go("#/a/signalling-rescue"); await shot(`${theme}-03-article`);
  await go("#/species"); await shot(`${theme}-04-species`);
  await go("#/s/death-cap"); await shot(`${theme}-05-species-page`);
  await go("#/tools"); await shot(`${theme}-06-tools`);
}
await setTheme("dark");

for (const c of index.categories) {
  await go(`#/c/${c.id}`);
  const n = await page.$$eval(".list .row", (r) => r.length);
  if (n < c.articles.length) fail(`category ${c.id}: ${n} rows < ${c.articles.length}`);
  await audit(`category ${c.id}`);
}

for (const id of Object.keys(index.articles)) {
  await go(`#/a/${id}`);
  const r = await page.$eval("#body", (b) => ({
    quick: b.querySelector(".quick") !== null, len: b.textContent.length, text: b.textContent,
    empty: [...b.querySelectorAll("a[href^='#/']")].filter((a) => /#\/(a|s|c)\/$/.test(a.getAttribute("href"))).length,
  }));
  if (!r.quick || r.len < 200) fail(`article ${id}: missing quick box or body`);
  if (r.empty) fail(`article ${id}: empty links`);
  if (!CALL_OK.has(id) && CALL_RE.test(r.text)) fail(`article ${id}: tells the reader to call 999/112`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (ov > 0) fail(`article ${id}: horizontal overflow ${ov}px`);
}

let imgs = 0;
for (const id of Object.keys(index.species)) {
  await go(`#/s/${id}`);
  if (!(await page.$$eval(".sp-title .pill", (b) => b.length))) fail(`species ${id}: no status pill`);
  const text = await page.$eval("#view", (v) => v.textContent);
  if (CALL_RE.test(text)) fail(`species ${id}: tells the reader to call 999/112`);
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
  await shot("viewer");
  await page.goBack();
  await page.waitForTimeout(100);
  if (!(await page.$eval("#viewer", (v) => v.hidden))) fail("viewer did not close on back");
}
await go("#/a/signalling-rescue");
const diag = await page.$("img[data-zoom]");
if (!diag) fail("signalling-rescue: no zoomable diagram");
else {
  await diag.scrollIntoViewIfNeeded();
  await diag.click();
  if (await page.$eval("#viewer", (v) => v.hidden)) fail("diagram viewer did not open");
  await page.goBack();
  await page.waitForTimeout(100);
}

// Saved
await go("#/a/hypothermia");
await page.click("#save");
await go("#/saved");
if (!(await page.$$eval(".list .row", (r) => r.length))) fail("saved item not listed");

// Species filters
await go("#/species?g=fungus&st=deadly");
const deadly = await page.$$eval("#sgrid .scard", (r) => r.length);
if (deadly < 5) fail(`deadly fungi filter shows ${deadly}`);

// Low-power hides photos; red theme applies.
await go("#/settings");
await page.check("#lowp");
await go("#/s/elder");
if (await page.$("#hero-img")) fail("low-power mode still shows photo");
await go("#/settings");
await page.uncheck("#lowp");
await page.click("[data-theme-opt='red']");
if ((await page.getAttribute("html", "data-theme")) !== "red") fail("red theme not applied");
await go("#/a/finding-north");
await shot("red-finding-north");
await go("#/settings");
await page.click("[data-theme-opt='dark']");

await go("#/nonsense");
if (!(await page.$(".empty"))) fail("unknown route did not show not-found");

await browser.close();
console.log(failures.length ? `${failures.length} failures` : "UI smoke test OK");
process.exit(failures.length ? 1 : 0);
