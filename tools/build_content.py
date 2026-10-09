#!/usr/bin/env python3
"""Build the offline content bundle for the Survival Guide app.

Reads the hand-written sources in content/ and writes everything the web UI needs into
app/src/main/assets/content/:

  index.json / index.js   categories, article + species metadata (titles, tags, summaries, images)
  a/<id>.js               article body (pre-rendered HTML) wrapped in a JS call
  s/<id>.js               species body (pre-rendered HTML)
  search.js               prebuilt inverted index for instant, typo-tolerant search
  credits.js              photo credits and licences

Bodies are wrapped as JS (window.__body(key, html)) rather than fetched as .html/.json because
both Android WebView and desktop browsers refuse fetch()/XHR on file:// URLs, while <script src>
works everywhere, with no network and no local web server.

Only the Python standard library is used. Source format is documented in README.md.
"""
from __future__ import annotations

import html
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content"
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUT = ASSETS / "content"
IMG_DIR = ASSETS / "img"

STATUSES = ["deadly", "poisonous", "venomous", "caution", "invasive", "edible", "medicinal", "protected", "info"]
GROUPS = {"plant", "fungus", "animal"}

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# --------------------------------------------------------------------------------------------
# Source parsing
# --------------------------------------------------------------------------------------------

ENTRY_RE = re.compile(r"^===\s+([a-z0-9-]+)\s*$")


def parse_entries(path: Path) -> list[dict]:
    """A source file holds several entries:

        === entry-id
        key: value
        key: value
        ---
        markdown body
    """
    entries = []
    cur = None
    in_body = False
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = ENTRY_RE.match(raw)
        if m:
            if cur:
                entries.append(cur)
            cur = {"id": m.group(1), "meta": {}, "body": [], "src": f"{path.name}:{lineno}"}
            in_body = False
            continue
        if cur is None:
            if raw.strip() and not raw.startswith("#"):
                err(f"{path.name}:{lineno}: text before first '=== id' line")
            continue
        if not in_body:
            if raw.strip() == "---":
                in_body = True
            elif raw.strip():
                if ":" not in raw:
                    err(f"{path.name}:{lineno}: expected 'key: value' in header of {cur['id']}")
                    continue
                k, v = raw.split(":", 1)
                cur["meta"][k.strip().lower()] = v.strip()
        else:
            cur["body"].append(raw)
    if cur:
        entries.append(cur)
    return entries


def split_list(value: str | None, sep: str = ",") -> list[str]:
    if not value:
        return []
    return [x.strip() for x in value.split(sep) if x.strip()]


# --------------------------------------------------------------------------------------------
# Minimal Markdown renderer (the subset the content uses)
# --------------------------------------------------------------------------------------------

class Ctx:
    """Lookup tables for resolving [[a:id]] / [[s:id]] links while rendering."""

    articles: dict = {}
    species: dict = {}
    links: list = []  # (from, kind, id) for the link checker


def slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def link_target(href: str, owner: str) -> tuple[str, str | None]:
    """Returns (href for the app, label if it can be derived)."""
    for prefix, kind in (("a:", "a"), ("s:", "s"), ("c:", "c")):
        if href.startswith(prefix):
            target = href[len(prefix):]
            Ctx.links.append((owner, kind, target))
            label = None
            if kind == "a" and target in Ctx.articles:
                label = Ctx.articles[target]["title"]
            elif kind == "s" and target in Ctx.species:
                label = Ctx.species[target]["name"]
            return f"#/{kind}/{target}", label
    if href.startswith("tel:") or href.startswith("#/"):
        return href, None
    return "", None  # external URLs are shown as text; the app never goes online


def inline(text: str, owner: str) -> str:
    out = html.escape(text, quote=False)

    def wiki_link(m: re.Match) -> str:
        href, label = link_target(m.group(1), owner)
        shown = m.group(2) or label or m.group(1)
        return f'<a href="{href}">{shown}</a>'

    out = re.sub(r"\[\[([acs]:[a-z0-9-]+)(?:\|([^\]]+))?\]\]", wiki_link, out)

    def md_link(m: re.Match) -> str:
        label, href = m.group(1), m.group(2)
        target, _ = link_target(href, owner)
        if not target:
            return f'{label} <span class="url">({href})</span>'
        return f'<a href="{target}">{label}</a>'

    out = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", md_link, out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", out)
    out = re.sub(r"(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])", r"<em>\1</em>", out)
    out = out.replace(" -- ", " – ")
    return out


LIST_RE = re.compile(r"^(\s*)([-*]|\d+[.)])\s+(.*)$")
CALLOUTS = {
    "quick": ("quick", "Quick steps"),
    "warn": ("callout warn", "Warning"),
    "danger": ("callout danger", "Danger"),
    "note": ("callout note", "Note"),
    "tip": ("callout tip", "Tip"),
    "law": ("callout law", "The law"),
    "checklist": ("callout checklist", "Checklist"),
}


