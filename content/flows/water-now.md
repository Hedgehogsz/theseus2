=== water-now
title: I need water now
summary: How urgent it is, where to find water nearby, how to make it safe, and the least-bad choice if you can't boil it.
icon: glass-water
---
@ start
? Do you have any water with you now?
+ Yes, some: have-some
+ None: urgent

@ have-some
**Drink some now if you're thirsty.** Don't ration water you already have while you are thirsty: it does more good inside you than in the bottle. Then find more before you run out.
? Ready to look for more?
+ Yes: urgent

@ urgent
Check yourself and anyone with you.
- **Mild:** thirst, dry mouth, headache, tiredness, dark yellow urine, peeing less often.
- **Severe:** confusion, fainting, fast heartbeat, fast breathing, sunken eyes, little or no urine.
? How bad is it?
+ Severe signs in anyone: severe
+ Mild signs, or fine for now: save
> [[a:dehydration-signs]]

@ severe
**This is serious.**
- Lie them down out of the sun and wind. Don't let them walk about.
- Someone else fetches the water. **Send someone for help** if they are confused or fainting.
- Once you have safe water, give **small sips often**, not big gulps. Use oral rehydration salts if you have them.
? Ready to find water?
+ Yes: sources
> [[a:dehydration-signs]] [[a:diarrhoea-ors]] [[a:when-to-get-help]]

@ save
**Cut how much water you lose** while you sort it out:
- Rest. Don't sweat: slow down, open layers before you get hot, work in the cool of the day.
- Keep out of the sun and wind. Breathe through your nose.
- Eat less, especially protein, until you have water.
- No alcohol. Don't drink urine.
? Ready to find water?
+ Yes: sources
> [[a:water-needs]]

@ sources
Look and listen. Water in Britain is rarely far away.
? What can you find nearby?
+ A running stream or river: stream
+ A spring coming out of the ground: spring
+ Rain is falling or on its way: rain
+ A pond, lake, puddle or ditch: standing
+ Snow or ice: snow
+ Only the sea: seawater
+ Nothing yet: search

@ search
**Where to look:**
- Go **downhill** into valleys and listen for running water.
- Look for **rushes, sedges, alder and willow trees, bright green moss**, and animal paths heading downhill.
- Wet hollows and lush patches on hillsides often mark a spring.
- Built sources: taps at churches, farms and villages, water butts, troughs (dirty, but water).
- At dawn, wipe a cloth through wet grass and wring the dew into your pot.
? Found something?
+ Yes: sources
> [[a:finding-water-uk]] [[a:rain-dew-collection]]

@ stream
**Choose your spot.**
- Go **upstream** of farms, sheep pens, roads, villages and campsites if you can.
- Walk 50–100 m upstream and look for dead animals, pipes and outfalls.
- Collect from **fast, clear** water, below the surface, avoiding scum and sediment.
- Orange-stained water or a stream with nothing living in it: old mine workings. Find another.
? Can you boil it?
+ Yes: boil
+ No: no-boil
> [[a:choosing-water-source]]

@ spring
A spring where water comes straight out of the ground is one of the best sources you'll find. Collect from where it emerges, before it runs over ground trampled by animals. **Still boil it if you can.**
? Can you boil it?
+ Yes: boil
+ No: no-boil
> [[a:finding-water-uk]]

@ rain
**Rain is the cleanest water there is.**
- Rig your tarp or survival bag sloping to one low corner, with the pot or bottle underneath.
- Let the first minute of rain rinse the surface, then collect.
- Rain caught straight into a clean pot or off a clean sheet is the safest water you can get without boiling. Anything that ran off trees, roofs or the ground needs boiling.
? Can you boil it?
+ Yes: boil
+ No: no-boil
> [[a:rain-dew-collection]]

@ standing
Lakes: collect from deep water away from the shore. Puddles, ditches and ponds by fields are a last resort.
? Is there any scum, film, foam, blue-green flecks, or a smell or sheen of fuel?
+ Yes: bad-water
+ No: can-boil
> [[a:choosing-water-source]]

@ bad-water
**Don't use it.** Blue-green algae toxins, fuel and chemicals are **not** removed by boiling, and some get stronger as water boils off.

Look for another source: a stream, a spring, or rain.
? Is there anything else nearby?
+ Yes, look again: sources
> [[a:boiling-limits]] [[a:choosing-water-source]]

@ snow
**Don't eat snow or ice as it is.** It chills you and costs body heat you can't spare.
- Melt it in the pot over a fire, adding a little water first so the pot doesn't scorch.
- No fire: pack it into a bottle and keep it inside your clothes (not against bare skin).
- Use clean white snow. Avoid yellow, pink or grey snow and snow by paths and roads.
? Can you boil it?
+ Yes: boil
+ No: no-boil

@ seawater
**Never drink seawater**, boiled or not. The salt dehydrates you faster and damages the kidneys. Never drink urine either.
- Look inland: streams reach the sea along most British coasts, and you can collect rain.
- Steam from boiling seawater, caught on a cool lid, drips as fresh water, but only a little at a time.
? Look for another source?
+ Yes: sources
> [[a:boiling-limits]] [[a:solar-still]]

@ can-boil
? Can you boil it (fire or stove and the steel pot)?
+ Yes: boil
+ No: no-boil

@ boil
**Settle, strain, boil:**
1. **Settle** cloudy water for 30 minutes or more; pour off the clearer top.
2. **Strain** it through folded cotton cloth into the pot.
3. Bring it to a **rolling boil for 1 minute**: big bubbles that don't stop when you stir. Use the boil timer.
4. **Cool it covered**, then pour into a clean bottle.

Single-walled steel only, lid or cap off, never a sealed bottle. Keep a litre of boiled water ready from now on.
> [[t:boil]] [[a:settle-strain-boil]] [[a:boiling-steel-bottle-pot]] [[a:fire-essentials]]

@ no-boil
Every wild source can carry germs that cause days of diarrhoea, which dehydrates you faster than thirst. **Boiling is always better** if there's any way to manage it.
? Can you hold on for an hour or two while you get a fire going?
+ Yes: make-fire
+ No, I need to drink now: least-bad

@ make-fire
**Get a fire going**, then boil.
- Ferro rod or flint and steel onto your best dry tinder: birch bark, char cloth, cotton fibres.
- Wet weather: snap standing dead branches and split them for the dry core; build on a platform off the wet ground.
- While you wait, sip from a small amount of the best water you have (rain, spring or fast stream) if you're very thirsty.
> [[a:fire-essentials]] [[a:wet-weather-fire]] [[a:ferro-rod]] [[t:boil]]

@ least-bad
**Pick the least-bad water**, in this order:
1. Rain caught straight into a clean container.
2. A spring, where it comes out of the ground.
3. A fast, clear upland stream, **above** farms, sheep, roads and paths.
4. Deep, clear lake water away from the shore.

**Never** puddles, ditches, water by fields or below roads, anything with scum, seawater or urine.

Settle it and strain it through cloth, then drink. It cuts the risk; it doesn't remove it. **Boil all your water as soon as you can.** Diarrhoea, cramps or fever can start days later: drink more, and use oral rehydration salts.
> [[a:choosing-water-source]] [[a:settle-strain-boil]] [[a:diarrhoea-ors]]
