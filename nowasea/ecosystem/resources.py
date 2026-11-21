"""Plankton field, sinking particles (food pellets, detritus, carcasses) and the nutrient pool."""

from __future__ import annotations

import numpy as np

from nowasea.server.protocol import PARTICLE_CARCASS, PARTICLE_DETRITUS, PARTICLE_FOOD

# Indexed by particle kind: food pellet, detritus, carcass.
SINK = np.array([0.12, 0.05, 0.35])          # m/s
DECAY = np.array([0.0, 1 / 2400.0, 1 / 1800.0])  # fraction of the amount per second
MAX_PARTICLES = 800


class Plankton:
    """Density 0..1 per cell on an (ny, nz, nx) grid; iy = 0 is the floor layer."""

    def __init__(self, tank, nx: int = 16, ny: int = 6, nz: int = 10, rng=None):
        self.tank = tank
        self.nx, self.ny, self.nz = nx, ny, nz
        self.sx, self.sy, self.sz = 2 * tank.half_x / nx, tank.depth / ny, 2 * tank.half_z / nz
        y_mid = -tank.depth + (np.arange(ny) + 0.5) * self.sy
        self.depth_light = np.exp(-np.maximum(0.0, -y_mid) / tank.light_depth)[:, None, None]
        rng = rng or np.random.default_rng(0)
        self.rho = np.clip(0.25 + 0.5 * self.depth_light * rng.uniform(0.6, 1.0, (ny, nz, nx)), 0, 1)
        self.growth = 0.012        # 1/s at full light
        self.seed_rate = 0.0004    # spontaneous appearance in light
        self.nutrient = 0.5        # 0..2 boosts growth; fed by decay
        self._diffuse_t = 0.0

    def cell_index(self, pos: np.ndarray):
        t = self.tank
        ix = np.clip(((pos[:, 0] + t.half_x) / self.sx).astype(int), 0, self.nx - 1)
        iy = np.clip(((pos[:, 1] + t.depth) / self.sy).astype(int), 0, self.ny - 1)
        iz = np.clip(((pos[:, 2] + t.half_z) / self.sz).astype(int), 0, self.nz - 1)
        return iy, iz, ix

    def density_at(self, pos: np.ndarray) -> np.ndarray:
        iy, iz, ix = self.cell_index(pos)
        return self.rho[iy, iz, ix]

    def best_neighbour(self, pos: np.ndarray) -> np.ndarray:
        """Unit direction to the densest of the 6 neighbouring cells (zero if here is best)."""
        iy, iz, ix = self.cell_index(pos)
        here = self.rho[iy, iz, ix]
        best = here.copy()
        out = np.zeros((len(pos), 3))
        for d, (dy, dz, dx) in enumerate(((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))):
            jy, jz, jx = np.clip(iy + dy, 0, self.ny - 1), np.clip(iz + dz, 0, self.nz - 1), np.clip(ix + dx, 0, self.nx - 1)
            v = self.rho[jy, jz, jx]
            better = v > best + 0.03
            best = np.where(better, v, best)
            out[better] = (dx, dy, dz)
        return out

    def consume(self, pos: np.ndarray, rate: np.ndarray, dt: float) -> np.ndarray:
        if len(pos) == 0:
            return np.zeros(0)
        iy, iz, ix = self.cell_index(pos)
        flat = (iy * self.nz + iz) * self.nx + ix
        want = rate * dt
        # Several eaters in one cell share what is there.
        total = np.bincount(flat, weights=want, minlength=self.rho.size)
        avail = self.rho.ravel()
        frac = np.where(total > 0, np.minimum(1.0, avail / np.maximum(total, 1e-12)), 0.0)
        got = want * frac[flat]
        np.subtract.at(avail, flat, got)
        self.rho = np.clip(avail.reshape(self.rho.shape), 0.0, 1.0)
        return got

    def step(self, dt: float, light: float) -> None:
        L = self.depth_light * light
        boost = 0.5 + 0.5 * min(self.nutrient, 2.0)
        r = self.rho
        grow = self.growth * boost * L * r * (1.0 - r) + self.seed_rate * L
        self.rho = np.clip(r + grow * dt, 0.0, 1.0)
        used = float(grow.sum() * dt) * 0.05
        self.nutrient = max(0.0, self.nutrient - used)
        self._diffuse_t += dt
        if self._diffuse_t >= 2.0:
            self._diffuse_t = 0.0
            r = self.rho
            blur = r.copy()
            for axis in range(3):
                blur += np.roll(r, 1, axis) + np.roll(r, -1, axis)
            self.rho = 0.94 * r + 0.06 * blur / 7.0

    def to_state(self) -> dict:
        return {"rho": self.rho.round(4).tolist(), "nutrient": self.nutrient}

    def load_state(self, s: dict) -> None:
        self.rho = np.asarray(s["rho"], dtype=float).reshape(self.ny, self.nz, self.nx)
        self.nutrient = float(s.get("nutrient", 0.5))


