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

STATUSES = ["deadly", "poisonous", "venomous", "psychoactive", "caution", "invasive", "edible", "medicinal", "protected",
            "info"]
LEVELS = ["easy", "moderate", "hard"]
# Tool screens articles may link to with [[t:id]] (kept in step with TOOLS in app.js).
TOOL_LABELS = {"compass": "compass", "gps": "position tool", "map": "map", "sun": "sun and moon tool", "signal": "signal tool",
               "morse": "Morse tool", "level": "clinometer", "pace": "pace counter", "cpr": "CPR metronome",
               "casualty": "casualty log", "boil": "boil timer", "calc": "calculators", "notebook": "notebook",
               "battery": "battery page", "torch": "torch", "phone-mode": "phone mode settings"}
TOOLS = set(TOOL_LABELS)
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
GROUPS = {"plant", "fungus", "animal"}

errors: list[str] = []
DIAGRAMS_USED: set[str] = set()

# This device has no SIM card and cannot make calls or send texts. Content may explain calling 999
# from *another* phone only in these articles; everything else must not tell the reader to call/text.
CALL_OK = {"when-you-reach-help", "finding-help", "when-to-get-help", "kit-phone", "coast-and-tides"}
CALL_PATTERNS = [r"\bcall(ing)?\s+(\*\*)?(999|112)\b", r"\bdial(ling)?\s+(\*\*)?(999|112)", r"\bspeaker on\b",
                 r"\bNHS 111\b", r"\bcall\s+(\*\*)?111\b"]
SMS_PATTERNS = [r"emergency\s*sms", r"\btext(ing)?\s+(to\s+)?(\*\*)?999", r"\bsms\b", r"\btel:"]
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
    flows: dict = {}
    categories: dict = {}
    links: list = []  # (from, kind, id) for the link checker


def slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def link_target(href: str, owner: str) -> tuple[str, str | None]:
    """Returns (href for the app, label if it can be derived)."""
    for prefix, kind in (("a:", "a"), ("s:", "s"), ("c:", "c"), ("f:", "f"), ("t:", "t")):
        if href.startswith(prefix):
            target = href[len(prefix):]
            Ctx.links.append((owner, kind, target))
            label = None
            if kind == "a" and target in Ctx.articles:
                label = Ctx.articles[target]["title"]
            elif kind == "s" and target in Ctx.species:
                label = Ctx.species[target]["name"]
            elif kind == "f" and target in Ctx.flows:
                label = Ctx.flows[target]["title"]
            elif kind == "c" and target in Ctx.categories:
                label = Ctx.categories[target]["title"]
            elif kind == "t":
                label = TOOL_LABELS.get(target)
            if kind == "t" and target == "map":
                return "#/map", label
            return f"#/{'tool' if kind == 't' else kind}/{target}", label
    if href.startswith("tel:") or href.startswith("#/"):
        return href, None
    return "", None  # external URLs are shown as text; the app never goes online


def inline(text: str, owner: str) -> str:
    out = html.escape(text, quote=False)

    def wiki_link(m: re.Match) -> str:
        href, label = link_target(m.group(1), owner)
        shown = m.group(2) or label or m.group(1)
        return f'<a href="{href}">{shown}</a>'

    out = re.sub(r"\[\[([acsft]:[a-z0-9-]+)(?:\|([^\]]+))?\]\]", wiki_link, out)

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
                # Shipped as a file (not inline) so a tap can open it in the zoom viewer.
                DIAGRAMS_USED.add(name)
                label = re.search(r'aria-label="([^"]*)"', svg_path.read_text(encoding="utf-8"))
                alt = html.escape(label.group(1) if label else name)
                out.append(f'<figure class="diagram"><img src="diagrams/{name}.svg" alt="{alt}" data-zoom></figure>')
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


FLOW_NODE_RE = re.compile(r"^@\s+([a-z0-9-]+)\s*$")
FLOW_OPT_RE = re.compile(r"^\+\s+(.+?):\s*([a-z0-9-]+)\s*$")


