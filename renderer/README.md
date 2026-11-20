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
| `shaders.js` | all WGSL: tank density bake (`W_DENS`), terrain / rock / props, leaves, creatures (`W_CRE`), surface, room background, glass, sprites (bubbles, particles, motes, plankton), light shafts, post |
| `world.js` | tank grid sizing, primitive buffer, terrain mesh, decoration scattered from `tank.seed` (kelp in `tank.kelp`, sponges, coral, ground cover, pebbles, grotto sparkles, bubbles), skylight volume, ground map; procedural meshes incl. the creature meshes (fish, ray, needle, shark, jelly) |
| `creatures.js` | parses binary `state` frames into a ring of preallocated snapshots, creature tracks (birth fade-in, death fade-out), interpolation ~110 ms behind, orientation and banking, swim phase, packing of the instance buffer, picking |
| `camera.js` | camera modes (outside orbit, inside free flight, follow), glide through the glass, collision with the baked rock grid, input, key legend (RU / EN) |
| `net.js` | WebSocket: `hello` → `floor` → world build (rebuilt only when the tank changes), state / plankton frames, reconnect |
| `main.js` | WebGPU device and pipelines, world build on the GPU, day / night from the stream, frame loop, `window.nowa` |
| `audio.js` | abyssal-garden's synthesized ambience (M mutes) |
| `hud.js` | HUD (see below): top bar, population, tools, saves and settings dialog, inspector with the vision cone, event log and event sounds; `initHud(nowa)` runs once after start-up |
| `boot.js` | draws the key legend and calls `initHud(window.nowa)` (the last file, so everything above exists) |

The tank solid is baked on the GPU from the shared SDF (`docs/protocol.md`) into a grid of about 0.33 m (0.4 m on
Low) and meshed with surface nets. The bake adds render-only relief within ±0.15 m and cuts the solid at the glass, so
the substrate shows as a section from outside. Fog and absorption act only on the part of a view ray inside the
water box. The frame loop allocates nothing (preallocated typed arrays and pass descriptors); a binary frame costs one
`DataView`.

## Controls

| Key / mouse | Action |
|---|---|
| `1` / `2` / `3`, `C` | outside / inside / follow, cycle |
| outside: drag, wheel | orbit, zoom; zooming through the glass dives in |
| inside: click, mouse, `WASD`, `Q`/`E`, `Shift` | capture the mouse, look, swim, down / up, faster |
| click a creature | select it (`{"t":"select","id":N}`) and follow it; drag / wheel orbit and zoom around it; creatures behind rock are not picked |
| `F` | follow the selected creature / stop following (the selection and the inspector stay) |
| `Esc` | cancel a HUD tool or close the dialog; else stop following; else drop the selection |
| `H`, `M` | stats line, sound |

## Hooks (`window.nowa`) — stable API for the HUD and tests

| Member | Meaning |
|---|---|
| `ws` | the current `WebSocket` (replaced on reconnect) |
| `send(obj)` | sends a JSON command; `false` when not connected |
| `onJson(fn)` | `fn(msg)` for every JSON message (`hello`, `stats`, `inspect`, `event`, `toast`, …); returns an unsubscribe function |
| `onState(fn)` | `fn(snapshot)` for every binary state frame; returns an unsubscribe function. The snapshot object and its typed arrays are **reused**: copy what you keep. Fields: `seq, simTime, speedSet, speedAchieved, dayPhase, light, selected, flags, n, m, id, species, intent, cflags, glow, pos, vel, scale, energy, ppos, pkind, psize` |
| `species`, `tank`, `hello` | from the last `hello` |
| `state` | the latest snapshot (same reused object) |
| `camera.mode` | `'outside' \| 'inside' \| 'follow'` |
| `camera.setMode(m)` | name or 0 / 1 / 2; outside ↔ inside glides through the glass |
| `camera.pose()` | `{mode, x, y, z, yaw, pitch, follow}` of the displayed camera |
| `camera.setPose(p)` | jumps: `{mode, x, y, z, yaw, pitch}`; outside also `dist`; follow `id` or `species`, `dist` (factor), `yaw` / `pitch` (offsets around the creature); returns `false` if nothing to follow yet |
| `select(id)` | select and follow a creature; `select(null)` deselects |
| `selected` | followed creature id or `null` |
| `stats()` | `{fps, gpuMs, cpuMs, creaturesDrawn, particlesDrawn, plankton, frames, resolution, det, quality, world, connected}` |
| `ready` | `true` once the first world is built |
| `lang`, `setLang(l)` | `'ru'` or `'en'`: remembered in `localStorage['nowasea.lang']`, else from `navigator.language`; `setLang` switches every text |
| `debug.light` | number 0..1 overrides the stream's light level (screenshots); `null` = stream |
| `debug.settle(s)`, `debug.bench(n)`, `debug.counts()`, `debug.audio()` | test helpers: advance smoothing by `s` seconds and draw; time `n` frames; scene sizes; audio context state |

URL parameters: `?cam=outside|inside|follow&x=&y=&z=&yaw=&pitch=&dist=&id=&species=&light=&q=low|med|high`.
Yaw 0 looks along −z, positive yaw turns towards +x; pitch is positive upwards.

## HUD

Everything is built in `src/hud.js` into `<div id="hud">` (styles in `template.html`); RU and EN with a toggle
(`RU` / `EN` button). The DOM changes only on server messages (`stats` 1 Hz, `inspect` 4 Hz, command replies) and on
clicks; the one per-frame part, `hudFrame()`, draws the vision cone on a 2D canvas without allocating.

| Part | What it does |
|---|---|
| top bar | day number and clock (`day_s` = 24 h), ☀ / ☾; speed `Pause 1× 2× 5× 10× Turbo` (`{"t":"speed"}`) with the achieved speed (orange below 80 % of the set one); camera `Outside / Inside / Follow`; `Feed`, species list, `Spawn`, 🎲 (spawn at random); `Saves`; sound; `?` (key legend); language |
| population | per species: colour chip, count / cap (`round(cap × scale)`, at least 2), highest generation, extinction countdown; chart of `history` as count / cap; births, deaths, brain load (workers, brains, p95, lag waits), particles, plankton. Collapsible (remembered) |
| Feed | click mode: from the room the click ray meets y = −1 inside the tank (else 2 m past the glass), from the water 3 m along the ray; sends `{"t":"feed","pos":[x,y,z]}` per click until Esc |
| Spawn | the species in the list at the next clicked point (`{"t":"spawn","species","pos"}`) or 🎲 without a point; replies `spawned` / the cap `toast` are shown |
| Saves | list (`list_saves`), save under a name (default `save-YYYYMMDD-HHMM`; shows `saved.seconds`), load, download (`/api/saves/<slot>.zip`), delete (second click confirms), import a `.zip` (POST `/api/saves/import?slot=`) |
| Settings | repopulation on / off, delay in sim minutes, founders fresh / archive, autosave off / 5 / 15 / 60 sim min (`{"t":"settings"}`); the form follows `stats.settings` |
| inspector | for the selected creature: name and id, generation, age / lifespan, energy and stamina, intent, decision mode, asleep / in cover, senses (tokens), 8 affect axes and 5 neuromodulators (NOWA species), parents / children, body genes, decisions / episodes / sleeps; `Show vision` draws the view cone (vision radius, `fov_deg`, rings at ⅓ and ⅔) and a line to `target` |
| events | log of catches, births, extinctions, repopulations; synthesized sounds for a burst near the camera, a catch and a birth (only with the sound on, `M`) |
| turbo | a TURBO overlay with the achieved speed; the scene is drawn about four times a second |
