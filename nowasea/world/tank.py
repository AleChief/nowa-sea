"""The tank: one seeded description shared by the simulation (collisions, sight) and the renderer.

Coordinates: metres, y up, water surface at y = 0, glass box |x| <= half_x, |z| <= half_z, y >= -depth.
Solid rock is the SDF ``max(min(positives), -min(holes))`` unioned with the floor heightfield.
The renderer evaluates exactly these formulas (docs/protocol.md, "Tank SDF").
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List

import numpy as np

# ---------------------------------------------------------------------------------------------------
# SDF primitives (vectorised: p is (N, 3))


def sd_ellipsoid(p: np.ndarray, c, r, yaw: float = 0.0) -> np.ndarray:
    q = _to_local(p, c, yaw) / np.asarray(r, dtype=np.float64)
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm(q / np.asarray(r, dtype=np.float64), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_capsule(p: np.ndarray, a, b, r: float) -> np.ndarray:
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    pa, ba = p - a, b - a
    h = np.clip((pa @ ba) / max(float(ba @ ba), 1e-12), 0.0, 1.0)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r


def sd_box(p: np.ndarray, c, h, yaw: float = 0.0, rounding: float = 0.0) -> np.ndarray:
    q = np.abs(_to_local(p, c, yaw)) - (np.asarray(h, dtype=np.float64) - rounding)
    outside = np.linalg.norm(np.maximum(q, 0.0), axis=1)
    inside = np.minimum(np.max(q, axis=1), 0.0)
    return outside + inside - rounding


def _to_local(p: np.ndarray, c, yaw: float) -> np.ndarray:
    q = p - np.asarray(c, dtype=np.float64)
    if yaw:
        cs, sn = math.cos(yaw), math.sin(yaw)
        x = q[:, 0] * cs + q[:, 2] * sn
        z = -q[:, 0] * sn + q[:, 2] * cs
        q = np.stack([x, q[:, 1], z], axis=1)
    return q


def _eval_prim(p: np.ndarray, prim: dict) -> np.ndarray:
    t = prim["type"]
    if t == "ellipsoid":
        return sd_ellipsoid(p, prim["c"], prim["r"], prim.get("yaw", 0.0))
    if t == "capsule":
        return sd_capsule(p, prim["a"], prim["b"], prim["r"])
    if t == "box":
        return sd_box(p, prim["c"], prim["h"], prim.get("yaw", 0.0), prim.get("round", 0.0))
    raise ValueError(f"unknown primitive {t}")


# ---------------------------------------------------------------------------------------------------
# Value noise for the floor


def _value_noise(rng: np.random.Generator, nx: int, nz: int, cell: float, octaves: int = 4) -> np.ndarray:
    out = np.zeros((nz, nx))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        step = cell / (2 ** o)
        gx, gz = int(math.ceil(nx / step)) + 2, int(math.ceil(nz / step)) + 2
        grid = rng.uniform(-1.0, 1.0, size=(gz, gx))
        xs, zs = np.arange(nx) / step, np.arange(nz) / step
        x0, z0 = np.floor(xs).astype(int), np.floor(zs).astype(int)
        fx, fz = xs - x0, zs - z0
        fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
        g00 = grid[np.ix_(z0, x0)]
        g10 = grid[np.ix_(z0, x0 + 1)]
        g01 = grid[np.ix_(z0 + 1, x0)]
        g11 = grid[np.ix_(z0 + 1, x0 + 1)]
        top = g00 + (g10 - g00) * fx[None, :]
        bot = g01 + (g11 - g01) * fx[None, :]
        out += amp * (top + (bot - top) * fz[:, None])
        total += amp
        amp *= 0.5
    return out / total


# ---------------------------------------------------------------------------------------------------


@dataclass
class Tank:
    seed: int = 7
    half_x: float = 40.0
    half_z: float = 25.0
    depth: float = 30.0
    floor_res: float = 1.0
    floor: np.ndarray = field(default=None, repr=False)      # (nz, nx) heights (y), row = z
    positives: List[dict] = field(default_factory=list)
    holes: List[dict] = field(default_factory=list)
    shelters: List[dict] = field(default_factory=list)       # {"c": [x,y,z], "r": radius, "kind": str}
    passages: List[dict] = field(default_factory=list)       # {"a":..., "b":..., "width":..., "name":...}
    kelp: List[dict] = field(default_factory=list)           # renderer decor: {"c": [x, z], "r": radius}
    light_depth: float = 12.0                                 # plankton grows above y > -light_depth

    @property
    def nx(self) -> int:
        return self.floor.shape[1]

    @property
    def nz(self) -> int:
        return self.floor.shape[0]

    # ----- floor ------------------------------------------------------------------------------------
    def floor_height(self, x: np.ndarray, z: np.ndarray) -> np.ndarray:
        fx = np.clip((np.asarray(x) + self.half_x) / self.floor_res, 0, self.nx - 1.001)
        fz = np.clip((np.asarray(z) + self.half_z) / self.floor_res, 0, self.nz - 1.001)
        x0, z0 = np.floor(fx).astype(int), np.floor(fz).astype(int)
        tx, tz = fx - x0, fz - z0
        f = self.floor
        a = f[z0, x0] + (f[z0, x0 + 1] - f[z0, x0]) * tx
        b = f[z0 + 1, x0] + (f[z0 + 1, x0 + 1] - f[z0 + 1, x0]) * tx
        return a + (b - a) * tz

    # ----- SDF --------------------------------------------------------------------------------------
    def sd_rock(self, p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        d = np.full(len(p), 1e9)
        for prim in self.positives:
            d = np.minimum(d, _eval_prim(p, prim))
        if self.holes:
            h = np.full(len(p), 1e9)
            for prim in self.holes:
                h = np.minimum(h, _eval_prim(p, prim))
            d = np.maximum(d, -h)
        return d

    def sd_floor(self, p: np.ndarray) -> np.ndarray:
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        # Height difference scaled by the slope bound keeps it a conservative distance estimate.
        return (p[:, 1] - self.floor_height(p[:, 0], p[:, 2])) * 0.7

    def sd_solid(self, p: np.ndarray) -> np.ndarray:
        """Distance to rock or floor; negative inside. Does not include the glass walls."""
        return np.minimum(self.sd_rock(p), self.sd_floor(p))

    def sd_walls(self, p: np.ndarray) -> np.ndarray:
        """Distance to the nearest of glass walls, glass bottom and water surface (positive inside water)."""
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        return np.minimum.reduce([self.half_x - np.abs(p[:, 0]), self.half_z - np.abs(p[:, 2]),
                                  -p[:, 1], p[:, 1] + self.depth])

    def gradient(self, p: np.ndarray, eps: float = 0.25) -> np.ndarray:
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        n = len(p)
        offs = np.array([[eps, 0, 0], [-eps, 0, 0], [0, eps, 0], [0, -eps, 0], [0, 0, eps], [0, 0, -eps]])
        d = self.sd_fast((p[:, None, :] + offs[None, :, :]).reshape(-1, 3)).reshape(n, 6)
        g = np.stack([d[:, 0] - d[:, 1], d[:, 2] - d[:, 3], d[:, 4] - d[:, 5]], axis=1)
        return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)

    # ----- sampled distance grid (fast path for steering and sight) ----------------------------------
    def build_grid(self, res: float = 0.5) -> None:
        nx = int(math.ceil(2 * self.half_x / res)) + 1
        ny = int(math.ceil(self.depth / res)) + 1
        nz = int(math.ceil(2 * self.half_z / res)) + 1
        xs = np.linspace(-self.half_x, self.half_x, nx)
        ys = np.linspace(-self.depth, 0.0, ny)
        zs = np.linspace(-self.half_z, self.half_z, nz)
        grid = np.empty((nx, ny, nz), dtype=np.float32)
        Y, Z = np.meshgrid(ys, zs, indexing="ij")
        yz = np.stack([Y.ravel(), Z.ravel()], axis=1)
        for i, x in enumerate(xs):  # slab by slab keeps memory small
            pts = np.column_stack([np.full(len(yz), x), yz])
            grid[i] = self.sd_solid(pts).reshape(ny, nz).astype(np.float32)
        self._grid = grid
        self._grid_res = (2 * self.half_x / (nx - 1), self.depth / (ny - 1), 2 * self.half_z / (nz - 1))
        self._grid_origin = np.array([-self.half_x, -self.depth, -self.half_z])
        self._grid_inv = 1.0 / np.asarray(self._grid_res)
        self._grid_hi = np.array(grid.shape, dtype=float) - 1.001
        self._grid_flat = grid.ravel()
        self._grid_sy, self._grid_sz = ny, nz
        # corner order: x0/x1 major, then y, then z  ->  index (x*ny + y)*nz + z
        self._grid_offs = np.array([(dx * ny + dy) * nz + dz for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)])

    def sd_fast(self, p: np.ndarray) -> np.ndarray:
        """Trilinear lookup of the sampled solid distance (falls back to the exact SDF before build_grid)."""
        g = getattr(self, "_grid", None)
        p = np.atleast_2d(np.asarray(p, dtype=np.float64))
        if g is None:
            return self.sd_solid(p)
        f = (p - self._grid_origin) * self._grid_inv
        np.clip(f, 0.0, self._grid_hi, out=f)
        i0 = f.astype(np.intp)
        t = f - i0
        base = (i0[:, 0] * self._grid_sy + i0[:, 1]) * self._grid_sz + i0[:, 2]
        c = self._grid_flat[base[:, None] + self._grid_offs[None, :]]      # (N, 8): xyz corners
        tx, ty, tz = t[:, 0:1], t[:, 1:2], t[:, 2:3]
        cx = c[:, 0:4] + (c[:, 4:8] - c[:, 0:4]) * tx                      # x interpolated: (y,z) corners
        cy = cx[:, 0:2] + (cx[:, 2:4] - cx[:, 0:2]) * ty
        return (cy[:, 0] + (cy[:, 1] - cy[:, 0]) * tz[:, 0]).astype(np.float64)

    # ----- sight ------------------------------------------------------------------------------------
    def line_of_sight(self, a: np.ndarray, b: np.ndarray, clearance: float = 0.05, steps: int = 32) -> np.ndarray:
        """True where the segment a->b does not pass through rock or floor. a, b: (N, 3)."""
        a = np.atleast_2d(np.asarray(a, dtype=np.float64))
        b = np.atleast_2d(np.asarray(b, dtype=np.float64))
        n = len(a)
        if n == 0:
            return np.zeros(0, dtype=bool)
        d = b - a
        length = np.linalg.norm(d, axis=1)
        u = d / np.maximum(length, 1e-9)[:, None]
        t = np.full(n, 0.0)
        clear = np.ones(n, dtype=bool)
        active = length > 1e-6
        for _ in range(steps):
            if not active.any():
                break
            idx = np.nonzero(active)[0]
            pts = a[idx] + u[idx] * t[idx, None]
            dist = self.sd_fast(pts)
            hit = dist < clearance
            clear[idx[hit]] = False
            active[idx[hit]] = False
            t[idx] += np.maximum(dist, 0.08)
            done = t[idx] >= length[idx]
            active[idx[done]] = False
        # Rays that ran out of steps before reaching the end: treat as clear only if the end is open.
        return clear

    # ----- description ------------------------------------------------------------------------------
    def describe(self) -> dict:
        return {
            "seed": self.seed, "half_x": self.half_x, "half_z": self.half_z, "depth": self.depth,
            "floor": {"res": self.floor_res, "nx": self.nx, "nz": self.nz,
                      "origin": [-self.half_x, -self.half_z]},
            "positives": self.positives, "holes": self.holes, "shelters": self.shelters,
            "passages": self.passages, "kelp": self.kelp, "light_depth": self.light_depth,
        }

    def floor_bytes(self) -> bytes:
        return self.floor.astype("<f4").tobytes()


def build_tank(seed: int = 7) -> Tank:
    """The default aquarium layout. Structure is fixed; seed varies floor relief and boulder scatter."""
    rng = np.random.default_rng(seed)
    t = Tank(seed=seed)
    nx = int(round(2 * t.half_x / t.floor_res)) + 1
    nz = int(round(2 * t.half_z / t.floor_res)) + 1
    xs = np.linspace(-t.half_x, t.half_x, nx)
    zs = np.linspace(-t.half_z, t.half_z, nz)
    X, Z = np.meshgrid(xs, zs)
    noise = _value_noise(rng, nx, nz, cell=14.0)
    h = -27.0 + 2.2 * noise
    # Sand basin in the middle, terraces rising towards the glass so the bottom edge reads as relief.
    edge = np.minimum((t.half_x - np.abs(X)) / 10.0, (t.half_z - np.abs(Z)) / 8.0)
    h += 3.0 * (1.0 - np.clip(edge, 0.0, 1.0)) ** 2
    basin = np.exp(-((X - 4.0) ** 2 / 300.0 + (Z - 2.0) ** 2 / 120.0))
    h -= 1.2 * basin
    t.floor = np.clip(h, -t.depth + 0.5, -18.0)

    def ground(x, z):
        return float(t.floor_height(np.array([x]), np.array([z]))[0])

    P, H = t.positives, t.holes

    # 1. Grotto: hollow rock with a narrow and a medium entrance.
    gc = [-22.0, ground(-22.0, -10.0) + 2.5, -10.0]
    P.append({"type": "ellipsoid", "c": gc, "r": [9.0, 6.5, 7.0], "yaw": 0.3, "name": "grotto"})
    H.append({"type": "ellipsoid", "c": [gc[0], gc[1] + 0.6, gc[2]], "r": [6.0, 4.0, 4.4], "yaw": 0.3})
    # Narrow entrance (fits small fish only) towards +x, medium entrance (no sharks) towards +z.
    H.append({"type": "capsule", "a": [gc[0] + 4.0, gc[1] + 0.5, gc[2] + 1.2],
              "b": [gc[0] + 10.5, gc[1] + 1.0, gc[2] + 3.5], "r": 0.55, "name": "grotto_narrow"})
    H.append({"type": "capsule", "a": [gc[0] - 1.0, gc[1] + 0.8, gc[2] + 3.0],
              "b": [gc[0] - 3.0, gc[1] + 1.2, gc[2] + 9.0], "r": 1.25, "name": "grotto_wide"})
    t.shelters.append({"c": [gc[0], gc[1] + 0.3, gc[2]], "r": 4.0, "kind": "grotto"})
    t.passages.append({"name": "grotto_narrow", "width": 1.1,
                       "a": [gc[0] + 1.0, gc[1] + 0.5, gc[2] + 0.2], "b": [gc[0] + 12.0, gc[1] + 1.1, gc[2] + 4.0]})

    # 2. Reef ridge with a crevice 1.0 m wide.
    ridge_z = -15.0
    for i, x in enumerate(np.linspace(6.0, 31.0, 7)):
        if 15.0 < x < 24.0:
            continue
        rr = [3.2 + rng.uniform(0, 1.2), 3.0 + rng.uniform(0, 2.5), 3.0]
        P.append({"type": "ellipsoid", "c": [float(x), ground(x, ridge_z) + rr[1] * 0.4, ridge_z + rng.uniform(-1, 1)],
                  "r": rr, "yaw": float(rng.uniform(-0.4, 0.4)), "name": f"ridge{i}"})
    # Crevice walls: two boxes 1.0 m apart (gap along x at x = 19.5).
    for side in (-1, 1):
        cx = 19.5 + side * (0.5 + 1.6)
        P.append({"type": "box", "c": [cx, ground(cx, ridge_z) + 2.6, ridge_z], "h": [1.6, 4.0, 3.2],
                  "yaw": 0.0, "round": 0.4, "name": f"crevice{side}"})
    cy = ground(19.5, ridge_z) + 1.6
    t.shelters.append({"c": [19.5, cy, ridge_z], "r": 1.6, "kind": "crevice"})
    t.passages.append({"name": "crevice", "width": 1.0,
                       "a": [19.5, cy, ridge_z - 6.0], "b": [19.5, cy, ridge_z + 6.0]})

    # 3. Arch: capsule chain along a half circle.
    ac, ar = np.array([8.0, 0.0, 10.0]), 6.0
    base_y = ground(8.0, 10.0)
    pts = [[ac[0] + ar * math.cos(a), base_y + ar * math.sin(a) * 1.1, ac[2]] for a in np.linspace(0, math.pi, 9)]
    for i in range(len(pts) - 1):
        P.append({"type": "capsule", "a": pts[i], "b": pts[i + 1], "r": 1.4, "name": "arch"})

    # 4. Pinnacle rising towards the light.
    px, pz = 27.0, 14.0
    P.append({"type": "capsule", "a": [px, ground(px, pz) - 1.0, pz], "b": [px + 1.0, -9.0, pz - 0.5], "r": 2.2,
              "name": "pinnacle"})
    P.append({"type": "ellipsoid", "c": [px - 1.5, ground(px, pz) + 1.0, pz + 1.5], "r": [4.0, 3.0, 3.5],
              "name": "pinnacle_base"})

    # 5. Ledge with an overhang against the back glass.
    lx, lz = -6.0, -21.5
    P.append({"type": "box", "c": [lx, ground(lx, lz) + 5.0, lz], "h": [7.0, 1.0, 3.0], "yaw": 0.08, "round": 0.6,
              "name": "ledge"})
    P.append({"type": "box", "c": [lx - 5.0, ground(lx - 5, lz) + 2.0, lz - 0.5], "h": [1.5, 3.5, 2.0],
              "round": 0.6, "name": "ledge_post"})
    t.shelters.append({"c": [lx, ground(lx, lz) + 2.2, lz + 1.0], "r": 2.5, "kind": "overhang"})

    # 6. Boulders scattered in the open, kept off the structures above.
    placed = 0
    tries = 0
    while placed < 10 and tries < 200:
        tries += 1
        x, z = float(rng.uniform(-34, 34)), float(rng.uniform(-20, 20))
        c = np.array([[x, ground(x, z) + 0.5, z]])
        if t.sd_rock(c)[0] < 5.0:
            continue
        r = float(rng.uniform(0.9, 2.4))
        P.append({"type": "ellipsoid", "c": [x, ground(x, z) + r * 0.3, z],
                  "r": [r * rng.uniform(1.0, 1.5), r * rng.uniform(0.6, 0.9), r], "yaw": float(rng.uniform(0, 3.1)),
                  "name": "boulder"})
        placed += 1
        if r > 1.7:
            for ang in np.linspace(0, 2 * math.pi, 8, endpoint=False):
                sx, sz = x + math.cos(ang) * r * 1.9, z + math.sin(ang) * r * 1.9
                sp = [sx, ground(sx, sz) + 0.7, sz]
                sd = float(t.sd_solid(np.array([sp]))[0])
                if 0.3 < sd < 1.3:
                    t.shelters.append({"c": sp, "r": 1.2, "kind": "boulder"})
                    break

    # Kelp patches for the renderer (decor only, no collision).
    for c, r in (((-30.0, 14.0), 7.0), ((-8.0, 6.0), 5.0), ((30.0, -2.0), 6.0), ((-2.0, -12.0), 4.0)):
        t.kelp.append({"c": list(c), "r": r})
    return t