def render_list(lines: list[str], owner: str) -> str:
    """Render a (possibly nested) list from raw lines using indentation."""
    items: list[tuple[int, str, str]] = []  # indent, marker type, text
    for ln in lines:
        m = LIST_RE.match(ln)
        if m:
            items.append((len(m.group(1).expandtabs(4)), "ol" if m.group(2)[0].isdigit() else "ul", m.group(3)))
        elif items:
            ind, typ, txt = items[-1]
            items[-1] = (ind, typ, txt + " " + ln.strip())

    def build(idx: int, base: int) -> tuple[str, int]:
        typ = items[idx][1]
        parts = [f"<{typ}>"]
        while idx < len(items) and items[idx][0] >= base:
            ind, _, txt = items[idx]
            if ind > base:
                sub, idx = build(idx, ind)
                parts[-1] = parts[-1].replace("</li>", "") + sub + "</li>"
                continue
            parts.append(f"<li>{inline(txt, owner)}</li>")
            idx += 1
        parts.append(f"</{typ}>")
        return "".join(parts), idx

    out = []
    i = 0
    while i < len(items):
        frag, i = build(i, items[i][0])
        out.append(frag)
    return "".join(out)


def render_table(lines: list[str], owner: str) -> str:
    rows = [[c.strip() for c in ln.strip().strip("|").split("|")] for ln in lines]
    head, body = rows[0], rows[1:]
    if body and all(re.fullmatch(r":?-{2,}:?", c) for c in body[0]):
        body = body[1:]
    h = "".join(f"<th>{inline(c, owner)}</th>" for c in head)
    b = "".join("<tr>" + "".join(f"<td>{inline(c, owner)}</td>" for c in r) + "</tr>" for r in body)
    return f'<div class="table-wrap"><table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table></div>'


def render_md(lines: list[str], owner: str) -> str:
    out: list[str] = []
    i = 0
    n = len(lines)
    para: list[str] = []

    def flush_para():
        if para:
            out.append(f"<p>{inline(' '.join(x.strip() for x in para), owner)}</p>")
            para.clear()

    while i < n:
        ln = lines[i]
        s = ln.strip()
        if not s:
            flush_para()
            i += 1
            continue
        m = re.match(r"^!(\w+)\s*(.*)$", s)
        if m and m.group(1) in CALLOUTS:
            flush_para()
            cls, default_title = CALLOUTS[m.group(1)]
            title = m.group(2).strip() or default_title
            j = i + 1
            inner = []
            while j < n and lines[j].strip() != "!end":
                inner.append(lines[j])
                j += 1
            if j >= n:
                err(f"{owner}: unterminated !{m.group(1)} block")
            body = render_md(inner, owner)
            role = ' role="note"'
            out.append(f'<section class="{cls}"{role}><h2>{html.escape(title)}</h2>{body}</section>')
            i = j + 1
            continue
        if s.startswith("!svg "):
            flush_para()
            name = s[5:].strip()
            svg_path = SRC / "diagrams" / f"{name}.svg"
            if svg_path.exists():
                svg = svg_path.read_text(encoding="utf-8")
                svg = re.sub(r"<\?xml[^>]*>\s*", "", svg)
                out.append(f'<figure class="diagram">{svg}</figure>')
            else:
                err(f"{owner}: missing diagram {svg_path.name}")
            i += 1
            continue
        hm = re.match(r"^(#{1,4})\s+(.*)$", s)
        if hm:
            flush_para()
            level = min(len(hm.group(1)) + (1 if len(hm.group(1)) == 1 else 0), 4)
            text = hm.group(2)
            out.append(f'<h{level} id="{slug(text)}">{inline(text, owner)}</h{level}>')
            i += 1
            continue
        if s.startswith("|"):
            flush_para()
            j = i
            rows = []
            while j < n and lines[j].strip().startswith("|"):
                rows.append(lines[j])
                j += 1
            out.append(render_table(rows, owner))
            i = j
            continue
        if LIST_RE.match(ln):
            flush_para()
            j = i
            block = []
            while j < n:
                cur = lines[j]
                if not cur.strip():
                    # a blank line ends the list unless the next line continues it
                    if j + 1 < n and LIST_RE.match(lines[j + 1]):
                        j += 1
                        continue
                    break
                if LIST_RE.match(cur) or cur.startswith("  "):
                    block.append(cur)
                    j += 1
                else:
                    break
            out.append(render_list(block, owner))
            i = j
            continue
        if s.startswith(">"):
            flush_para()
            j = i
            quote = []
            while j < n and lines[j].strip().startswith(">"):
                quote.append(lines[j].strip()[1:].strip())
                j += 1
            out.append(f"<blockquote>{render_md(quote, owner)}</blockquote>")
            i = j
            continue
        para.append(ln)
        i += 1
    flush_para()
    return "".join(out)


