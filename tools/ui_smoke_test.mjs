// Desktop-browser smoke test of the offline web UI (file:// with no server, like the WebView).
//
//   NODE_PATH=$(npm root -g) node tools/ui_smoke_test.mjs [screenshot-dir]
//
// Needs the `playwright` npm package and a Chromium build. Visits every route, every article and
// every species, types typo'd searches, checks that photos decode, that nothing touches the
// network and that no JavaScript errors occur. Exit code 1 on any failure.
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

const t0 = Date.now();
await page.goto(base);
await page.waitForSelector(".tiles .tile");
console.log(`home rendered in ${Date.now() - t0} ms (desktop)`);
await shot("01-home");

// Search: typo tolerance and as-you-type.
for (const [q, expect] of [["nettel", "Common nettle"], ["hemlok", "Hemlock"], ["ferro rod", "Ferro rod technique"],
  ["cpr", "CPR for adults"], ["grid ref", "Reading OS grid references"], ["deth cap", "Death cap"], ["hypothermia", "Hypothermia"],
  ["chantrelle", "Chanterelle"], ["boil water", "Settle, strain, boil: making water safe"], ["adder bite", "Adder bite"]]) {
  await page.fill("#q", q);
  await page.waitForSelector("#results .row", { timeout: 5000 }).catch(() => {});
  const titles = await page.$$eval("#results .row .t", (els) => els.slice(0, 5).map((e) => e.textContent));
  if (!titles.includes(expect)) fail(`search "${q}": expected "${expect}" in top 5, got ${JSON.stringify(titles)}`);
}
await page.fill("#q", "nettel");
await shot("02-search-nettel");
await page.fill("#q", "");

for (const c of index.categories) {
  await go(`#/c/${c.id}`);
  const n = await page.$$eval(".list .row", (r) => r.length);
  if (n < c.articles.length) fail(`category ${c.id}: ${n} rows < ${c.articles.length}`);
}
await go("#/c/identify");
await shot("03-identify");

let imgs = 0;
for (const id of Object.keys(index.articles)) {
  await go(`#/a/${id}`);
  const ok = await page.$eval("#body", (b) => b.querySelector(".quick") !== null && b.textContent.length > 200);
  if (!ok) fail(`article ${id}: missing quick box or body`);
  const broken = await page.$$eval("#body a[href^='#/']", (as) => as.filter((a) => /#\/(a|s|c)\/$/.test(a.getAttribute("href"))).length);
  if (broken) fail(`article ${id}: empty links`);
}
for (const id of Object.keys(index.species)) {
  await go(`#/s/${id}`);
  const st = await page.$$eval(".badges .badge", (b) => b.length);
  if (!st) fail(`species ${id}: no status badge shown`);
  const main = await page.$(".gallery img.main");
  if (main) {
    await main.scrollIntoViewIfNeeded();
    const w = await page.waitForFunction((el) => el.complete && el.naturalWidth, main, { timeout: 5000 }).then(() => 1).catch(() => 0);
    if (!w) fail(`species ${id}: main photo did not decode`); else imgs++;
  }
}
console.log(`decoded ${imgs} species lead photos`);

await go("#/s/death-cap");
await shot("04-death-cap");
await go("#/a/compare-wild-garlic");
await shot("05-compare-garlic");
await page.$eval(".gallery img.main, .compare img", (el) => el.scrollIntoView()).catch(() => {});

// Image viewer opens and closes with back.
await go("#/s/nettle");
const g = await page.$(".gallery img.main");
if (g) {
  await g.click();
  if (await page.$eval("#viewer", (v) => v.hidden)) fail("viewer did not open");
  await shot("06-viewer");
  await page.goBack();
  await page.waitForTimeout(100);
  if (!(await page.$eval("#viewer", (v) => v.hidden))) fail("viewer did not close on back");
}

// Favourites + recents
await page.click("#favbtn");
await go("#/favs");
if (!(await page.$$eval(".list .row", (r) => r.length))) fail("favourite not listed");
await go("#/recent");
if (!(await page.$$eval(".list .row", (r) => r.length))) fail("recently viewed empty");

// Species browser filters
await go("#/species?g=fungus&st=deadly");
const deadly = await page.$$eval("#splist .row", (r) => r.length);
if (deadly < 5) fail(`deadly fungi filter shows ${deadly}`);
await shot("07-browser-deadly-fungi");

// Settings: theme, text size, low-power
await go("#/settings");
await page.click("[data-theme-opt='light']");
if ((await page.getAttribute("html", "data-theme")) !== "light") fail("light theme not applied");
await go("#/a/hypothermia");
await shot("08-light-hypothermia");
await go("#/settings");
await page.click("[data-theme-opt='red']");
await go("#/a/finding-north");
await shot("09-red-finding-north");
await go("#/settings");
await page.click("[data-theme-opt='dark']");
await page.check("#lowp");
await go("#/s/elder");
if (await page.$(".gallery img.main")) fail("low-power mode still shows photo");
await go("#/settings");
await page.uncheck("#lowp");

for (const r of ["#/tools", "#/report", "#/credits", "#/about", "#/kiosk", "#/nonsense"]) await go(r);
await go("#/tools");
await shot("10-tools");
await go("#/credits");
await shot("11-credits");

await browser.close();
console.log(failures.length ? `${failures.length} failures` : "UI smoke test OK");
process.exit(failures.length ? 1 : 0);
