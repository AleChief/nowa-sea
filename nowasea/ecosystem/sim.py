"""The aquarium simulation: bodies, senses, intents, metabolism, predation, sleep, breeding, ageing.

Fixed timestep ``dt``. Brains are asked for an intent only when the creature's context tokens change (not
more often than ``decide_min``) or ``decide_max`` has passed; urgent sightings bypass the minimum. The motor
layer executes the current intent every step. All hot data is in numpy arrays indexed by slot.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from nowasea.brains import nowa_adapter as na
from nowasea.brains.nowa_adapter import BrainSpec
from nowasea.ecosystem.resources import Particles, Plankton
from nowasea.ecosystem.species import BY_ID, DAY_S, PREY_OF, SPECIES, Species
from nowasea.server.protocol import (CREATURE_DTYPE, FLAG_BURST, FLAG_COVER, FLAG_EAT, FLAG_SELECTED, FLAG_SLEEP,
                                     PARTICLE_CARCASS, PARTICLE_DETRITUS, PARTICLE_DTYPE, PARTICLE_FOOD)
from nowasea.world.tank import Tank, build_tank

INTENTS: List[str] = sorted({a for s in SPECIES for a in s.actions} | {"sleep"})
I = {name: i for i, name in enumerate(INTENTS)}
NSP = len(SPECIES)
CAPACITY = 192
LEVEL3 = ("low", "mid", "high")


@dataclass
class SimConfig:
    seed: int = 7
    scale: float = 1.0
    brain_kind: str = "nowa"            # "nowa" or "stub"
    dt: float = 0.05
    perceive_every: int = 5             # steps between perception passes (0.25 s)
    decide_min: float = 0.5
    decide_max: float = 3.0
    urgent_min: float = 0.25
    hippocampus_capacity: int = 128      # 256 doubles p95 decision cost (docs/nowa-host-guide.md, section 5)
    max_total: int = 80                 # NOWA agents
    repop_enabled: bool = True
    repop_delay_s: float = 300.0
    repop_mode: str = "archive"         # "archive" or "fresh"
    archive_size: int = 8
    history_every_s: float = 10.0
    history_len: int = 1440
    start_day_phase: float = 0.3


def day_phase(t: float) -> float:
    return (t % DAY_S) / DAY_S


def light_level(phase: float) -> float:
    # 0 = midnight, 0.25 dawn, 0.5 noon, 0.75 dusk; short twilight.
    s = math.sin((phase - 0.25) * 2 * math.pi)
    return float(min(1.0, max(0.04, 0.5 + 0.75 * s)))


def in_window(phase: float, window) -> bool:
    a, b = window
    if a == b:
        return False
    return (a <= phase < b) if a < b else (phase >= a or phase < b)


class Simulation:
    def __init__(self, cfg: SimConfig, pool, tank: Optional[Tank] = None, populate: bool = True):
        self.cfg = cfg
        self.pool = pool
        self.tank = tank or build_tank(cfg.seed)
        if getattr(self.tank, "_grid", None) is None:
            self.tank.build_grid()
        self.rng = np.random.default_rng(cfg.seed + 1)
        self.prng = random.Random(cfg.seed + 2)
        self.plankton = Plankton(self.tank, rng=self.rng)
        self.particles = Particles(self.tank)
        self.time = cfg.start_day_phase * DAY_S
        self.steps = 0
        self.next_id = 1
        self.events: List[dict] = []
        self.history: List[list] = []
        self._last_history = -1e9
        self.births = 0
        self.deaths: Dict[str, int] = {}
        self.extinct_since: Dict[str, float] = {}
        self.archive: Dict[str, List[dict]] = {s.id: [] for s in SPECIES}
        self.selected = 0
        self.specs = {s.id: BrainSpec(species=s.id, actions=s.actions,
                                      wake_interval_s=max(60.0, (1.0 - self._window_len(s)) * DAY_S),
                                      hippocampus_capacity=cfg.hippocampus_capacity) for s in SPECIES if s.brain == "nowa"}
        self._alloc()
        self.meta: Dict[int, dict] = {}          # slot -> python-side data
        self.slot_of: Dict[int, int] = {}        # creature id -> slot
        self._shelters = np.array([s["c"] for s in self.tank.shelters]) if self.tank.shelters else np.zeros((0, 3))
        self._shelter_r = np.array([s["r"] for s in self.tank.shelters]) if self.tank.shelters else np.zeros(0)
        self._prey_rel = np.zeros((NSP, NSP), dtype=bool)   # [eater, eaten]
        for s in SPECIES:
            for p in PREY_OF[s.id]:
                self._prey_rel[s.index, BY_ID[p].index] = True
        self._sp_arr = {k: np.array([getattr(s, k) for s in SPECIES], dtype=float)
                        for k in ("radius", "cruise", "burst", "turn_rate", "accel", "vision", "metabolism",
                                  "burst_cost", "breed_energy", "body_content", "length", "hungry_below")}
        self._cos_half_fov = np.cos(np.radians(np.array([max(1.0, s.fov_deg) for s in SPECIES]) / 2.0))
        self._bottom = np.array([s.prefers_bottom for s in SPECIES])
        self._kind_names = {PARTICLE_FOOD: "pellet", PARTICLE_DETRITUS: "detritus", PARTICLE_CARCASS: "carcass"}
        self._edible = np.array([[name in s.diet for k, name in sorted(self._kind_names.items())] for s in SPECIES])
        self._eats_particles = self._edible.any(axis=1)
        self._eat_intents = [I[n] for n in ("forage", "scavenge", "school", "explore", "drift")]
        if populate:
            t = self.tank
            pts = self.rng.uniform([-t.half_x + 2, -t.depth, -t.half_z + 2], [t.half_x - 2, -t.depth, t.half_z - 2], (60, 3))
            pts[:, 1] = t.floor_height(pts[:, 0], pts[:, 2]) + 0.1
            self.particles.add(pts, PARTICLE_DETRITUS, 0.15)
            self.particles.settled[:] = True
            for s in SPECIES:
                n = max(1, int(round(s.target * cfg.scale)))
                for _ in range(n):
                    self.spawn(s.id, age_frac=self.prng.uniform(0.15, 0.6))

    @staticmethod
    def _window_len(s: Species) -> float:
        a, b = s.sleep_window
        return 0.0 if a == b else ((b - a) if a < b else (1 - a + b))

    # ------------------------------------------------------------------------------------------------
    def _alloc(self):
        C = CAPACITY
        self.alive = np.zeros(C, dtype=bool)
        self.cid = np.zeros(C, dtype=np.uint32)
        self.sp = np.zeros(C, dtype=np.int16)
        self.pos = np.zeros((C, 3))
        self.vel = np.zeros((C, 3))
        self.energy = np.zeros(C)
        self.stamina = np.ones(C)
        self.age = np.zeros(C)
        self.lifespan = np.ones(C)
        self.mature_age = np.ones(C)
        self.intent = np.zeros(C, dtype=np.int16)
        self.burst = np.zeros(C, dtype=bool)
        self.sleeping = np.zeros(C, dtype=bool)
        self.in_cover = np.zeros(C, dtype=bool)
        self.eating = np.zeros(C, dtype=bool)
        self.glow = np.zeros(C)
        self.target = np.full(C, -1)              # slot of prey / mate / threat
        self.target_seen = np.zeros(C)            # sim time last seen
        self.target_pos = np.zeros((C, 3))
        self.threat_vec = np.zeros((C, 3))
        self.threat_seen = np.full(C, -1e9)
        self.threat_level = np.zeros(C, dtype=np.int8)
        self.prey_level = np.zeros(C, dtype=np.int8)
        self.waypoint = np.zeros((C, 3))
        self.home = np.zeros((C, 3))              # shelter target
        self.food_dir = np.zeros((C, 3))
        self.food_pos = np.full((C, 3), np.nan)
        self.school_c = np.zeros((C, 3))
        self.school_v = np.zeros((C, 3))
        self.school_n = np.zeros(C, dtype=np.int16)
        self.mate = np.full(C, -1)
        self.last_decide = np.full(C, -1e9)
        self.reward = np.zeros(C)
        self.cooldown = np.zeros(C)
        self.gen = np.zeros(C, dtype=np.int32)
        self.children = np.zeros(C, dtype=np.int32)
        self.speed_g = np.ones(C)                 # body genes
        self.vision_g = np.ones(C)
        self.metab_g = np.ones(C)
        self.brain_ready = np.zeros(C, dtype=bool)
        self.strike_cd = np.zeros(C)              # seconds until the next lunge
        self.digest = np.zeros(C)                 # seconds of digestion left after a meal
        self.decisions = np.zeros(C, dtype=np.int32)

    # ----- creatures --------------------------------------------------------------------------------
    def _free_slot(self) -> int:
        free = np.nonzero(~self.alive)[0]
        if not len(free):
            raise RuntimeError("creature capacity exhausted")
        return int(free[0])

    def cap(self, s: Species) -> int:
        """Population ceiling at the configured scale."""
        return max(2, int(round(s.cap * max(self.cfg.scale, 0.05))))

    def max_nowa(self) -> int:
        return max(4, int(round(self.cfg.max_total * max(self.cfg.scale, 0.05))))

    def count(self, species_id: str) -> int:
        return int((self.alive & (self.sp == BY_ID[species_id].index)).sum())

    def nowa_count(self) -> int:
        idx = np.nonzero(self.alive)[0]
        return int(sum(1 for i in idx if SPECIES[self.sp[i]].brain == "nowa"))

    def random_open_point(self, species: Species) -> np.ndarray:
        t = self.tank
        for _ in range(10):
            p = self.rng.uniform([-t.half_x + 3, -t.depth + 2, -t.half_z + 3], [t.half_x - 3, -3, t.half_z - 3], (48, 3))
            if species.prefers_bottom:
                p[:, 1] = t.floor_height(p[:, 0], p[:, 2]) + 1.0
            ok = np.nonzero(t.sd_fast(p) > species.radius + 1.0)[0]
            if len(ok):
                return p[ok[0]]
        return np.array([0.0, -t.depth / 2, 0.0])

    def spawn(self, species_id: str, pos=None, genome: Optional[dict] = None, epigenome: Optional[dict] = None,
              body: Optional[dict] = None, parents=(0, 0), generation: int = 0, age_frac: float = 0.0,
              energy: float = 0.7) -> int:
        s = BY_ID[species_id]
        slot = self._free_slot()
        cid = self.next_id
        self.next_id += 1
        self.alive[slot] = True
        self.cid[slot] = cid
        self.sp[slot] = s.index
        p = np.asarray(pos, dtype=float) if pos is not None else self.random_open_point(s)
        if self.tank.sd_fast(p[None])[0] < s.radius:
            p = self.random_open_point(s)
        self.pos[slot] = p
        d = self.rng.normal(0, 1, 3)
        d[1] *= 0.2
        self.vel[slot] = d / max(np.linalg.norm(d), 1e-6) * s.cruise * 0.5
        if genome is None and s.brain == "nowa" and self.cfg.brain_kind == "nowa":
            genome = na.random_genome(self.prng)
        body = body or {}
        self.speed_g[slot] = body.get("speed", 1.0)
        self.vision_g[slot] = body.get("vision", 1.0)
        self.metab_g[slot] = body.get("metabolism", 1.0)
        factor = na.lifespan_factor(genome) if genome else self.prng.uniform(0.8, 1.2)
        self.lifespan[slot] = s.lifespan_days * DAY_S * factor
        self.mature_age[slot] = s.mature_days * DAY_S
        self.age[slot] = age_frac * self.lifespan[slot]
        self.energy[slot] = energy
        self.stamina[slot] = 1.0
        for arr, v in ((self.burst, False), (self.sleeping, False), (self.in_cover, False), (self.eating, False)):
            arr[slot] = v
        self.intent[slot] = I[s.actions[0]]
        self.target[slot] = -1
        self.mate[slot] = -1
        self.threat_level[slot] = 0
        self.prey_level[slot] = 0
        self.threat_seen[slot] = -1e9
        self.last_decide[slot] = -1e9
        self.reward[slot] = 0.0
        self.cooldown[slot] = 0.2 * DAY_S
        self.strike_cd[slot] = 0.0
        self.digest[slot] = 0.0
        self.gen[slot] = generation
        self.children[slot] = 0
        self.decisions[slot] = 0
        self.waypoint[slot] = self.random_open_point(s)
        self.glow[slot] = 0.3
        self.meta[slot] = {"tokens": [], "prev_tokens": None, "executed": None, "parents": list(parents),
                           "born": self.time, "genome": genome, "slept_window": None, "mode": "",
                           "sleep_requested": False}
        self.slot_of[cid] = slot
        if s.brain == "nowa":
            seed = int(self.prng.randrange(1 << 30))
            self.pool.create(cid, self.specs[s.id], genome=genome, epigenome=epigenome, seed=seed)
            self.brain_ready[slot] = True
        return cid

    def kill(self, slot: int, cause: str) -> None:
        if not self.alive[slot]:
            return
        s = SPECIES[self.sp[slot]]
        self.alive[slot] = False
        cid = int(self.cid[slot])
        self.slot_of.pop(cid, None)
        meta = self.meta.pop(slot, {})
        if s.brain == "nowa":
            genome = self.pool.created_genomes.pop(cid, None) or meta.get("genome")
            fitness = self.age[slot] / DAY_S + 2.0 * self.children[slot]
            if genome:
                arch = self.archive[s.id]
                arch.append({"fitness": round(float(fitness), 3), "genome": genome, "generation": int(self.gen[slot]),
                             "body": {"speed": float(self.speed_g[slot]), "vision": float(self.vision_g[slot]),
                                      "metabolism": float(self.metab_g[slot])}})
                arch.sort(key=lambda e: -e["fitness"])
                del arch[self.cfg.archive_size:]
            self.pool.remove(cid)
        self.brain_ready[slot] = False
        if cause != "eaten":
            self.particles.add(self.pos[slot], PARTICLE_CARCASS, s.body_content * max(0.3, self.energy[slot] + 0.3))
        self.deaths[cause] = self.deaths.get(cause, 0) + 1
        self.events.append({"t": "event", "kind": "death", "cause": cause, "species": s.id, "id": cid,
                            "pos": self.pos[slot].round(2).tolist()})
        if self.selected == cid:
            self.selected = 0
        for arr in (self.target, self.mate):
            arr[arr == slot] = -1

    # ----- main step ----------------------------------------------------------------------------------
    def step(self) -> None:
        dt = self.cfg.dt
        self.time += dt
        self.steps += 1
        phase = day_phase(self.time)
        light = light_level(phase)
        self._apply_answers()
        self._sleep_schedule(phase)
        if self.steps % self.cfg.perceive_every == 0:
            self._perceive(light)
            self._schedule_decisions()
        self._motor(dt)
        self._physiology(dt)
        self._feed(dt)
        self._predation(dt)
        if self.steps % self.cfg.perceive_every == 0:
            slow_dt = dt * self.cfg.perceive_every
            self._breed()
            self._lifecycle()
            self.plankton.step(slow_dt, light)
            self._marine_snow(slow_dt)
            self.particles.step(slow_dt, self.plankton)
            self._repopulate()
        if self.time - self._last_history >= self.cfg.history_every_s:
            self._last_history = self.time
            self.history.append([round(self.time, 1), [self.count(s.id) for s in SPECIES]])
            if len(self.history) > self.cfg.history_len:
                # keep long history coarse: drop every other point in the older half
                half = len(self.history) // 2
                self.history = self.history[:half:2] + self.history[half:]

    # ----- brains -------------------------------------------------------------------------------------
    def _apply_answers(self):
        for cid, action, mode, no_action, _ms in self.pool.take_answers():
            slot = self.slot_of.get(cid)
            if slot is None or not action:
                continue
            if self.sleeping[slot]:
                continue
            self.intent[slot] = I.get(action, self.intent[slot])
            self.decisions[slot] += 1
            m = self.meta[slot]
            m["mode"] = mode
            m["executed"] = action
            self._on_new_intent(slot)
        for cid, _ms, err in self.pool.take_slept():
            pass
        if self.pool.errors:
            err = self.pool.errors.pop(0)
            raise RuntimeError(f"brain worker error: {err}")

    def _on_new_intent(self, slot: int):
        name = INTENTS[self.intent[slot]]
        s = SPECIES[self.sp[slot]]
        if name in ("explore", "patrol"):
            self.waypoint[slot] = self.random_open_point(s)
        if name in ("hide", "burrow", "rest", "ambush"):
            self.home[slot] = self._nearest_shelter(self.pos[slot], s)

    def _nearest_shelter(self, p: np.ndarray, s: Species) -> np.ndarray:
        if not len(self._shelters):
            return p.copy()
        d = np.linalg.norm(self._shelters - p, axis=1)
        if s.radius > 0.5:  # big bodies do not fit in grottos and crevices
            d = d + np.where(self._shelter_r < 3.0, 1e3, 0.0)
        j = int(d.argmin())
        c = self._shelters[j].copy()
        if s.prefers_bottom or self.tank.shelters[j]["kind"] == "boulder":
            c[1] = self.tank.floor_height(np.array([c[0]]), np.array([c[2]]))[0] + max(0.4, s.radius + 0.2)
        return c

    def _schedule_decisions(self):
        cfg = self.cfg
        reqs = []
        for slot in np.nonzero(self.alive & self.brain_ready & ~self.sleeping)[0]:
            cid = int(self.cid[slot])
            if cid in self.pool.pending:
                continue
            m = self.meta[slot]
            since = self.time - self.last_decide[slot]
            toks = m["tokens"]
            prev = m["prev_tokens"]
            changed = prev is None or toks != prev
            urgent = m.pop("urgent", False)
            if not ((urgent and since >= cfg.urgent_min) or (changed and since >= cfg.decide_min)
                    or since >= cfg.decide_max):
                continue
            elapsed = since if self.last_decide[slot] > -1e8 else 0.0
            novelty = 0.0 if prev is None else len(set(toks) ^ set(prev)) / max(1, len(toks))
            conflict = 0.5 if (self.threat_level[slot] and ("food:near" in toks or self.prey_level[slot])) else 0.0
            reward = float(np.clip(self.reward[slot], -1.0, 1.0)) if m["executed"] else None
            reqs.append((cid, list(toks), m["executed"], reward, float(elapsed), float(novelty), conflict, None))
            m["prev_tokens"] = list(toks)
            self.reward[slot] = 0.0
            self.last_decide[slot] = self.time
        if reqs:
            self.pool.submit(reqs)

    def oldest_pending_s(self, wall_now: float) -> float:
        if not self.pool.pending:
            return 0.0
        return wall_now - min(self.pool.pending.values())

    # ----- perception ---------------------------------------------------------------------------------
    def _perceive(self, light: float):
        idx = np.nonzero(self.alive)[0]
        n = len(idx)
        if n == 0:
            return
        now = self.time
        P = self.pos[idx]
        V = self.vel[idx]
        sp = self.sp[idx].astype(int)
        speed = np.linalg.norm(V, axis=1)
        H = V / np.maximum(speed, 1e-6)[:, None]
        diff = P[None, :, :] - P[:, None, :]            # [i, j] = Pj - Pi
        D = np.linalg.norm(diff, axis=2)
        np.fill_diagonal(D, np.inf)
        U = diff / np.maximum(D, 1e-6)[:, :, None]
        radius = self._sp_arr["radius"][sp]
        vision = self._sp_arr["vision"][sp] * self.vision_g[idx]
        in_fov = np.einsum("ik,ijk->ij", H, U) >= self._cos_half_fov[sp][:, None]
        # Concealment: a creature in cover is seen only from close by.
        conceal = np.where(self.in_cover[idx][None, :], 3.0, np.inf)
        rangeok = (D <= vision[:, None]) & (D <= conceal)
        eats = self._prey_rel[sp][:, sp]                     # i eats j
        threat_c = eats.T & rangeok & (in_fov | (D < 3.0))    # j eats i; lateral line senses very close threats
        hungry = (self.energy[idx] < self._sp_arr["hungry_below"][sp]) & (self.digest[idx] <= 0)
        prey_c = eats & rangeok & in_fov & hungry[:, None]     # a sated predator ignores prey

        # Line of sight for the nearest three candidates of each kind; nearest visible wins.
        def nearest_visible(cand):
            Dm = np.where(cand, D, np.inf)
            k = min(3, n)
            order = np.argsort(Dm, axis=1)[:, :k]
            rows = np.repeat(np.arange(n), k)
            cols = order.ravel()
            ok = np.isfinite(Dm[rows, cols])
            rows, cols = rows[ok], cols[ok]
            best = np.full(n, -1)
            if len(rows):
                los = self.tank.line_of_sight(P[rows], P[cols])
                # rows are grouped by agent in increasing distance: keep the first visible one
                for r, c, v in zip(rows[::-1], cols[::-1], los[::-1]):
                    if v:
                        best[r] = c
            return best

        threat_j = nearest_visible(threat_c)
        prey_j = nearest_visible(prey_c)
        ar = np.arange(n)
        has_t = threat_j >= 0
        tj = np.where(has_t, threat_j, 0)
        t_dist = np.where(has_t, D[ar, tj], np.inf)
        t_near = t_dist < np.maximum(5.0, 3 * radius[tj] + 3)
        has_p = prey_j >= 0
        pj = np.where(has_p, prey_j, 0)
        p_dist = np.where(has_p, D[ar, pj], np.inf)

        # Food: plankton and particles, vectorised per species diet.
        dens = self.plankton.density_at(P)
        grad = self.plankton.best_neighbour(P)
        kinds_map = {"pellet": PARTICLE_FOOD, "detritus": PARTICLE_DETRITUS, "carcass": PARTICLE_CARCASS}
        f_idx = np.full(n, -1)
        f_dist = np.full(n, np.inf)
        for s in SPECIES:
            kinds = [kinds_map[k] for k in s.diet if k in kinds_map]
            rows = np.nonzero(sp == s.index)[0]
            if kinds and len(rows):
                j, d = self.particles.nearest(P[rows], kinds, float(s.vision or 4.0))
                f_idx[rows], f_dist[rows] = j, d
        # Shelters, rock, glass.
        if len(self._shelters):
            ds = np.linalg.norm(P[:, None, :] - self._shelters[None, :, :], axis=2) - self._shelter_r[None, :]
            ds = np.where((radius[:, None] > 0.5) & (self._shelter_r[None, :] < 3.0), np.inf, ds)
            shelter_d = ds.min(axis=1)
        else:
            shelter_d = np.full(n, np.inf)
        rock_d = self.tank.sd_fast(P)
        wall_d = self.tank.sd_walls(P)
        light_tok = "light:" + ("day" if light > 0.6 else ("dusk" if light > 0.25 else "night"))
        # Schools.
        same = sp[:, None] == sp[None, :]
        school = same & (D < 5.0)
        sn = school.sum(axis=1)
        sc = (school @ P) / np.maximum(sn, 1)[:, None]
        sv = (school @ V) / np.maximum(sn, 1)[:, None]
        # Mates.
        ready = (self.age[idx] >= self.mature_age[idx]) & ~self.sleeping[idx] & (self.cooldown[idx] <= 0) & \
            (self.energy[idx] >= self._sp_arr["breed_energy"][sp] - 0.1)
        ready_self = ready & (self.energy[idx] >= self._sp_arr["breed_energy"][sp])
        mate_m = same & (D < 6.0) & ready[None, :] & ready_self[:, None]
        mate_any = mate_m.any(axis=1)
        mate_j = np.where(mate_any, np.argmax(mate_m, axis=1), -1)
        mature = self.age[idx] >= self.mature_age[idx]

        cover_now = (shelter_d < 0.0) | ((self.intent[idx] == I["burrow"]) & (speed < 0.3))
        self.in_cover[idx] = cover_now
        prev_t = self.threat_level[idx].copy()
        prev_p = self.prey_level[idx].copy()
        # Threat state.
        tl = np.where(has_t, np.where(t_near, 2, 1), np.where(now - self.threat_seen[idx] > 2.0, 0, prev_t))
        self.threat_level[idx] = tl
        if has_t.any():
            self.threat_vec[idx[has_t]] = -U[ar[has_t], tj[has_t]]
            self.threat_seen[idx[has_t]] = now
        # Prey state: keep chasing the last seen position for 2 s after it disappears.
        if has_p.any():
            self.target[idx[has_p]] = idx[pj[has_p]]
            self.target_seen[idx[has_p]] = now
            self.target_pos[idx[has_p]] = P[pj[has_p]]
        lost = ~has_p & (self.target[idx] >= 0) & ((now - self.target_seen[idx] > 2.0) | ~hungry)
        self.target[idx[lost]] = -1
        pl = np.where(has_p, np.where(p_dist < 5.0 + radius * 2, 2, 1), np.where(self.target[idx] >= 0, prev_p, 0))
        self.prey_level[idx] = pl
        self.school_n[idx] = sn
        self.school_c[idx] = sc
        self.school_v[idx] = sv
        self.mate[idx] = np.where(mate_j >= 0, idx[np.maximum(mate_j, 0)], -1)
        fp = np.full((n, 3), np.nan)
        okf = f_idx >= 0
        if okf.any():
            fp[okf] = self.particles.pos[f_idx[okf]]
        self.food_pos[idx] = fp
        self.food_dir[idx] = grad
        excite = np.where(tl == 2, 0.8, np.where(pl > 0, 0.6, 0.25))
        self.glow[idx] = 0.7 * self.glow[idx] + 0.3 * excite

        NFL = ("none", "far", "near")
        energy = self.energy[idx]
        stamina = self.stamina[idx]
        for a in range(n):
            slot = int(idx[a])
            s = SPECIES[sp[a]]
            feats = s.features
            toks = []
            if "threat" in feats:
                toks.append("threat:" + NFL[tl[a]])
            if "prey" in feats:
                toks.append("prey:" + NFL[pl[a]])
            if "food" in feats:
                level = 0
                if f_idx[a] >= 0:
                    level = 2 if f_dist[a] < 2.5 else 1
                if "plankton" in s.diet:
                    level = max(level, 2 if dens[a] > 0.45 else (1 if dens[a] > 0.15 or grad[a].any() else 0))
                toks.append("food:" + NFL[level])
            if "cover" in feats:
                toks.append("cover:" + ("in" if cover_now[a] else ("near" if (shelter_d[a] < 6.0 or rock_d[a] < 1.2)
                                                                    else "far")))
            if "school" in feats:
                toks.append("school:" + ("alone" if sn[a] == 0 else ("few" if sn[a] < 4 else "many")))
            e, st = energy[a], stamina[a]
            toks.append("energy:" + ("low" if e < 0.3 else ("high" if e > 0.7 else "mid")))
            toks.append("stamina:" + ("low" if st < 0.3 else ("high" if st > 0.7 else "mid")))
            toks.append(light_tok)
            toks.append("edge:" + ("near" if (wall_d[a] < 3.0 or rock_d[a] < 1.0) else "open"))
            if "mate" in feats and mature[a]:
                toks.append("mate:" + ("near" if mate_j[a] >= 0 else "none"))
            m = self.meta[slot]
            m["tokens"] = toks
            if (tl[a] == 2 and prev_t[a] < 2) or (pl[a] > 0 and prev_p[a] == 0):
                m["urgent"] = True

    def _ready_to_breed(self, slot: int, slack: float = 0.0) -> bool:
        s = SPECIES[self.sp[slot]]
        return bool(self.alive[slot] and not self.sleeping[slot] and self.age[slot] >= self.mature_age[slot]
                    and self.energy[slot] >= s.breed_energy - slack and self.cooldown[slot] <= 0.0)

    # ----- sleep --------------------------------------------------------------------------------------
    def _sleep_schedule(self, phase: float):
        day_no = int(self.time // DAY_S)
        for slot in np.nonzero(self.alive)[0]:
            s = SPECIES[self.sp[slot]]
            should = in_window(phase, s.sleep_window) and self.threat_level[slot] < 2
            m = self.meta[slot]
            if should and not self.sleeping[slot]:
                self.sleeping[slot] = True
                self.intent[slot] = I["sleep"]
                self.home[slot] = self._nearest_shelter(self.pos[slot], s)
                window_id = day_no if s.sleep_window[0] < s.sleep_window[1] or phase >= s.sleep_window[0] else day_no - 1
                if s.brain == "nowa" and m.get("slept_window") != window_id:
                    m["slept_window"] = window_id
                    self.pool.sleep(int(self.cid[slot]), 3)
            elif not should and self.sleeping[slot]:
                self.sleeping[slot] = False
                self.intent[slot] = I[s.actions[0]]
                m["urgent"] = True

    # ----- motor --------------------------------------------------------------------------------------
    def _motor(self, dt: float):
        idx = np.nonzero(self.alive)[0]
        if not len(idx):
            return
        t = self.tank
        sp = self.sp[idx].astype(int)
        P, V = self.pos[idx], self.vel[idx]
        cruise = self._sp_arr["cruise"][sp] * self.speed_g[idx]
        burst = self._sp_arr["burst"][sp] * self.speed_g[idx]
        radius = self._sp_arr["radius"][sp]
        intent = self.intent[idx]
        desired = np.zeros_like(P)
        speed = cruise.copy()
        want_burst = np.zeros(len(idx), dtype=bool)

        def seek(mask, target, gain=1.0):
            if mask.any():
                d = target[mask] - P[mask]
                desired[mask] += d / np.maximum(np.linalg.norm(d, axis=1), 1e-6)[:, None] * gain

        onehot = intent[:, None] == np.arange(len(INTENTS))[None, :]

        def by(*names):
            return onehot[:, [I[n] for n in names]].any(axis=1)

        # Wander-type intents.
        m = by("explore", "patrol")
        if m.any():
            reached = np.linalg.norm(self.waypoint[idx] - P, axis=1) < 3.0
            for k in np.nonzero(m & reached)[0]:
                self.waypoint[idx[k]] = self.random_open_point(SPECIES[sp[k]])
            seek(m, self.waypoint[idx])
        # Forage: particles first, then up the plankton gradient.
        m = by("forage", "scavenge")
        if m.any():
            fp = self.food_pos[idx]
            has = m & ~np.isnan(fp[:, 0])
            seek(has, np.nan_to_num(fp))
            rest = m & ~has
            if rest.any():
                fd = self.food_dir[idx]
                jitter = self.rng.normal(0, 0.35, (len(idx), 3))
                desired[rest] += fd[rest] + jitter[rest]
                scav = rest & self._bottom[sp]
                for k in np.nonzero(scav)[0]:
                    if np.linalg.norm(self.waypoint[idx[k]] - P[k]) < 3.0:
                        self.waypoint[idx[k]] = self.random_open_point(SPECIES[sp[k]])
                seek(scav, self.waypoint[idx])
            speed[m] *= 0.7
        # Schooling.
        m = by("school")
        if m.any():
            n = self.school_n[idx] > 0
            mm = m & n
            if mm.any():
                coh = self.school_c[idx] - P
                desired[mm] += coh[mm] * 0.4 + self.school_v[idx][mm] * 0.6
            lone = m & ~n
            seek(lone, self.waypoint[idx])
        # Flee and hide.
        m = by("flee")
        if m.any():
            recent = (self.time - self.threat_seen[idx]) < 3.0
            mf = m & recent
            desired[mf] += self.threat_vec[idx][mf] * 2.0
            seek(m, self.home[idx], 0.6)
            want_burst |= mf & (self.threat_level[idx] == 2)
        m = by("hide", "burrow", "rest", "ambush", "sleep")
        if m.any():
            home = self.home[idx]
            dh = np.linalg.norm(home - P, axis=1)
            far = m & (dh > 1.0)
            seek(far, home)
            near = m & ~far
            speed[near] *= 0.15
            desired[near] += self.rng.normal(0, 0.1, (int(near.sum()), 3))
            speed[m & by("rest", "sleep")] *= 0.6
            bur = by("burrow") & near
            speed[bur] = 0.0
        # Hunting.
        m = by("stalk", "chase", "strike")
        if m.any():
            tgt = self.target[idx]
            tpos = self.target_pos[idx].copy()
            live = tgt >= 0
            tpos[live] = self.pos[tgt[live]] + self.vel[tgt[live]] * 0.4
            seek(m, tpos)
            lost_reached = m & ~live & (np.linalg.norm(tpos - P, axis=1) < 2.0)
            for k in np.nonzero(lost_reached)[0]:   # searched the last-seen spot: give up, wander
                self.intent[idx[k]] = I["patrol"] if "patrol" in SPECIES[sp[k]].actions else I["explore"]
                self.waypoint[idx[k]] = self.random_open_point(SPECIES[sp[k]])
            dist = np.linalg.norm(tpos - P, axis=1)
            stalk = by("stalk")
            speed[stalk] *= 0.6
            want_burst |= (by("strike") | (by("chase") & (dist < 8.0))) & live
        # Mating approach.
        m = by("mate")
        if m.any():
            mt = self.mate[idx]
            has = m & (mt >= 0)
            if has.any():
                seek(has, self.pos[np.where(mt >= 0, mt, 0)])
            seek(m & ~has, self.waypoint[idx])
            speed[m] *= 0.6
        # Jellies drift and pulse upward.
        m = by("drift")
        if m.any():
            desired[m] += self.rng.normal(0, 0.5, (int(m.sum()), 3)) + np.array([0, 0.2, 0])
            seek(m, self.waypoint[idx], 0.3)

        # Bottom dwellers stay low.
        floor = t.floor_height(P[:, 0], P[:, 2])
        low = self._bottom[sp] & np.isnan(self.food_pos[idx][:, 0])
        above = P[:, 1] - floor
        desired[low, 1] += np.clip(0.7 - above[low], -1.0, 1.0)
        # Separation.
        if len(idx) > 1:
            diff = P[:, None, :] - P[None, :, :]
            D = np.maximum(np.linalg.norm(diff, axis=2), 1e-3) + np.eye(len(idx)) * 1e6
            rr = radius[:, None] + radius[None, :] + 0.25
            close = D < rr
            if close.any():
                push = (diff / D[:, :, None]) * ((rr - D) / rr)[:, :, None] * close[:, :, None]
                desired += push.sum(axis=1) * 3.0
        # Obstacles: look ahead along velocity.
        look = np.maximum(1.5, np.linalg.norm(V, axis=1) * 1.2) + radius
        ahead = P + V / np.maximum(np.linalg.norm(V, axis=1), 1e-6)[:, None] * look[:, None]
        da = t.sd_fast(ahead) - radius
        near = da < 1.5
        if near.any():
            g = t.gradient(ahead[near])
            vdir = V[near] / np.maximum(np.linalg.norm(V[near], axis=1), 1e-6)[:, None]
            toward = np.maximum(0.0, -(vdir * g).sum(axis=1))      # only when heading into the rock
            desired[near] += g * ((1.5 - da[near]) * (0.3 + toward))[:, None] * 1.5
        # Glass, floor and surface.
        lo = np.array([-t.half_x, -t.depth, -t.half_z])
        hi = np.array([t.half_x, 0.0, t.half_z])
        margin = 2.0 + radius[:, None]
        desired += np.clip((lo + margin - P) / margin, 0, 1) * 2.0
        desired -= np.clip((P - (hi - margin)) / margin, 0, 1) * 2.0
        desired[:, 1] -= np.clip((P[:, 1] + 1.5) / 1.5, 0, 1)   # stay below the surface

        # Speed: burst needs stamina.
        can_burst = self.stamina[idx] > 0.15
        bursting = want_burst & can_burst
        speed = np.where(bursting, burst, speed)
        self.burst[idx] = bursting
        dn = np.linalg.norm(desired, axis=1)
        wdir = np.where(dn[:, None] > 1e-6, desired / np.maximum(dn, 1e-6)[:, None], V / np.maximum(np.linalg.norm(V, axis=1), 1e-6)[:, None])
        # Turn-rate limited rotation of the heading towards the desired direction.
        vs = np.linalg.norm(V, axis=1)
        u = np.where(vs[:, None] > 0.05, V / np.maximum(vs, 1e-6)[:, None], wdir)
        cosang = np.clip((u * wdir).sum(axis=1), -1.0, 1.0)
        ang = np.arccos(cosang)
        turn = self._sp_arr["turn_rate"][sp] * dt
        turn = np.where(bursting, turn * 0.7, turn)
        frac = np.where(ang > 1e-6, np.minimum(1.0, turn / np.maximum(ang, 1e-6)), 1.0)
        sin_a = np.sin(ang)
        small = sin_a < 1e-4
        w1 = np.where(small, 1.0 - frac, np.sin((1 - frac) * ang) / np.maximum(sin_a, 1e-9))
        w2 = np.where(small, frac, np.sin(frac * ang) / np.maximum(sin_a, 1e-9))
        newdir = u * w1[:, None] + wdir * w2[:, None]
        newdir /= np.maximum(np.linalg.norm(newdir, axis=1), 1e-9)[:, None]
        accel = self._sp_arr["accel"][sp] * dt
        newspeed = vs + np.clip(speed - vs, -accel * 1.5, accel)
        V = newdir * newspeed[:, None]
        P = P + V * dt
        # Collisions: push out of rock along the gradient.
        d = t.sd_fast(P) - radius
        hit = d < 0
        if hit.any():
            g = t.gradient(P[hit])
            P[hit] -= g * d[hit][:, None]
            vn = (V[hit] * g).sum(axis=1)
            V[hit] -= g * np.minimum(vn, 0.0)[:, None]
        P = np.clip(P, lo + radius[:, None] + 0.05, hi - radius[:, None] - 0.05)
        self.pos[idx], self.vel[idx] = P, V

    # ----- physiology ---------------------------------------------------------------------------------
    def _physiology(self, dt: float):
        idx = np.nonzero(self.alive)[0]
        if not len(idx):
            return
        sp = self.sp[idx].astype(int)
        vs = np.linalg.norm(self.vel[idx], axis=1)
        cruise = self._sp_arr["cruise"][sp]
        effort = 0.6 + 0.4 * np.minimum(4.0, (vs / cruise) ** 2)
        sleeping = self.sleeping[idx]
        effort = np.where(sleeping, 0.4, effort)
        cost = self._sp_arr["metabolism"][sp] * self.metab_g[idx] * effort * dt
        burst = self.burst[idx]
        self.stamina[idx] = np.clip(self.stamina[idx] + np.where(burst, -self._sp_arr["burst_cost"][sp] * 4.0,
                                                                 np.where(vs < cruise * 0.4, 0.12, 0.06)) * dt, 0, 1)
        self.energy[idx] -= cost + np.where(burst, self._sp_arr["metabolism"][sp] * 2.0 * dt, 0.0)
        self.age[idx] += dt
        self.cooldown[idx] -= dt
        # Rewards between decisions (energy change is added where food is eaten).
        threat = self.threat_level[idx]
        self.reward[idx] += np.where(threat == 2, -0.04, np.where(threat == 1, -0.01, 0.0)) * dt / 0.25
        self.reward[idx] += np.where((threat > 0) & self.in_cover[idx], 0.03, 0.0) * dt / 0.25
        self.reward[idx] -= np.where(self.stamina[idx] < 0.1, 0.01, 0.0)
        self.reward[idx] -= np.where(self.energy[idx] < 0.15, 0.005, 0.0)

    def _feed(self, dt: float):
        idx = np.nonzero(self.alive)[0]
        self.eating[idx] = False
        if not len(idx):
            return
        sp = self.sp[idx].astype(int)
        intent = self.intent[idx]
        # Plankton grazing.
        grazers = np.array([("plankton" in SPECIES[s].diet) for s in sp]) & \
            np.isin(intent, [I["forage"], I["drift"], I["school"]])
        if grazers.any():
            g_idx = idx[grazers]
            rate = np.where(self.intent[g_idx] == I["school"], 0.015, 0.05)
            got = self.plankton.consume(self.pos[g_idx], rate, dt)
            yields = np.array([SPECIES[self.sp[k]].diet["plankton"] for k in g_idx])
            gain = got * yields * 0.45
            self.energy[g_idx] = np.minimum(1.0, self.energy[g_idx] + gain)
            self.reward[g_idx] += gain * 8.0
            self.eating[g_idx] = got > 0.0005
        # Particles: nearest edible particle within reach, vectorised; bites applied per eater.
        if len(self.particles):
            ok_intent = np.isin(intent, self._eat_intents)
            eaters = idx[ok_intent & self._eats_particles[sp]]
            if len(eaters):
                d = np.linalg.norm(self.pos[eaters][:, None, :] - self.particles.pos[None, :, :], axis=2)
                edible = self._edible[self.sp[eaters]][:, self.particles.kind]        # (eaters, particles)
                reach = self._sp_arr["radius"][self.sp[eaters]] + 0.8
                d = np.where(edible & (d <= reach[:, None]), d, np.inf)
                j = d.argmin(axis=1)
                got = np.isfinite(d[np.arange(len(eaters)), j])
                for k, jj in zip(eaters[got], j[got]):
                    s = SPECIES[self.sp[k]]
                    kind = int(self.particles.kind[jj])
                    name = self._kind_names[kind]
                    bite = min(self.particles.amount[jj], (0.08 if kind == PARTICLE_FOOD else 0.02) * (dt / 0.05) * 0.5)
                    self.particles.amount[jj] -= bite
                    gain = bite * s.diet[name] * (1.6 if kind == PARTICLE_FOOD else 0.8)
                    self.energy[k] = min(1.0, self.energy[k] + gain)
                    self.reward[k] += gain * 8.0
                    self.eating[k] = True

    DIGEST_S = {"needlejaw": 240.0, "shade": 480.0}

    def _predation(self, dt: float):
        self.strike_cd -= dt
        self.digest -= dt
        hunters = np.nonzero(self.alive & np.isin(self.intent, [I["chase"], I["strike"], I["stalk"]]) &
                             (self.target >= 0) & (self.strike_cd <= 0) & (self.digest <= 0) &
                             (self.energy < self._sp_arr["hungry_below"][self.sp]))[0]
        for h in hunters:
            prey = int(self.target[h])
            if prey < 0 or not self.alive[prey]:
                self.target[h] = -1
                continue
            hs, ps = SPECIES[self.sp[h]], SPECIES[self.sp[prey]]
            reach = hs.radius + ps.radius + 0.35
            if np.linalg.norm(self.pos[h] - self.pos[prey]) > reach:
                continue
            # One lunge, then a refractory pause whatever the outcome.
            self.strike_cd[h] = 2.0
            self.stamina[h] = max(0.0, self.stamina[h] - 0.15)
            p_catch = 0.4 if self.burst[h] else 0.12
            if self.burst[prey]:
                p_catch *= 0.5
            if self.in_cover[prey]:
                p_catch *= 0.3
            if self.school_n[prey] >= 4:
                p_catch *= 0.4                    # confusion effect of a dense school
            if self.prng.random() > p_catch:
                self.reward[prey] += 0.2          # escaped
                continue
            gain = ps.body_content * hs.diet.get(ps.id, 0.0) * (0.5 + 0.5 * max(0.0, self.energy[prey]))
            self.energy[h] = min(1.0, self.energy[h] + gain)
            self.reward[h] += 0.5 + gain * 4.0
            self.digest[h] = self.DIGEST_S.get(hs.id, 300.0) * (0.5 + gain)
            self.events.append({"t": "event", "kind": "catch", "species": hs.id, "prey": ps.id,
                                "pos": self.pos[prey].round(2).tolist()})
            self.particles.add(self.pos[prey], PARTICLE_DETRITUS, ps.body_content * 0.15)
            self.kill(prey, "eaten")
            self.target[h] = -1
            self.intent[h] = I["rest"] if "rest" in hs.actions else self.intent[h]
            self.home[h] = self._nearest_shelter(self.pos[h], hs)

    def _breed(self):
        for a in np.nonzero(self.alive)[0]:
            b = int(self.mate[a])
            if b < 0 or b <= a or not self.alive[b]:
                continue
            s = SPECIES[self.sp[a]]
            if not (self._ready_to_breed(a, 0.05) and self._ready_to_breed(b, 0.1)):
                continue
            if np.linalg.norm(self.pos[a] - self.pos[b]) > 2.0 + s.radius * 2:
                continue
            if self.count(s.id) >= self.cap(s) or (s.brain == "nowa" and self.nowa_count() >= self.max_nowa()):
                continue
            if INTENTS[self.intent[a]] in ("flee", "strike", "chase") or INTENTS[self.intent[b]] in ("flee", "strike"):
                continue
            self._make_child(int(a), b)

    def _make_child(self, a: int, b: int):
        s = SPECIES[self.sp[a]]
        genome = epi = None
        ia = ib = {}
        if s.brain == "nowa":
            ia = self.pool.inheritance(int(self.cid[a])) or {}
            ib = self.pool.inheritance(int(self.cid[b])) or {}
            ga, gb = ia.get("genome"), ib.get("genome")
            if self.cfg.brain_kind == "nowa" and ga and gb:
                genome = na.child_genome(ga, gb, self.prng)
                epi = na.blend_epigenomes(ia.get("epigenome"), ib.get("epigenome"), self.prng)
            else:
                genome = {"genes": {}, "generation": int(max(self.gen[a], self.gen[b]) + 1)}

        def mix(arr):
            return float(np.clip((arr[a] + arr[b]) / 2 + self.rng.normal(0, 0.04), 0.8, 1.2))

        body = {"speed": mix(self.speed_g), "vision": mix(self.vision_g), "metabolism": mix(self.metab_g)}
        pos = (self.pos[a] + self.pos[b]) / 2
        gen = int(max(self.gen[a], self.gen[b]) + 1)
        cid = self.spawn(s.id, pos=pos, genome=genome, epigenome=epi, body=body,
                         parents=(int(self.cid[a]), int(self.cid[b])), generation=gen, energy=0.55)
        slot = self.slot_of[cid]
        self.age[slot] = 0.0
        for _ in range(s.litter - 1):
            if self.count(s.id) >= self.cap(s):
                break
            g2 = na.child_genome(ia.get("genome"), ib.get("genome"), self.prng) if (
                s.brain == "nowa" and self.cfg.brain_kind == "nowa" and genome) else genome
            c2 = self.spawn(s.id, pos=pos + self.rng.normal(0, 0.3, 3), genome=g2, epigenome=epi, body=body,
                            parents=(int(self.cid[a]), int(self.cid[b])), generation=gen, energy=0.55)
            self.age[self.slot_of[c2]] = 0.0
            self.births += 1
        for p in (a, b):
            self.energy[p] -= 0.3
            self.cooldown[p] = s.breed_cooldown_days * DAY_S
            self.children[p] += 1
            self.reward[p] += 0.6
        self.births += 1
        self.events.append({"t": "event", "kind": "birth", "species": s.id, "id": cid, "pos": pos.round(2).tolist(),
                            "generation": gen})

    def _lifecycle(self):
        idx = np.nonzero(self.alive)[0]
        for k in idx:
            s = SPECIES[self.sp[k]]
            if self.energy[k] <= 0.0:
                self.kill(int(k), "starvation")
            elif self.age[k] >= self.lifespan[k]:
                self.kill(int(k), "old_age")
            elif s.brain == "nowa" and self.decisions[k] >= s.max_decisions:
                self.kill(int(k), "old_age")
        # Jellies divide when well fed.
        for k in np.nonzero(self.alive & (self.sp == BY_ID["lumen"].index))[0]:
            if self.energy[k] > 0.9 and self.age[k] > self.mature_age[k] and self.cooldown[k] <= 0 \
                    and self.count("lumen") < self.cap(BY_ID["lumen"]):
                self.energy[k] *= 0.5
                self.cooldown[k] = 0.3 * DAY_S
                cid = self.spawn("lumen", pos=self.pos[k] + self.rng.normal(0, 0.5, 3), energy=float(self.energy[k]),
                                 generation=int(self.gen[k] + 1), parents=(int(self.cid[k]), 0))
                self.age[self.slot_of[cid]] = 0.0
                self.births += 1

    SNOW_RATE = 0.1        # detritus flakes per second from plankton turnover (scaled by plankton biomass)

    def _marine_snow(self, dt: float):
        expected = self.SNOW_RATE * dt * min(1.5, self.plankton.rho.mean() / 0.35)
        n = self.rng.poisson(expected)
        if n:
            t = self.tank
            pts = self.rng.uniform([-t.half_x + 1, -t.light_depth, -t.half_z + 1], [t.half_x - 1, -1, t.half_z - 1], (n, 3))
            self.particles.add(pts, PARTICLE_DETRITUS, 0.15)

    def _repopulate(self):
        for s in SPECIES:
            n = self.count(s.id)
            if n > 0:
                self.extinct_since.pop(s.id, None)
                continue
            if s.id not in self.extinct_since:
                self.extinct_since[s.id] = self.time
                self.events.append({"t": "event", "kind": "extinct", "species": s.id})
                continue
            if not self.cfg.repop_enabled or self.time - self.extinct_since[s.id] < self.cfg.repop_delay_s:
                continue
            self.found(s.id)
            self.extinct_since.pop(s.id, None)

    def found(self, species_id: str, n: Optional[int] = None):
        s = BY_ID[species_id]
        n = n or max(2, int(round(s.founders * max(self.cfg.scale, 0.5))))
        arch = self.archive.get(species_id) or []
        use_archive = self.cfg.repop_mode == "archive" and arch and s.brain == "nowa" and self.cfg.brain_kind == "nowa"
        center = self.random_open_point(s)
        for k in range(n):
            genome = body = None
            gen = 0
            if use_archive:
                e = arch[k % len(arch)]
                genome = na.child_genome(e["genome"], arch[(k + 1) % len(arch)]["genome"], self.prng, 0.08)
                body, gen = e.get("body"), int(e.get("generation", 0)) + 1
            self.spawn(species_id, pos=center + self.rng.normal(0, 1.0, 3) * [1, 0.3, 1], genome=genome, body=body,
                       generation=gen, energy=0.8, age_frac=0.25)
        self.events.append({"t": "event", "kind": "repopulate", "species": species_id, "n": n,
                            "mode": "archive" if use_archive else "fresh"})

    # ----- user tools -----------------------------------------------------------------------------------
    def feed(self, pos, n: int = 30):
        p = np.asarray(pos, dtype=float)
        p[1] = min(p[1], -0.5)
        pts = p + self.rng.normal(0, 0.8, (n, 3)) * [1, 0.3, 1]
        self.particles.add(pts, PARTICLE_FOOD, 0.08)

    # ----- output -----------------------------------------------------------------------------------------
    def creature_array(self) -> np.ndarray:
        idx = np.nonzero(self.alive)[0]
        c = np.zeros(len(idx), dtype=CREATURE_DTYPE)
        c["id"] = self.cid[idx]
        c["species"] = self.sp[idx]
        c["intent"] = self.intent[idx]
        flags = (self.sleeping[idx] * FLAG_SLEEP) | (self.burst[idx] * FLAG_BURST) | (self.eating[idx] * FLAG_EAT) | \
            (self.in_cover[idx] * FLAG_COVER) | ((self.cid[idx] == self.selected) * FLAG_SELECTED)
        c["flags"] = flags.astype(np.uint8)
        g = np.where(self.sleeping[idx], 0.1, self.glow[idx]) + self.burst[idx] * 0.3
        c["glow"] = np.clip(g * 255, 0, 255).astype(np.uint8)
        c["pos"] = self.pos[idx]
        c["vel"] = self.vel[idx]
        c["scale"] = np.clip(0.6 + 0.4 * self.age[idx] / np.maximum(self.mature_age[idx], 1.0), 0.6, 1.0)
        c["energy"] = np.clip(self.energy[idx], 0, 1)
        return c

    def particle_array(self) -> np.ndarray:
        n = len(self.particles)
        a = np.zeros(n, dtype=PARTICLE_DTYPE)
        if n:
            a["pos"] = self.particles.pos
            a["kind"] = self.particles.kind
            a["size"] = np.clip(5 + self.particles.amount * 60, 3, 60).astype(np.uint8)
        return a

    def populations(self) -> Dict[str, int]:
        return {s.id: self.count(s.id) for s in SPECIES}

    def max_generation(self) -> Dict[str, int]:
        out = {}
        for s in SPECIES:
            m = self.alive & (self.sp == s.index)
            out[s.id] = int(self.gen[m].max()) if m.any() else 0
        return out

    def describe_creature(self, cid: int) -> Optional[dict]:
        slot = self.slot_of.get(cid)
        if slot is None:
            return None
        s = SPECIES[self.sp[slot]]
        m = self.meta[slot]
        tgt = int(self.target[slot])
        return {"t": "inspect", "id": cid, "species": s.id, "generation": int(self.gen[slot]),
                "age_days": round(float(self.age[slot] / DAY_S), 3),
                "lifespan_days": round(float(self.lifespan[slot] / DAY_S), 2),
                "energy": round(float(self.energy[slot]), 3), "stamina": round(float(self.stamina[slot]), 3),
                "intent": INTENTS[self.intent[slot]], "sleeping": bool(self.sleeping[slot]),
                "in_cover": bool(self.in_cover[slot]), "tokens": list(m["tokens"]), "mode": m.get("mode", ""),
                "target": int(self.cid[tgt]) if tgt >= 0 and self.alive[tgt] else None,
                "vision": round(float(s.vision * self.vision_g[slot]), 2), "fov_deg": s.fov_deg,
                "parents": m["parents"], "children": int(self.children[slot]), "decisions": int(self.decisions[slot]),
                "body": {"speed": round(float(self.speed_g[slot]), 3), "vision": round(float(self.vision_g[slot]), 3),
                         "metabolism": round(float(self.metab_g[slot]), 3)},
                "pos": self.pos[slot].round(2).tolist()}