def strip_tags(h: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", h))


# --------------------------------------------------------------------------------------------
# Search index
# --------------------------------------------------------------------------------------------

STOP = set(
    """a an and are as at be but by can do for from has have if in into is it its not of on or so
    that the their them then there these they this to too was were what when where which while who will
    with you your it's don't than also may more most one some any all each other out up use used using
    very only just should would could been being over under about after before such how why per off
    own same both few many much now new well get got make made""".split()
)


def tokens(text: str) -> list[str]:
    t = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()
    t = t.replace("'", "")
    return [w for w in re.findall(r"[a-z0-9]+", t) if len(w) > 1 and w not in STOP and not w.isdigit() or w in {"999", "112", "999/112"}]


def stem(w: str) -> str:
    """Very light plural folding so 'nettles' finds 'nettle' and 'berries' finds 'berry'."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ches", "shes", "sses", "xes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def build_search(docs: list[dict]) -> dict:
    weights = {"title": 12.0, "alt": 10.0, "tags": 7.0, "summary": 3.0, "heads": 2.0, "body": 1.0}
    postings: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for idx, d in enumerate(docs):
        for field, w in weights.items():
            counts: dict[str, int] = defaultdict(int)
            for tok in tokens(d.get(field, "")):
                counts[stem(tok)] += 1
            for tok, c in counts.items():
                postings[tok][idx] += w * (1 + math.log(c))
    terms = {}
    for tok in sorted(postings):
        flat = []
        for idx, score in sorted(postings[tok].items()):
            flat += [idx, round(score, 1)]
        terms[tok] = flat
    return {"docs": [d["key"] for d in docs], "terms": terms}


# --------------------------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------------------------

def load_images() -> tuple[dict, dict]:
    """images.json (written by fetch_images.py): {"species/nettle": [file, ...], ...} plus credits."""
    path = SRC / "images.json"
    if not path.exists():
        warn("content/images.json missing: building without photos (run tools/fetch_images.py)")
        return {}, {}
    data = json.loads(path.read_text(encoding="utf-8"))
    exclude = set()
    ex_path = SRC / "image_exclude.txt"
    if ex_path.exists():
        for ln in ex_path.read_text(encoding="utf-8").splitlines():
            ln = ln.split("#", 1)[0].strip()
            if ln:
                exclude.add(ln)
    files = data.get("files", {})
    by_owner: dict[str, list[str]] = {}
    for owner, names in data.get("owners", {}).items():
        keep = []
        for name in names:
            info = files.get(name)
            if not info or info.get("commons") in exclude or name in exclude:
                continue
            if not (IMG_DIR / name).exists() or not (IMG_DIR / "t" / name).exists():
                warn(f"image or thumbnail missing on disk: {name}")
                continue
            keep.append(name)
        by_owner[owner] = [[n, files[n].get("w", 0), files[n].get("h", 0)] for n in keep]
    used = {im[0] for names in by_owner.values() for im in names}
    credits = {n: files[n] for n in sorted(used)}
    return by_owner, credits


def main() -> int:
    categories = json.loads((SRC / "categories.json").read_text(encoding="utf-8"))
    cat_ids = [c["id"] for c in categories]

    raw_articles = []
    for path in sorted((SRC / "articles").glob("*.md")):
        cat = re.sub(r"^\d+-", "", path.stem)
        if cat not in cat_ids:
            err(f"{path.name}: category '{cat}' not in categories.json")
        for e in parse_entries(path):
            e["cat"] = cat
            raw_articles.append(e)

    raw_species = []
    for path in sorted((SRC / "species").glob("*.md")):
        raw_species.extend(parse_entries(path))

    # First pass: metadata, so links can be resolved while rendering.
    articles: dict[str, dict] = {}
    for e in raw_articles:
        m = e["meta"]
        if e["id"] in articles:
            err(f"{e['src']}: duplicate article id {e['id']}")
        if "title" not in m or "summary" not in m:
            err(f"{e['src']}: article {e['id']} needs title and summary")
        articles[e["id"]] = {
            "id": e["id"],
            "cat": e["cat"],
            "title": m.get("title", e["id"]),
            "summary": m.get("summary", ""),
            "tags": split_list(m.get("tags")),
            "compare": split_list(m.get("compare")),
            "wiki": split_list(m.get("wiki"), "|"),
        }
    species: dict[str, dict] = {}
    for e in raw_species:
        m = e["meta"]
        sid = e["id"]
        if sid in species or sid in articles:
            err(f"{e['src']}: duplicate id {sid}")
        st = split_list(m.get("status"))
        bad = [s for s in st if s not in STATUSES]
        if bad or not st:
            err(f"{e['src']}: species {sid} has bad/missing status {bad or st}")
        st.sort(key=STATUSES.index)
        group = m.get("group", "")
        if group not in GROUPS:
            err(f"{e['src']}: species {sid} group must be one of {sorted(GROUPS)}")
        for req in ("name", "latin", "summary", "season", "habitat"):
            if not m.get(req):
                err(f"{e['src']}: species {sid} missing '{req}'")
        species[sid] = {
            "id": sid,
            "name": m.get("name", sid),
            "latin": m.get("latin", ""),
            "aka": split_list(m.get("aka")),
            "group": group,
            "kind": m.get("kind", ""),
            "status": st,
            "season": m.get("season", ""),
            "habitat": m.get("habitat", ""),
            "summary": m.get("summary", ""),
            "tags": split_list(m.get("tags")),
            "lookalikes": split_list(m.get("lookalikes")),
            "wiki": split_list(m.get("wiki"), "|"),
        }
    Ctx.articles, Ctx.species = articles, species

    images, credits = load_images()

    # Category membership keeps file order.
    for c in categories:
        c["articles"] = [a["id"] for a in articles.values() if a["cat"] == c["id"]]

    if OUT.exists():
        for old in list(OUT.glob("a/*.js")) + list(OUT.glob("s/*.js")):
            old.unlink()
    (OUT / "a").mkdir(parents=True, exist_ok=True)
    (OUT / "s").mkdir(parents=True, exist_ok=True)

    docs = []
    for e in raw_articles:
        a = articles[e["id"]]
        owner = f"article {a['id']}"
        body = render_md(e["body"], owner)
        if 'class="quick"' not in body:
            err(f"{e['src']}: article {a['id']} has no !quick box")
        if 'id="sources"' not in body:
            err(f"{e['src']}: article {a['id']} has no '## Sources' section")
        for sid in a["compare"]:
            Ctx.links.append((owner, "s", sid))
        a["images"] = images.get(f"article/{a['id']}", [])
        write_body(OUT / "a" / f"{a['id']}.js", f"a/{a['id']}", body)
        heads = " ".join(re.findall(r"<h[2-4][^>]*>(.*?)</h[2-4]>", body))
        docs.append({
            "key": f"a:{a['id']}", "title": a["title"], "tags": " ".join(a["tags"]),
            "summary": a["summary"], "heads": strip_tags(heads), "body": strip_tags(body),
        })
    for e in raw_species:
        s = species[e["id"]]
        owner = f"species {s['id']}"
        body = render_md(e["body"], owner)
        for lid in s["lookalikes"]:
            Ctx.links.append((owner, "s", lid))
        s["images"] = images.get(f"species/{s['id']}", [])
        write_body(OUT / "s" / f"{s['id']}.js", f"s/{s['id']}", body)
        docs.append({
            "key": f"s:{s['id']}", "title": s["name"], "alt": " ".join([s["latin"]] + s["aka"]),
            "tags": " ".join(s["tags"] + s["status"] + [s["group"], s["kind"]]),
            "summary": s["summary"] + " " + s["habitat"] + " " + s["season"],
            "body": strip_tags(body),
        })

    for owner, kind, target in Ctx.links:
        table = {"a": articles, "s": species, "c": {c["id"]: c for c in categories}}[kind]
        if target not in table:
            err(f"{owner}: broken link to {kind}:{target}")

    for a in articles.values():
        del a["wiki"]
        if not a["compare"]:
            del a["compare"]
        if not a["images"]:
            del a["images"]
    for s in species.values():
        del s["wiki"]

    index = {
        "built": date.today().isoformat(),
        "counts": {"articles": len(articles), "species": len(species), "photos": len(credits)},
        "categories": categories,
        "articles": articles,
        "species": species,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    index_json = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    (OUT / "index.json").write_text(index_json, encoding="utf-8")
    (OUT / "index.js").write_text(f"window.GUIDE_INDEX={index_json};\n", encoding="utf-8")
    search = json.dumps(build_search(docs), ensure_ascii=False, separators=(",", ":"))
    (OUT / "search.js").write_text(f"window.GUIDE_SEARCH={search};\n", encoding="utf-8")
    cred = json.dumps(credits, ensure_ascii=False, separators=(",", ":"))
    (OUT / "credits.js").write_text(f"window.GUIDE_CREDITS={cred};\n", encoding="utf-8")

    for w in warnings:
        print("warning:", w, file=sys.stderr)
    for e in errors:
        print("ERROR:", e, file=sys.stderr)
    print(f"{len(articles)} articles, {len(species)} species, {len(credits)} photos, "
          f"{len(build_search(docs)['terms'])} search terms")
    return 1 if errors else 0


def write_body(path: Path, key: str, body: str) -> None:
    payload = json.dumps(body, ensure_ascii=False)
    path.write_text(f"__body({json.dumps(key)},{payload});\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
