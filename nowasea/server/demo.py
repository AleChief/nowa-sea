"""Scripted motion source for renderer development (``python -m nowasea.server --demo``).

Creatures wander between random waypoints and steer around rock. No brains, no ecosystem.
"""

from __future__ import annotations

import threading
import time
import uuid

import numpy as np

from nowasea.ecosystem.species import DAY_S, SPECIES
from nowasea.server import protocol as P
from nowasea.world.tank import build_tank


class DemoSource:
    def __init__(self, seed: int = 7, scale: float = 1.0):
        self.tank = build_tank(seed)
        self.tank.build_grid()
        self.rng = np.random.default_rng(seed)
        self.world_id = uuid.uuid4().hex[:8]
        sp, ids = [], []
        for s in SPECIES:
            n = max(1, int(round(s.target * scale)))
            sp += [s.index] * n
        self.sp = np.array(sp)
        n = len(self.sp)
        self.ids = np.arange(1, n + 1, dtype=np.uint32)
        self.pos = self._random_points(n)
        self.vel = self.rng.normal(0, 0.5, (n, 3))
        self.way = self._random_points(n)
        self.cruise = np.array([SPECIES[i].cruise for i in self.sp])
        self.turn = np.array([SPECIES[i].turn_rate for i in self.sp])
        self.radius = np.array([SPECIES[i].radius for i in self.sp])
        self.sim_time = DAY_S * 0.3
        self.seq = 0
        self.speed = 1.0
        self.selected = 0
        self._lock = threading.Lock()
        self._frame = b""
        self._stop = False
        self.food = np.zeros((0, 3))
        self.plankton = np.zeros((6, 10, 16))

    def _random_points(self, n: int) -> np.ndarray:
        t = self.tank
        out = np.zeros((0, 3))
        while len(out) < n:
            p = self.rng.uniform([-t.half_x + 3, -t.depth + 3, -t.half_z + 3], [t.half_x - 3, -2, t.half_z - 3], (n * 2, 3))
            p = p[t.sd_fast(p) > 2.0]
            out = np.vstack([out, p])
        return out[:n]

    # ----- source interface -----------------------------------------------------------------------
    def hello(self) -> dict:
        return {"t": "hello", "protocol": P.PROTOCOL, "world_id": self.world_id, "tank": self.tank.describe(),
                "species": [s.describe() for s in SPECIES],
                "intents": sorted({a for s in SPECIES for a in s.actions}), "day_s": DAY_S,
                "plankton": {"nx": 16, "ny": 6, "nz": 10}, "demo": True}

    def floor_frame(self) -> bytes:
        return P.floor_frame(self.tank.floor)

    def state_frame(self) -> bytes:
        with self._lock:
            return self._frame

    def plankton_frame(self) -> bytes:
        return P.plankton_frame(self.plankton)

    def stats(self) -> dict:
        pop = {s.id: int((self.sp == s.index).sum()) for s in SPECIES}
        return {"t": "stats", "pop": pop, "history": [], "births": 0, "deaths": 0, "extinct": {},
                "speed": {"set": self.speed, "achieved": self.speed}, "brains": {}, "generation_max": {}}

    def inspect(self, cid):
        return None

    def pop_events(self):
        return []

    def command(self, msg: dict):
        t = msg.get("t")
        if t == "speed":
            v = msg.get("value")
            self.speed = 20.0 if v == "turbo" else float(v or 0)
        elif t == "select":
            self.selected = int(msg.get("id") or 0)
        elif t == "feed":
            p = np.asarray(msg.get("pos", [0, -2, 0]), dtype=float)
            self.food = np.vstack([self.food, p + self.rng.normal(0, 0.6, (30, 3))])
        return None

    # ----- loop ------------------------------------------------------------------------------------
    def start(self):
        threading.Thread(target=self._run, daemon=True, name="demo-sim").start()

    def stop(self):
        self._stop = True

    def _run(self):
        dt = 0.05
        last = time.perf_counter()
        acc = 0.0
        while not self._stop:
            now = time.perf_counter()
            acc += (now - last) * self.speed
            last = now
            steps = 0
            while acc >= dt and steps < 40:
                self._step(dt)
                acc -= dt
                steps += 1
            if steps >= 40:
                acc = 0.0
            self._publish()
            time.sleep(0.01)

    def _step(self, dt: float):
        t = self.tank
        self.sim_time += dt
        to_way = self.way - self.pos
        dist = np.linalg.norm(to_way, axis=1)
        reached = dist < 2.0
        if reached.any():
            self.way[reached] = self._random_points(int(reached.sum()))
        desired = to_way / np.maximum(dist, 1e-6)[:, None] * self.cruise[:, None]
        ahead = self.pos + self.vel * 1.2
        d = t.sd_fast(ahead)
        near = d < 2.5
        if near.any():
            g = t.gradient(ahead[near])
            desired[near] += g * (2.5 - d[near])[:, None] * 2.0
        wall = t.sd_walls(self.pos)
        if (wall < 3).any():
            c = np.array([0.0, -t.depth / 2, 0.0])
            m = wall < 3
            desired[m] += (c - self.pos[m]) * 0.15
        steer = desired - self.vel
        max_dv = self.turn[:, None] * self.cruise[:, None] * dt
        n = np.linalg.norm(steer, axis=1, keepdims=True)
        steer = np.where(n > max_dv, steer / np.maximum(n, 1e-9) * max_dv, steer)
        self.vel += steer
        self.pos += self.vel * dt
        inside = t.sd_fast(self.pos) - self.radius
        hit = inside < 0
        if hit.any():
            g = t.gradient(self.pos[hit])
            self.pos[hit] -= g * inside[hit][:, None]
        lo = np.array([-t.half_x, -t.depth, -t.half_z]) + 0.5
        hi = np.array([t.half_x, 0.0, t.half_z]) - 0.5
        self.pos = np.clip(self.pos, lo, hi)
        if len(self.food):
            self.food[:, 1] -= 0.15 * dt
            floor = t.floor_height(self.food[:, 0], self.food[:, 2])
            self.food = self.food[self.food[:, 1] > floor]

    def _publish(self):
        n = len(self.pos)
        c = np.zeros(n, dtype=P.CREATURE_DTYPE)
        c["id"], c["species"] = self.ids, self.sp
        c["intent"] = (self.ids // 7 + int(self.sim_time / 20)) % 8
        c["flags"] = np.where(self.ids == self.selected, P.FLAG_SELECTED, 0)
        c["glow"] = (128 + 100 * np.sin(self.sim_time * 0.5 + self.ids)).astype(np.uint8)
        c["pos"], c["vel"] = self.pos, self.vel
        c["scale"], c["energy"] = 1.0, 0.7
        parts = np.zeros(len(self.food), dtype=P.PARTICLE_DTYPE)
        if len(self.food):
            parts["pos"], parts["kind"], parts["size"] = self.food, P.PARTICLE_FOOD, 4
        phase = (self.sim_time % DAY_S) / DAY_S
        light = float(np.clip(np.sin((phase - 0.25) * 2 * np.pi) * 0.5 + 0.5, 0.05, 1.0))
        z = np.linspace(0, 1, 6)[:, None, None]
        self.plankton = np.clip(0.3 + 0.6 * z * light + 0.1 * np.sin(self.sim_time * 0.05 + np.arange(16)), 0, 1) \
            * np.ones((6, 10, 16))
        frame = P.state_frame(self.seq, self.sim_time, self.speed, self.speed, phase, light, c, parts,
                              selected=self.selected, paused=self.speed == 0)
        self.seq += 1
        with self._lock:
            self._frame = frame