def parse_flow(e: dict) -> dict:
    """A decision flow is a set of nodes:

        @ node-id
        Text lines (Markdown inline, may be lists).
        ? The question (optional)
        + Option label: target-node-id
        > [[a:article]]           (links shown as buttons)

    A node with no options is an end point. The first node is the start.
    """
    nodes: dict[str, dict] = {}
    order: list[str] = []
    cur = None
    owner = f"flow {e['id']}"
    for raw in e["body"]:
        line = raw.rstrip()
        m = FLOW_NODE_RE.match(line)
        if m:
            cur = {"id": m.group(1), "text": [], "q": "", "opts": [], "links": []}
            if cur["id"] in nodes:
                err(f"{e['src']}: flow {e['id']} has duplicate node {cur['id']}")
            nodes[cur["id"]] = cur
            order.append(cur["id"])
            continue
        if not line.strip():
            continue
        if cur is None:
            err(f"{e['src']}: flow {e['id']}: text before the first '@ node' line")
            continue
        if line.startswith("? "):
            cur["q"] = inline(line[2:].strip(), owner)
        elif FLOW_OPT_RE.match(line):
            lab, tgt = FLOW_OPT_RE.match(line).groups()
            cur["opts"].append([inline(lab, owner), tgt])
        elif line.startswith("> "):
            for href in re.findall(r"\[\[([acsft]:[a-z0-9-]+)", line):
                cur["links"].append(link_target(href, owner)[0])
        else:
            cur["text"].append(line)
    out = {}
    for nid in order:
        n = nodes[nid]
        for _, tgt in n["opts"]:
            if tgt not in nodes:
                err(f"{e['src']}: flow {e['id']} node {nid} points to missing node {tgt}")
        out[nid] = {"html": render_md(n["text"], owner), "q": n["q"], "opts": n["opts"], "links": n["links"]}
    reachable, todo = set(), [order[0]] if order else []
    while todo:
        nid = todo.pop()
        if nid in reachable or nid not in nodes:
            continue
        reachable.add(nid)
        todo.extend(t for _, t in nodes[nid]["opts"])
    for nid in order:
        if nid not in reachable:
            err(f"{e['src']}: flow {e['id']} node {nid} can't be reached")
    return {"start": order[0] if order else "", "nodes": out}


def parse_harvest(value: str, owner: str) -> list:
    """'leaves 2-5; flowers 5-6; berries 8-10' -> [["leaves", 2, 5], ...] (months 1-12, may wrap)."""
    out = []
    for part in split_list(value, ";"):
        m = re.match(r"^(.*?)\s*(\d{1,2})\s*[-–]\s*(\d{1,2})$", part) or re.match(r"^(.*?)\s*(\d{1,2})()$", part)
        if not m:
            err(f"{owner}: bad harvest entry '{part}' (want e.g. 'leaves 3-5')")
            continue
        what, a, b = m.group(1).strip() or "harvest", int(m.group(2)), int(m.group(3) or m.group(2))
        if not (1 <= a <= 12 and 1 <= b <= 12):
            err(f"{owner}: harvest months must be 1-12 in '{part}'")
            continue
        out.append([what, a, b])
    return out


