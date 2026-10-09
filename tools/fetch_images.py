#!/usr/bin/env python3
"""Download identification photos from Wikimedia Commons at build time (never at runtime).

For every species/article entry with a `wiki:` field (one or more English Wikipedia titles,
separated by |) this script:

  1. asks the Wikipedia REST API (page/summary/{title}) for the article's lead image,
  2. optionally adds further photos used on that article (prop=images), keeping only files whose
     name mentions the species (genus/epithet/common name) and skipping maps, drawings and icons,
  3. checks each file's licence with the Commons API (imageinfo + extmetadata) and keeps only
     public domain, CC0, CC BY and CC BY-SA,
  4. downloads a standard-size thumbnail, resizes to max 1000 px on the long edge, strips all
     metadata and saves WebP (quality 75) into app/src/main/assets/img/,
  5. records author, licence and source page in content/images.json, from which
     build_content.py generates the in-app "Photo credits & licences" page.

Entries already present in content/images.json are skipped, so re-running only fetches what is
new. Use --refresh to re-resolve everything, --only nettle,adder to limit to some ids.
Files listed in content/image_exclude.txt (Commons file names) are never used.

Requires: Python 3.9+, Pillow with WebP support (pip install pillow).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_content import parse_entries, split_list  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content"
IMG_DIR = ROOT / "app" / "src" / "main" / "assets" / "img"
MANIFEST = SRC / "images.json"
EXCLUDE = SRC / "image_exclude.txt"

UA = "UKSurvivalGuideOfflineApp/1.0 (personal offline field guide; https://github.com/Hedgehogsz/theseus2) python-urllib"
WIKI_API = "https://en.wikipedia.org/w/api.php"
REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

MAX_EDGE = 1000
QUALITY = 75
THUMB_WIDTH = 1280
THUMB_EDGE = 192  # square list thumbnails  # a standard Wikimedia thumbnail step; we downscale locally
OK_LICENSE = re.compile(r"^(cc0|cc[- ]by|pd|public domain|cc-pd)", re.I)
BAD_NAME = re.compile(
    r"(?<![a-z])(map|maps|distribution|range|logo|icon|symbol|flag|coat of arms|stamp|diagram|chart|"
    r"drawing|illustration|plate|k[oö]hler|thom[eé]|sowerby|botanical|herbarium|skull|skeleton|"
    r"specimen|museum|wiki|status|iucn|seed|seeds|market|dish|food|cooked|recipe|soup|meal|albino|"
    r"melanistic|leucistic|tincture|bottle|sem|micrograph|microscope|spore|spores|cultivar|cv|var|"
    r"sporran|dentition|teeth|mhnt|mount|stuffed|taxidermy|sign|label|stamps)(?![a-z])|\.(svg|gif|tiff?)$",
    re.I,
)

_last = 0.0


def get(url: str, params: dict | None = None, binary: bool = False, tries: int = 5):
    global _last
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        wait = 0.25 - (time.time() - _last)  # stay well below Wikimedia rate limits
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(2 ** attempt * 2)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < tries - 1:
                time.sleep(2 ** attempt * 2)
                continue
            raise
    return None


def lead_image(title: str) -> str | None:
    data = get(REST + urllib.parse.quote(title.replace(" ", "_"), safe=""))
    if not data:
        print(f"  ! no Wikipedia page for {title!r}")
        return None
    src = (data.get("originalimage") or {}).get("source") or (data.get("thumbnail") or {}).get("source")
    if not src or "/wikipedia/commons/" not in src:
        return None  # no image, or a non-free local (en.wikipedia) upload
    src = src.split("?", 1)[0].split("#", 1)[0]  # REST URLs carry ?utm_source=... tracking params
    name = urllib.parse.unquote(src.split("/")[-1])
    if "/thumb/" in src:
        name = urllib.parse.unquote(src.split("/")[-2])
    return name.replace("_", " ")


def page_images(title: str) -> list[str]:
    data = get(WIKI_API, {"action": "query", "prop": "images", "titles": title, "imlimit": "100",
                          "format": "json", "redirects": "1"})
    names = []
    for page in (data or {}).get("query", {}).get("pages", {}).values():
        for im in page.get("images", []):
            names.append(im["title"].split(":", 1)[1])
    return names


def commons_info(name: str) -> dict | None:
    data = get(COMMONS_API, {
        "action": "query", "titles": "File:" + name, "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata", "iiurlwidth": str(THUMB_WIDTH), "format": "json",
    })
    pages = (data or {}).get("query", {}).get("pages", {})
    for page in pages.values():
        if "imageinfo" not in page:
            return None
        return page["imageinfo"][0]
    return None


def clean_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def to_webp(data: bytes) -> tuple[bytes, int, int]:
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)  # apply camera rotation before EXIF is dropped
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, method=6)  # no exif/icc passed => metadata stripped
    return buf.getvalue(), im.width, im.height


def make_thumbnails(manifest: dict) -> None:
    """Small list/thumbnail versions (img/t/<name>), so lists never decode full-size photos."""
    from PIL import Image

    tdir = IMG_DIR / "t"
    tdir.mkdir(parents=True, exist_ok=True)
    for name in manifest["files"]:
        src, dst = IMG_DIR / name, tdir / name
        if dst.exists() or not src.exists():
            continue
        im = Image.open(src)
        w, h = im.size
        side = min(w, h)  # centre-crop to a square, then shrink
        im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
        im = im.resize((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
        im.save(dst, "WEBP", quality=70, method=6)


def name_matches(fname: str, words: list[str]) -> bool:
    f = re.sub(r"[_\-]+", " ", fname.lower())
    return any(w and w in f for w in words)


def resolve(entry: dict, kind: str, excluded: set[str], want: int) -> list[str]:
    """Return Commons file names to use for one entry, best first."""
    titles = split_list(entry["meta"].get("wiki"), "|")
    picks: list[str] = []
    for extra in split_list(entry["meta"].get("commons"), "|"):  # explicit File: names win
        extra = extra.removeprefix("File:")
        if extra not in excluded and extra not in picks:
            picks.append(extra)
    for t in titles:
        name = lead_image(t)
        if name and name not in excluded and name not in picks and not re.search(r"\.(svg|gif|tif+)$", name, re.I):
            picks.append(name)
    if kind == "species" and len(picks) < want and titles:
        # Extra photos must name the exact species (full binomial) or its full common name in the
        # file name. Matching on the genus alone pulled in other species (e.g. fly agaric for
        # death cap), so it is deliberately not allowed.
        latin = entry["meta"].get("latin", "").lower().replace("×", "x").split()
        words = [" ".join(latin[:2])] if len(latin) >= 2 and latin[1] not in ("spp.", "agg.") else []
        common = entry["meta"].get("name", "").lower()
        common = re.sub(r"\s*\(.*?\)", "", common).strip()
        if len(common) > 4:
            words.append(common)
        for name in page_images(titles[0]):
            if len(picks) >= want + 2:  # a few spare candidates in case licences fail
                break
            if name in excluded or name in picks or BAD_NAME.search(name.replace("_", " ")):
                continue
            if not re.search(r"\.(jpe?g|png|webp)$", name, re.I):
                continue
            if name_matches(name, words):
                picks.append(name)
    return picks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="re-resolve entries already in images.json")
    ap.add_argument("--only", help="comma-separated entry ids")
    ap.add_argument("--offline", action="store_true",
                    help="no network: only drop excluded/unreferenced photos and make missing thumbnails")
    ap.add_argument("--photos", type=int, default=3, help="max photos per species (default 3)")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    manifest.setdefault("files", {})
    manifest.setdefault("owners", {})
    excluded = set()
    if EXCLUDE.exists():
        excluded = {ln.split("#", 1)[0].strip().removeprefix("File:") for ln in EXCLUDE.read_text(encoding="utf-8").splitlines()}
        excluded.discard("")
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    # Forget photos that have since been added to the exclude list (their files are deleted below).
    for owner, names in manifest["owners"].items():
        manifest["owners"][owner] = [n for n in names if manifest["files"].get(n, {}).get("commons") not in excluded]
    only = set(split_list(args.only)) if args.only else None

    jobs = []
    for path in sorted((SRC / "species").glob("*.md")):
        jobs += [("species", e) for e in parse_entries(path)]
    for path in sorted((SRC / "articles").glob("*.md")):
        jobs += [("article", e) for e in parse_entries(path)]

    fetched = failed = 0
    if args.offline:
        jobs = []
    for kind, e in jobs:
        if not e["meta"].get("wiki") and not e["meta"].get("commons"):
            continue
        owner = f"{kind}/{e['id']}"
        if only and e["id"] not in only:
            continue
        # Entries that got no photo last time (rate limits, licence failures) are retried every run.
        kept = [n for n in manifest["owners"].get(owner, [])
                if manifest["files"].get(n, {}).get("commons") not in excluded]
        if kept and not args.refresh and not only:
            continue
        want = args.photos if kind == "species" else int(e["meta"].get("photos", "1"))
        print(f"{owner}")
        try:
            candidates = resolve(e, kind, excluded, want)
        except Exception as ex:  # keep going; a later run will retry this entry
            print(f"  ! lookup failed: {ex}")
            failed += 1
            continue
        names: list[str] = []
        for cname in candidates:
            if len(names) >= want:
                break
            local = "c-" + hashlib.sha1(cname.encode("utf-8")).hexdigest()[:12] + ".webp"
            if local in manifest["files"] and (IMG_DIR / local).exists():
                names.append(local)
                continue
            try:
                info = commons_info(cname)
                if not info:
                    print(f"  - {cname}: not on Commons")
                    continue
                meta = info.get("extmetadata", {})
                lic = clean_html(meta.get("LicenseShortName", {}).get("value", ""))
                lic_code = meta.get("License", {}).get("value", "")
                if not (OK_LICENSE.match(lic_code) or OK_LICENSE.match(lic)):
                    print(f"  - {cname}: licence {lic or lic_code!r} not accepted")
                    continue
                url = info.get("thumburl") or info["url"]
                raw = get(url, binary=True)
                if not raw:
                    continue
                webp, w, h = to_webp(raw)
                (IMG_DIR / local).write_bytes(webp)
                artist = clean_html(meta.get("Attribution", {}).get("value", "")) or \
                    clean_html(meta.get("Artist", {}).get("value", "")) or "Unknown author"
                manifest["files"][local] = {
                    "commons": cname,
                    "author": artist[:200],
                    "license": lic or lic_code,
                    "licenseUrl": meta.get("LicenseUrl", {}).get("value", ""),
                    "source": info.get("descriptionurl", ""),
                    "w": w,
                    "h": h,
                }
                names.append(local)
                fetched += 1
                print(f"  + {cname} ({lic}, {len(webp) // 1024} KB)")
            except Exception as ex:
                print(f"  ! {cname}: {ex}")
        manifest["owners"][owner] = names
        MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    make_thumbnails(manifest)

    # Drop files no longer referenced by anything.
    used = {n for ns in manifest["owners"].values() for n in ns}
    for name in list(manifest["files"]):
        if name not in used:
            del manifest["files"][name]
            (IMG_DIR / name).unlink(missing_ok=True)
            (IMG_DIR / "t" / name).unlink(missing_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    total = sum((IMG_DIR / n).stat().st_size for n in used if (IMG_DIR / n).exists())
    print(f"fetched {fetched} new photos, {failed} lookups failed; {len(used)} photos, {total / 1e6:.1f} MB total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
