"""Binary frame encoders (docs/protocol.md)."""

from __future__ import annotations

import struct

import numpy as np

PROTOCOL = 1

CREATURE_DTYPE = np.dtype([
    ("id", "<u4"), ("species", "u1"), ("intent", "u1"), ("flags", "u1"), ("glow", "u1"),
    ("pos", "<f4", 3), ("vel", "<f4", 3), ("scale", "<f4"), ("energy", "<f4"),
])
PARTICLE_DTYPE = np.dtype([("pos", "<f4", 3), ("kind", "u1"), ("size", "u1"), ("reserved", "<u2")])
assert CREATURE_DTYPE.itemsize == 40 and PARTICLE_DTYPE.itemsize == 16

FLAG_SLEEP, FLAG_BURST, FLAG_EAT, FLAG_COVER, FLAG_SELECTED = 1, 2, 4, 8, 16
PARTICLE_FOOD, PARTICLE_DETRITUS, PARTICLE_CARCASS = 0, 1, 2

_HEADER = struct.Struct("<BBHIdffffHH")
assert _HEADER.size == 36


def state_frame(seq: int, sim_time: float, speed_set: float, speed_achieved: float, day_phase: float,
                light: float, creatures: np.ndarray, particles: np.ndarray, selected: int = 0,
                paused: bool = False, turbo: bool = False) -> bytes:
    flags = (1 if paused else 0) | (2 if turbo else 0)
    head = _HEADER.pack(1, flags, len(creatures), seq & 0xFFFFFFFF, float(sim_time), float(speed_set),
                        float(speed_achieved), float(day_phase), float(light), len(particles), selected & 0xFFFF)
    return head + creatures.astype(CREATURE_DTYPE, copy=False).tobytes() + \
        particles.astype(PARTICLE_DTYPE, copy=False).tobytes()


def plankton_frame(density: np.ndarray) -> bytes:
    """density: (ny, nz, nx) floats 0..1, iy from the floor up."""
    ny, nz, nx = density.shape
    body = np.clip(density * 255.0, 0, 255).astype(np.uint8).tobytes()
    return struct.pack("<BBHHH", 2, 0, nx, ny, nz) + body


def floor_frame(heights: np.ndarray) -> bytes:
    """heights: (nz, nx) float y values."""
    nz, nx = heights.shape
    return struct.pack("<BBHHH", 3, 0, nx, nz, 0) + heights.astype("<f4").tobytes()