def load_structure(articles: dict, flows: dict) -> tuple[dict, dict]:
    st = json.loads((SRC / "structure.json").read_text(encoding="utf-8"))
    cats: dict[str, dict] = {}
    member: dict[str, str] = {}
    groups = []
    for g in st["groups"]:
        gcats = []
        for c in g["categories"]:
            if c["id"] in cats:
                err(f"structure.json: duplicate category {c['id']}")
            topics = []
            own = []
            for t in c["topics"]:
                items = []
                for ref in t["articles"]:
                    cross = ref.startswith("@")
                    aid = ref.lstrip("@")
                    if aid not in articles:
                        err(f"structure.json: {c['id']} / {t['title']}: unknown article {aid}")
                        continue
                    if not cross:
                        if aid in member:
                            err(f"structure.json: article {aid} is in both {member[aid]} and {c['id']} (use @ for a cross-reference)")
                        member[aid] = c["id"]
                        own.append(aid)
                    items.append(ref)
                topics.append({"title": t["title"], "items": items})
            if c.get("start") not in own:
                err(f"structure.json: category {c['id']} start '{c.get('start')}' must be one of its own articles")
            cats[c["id"]] = {"id": c["id"], "group": g["id"], "title": c["title"], "icon": c["icon"],
                             "short": c["short"], "intro": c["intro"], "start": c.get("start"), "topics": topics,
                             "articles": own}
            gcats.append(c["id"])
        groups.append({"id": g["id"], "title": g["title"], "icon": g["icon"], "color": g["color"],
                       "short": g["short"], "intro": g["intro"], "categories": gcats, "links": g.get("links", [])})
    for aid in articles:
        if aid not in member:
            err(f"structure.json: article {aid} is not in any category (orphan)")
        else:
            articles[aid]["cat"] = member[aid]
    for u in st["urgent"]:
        kind, _, target = u["to"].partition(":")
        table = {"a": articles, "f": flows, "c": cats}.get(kind)
        if table is None or target not in table:
            err(f"structure.json: urgent tile '{u['title']}' points to unknown {u['to']}")
    for fid in st["flows"]:
        if fid not in flows:
            err(f"structure.json: unknown flow {fid}")
    for aid in st["cards"]:
        if aid not in articles:
            err(f"structure.json: unknown card article {aid}")
    return {"groups": groups, "urgent": st["urgent"], "flows": st["flows"], "cards": st["cards"]}, cats


def load_synonyms() -> list[list[str]]:
    groups = []
    path = SRC / "synonyms.txt"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                groups.append([w.strip().lower() for w in line.split(",") if w.strip()])
    return groups


