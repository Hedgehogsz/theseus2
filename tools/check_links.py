#!/usr/bin/env python3
"""Verify the generated offline bundle in app/src/main/assets.

Checks that every article/species/category link resolves, every body file exists, every image
referenced by the index exists on disk and has a credits entry, the web UI only references local
files, every icon the UI uses is in icons.js, nothing in the UI points at the network, and nothing in
the app or UI tries to call or text (the phone has no SIM). Exit code 1 on any problem.

  python3 tools/check_links.py            # check
  python3 tools/check_links.py --min 120  # also require at least 120 articles and 120 species
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "app" / "src" / "main" / "assets"
CONTENT = ASSETS / "content"


def load_js(path: Path, var: str):
    text = path.read_text(encoding="utf-8")
    prefix = f"window.{var}="
    if not text.startswith(prefix):
        raise ValueError(f"{path} does not start with {prefix}")
    return json.loads(text[len(prefix):].rstrip().rstrip(";"))


def load_body(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.match(r'^__body\("([^"]+)",(.*)\);\s*$', text, re.S)
    if not m:
        raise ValueError(f"{path}: malformed body file")
    return json.loads(m.group(2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=0, help="minimum number of articles and of species")
    ap.add_argument("--min-photos", type=int, default=0)
    args = ap.parse_args()

    problems: list[str] = []
    index = load_js(CONTENT / "index.js", "GUIDE_INDEX")
    credits = load_js(CONTENT / "credits.js", "GUIDE_CREDITS")
    load_js(CONTENT / "search.js", "GUIDE_SEARCH")
    if json.loads((CONTENT / "index.json").read_text(encoding="utf-8")) != index:
        problems.append("index.json and index.js differ (re-run build_content.py)")

    arts, spp = index["articles"], index["species"]
    cats = {c["id"]: c for c in index["categories"]}
    targets = {"a": arts, "s": spp, "c": cats}
    checked_links = 0

    def check_img(owner: str, im):
        name = im[0]
        if not (ASSETS / "img" / name).is_file():
            problems.append(f"{owner}: image img/{name} missing")
        if not (ASSETS / "img" / "t" / name).is_file():
            problems.append(f"{owner}: thumbnail img/t/{name} missing")
        if not (im[1] > 0 and im[2] > 0):
            problems.append(f"{owner}: image {name} has no dimensions")
        if name not in credits:
            problems.append(f"{owner}: image {name} has no credits entry")

    for cid, c in cats.items():
        for aid in c["articles"]:
            if aid not in arts:
                problems.append(f"category {cid}: unknown article {aid}")
    for kind, table in (("a", arts), ("s", spp)):
        for item_id, item in table.items():
            owner = f"{kind}:{item_id}"
            body_path = CONTENT / kind / f"{item_id}.js"
            if not body_path.is_file():
                problems.append(f"{owner}: body file missing")
                continue
            body = load_body(body_path)
            for k, target in re.findall(r'href="#/([acs])/([^"?]+)"', body):
                checked_links += 1
                if target not in targets[k]:
                    problems.append(f"{owner}: broken link #/{k}/{target}")
            for href in re.findall(r'href="([^"]*)"', body):
                if not (href.startswith("#/") or href.startswith("tel:")):
                    problems.append(f"{owner}: non-local link {href!r}")
            for src in re.findall(r'src="([^"]*)"', body):
                if not (ASSETS / src).is_file():
                    problems.append(f"{owner}: missing embedded file {src}")
            for im in item.get("images", []):
                check_img(owner, im)
            for sid in item.get("compare", []) + item.get("lookalikes", []):
                checked_links += 1
                if sid not in spp:
                    problems.append(f"{owner}: unknown species {sid}")
            if kind == "s" and not item.get("status"):
                problems.append(f"{owner}: no status badge")
            if kind == "a" and item["cat"] not in cats:
                problems.append(f"{owner}: unknown category {item['cat']}")

    # Web UI shell: every local reference must exist; nothing may point at the network.
    for f in ["index.html", "app.css", "app.js", "fonts.css", "icons.js"]:
        p = ASSETS / f
        if not p.is_file():
            problems.append(f"{f} missing")
            continue
        text = p.read_text(encoding="utf-8")
        for m in re.finditer(r'(?:src|href)="([^"#][^"]*)"', text):
            ref = m.group(1)
            if "${" in ref or "' +" in ref or ref.startswith(("tel:", "javascript:")):
                continue
            if not (ASSETS / ref).is_file():
                problems.append(f"{f}: reference to missing file {ref}")
        if re.search(r"""(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import|fetch\(\s*["']https?:""", text):
            problems.append(f"{f}: references a network URL")
    # Icons: every name the UI asks for must be in the generated sprite.
    icons_js = ASSETS / "icons.js"
    if not icons_js.is_file():
        problems.append("icons.js missing (run tools/build_ui_assets.py)")
    else:
        m = re.search(r"window\.ICONS=(\{.*\});", icons_js.read_text(encoding="utf-8"), re.S)
        have = set(json.loads(m.group(1))) if m else set()
        js = (ASSETS / "app.js").read_text(encoding="utf-8")
        used = {c["icon"] for c in cats.values() if c.get("icon")} | {a["icon"] for a in arts.values() if a.get("icon")}
        used |= set(re.findall(r"""\bicon\(\s*["']([a-z0-9-]+)["']""", js))
        used |= set(re.findall(r'href="#i-([a-z0-9-]+)"', (ASSETS / "index.html").read_text(encoding="utf-8")))
        for line in re.findall(r"//\s*icons:(.*)", js):
            used |= set(line.split())
        for name in sorted(used - have):
            problems.append(f"icon {name!r} is used but not in icons.js")

    # No SIM: nothing in the shell or the native code may dial, call or text.
    no_call = re.compile(r"""tel:|sms:|smsto:|data-dial|ACTION_DIAL|ACTION_CALL|CALL_PHONE|SEND_SMS|\bdial\(|\bcall\s+999\b|emergency\s*sms""", re.I)
    native = list((ROOT / "app" / "src" / "main" / "java").rglob("*.kt")) + [ROOT / "app" / "src" / "main" / "AndroidManifest.xml"]
    for p in [ASSETS / "index.html", ASSETS / "app.js"] + native:
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if no_call.search(line) and not re.search(r"(cannot|can't|can&#39;t)\s+(<b>)?call", line):
                problems.append(f"{p.relative_to(ROOT)}:{n}: call/SMS reference: {line.strip()[:80]}")

    for p in sorted((ASSETS / "img").glob("*.webp")) if (ASSETS / "img").exists() else []:
        if p.name not in credits:
            problems.append(f"img/{p.name} is bundled but unused/uncredited")
    for name, c in credits.items():
        for field in ("author", "license", "source"):
            if not c.get(field):
                problems.append(f"credits {name}: missing {field}")

    if args.min:
        if len(arts) < args.min:
            problems.append(f"only {len(arts)} articles (< {args.min})")
        if len(spp) < args.min:
            problems.append(f"only {len(spp)} species (< {args.min})")
    if len(credits) < args.min_photos:
        problems.append(f"only {len(credits)} photos (< {args.min_photos})")

    for p in problems:
        print("FAIL:", p)
    print(f"checked {len(arts)} articles, {len(spp)} species, {len(cats)} categories, "
          f"{checked_links} links, {len(credits)} photos: {'OK' if not problems else f'{len(problems)} problems'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
