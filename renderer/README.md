# NOWA Sea renderer

WebGPU renderer of the NOWA Sea aquarium. It draws the tank and the creatures that the Python server simulates; it
owns no world state. The server serves the built page at `/` and the stream at `/ws` (same origin, see
`docs/protocol.md`).

## Origin and licence

A hard fork of [abyssal-garden](https://github.com/Noniv/abyssal-garden) (MIT) at commit
`a596354eff400d458bc2aeb9bdf5e0a9734b2bcf`. Its licence is kept in `LICENSE-abyssal-garden`. Taken over almost as is:
light model, caustics, light shafts, bloom and post-processing, the rock / leaf / sponge / coral shaders and meshes,
the fish and manta meshes, surface nets, adaptive resolution, quality levels, the sound. Replaced: the procedural
world (`dens()`, `makeWorld()`, viewpoints, fly path, fish schools and mantas), the camera, the menu.

## Build

```
cd renderer
npm install
npm run build            # dist/index.html, minified, one self-contained file
npm run build:readable   # the same file unminified, for debugging
```

`dist/` is not committed. Requires Node 18+; esbuild is pinned in `package.json`.

## Files (`src/`, concatenated in this order into one async function scope by `build.mjs`)

| File | Responsibility |
|---|---|
| `quality.js` | quality level (High / Medium / Low), `localStorage` keys `nowasea.q`, `nowasea.load`, `?q=` override |
| `math.js` | random numbers, noise, quaternions, surface nets, mesh builder; bake-grid variables |
| `shaders.js` | all WGSL: tank density bake (`W_DENS`), terrain / rock / props, leaves, creatures (`W_CRE`), surface, room background, glass (`W_GLASS`) and its refraction pass (`W_GLASSB`), sprites (bubbles, particles, motes, plankton), light shafts, post |
| `world.js` | tank grid sizing, primitive buffer, terrain mesh, decoration scattered from `tank.seed` (kelp in `tank.kelp`, sponges, coral, ground cover, pebbles, grotto sparkles, bubbles), skylight volume, ground map; procedural meshes incl. the creature meshes (fish, ray, needle, shark, jelly) |
| `creatures.js` | parses binary `state` frames into a ring of preallocated snapshots (repeated frames are dropped), creature tracks (birth fade-in, death fade-out), interpolation 1.6 measured frame intervals behind (≈110 ms at 20 Hz, ≈400 ms in turbo) with up to 35 % of an interval of extrapolation when a frame is late, orientation and banking, swim phase, burst pose, packing of the instance buffer, picking (rock and kelp hide creatures) |
| `camera.js` | camera modes (outside orbit, inside free flight, follow, director), glide through the glass, collision with the baked rock grid, line-of-sight test (`rockBetween`), mouse / keyboard / touch input, key legend (RU / EN) |
| `director.js` | the director: an automatic camera for unattended demos (tour shots and following interesting creatures, see below) |
| `net.js` | WebSocket: `hello` → `floor` → world build (rebuilt only when the tank changes), state / plankton frames, reconnect |
| `main.js` | WebGPU device and pipelines, world build on the GPU, day / night and the moving lamp with its shadow re-bake, the glass pass, frame loop, `window.nowa` |
| `audio.js` | abyssal-garden's synthesized ambience; event voices placed by distance and side, volume and mute (remembered), the offline level test |
| `hud.js` | HUD (see below): top bar, population, tools, saves and settings dialog, inspector with the vision cone, genome and family tree, event log; `initHud(nowa)` runs once after start-up |
| `insights.js` | the Insights panel (`insights` frames, 5 s) and the presence map on the mini-map (`heatmap`), see below |
| `boot.js` | draws the key legend and calls `initHud(window.nowa)` (the last file, so everything above exists) |

The tank solid is baked on the GPU from the shared SDF (`docs/protocol.md`) into a grid of about 0.33 m (0.4 m on
Low) and meshed with surface nets. The bake adds render-only relief within ±0.15 m and cuts the solid at the glass, so
the substrate shows as a section from outside. Fog and absorption act only on the part of a view ray inside the
water box. The frame loop allocates nothing (preallocated typed arrays and pass descriptors); a binary frame costs one
`DataView`.

**Glass and room.** On High and Medium, with the camera out of the water, the walls facing the camera and the water
surface seen from above are drawn in a second, single-sample pass after the scene: the resolved scene is copied
(`copyTextureToTexture`), and each wall pixel looks it up where the view ray, bent by the glass into the water
(refraction index 1.333, a little less / more for red / blue), ends half-way through the water. So the interior is
magnified, squeezes and shifts at grazing angles, and the corners stay put. The glass tints it faintly green (more at a
slant), reflects the room with a Fresnel term and shows thin greenish edges and the water line. The surface from above
refracts the bottom (flat lift plus a few metres of ripple bending) under a reflection of the room and the lamp; it is
depth-tested against the scene by hand (the MSAA depth is read in the shader). The walls seen from the water side stay
in the scene pass: a faint reflection of the tank and, past the critical angle (48.8°), a mirror of it (total internal
reflection; from inside, looking at a wall straight on shows Snell's window onto the dark room). Low keeps the single
blended glass pass. The room: dark walls with a soft band lit by the tank, a floor with the tank's light pool, the black
stand, a dim ceiling and a glow towards the lamp. Cost at 1600×900 (Iris Xe): the copy plus the glass pass 1.5–1.9 ms;
the whole frame +0.3–1.0 ms over the old blended glass (which it replaces).

**Highlight life** (`V`, ✨ with the tooltip "Highlight life (V)" / "Подсветка жизни (V)", on by default): a thin
game-style outline coloured by role, warm against the teal water: prey (sparkfin, sweeper) gold, predators (needlejaw,
shade) coral red, lumen jellies a faint one. It is drawn in screen space, so it is a line at any viewing angle and never
fills a body: after the scene every visible creature is drawn into a mask (`W_MASK`: role colour, strength in alpha;
skipped where the scene's depth is nearer, so rock and kelp in front cut the line), and the post pass (`W_POST`) draws a
2 px line where a pixel outside a silhouette has the mask next to it, plus a faint glow from a 5 px ring. The calm line
is modest (sleep and cover dim it) and stronger for far creatures, which are also drawn up to 1.4× larger. Events raise
it, smoothed on the CPU (`tkEx`, attack 0.2 s, release 1 s): speed above cruise, a burst, a hunting intent (chase /
strike: brighter red with a slow pulse), a flight (flee or a burst of prey: gold turning white), and a short flash on a
catch (the hunter nearest the catch) or a birth; events also add a thin rim on the body's own edge. Excitement, mode and
flash ride in free floats of the instance record (no protocol change). `debug.hlTest(id, mode)` shows one creature as
hunting (1) or fleeing (2), for checking the look. Cost at 1600×900 High: about +0.3 ms (the mask pass and the post
taps).

**The lamp moves.** On High and Medium the light follows `dayPhase`: east to west along the tank over the day
(phase 0.15–0.85, 38–72° up), the dim night light on the same arc. The drawn direction eases towards it; when it is more
than 3° away from the direction of the shadow map in use (and the last re-bake is 2 s old) the other of two shadow maps
is baked over the next frames, one group of parts per frame (High: terrain + rocks | chips | pebbles | kelp + two
sponge kinds | sponges + coral | coral | tube sponges, each 0.5–1.1 ms; Medium: terrain + rocks | kelp), and the maps
swap with their matrix in the same frame. Coral casts its shadow with its distant mesh. Low keeps the fixed lamp and
one map. The second map costs 64 MB of GPU memory on High (16 MB on Medium).

## Controls

| Key / mouse | Action |
|---|---|
| `1` / `2` / `3`, `C` | outside / inside / follow, cycle |
| `4` | director (automatic tour); any key, click, wheel or a deliberate mouse move gives the camera back to the previous mode |
| outside: drag, wheel | orbit, zoom; zooming through the glass dives in |
| inside: click, mouse, `WASD`, `Q`/`E`, `Shift` | capture the mouse, look, swim, down / up, faster |
| click a creature | select it (`{"t":"select","id":N}`) and follow it; drag / wheel orbit and zoom around it; creatures behind rock are not picked |
| `F` | follow the selected creature / stop following (the selection and the inspector stay) |
| `Esc` | cancel a HUD tool or close the dialog; else stop following; else drop the selection |
| `H`, `M`, `V` | stats line, sound, highlight life (on by default, remembered in `localStorage['nowasea.highlight']`) |
| touch: one finger | orbit (outside, follow) / look (inside) |
| touch: two fingers | pinch: zoom (outside, follow), swim forward / back (inside); drag: move the orbit centre (outside), swim (inside) |
| touch: tap / double tap | select a creature (the camera stays) / follow it |

## Hooks (`window.nowa`) — stable API for the HUD and tests

| Member | Meaning |
|---|---|
| `ws` | the current `WebSocket` (replaced on reconnect) |
| `send(obj)` | sends a JSON command; `false` when not connected |
| `onJson(fn)` | `fn(msg)` for every JSON message (`hello`, `stats`, `inspect`, `event`, `toast`, …); returns an unsubscribe function |
| `onState(fn)` | `fn(snapshot)` for every binary state frame; returns an unsubscribe function. The snapshot object and its typed arrays are **reused**: copy what you keep. Fields: `seq, simTime, speedSet, speedAchieved, dayPhase, light, selected, flags, n, m, id, species, intent, cflags, glow, pos, vel, scale, energy, ppos, pkind, psize` |
| `species`, `tank`, `hello` | from the last `hello` |
| `state` | the latest snapshot (same reused object) |
| `camera.mode` | `'outside' \| 'inside' \| 'follow' \| 'director'` |
| `camera.setMode(m)` | name or 0 / 1 / 2 / 3; outside ↔ inside glides through the glass |
| `camera.pose()` | `{mode, x, y, z, yaw, pitch, follow}` of the displayed camera |
| `camera.setPose(p)` | jumps: `{mode, x, y, z, yaw, pitch}`; outside also `dist`; follow `id` or `species`, `dist` (factor), `yaw` / `pitch` (offsets around the creature); returns `false` if nothing to follow yet |
| `select(id)` | select and follow a creature (sent again for the selected one, and after a reconnect); `select(null)` deselects |
| `selected` | followed creature id or `null` |
| `stats()` | `{fps, gpuMs, cpuMs, creaturesDrawn, particlesDrawn, plankton, frames, resolution, det, quality, world, connected}` |
| `ready` | `true` once the first world is built |
| `lang`, `setLang(l)` | `'ru'` or `'en'`: remembered in `localStorage['nowasea.lang']`, else from `navigator.language`; `setLang` switches every text |
| `debug.light` | number 0..1 overrides the stream's light level (screenshots); `null` = stream |
| `debug.settle(s)`, `debug.bench(n, px)`, `debug.counts()`, `debug.audio()` | test helpers: advance smoothing by `s` seconds and draw; time `n` frames (with `px`: at that many pixels, the dynamic resolution paused; `gpuMs` is the mean, `glassMs` the copy plus the glass pass); scene sizes; audio context state |
| `debug.glass`, `debug.phase`, `debug.sunFast`, `debug.sun()` | `false` draws the old blended glass (A/B); a number 0..1 overrides the stream's day phase; `true` re-bakes the shadows without the 2 s pause; the lamp's direction, the shadow map's, re-bakes so far and the GPU ms of the last slices |
| `debug.highlight(on)`, `debug.hlTest(id, mode)` | highlight life on / off (`true` / `false`), returns the state; show creature `id` as hunting (1) or fleeing (2), 0 to stop |
| `debug.screenOf(id)` | where a creature is on screen (client px) or `null` — for synthetic clicks and taps |
| `debug.audioTest(n)` | renders 8 s of the ambience with `n` events (default 24) in an `OfflineAudioContext`; returns `{peak, peakDb, rms, rmsDb, voicesPlayed}` |
| `debug.capture(w, h, q)`, `debug.captureHud(w, h, q)` | a frame as a JPEG `Blob`: the scene only, or with the HUD and the key legend (the HTML copied into an SVG `foreignObject`) — for documentation screenshots |
| `debug.director()`, `debug.interp()`, `debug.trackAt(id, now)` | director state (shot, subject, caption, whether rock hides the subject); interpolation interval and delay; where a creature is drawn at a given time |

URL parameters: `?cam=outside|inside|follow|director&x=&y=&z=&yaw=&pitch=&dist=&id=&species=&light=&q=low|med|high`.
Yaw 0 looks along −z, positive yaw turns towards +x; pitch is positive upwards.

## HUD

Everything is built in `src/hud.js` into `<div id="hud">` (styles in `template.html`); RU and EN with a toggle
(`RU` / `EN` button). The DOM changes only on server messages (`stats` 1 Hz, `inspect` 4 Hz, command replies) and on
clicks; the one per-frame part, `hudFrame()`, draws the vision cone on a 2D canvas without allocating.

| Part | What it does |
|---|---|
| top bar | day number and clock (`day_s` = 24 h), ☀ / ☾; speed `Pause 1× 2× 5× 10× Turbo` (`{"t":"speed"}`) with the achieved speed (orange below 80 % of the set one); camera `Outside / Inside / Follow / Director`; `Feed`, species list, `Spawn`, 🎲 (spawn at random); `Learning`; `Insights`; `💾 Save / Load`; ✨ highlight life (`V`); sound on / off and volume (remembered in `localStorage['nowasea.snd']`); `?` (key legend); language. Below 900 px the bar keeps the clock and speed, the rest opens from ☰, and the key legend shows only on `?` |
| population | per species: colour chip, count / cap (`round(cap × scale)`, at least 2), highest generation, extinction countdown; chart of `history` as count / cap; births, deaths, brain kind (`stats.settings.brain`: NOWA, or reflex / random as controls) and load (workers, brains, p95, lag waits), particles, plankton. Collapsible (remembered) |
| Feed | click mode: from the room, where the click ray meets the layer y = −1, moved to the nearest point of that layer inside the tank (a ray that never comes down: the point of it nearest the tank's centre line); from the water 3 m along the ray; sends `{"t":"feed","pos":[x,y,z]}` per click until Esc |
| Spawn | the species in the list at the next clicked point (`{"t":"spawn","species","pos"}`) or 🎲 without a point; replies `spawned` / the cap `toast` are shown |
| Save / Load | one dialog, two framed sections and the settings beside: save (a name, default `save-YYYYMMDD-HHMM`, and a button; shows `saved.seconds`); load (the list with load, download `/api/saves/<slot>.zip`, delete — a second click confirms), with import of a `.zip` below (POST `/api/saves/import?slot=`) |
| Settings | repopulation on / off, delay in sim minutes, founders fresh / archive, autosave off / 5 / 15 / 60 sim min (`{"t":"settings"}`); the form follows `stats.settings` |
| inspector | for the selected creature: name and id, generation, age / lifespan, energy and stamina, intent, decision mode, asleep / in cover, what the brain is told (`tokens`, the 2–3 salient ones, highlighted) and the senses (`senses`, everything perceived, muted), 8 affect axes and 5 neuromodulators (NOWA species) and the experiences lost before sleep (`brain.lost_unconsolidated`), body genes, decisions / episodes / sleeps; family: a compact tree from `{"t":"lineage","id","up":4,"down":3}` (asked for on selection and every 8 s), ancestors in rows above (parents, grandparents, …), descendants below, living ones in their species colour (click to follow), the dead greyed with the cause (🦷 eaten, 🍂 starvation, ⌛ old age, ✖ removed) and dates in the tooltip; genome (NOWA species): the 39 genes of `hello.genes` grouped by module (Russian names in RU), collapsible (remembered), each a bar over its `[min, max]` with a tick at the default, the description and values in the tooltip, plus the epigenome size; `Show vision` draws the view cone (vision radius, `fov_deg`, rings at ⅓ and ⅔) and a line to `target`, plus a top-down map of the tank in the bottom-right corner (rock and kelp, every creature, the selected one's field of view, the camera) |
| learning | `stats.learning` per NOWA species: one row per generation (0 = founders) with n (alive + dead); first, with bars, choice quality (share of decisions that fitted the situation: `evade` for prey, `hunt` for hunters, `feed` where measured; `reflex` would score about 100 %, `random` about 30 %); then lifespan (mean age at death), reward per decision, and catch (hunters) / escape (prey) rates (values only); a sparkline of the same numbers in each header; rows with n < 3 faded; no smoothing; a caption explains each metric |
| errors | `stats.error` shows as a red banner while it is set; `stats.resumed_from` as a toast once |
| events | log of catches, births, extinctions, repopulations; synthesized sounds for a burst near the camera, a catch and a birth at their place: quieter and duller with distance, nothing past 40 m, panned by side, more muffled behind the glass; at most 6 voices at once. Level test (`debug.audioTest`): ambience alone peaks at 0.44–0.50 (RMS −19…−21 dBFS); with a burst of 24 events 0.53–0.81 (RMS −18.5…−20 dBFS), 10–15 of them played |
| touch | every control at least 40 px high on coarse pointers; below 900 px the open menu sits above the panels |
| turbo | a TURBO overlay with the achieved speed; the scene is drawn at most about 30 times a second; creatures glide between the 5 Hz frames (see `creatures.js`) |
| director caption | what the director is showing ("Shade hunting a needlejaw", "Тень охотится на иглозуба"), bottom centre |

## Insights (🔭 in the top bar)

`src/insights.js`, a tabbed panel over the server's `insights` frame (every 5 s; asked for once when opened). It reads
both forms the server has used: flat with one caste, and windowed (`recent` = last 2 sim days + living, `all`) with the
learning (`plastic`) and frozen control (`frozen`) castes; a "Now (2 days) / All time" toggle appears with the latter.

| Group | Tab | What it shows |
|---|---|---|
| Evidence | Brain | choice quality of the brain's own decisions (evade / feed / hunt) per species: learning ● against control ○ with 95 % CIs, the random-brain level dashed and faint, instinct at 100 %, labelled "agreement with instinct"; decisions left to instinct per caste; decision modes per caste (habitual / balanced / deliberative / inhibitory; NOWA reports habitual ≈100 %, shown as is) |
| Evidence | Learning | cover discrimination against a zero line (learning vs control; instinct and random give exactly 0); the sleep effect (`sleep_delta`, after waking minus before sleep) or, from an older server, the paired change after 1 / 2 / 3+ nights; autonomy by decision age |
| Show | Hunting | where the prey was when lunged at (open / cover / school, 100 % bar), the catch rate with its Wilson CI and, with `by_state`, the catch rate per position ("the price of cover"; bursting overlaps the other states); "too few data" below 10 lunges; the presence map switch |
| Show | Life and death | deaths per day by cause (12 days), Kaplan–Meier survival (generations 0–1 vs 2+, or founders vs descendants), faded where fewer than 5 are at risk |
| Show | Daily rhythm | time budget by hour of the sim day as stacked bars, a day / night band (light < 0.25), faded hours with few observations |
| Show | Mood | medians and IQR of valence, arousal, stress, cortisol, uncertainty per species (small n noted); stress medians over time with the world speed beside; stress after a lunge, target vs neighbours |
| Show | Heroes and chronicle | record cards among the living and of all time (a living one: click to follow; a dead one: its family tree from `lineage`), the chronicle newest first with sim day and time |

Honesty rules shown in the captions: intervals as whiskers (dots only when the server gives no interval), faded when
n < 5, nothing smoothed across generations, the world speed beside time series. **Presence map**: a switch on the
Hunting tab draws the chosen species' `heatmap` (40 × 25, asked for on the switch and every 15 s) and the catch points
on the mini-map, which then shows without a selection too. The population chart has a strip with the plankton mean
and the nutrient pool (`stats.history` rows `[t, counts, plankton, nutrient]`) and ticks for extinctions and returns
from the chronicle. The inspector shows the caste (`inspect.caste`: learning / control), the population panel the
control share (`stats.settings.control_share`). DOM and charts change only when a frame arrives or on a click.

## Director (camera mode 4)

An automatic camera for unattended demos (`src/director.js`). Tour shots: a slow orbit outside the tank; a glide through
the water between two points in clear water with a rock structure in sight; a look out of the grotto. Between them it
follows a creature for 10–20 s. Candidates are scanned every 0.7 s: a hunter (chase / strike intent or a burst) with
smaller prey of another species within 10 m, prey slipping into cover while a hunter is within 9 m, at night glowing
species (sparkfin, lumen); events cut in: a catch (the nearest creature of the catching species to its position), a birth
(the newborn). A creature or species seen lately scores lower; creatures tucked in a shelter score lower. While
following, the camera keeps clear water and a line of sight (rock and kelp): when the subject gets hidden it swings to
a clear side (8 directions × 2 heights × 3 distances) or ends the shot. Shots glide into each other unless rock lies on
the straight way, then they cut. A caption names what is shown (species names from `hello`, Russian in the accusative).
