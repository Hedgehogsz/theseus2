# Writing content for the Survival Guide

Everything the app shows is built from the plain-text files in `content/` by
`python3 tools/build_content.py`, which **fails** on any rule below being broken. Run it after every
change. Read two or three existing entries in `content/articles/` and `content/species/` before writing,
and match their tone: plain British English, short sentences, second person ("you"), practical, no
waffle, no American spellings or units first (metric first, imperial in brackets where useful).

## The device this is for

A phone with **no SIM card** (it cannot call or text anyone, including 999/112), kept in airplane mode,
**powered off between uses**, with no Google services. The reader may be cold, scared, injured, alone
and reading by torchlight. Lead with actions. Never tell the reader to call, phone, dial or text 999,
112 or 111 from this phone: the build rejects it. You may say "send someone for help", "when you reach a
phone or a person, ask them to call 999", or link `[[a:when-you-reach-help]]`.

The phone has tools you can link to with `[[t:id]]`: `compass`, `gps` (grid reference, waypoints),
`map` (offline OS-style map of Great Britain with GPS), `sun` (sunrise/sunset, daylight left, sun
bearing), `signal` (SOS torch/screen/sound beacons), `morse`, `level` (clinometer/slope), `pace`
(step counter), `cpr` (CPR metronome), `casualty` (timestamped casualty log), `boil` (boil timer),
`calc` (Naismith, wind chill, water needs, conversions), `notebook`, `battery`, `torch`, `phone-mode`.

## Structure

`content/structure.json` is the whole hierarchy: group > category > topic > article. Every article id
must appear in exactly one topic there (that is where it "lives"); `@id` entries are cross-references.
The ids of all planned articles are already in it. **Use exactly those ids.**

## Articles (`content/articles/*.md`)

A file holds many entries:

```
=== article-id
title: Crossing a river safely (or not)
summary: One sentence shown in lists and search results (max ~140 characters).
tags: river, ford, crossing, flood, stream      (search words: synonyms people might type)
icon: waves                                     (REQUIRED: a Lucide icon name, see below)
time: 10–20 min                                 (optional: how long the task takes; omit for reading-only pages)
level: easy | moderate | hard                   (optional: difficulty of the task)
needs: cord, knife, survival-bag, "dry tinder"  (optional: kit ids from content/kit.json, or free text)
related: stay-or-go, hypothermia                (optional: up to 4 article ids; siblings are added automatically)
---
!quick
1. Two to four short imperative steps for someone under stress.
2. Bold the key words: **Don't cross** if it's above your knees.
!end

Body in Markdown: ## and ### headings, paragraphs, - lists, 1. lists, **bold**, *italic*, | tables |.

!warn Optional title
Callout boxes: !warn, !danger, !note, !tip, !law, !checklist (tickable list) ... each closed by !end
!end

Links: [[a:article-id]], [[s:species-id]], [[f:flow-id]], [[c:category-id]], [[t:tool-id]],
and [[a:id|custom text]]. Every link target must exist (the build checks).

## Sources
- Organisation: page or document name (domain)
```

Rules the build enforces:

- The body **starts** with a `!quick` box of **2–4** numbered steps.
- There is a `## Sources` section at the end listing real UK authorities you based it on (NHS, St John
  Ambulance, British Red Cross, Resuscitation Council UK, RNLI, Mountain Rescue England and Wales,
  Scottish Mountain Rescue, Met Office, UK Health Security Agency, Environment Agency, gov.uk, Ofgem,
  Ordnance Survey, Forestry Commission, the Wildlife and Countryside Act 1981, etc.). No URLs needed.
- `icon:` is a valid Lucide icon name. Check one exists with
  `ls /tmp/claude-0/-home-user-theseus2/6c7825d6-c02f-5e94-a6dd-02199c48a1d0/scratchpad/dl-lucide/package/icons/<name>.svg`
  (or `knot`, `mushroom`, `snake`, which are custom). Prefer a distinct, meaningful icon per article.
- No call/text instructions (see above). The build has a regex for it.

Writing rules (reviewed by hand):

- **Safety first and correct.** Follow current UK guidance. When guidance changed recently (e.g. CPR,
  tourniquets, cold water "float to live"), use the current version. If something is debated, say the
  safe option. Never invent statistics; round, sourced figures only.
- **Deep and practical.** Explain *how*, with numbers (distances, times, temperatures, quantities),
  common mistakes and how to tell it's working. 400–1200 words is typical; a reference table can be
  shorter.
- **UK-relevant**: British weather, terrain, wildlife, law (Scotland's access rights differ from England
  and Wales: say so where it matters), kit you can buy here, OS maps.
- The reader's own kit: ferro rod, flint and steel, char cloth, magnifier, arc lighter, stainless steel
  pot and single-walled bottle, cotton cloth, 20 W solar panel, this phone. Recommended additions:
  whistle, map and compass, head torch, survival bag, first-aid kit, knife, cord, tarp, warm layers.
- Headings in sentence case. Use "–" for ranges (10–20 min). Metric units.
- Don't duplicate another article: link to it instead.

## Decision flows (`content/flows/*.md`)

```
=== flow-id
title: Someone is injured
summary: One line.
icon: heart-pulse
---
@ start
Short text for this step (Markdown, lists allowed).
? The yes/no (or multiple choice) question
+ Yes: node-id
+ No: other-node-id
> [[a:primary-survey]] [[t:cpr]]        (optional buttons to related pages and tools)

@ other-node-id
...
```

The first node is the start. A node with no `+` options is an end point (say what to do next and link
the right article). Every node must be reachable. Keep each node short: one decision at a time.

## Species (`content/species/*.md`)

```
=== species-id
name: Liberty cap
latin: Psilocybe semilanceata
aka: magic mushroom
group: fungus                 (plant | fungus | animal)
kind: mushroom                (free text: herb, shrub, tree, mushroom, bracket, bird, mammal...)
status: psychoactive, caution (any of: deadly, poisonous, venomous, psychoactive, caution, invasive,
                               edible, medicinal, protected, info)
season: Fruits Sep–Nov
harvest: leaves 3-5; berries 8-10   (ONLY for edible/medicinal species: what part, month numbers 1-12)
habitat: Grazed grassland, especially sheep pasture; never on wood or dung directly
summary: One or two sentences.
lookalikes: funeral-bell, deadly-fibrecap   (species ids that exist; the dangerous ones first)
tags: search words
wiki: Psilocybe semilanceata  (English Wikipedia article title: used to fetch the lead photo)
---
## Identification
- Feature lists: size, colour, shape, smell, habitat, season. Several features, never one.
## Lookalikes
...
(then whatever sections fit: Uses, Dangers, Law, If someone has eaten it, etc.)
```

- Every species needs at least one status; list the most important first.
- `wiki:` must be the exact English Wikipedia article title (photos come from it).
- **Psychoactive** species also need `## Law` and `## If someone has eaten it` sections, and must
  **never** include dosing, preparation, effects-seeking or "how to use" information. Frame them for
  identification, safety, the law and first aid. Make deadly lookalikes prominent.
- Edible species: always say what could be mistaken for it, and how to tell.