def main() -> int:
    kit = json.loads((SRC / "kit.json").read_text(encoding="utf-8"))

    raw_articles = []
    for path in sorted((SRC / "articles").glob("*.md")):
        raw_articles.extend(parse_entries(path))
    raw_species = []
    for path in sorted((SRC / "species").glob("*.md")):
        raw_species.extend(parse_entries(path))
    raw_flows = []
    for path in sorted((SRC / "flows").glob("*.md")) if (SRC / "flows").exists() else []:
        raw_flows.extend(parse_entries(path))

    # First pass: metadata, so links can be resolved while rendering.
    articles: dict[str, dict] = {}
    for e in raw_articles:
        m = e["meta"]
        if e["id"] in articles:
            err(f"{e['src']}: duplicate article id {e['id']}")
        if "title" not in m or "summary" not in m:
            err(f"{e['src']}: article {e['id']} needs title and summary")
        level = m.get("level", "").lower()
        if level and level not in LEVELS:
            err(f"{e['src']}: article {e['id']} level must be one of {LEVELS}")
        articles[e["id"]] = {
            "id": e["id"],
            "title": m.get("title", e["id"]),
            "summary": m.get("summary", ""),
            "tags": split_list(m.get("tags")),
            "compare": split_list(m.get("compare")),
            "icon": m.get("icon", ""),
            "time": m.get("time", ""),
            "level": level,
            "needs": [n.strip('"\'') for n in split_list(m.get("needs"))],
            "related": split_list(m.get("related")),
            "wiki": split_list(m.get("wiki"), "|"),
        }
    flows: dict[str, dict] = {}
    for e in raw_flows:
        m = e["meta"]
        if e["id"] in flows:
            err(f"{e['src']}: duplicate flow id {e['id']}")
        for req in ("title", "summary", "icon"):
            if not m.get(req):
                err(f"{e['src']}: flow {e['id']} missing '{req}'")
        flows[e["id"]] = {"id": e["id"], "title": m.get("title", e["id"]), "summary": m.get("summary", ""),
                          "icon": m.get("icon", "")}
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
        st = [s for s in STATUSES if s in st]
        group = m.get("group", "")
        if group not in GROUPS:
            err(f"{e['src']}: species {sid} group must be one of {sorted(GROUPS)}")
        for req in ("name", "latin", "summary", "season", "habitat"):
            if not m.get(req):
                err(f"{e['src']}: species {sid} missing '{req}'")
        harvest = parse_harvest(m.get("harvest", ""), f"{e['src']}: species {sid}")
        if harvest and not ({"edible", "medicinal"} & set(st)):
            err(f"{e['src']}: species {sid} has harvest months but is not edible/medicinal")
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
        if harvest:
            species[sid]["harvest"] = harvest
        if "psychoactive" in st:
            for need in ("## Identification", "## Law", "## If someone has eaten it"):
                if not any(line.strip().startswith(need) for line in e["body"]):
                    err(f"{e['src']}: psychoactive species {sid} needs a '{need}' section")
    structure, cats = load_structure(articles, flows)
    Ctx.articles, Ctx.species, Ctx.flows, Ctx.categories = articles, species, flows, cats

    images, credits = load_images()

    if OUT.exists():
        for old in list(OUT.glob("a/*.js")) + list(OUT.glob("s/*.js")) + list(OUT.glob("f/*.js")):
            old.unlink()
    for d in ("a", "s", "f"):
        (OUT / d).mkdir(parents=True, exist_ok=True)

    docs = []
    for e in raw_articles:
        a = articles[e["id"]]
        owner = f"article {a['id']}"
        body = render_md(e["body"], owner)
        if not a["icon"]:
            err(f"{e['src']}: article {a['id']} needs an icon: (a Lucide icon name)")
        lint_text = "\n".join(e["body"]) + " " + a["title"] + " " + a["summary"]
        for pat in SMS_PATTERNS + ([] if a["id"] in CALL_OK else CALL_PATTERNS):
            if re.search(pat, lint_text, re.I):
                err(f"{e['src']}: article {a['id']} tells the reader to call/text from this device ({pat})")
        if not body.startswith('<section class="quick"'):
            err(f"{e['src']}: article {a['id']} must start with a !quick box")
        else:
            quick = body[: body.index("</section>")]
            n_items = quick.count("<li>")
            if not 2 <= n_items <= 4:
                err(f"{e['src']}: article {a['id']} quick box has {n_items} steps (want 2-4)")
        if 'id="sources"' not in body:
            err(f"{e['src']}: article {a['id']} has no '## Sources' section")
        for sid in a["compare"]:
            Ctx.links.append((owner, "s", sid))
        # "You'll need": kit items become links, anything else is shown as plain text.
        needs = []
        for n in a["needs"]:
            k = kit.get(n)
            if k:
                needs.append([k["name"], k.get("a", "")])
                if k.get("a"):
                    Ctx.links.append((f"kit.json {n}", "a", k["a"]))
            elif re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", n):
                err(f"{e['src']}: article {a['id']} needs unknown kit item '{n}' (add it to content/kit.json)")
            else:
                needs.append([n, ""])
        a["needs"] = needs
        # Related: explicit first, then siblings from the same topic, up to four.
        for r in a["related"]:
            Ctx.links.append((owner, "a", r))
        a["images"] = images.get(f"article/{a['id']}", [])
        words = len(strip_tags(body).split())
        a["read"] = max(1, round(words / 200))
        write_body(OUT / "a" / f"{a['id']}.js", f"a/{a['id']}", body)
        heads = " ".join(re.findall(r"<h[2-4][^>]*>(.*?)</h[2-4]>", body))
        docs.append({
            "key": f"a:{a['id']}", "title": a["title"], "tags": " ".join(a["tags"]),
            "summary": a["summary"], "heads": strip_tags(heads), "body": strip_tags(body),
        })
    for a in articles.values():
        if "cat" not in a:
            continue
        rel = [r for r in a["related"] if r in articles and r != a["id"]]
        for t in cats[a["cat"]]["topics"]:
            if a["id"] in t["items"]:
                rel += [x.lstrip("@") for x in t["items"] if x.lstrip("@") != a["id"]]
        # Then the rest of its category, then pages that cross-reference it from other categories.
        for t in cats[a["cat"]]["topics"]:
            rel += [x.lstrip("@") for x in t["items"] if x.lstrip("@") != a["id"]]
        for c in cats.values():
            for t in c["topics"]:
                if "@" + a["id"] in t["items"]:
                    rel += [x.lstrip("@") for x in t["items"] if x.lstrip("@") != a["id"]]
        seen = []
        for r in rel:
            if r not in seen and r in articles:
                seen.append(r)
        a["related"] = seen[:4]
    for e in raw_species:
        s = species[e["id"]]
        owner = f"species {s['id']}"
        body = render_md(e["body"], owner)
        for lid in s["lookalikes"]:
            Ctx.links.append((owner, "s", lid))
        s["images"] = images.get(f"species/{s['id']}", [])
        for pat in SMS_PATTERNS + CALL_PATTERNS:
            if re.search(pat, "\n".join(e["body"]), re.I):
                err(f"{e['src']}: species {s['id']} tells the reader to call/text from this device ({pat})")
        write_body(OUT / "s" / f"{s['id']}.js", f"s/{s['id']}", body)
        docs.append({
            "key": f"s:{s['id']}", "title": s["name"], "alt": " ".join([s["latin"]] + s["aka"]),
            "tags": " ".join(s["tags"] + s["status"] + [s["group"], s["kind"]]),
            "summary": s["summary"] + " " + s["habitat"] + " " + s["season"],
            "body": strip_tags(body),
        })
    for e in raw_flows:
        f = flows[e["id"]]
        flow = parse_flow(e)
        for pat in SMS_PATTERNS + CALL_PATTERNS:
            if re.search(pat, "\n".join(e["body"]), re.I):
                err(f"{e['src']}: flow {f['id']} tells the reader to call/text from this device ({pat})")
        path = OUT / "f" / f"{f['id']}.js"
        path.write_text(f"__body({json.dumps('f/' + f['id'])},{json.dumps(flow, ensure_ascii=False)});\n", encoding="utf-8")
        docs.append({"key": f"f:{f['id']}", "title": f["title"], "summary": f["summary"],
                     "tags": "step by step guided decision flow",
                     "body": " ".join(strip_tags(n["html"] + " " + n["q"]) for n in flow["nodes"].values())})

    for owner, kind, target in Ctx.links:
        table = {"a": articles, "s": species, "c": cats, "f": flows,
                 "t": {t: 1 for t in TOOLS}}[kind]
        if target not in table:
            err(f"{owner}: broken link to {kind}:{target}")

    ddir = ASSETS / "diagrams"
    ddir.mkdir(parents=True, exist_ok=True)
    for old in ddir.glob("*.svg"):
        if old.stem not in DIAGRAMS_USED:
            old.unlink()
    for name in DIAGRAMS_USED:
        (ddir / f"{name}.svg").write_text((SRC / "diagrams" / f"{name}.svg").read_text(encoding="utf-8"), encoding="utf-8")

    for a in articles.values():
        del a["wiki"]
        for k in ("compare", "images", "needs", "related", "time", "level"):
            if not a[k]:
                del a[k]
    for s in species.values():
        del s["wiki"]

    index = {
        "built": date.today().isoformat(),
        "counts": {"articles": len(articles), "species": len(species), "photos": len(credits)},
        **structure,
        "categories": cats,
        "flows_meta": flows,
        "articles": articles,
        "species": species,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    index_json = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    (OUT / "index.json").write_text(index_json, encoding="utf-8")
    (OUT / "index.js").write_text(f"window.GUIDE_INDEX={index_json};\n", encoding="utf-8")
    search_idx = build_search(docs)
    search_idx["syn"] = [[stem(w) for w in tokens(" ".join(g))] for g in load_synonyms()]
    search = json.dumps(search_idx, ensure_ascii=False, separators=(",", ":"))
    (OUT / "search.js").write_text(f"window.GUIDE_SEARCH={search};\n", encoding="utf-8")
    cred = json.dumps(credits, ensure_ascii=False, separators=(",", ":"))
    (OUT / "credits.js").write_text(f"window.GUIDE_CREDITS={cred};\n", encoding="utf-8")

    for w in warnings:
        print("warning:", w, file=sys.stderr)
    for e in errors:
        print("ERROR:", e, file=sys.stderr)
    print(f"{len(articles)} articles, {len(flows)} flows, {len(species)} species, {len(credits)} photos, "
          f"{len(search_idx['terms'])} search terms")
    return 1 if errors else 0


def write_body(path: Path, key: str, body: str) -> None:
    payload = json.dumps(body, ensure_ascii=False)
    path.write_text(f"__body({json.dumps(key)},{payload});\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