class Particles:
    def __init__(self, tank):
        self.tank = tank
        self.pos = np.zeros((0, 3))
        self.kind = np.zeros(0, dtype=np.uint8)
        self.amount = np.zeros(0)
        self.settled = np.zeros(0, dtype=bool)

    def __len__(self):
        return len(self.kind)

    def add(self, pos, kind: int, amount: float) -> None:
        pos = np.atleast_2d(np.asarray(pos, dtype=float))
        n = len(pos)
        self.pos = np.vstack([self.pos, pos])
        self.kind = np.concatenate([self.kind, np.full(n, kind, dtype=np.uint8)])
        self.amount = np.concatenate([self.amount, np.full(n, float(amount))])
        self.settled = np.concatenate([self.settled, np.zeros(n, dtype=bool)])
        if len(self.kind) > MAX_PARTICLES:
            self.keep(np.arange(len(self.kind)) >= len(self.kind) - MAX_PARTICLES)

    def keep(self, mask) -> None:
        self.pos, self.kind, self.amount, self.settled = self.pos[mask], self.kind[mask], self.amount[mask], self.settled[mask]

    def step(self, dt: float, plankton: Plankton) -> None:
        if not len(self.kind):
            return
        sink = SINK[self.kind]
        moving = ~self.settled
        self.pos[moving, 1] -= sink[moving] * dt
        floor = self.tank.floor_height(self.pos[:, 0], self.pos[:, 2]) + 0.1
        landed = moving & (self.pos[:, 1] <= floor)
        if landed.any():
            self.pos[landed, 1] = floor[landed]
            self.settled[landed] = True
            food = landed & (self.kind == PARTICLE_FOOD)
            self.kind[food] = PARTICLE_DETRITUS          # uneaten pellets rot on the floor
            self.amount[food] *= 0.6
        # Rock tops also stop sinking matter.
        rest = moving & ~landed
        if rest.any():
            d = self.tank.sd_fast(self.pos[rest])
            on_rock = d < 0.15
            idx = np.nonzero(rest)[0][on_rock]
            self.settled[idx] = True
        lost = self.amount * DECAY[self.kind] * dt
        self.amount -= lost
        plankton.nutrient = min(2.0, plankton.nutrient + float(lost.sum()) * 3.0)
        self.keep(self.amount > 0.005)

    def nearest(self, pos: np.ndarray, kinds, max_dist: float):
        """For each query point: index of the nearest particle of the given kinds within max_dist, else -1."""
        out = np.full(len(pos), -1)
        dist = np.full(len(pos), np.inf)
        if not len(self.kind) or not len(pos):
            return out, dist
        m = np.isin(self.kind, list(kinds))
        if not m.any():
            return out, dist
        cand = np.nonzero(m)[0]
        d = np.linalg.norm(pos[:, None, :] - self.pos[None, cand, :], axis=2)
        j = d.argmin(axis=1)
        dj = d[np.arange(len(pos)), j]
        ok = dj <= max_dist
        out[ok] = cand[j[ok]]
        dist[ok] = dj[ok]
        return out, dist

    def to_state(self) -> dict:
        return {"pos": self.pos.round(3).tolist(), "kind": self.kind.tolist(), "amount": self.amount.round(4).tolist(),
                "settled": self.settled.tolist()}

    def load_state(self, s: dict) -> None:
        self.pos = np.asarray(s["pos"], dtype=float).reshape(-1, 3)
        self.kind = np.asarray(s["kind"], dtype=np.uint8)
        self.amount = np.asarray(s["amount"], dtype=float)
        self.settled = np.asarray(s.get("settled", [False] * len(self.kind)), dtype=bool)
