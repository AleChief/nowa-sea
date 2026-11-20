"""Tank geometry: sight is blocked by rock, narrow passages admit small bodies only."""

import numpy as np

from nowasea.brains.pool import BrainPool
from nowasea.ecosystem.sim import I, SimConfig, Simulation


def test_line_of_sight_blocked_by_rock_and_open_in_water(tank):
    grotto = next(p for p in tank.positives if p.get("name") == "grotto")
    c = np.array(grotto["c"])
    a = c + np.array([-14.0, 1.0, 0.0])
    b = c + np.array([14.0, 1.0, 0.0])
    assert not tank.line_of_sight(a[None], b[None])[0], "segment through the grotto rock must be blocked"
    open_a, open_b = np.array([[0.0, -6.0, 0.0]]), np.array([[12.0, -6.0, 3.0]])
    assert tank.line_of_sight(open_a, open_b)[0]


def test_passage_clearances(tank):
    for p in tank.passages:
        a, b = np.array(p["a"]), np.array(p["b"])
        pts = a + (b - a) * np.linspace(0, 1, 120)[:, None]
        clearance = tank.sd_solid(pts).min()
        assert clearance > 0.12 + 0.05, f"{p['name']}: small fish (r=0.12) must fit, clearance {clearance:.2f}"
        assert clearance < 0.85, f"{p['name']}: shade (r=0.85) must not fit, clearance {clearance:.2f}"


def _drive_through_crevice(species_id: str, seconds: float = 40.0) -> bool:
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(brain_kind="stub", repop_enabled=False), pool, populate=False)
    crevice = next(p for p in sim.tank.passages if p["name"] == "crevice")
    a, b = np.array(crevice["a"]), np.array(crevice["b"])
    cid = sim.spawn(species_id, pos=a, energy=1.0)
    slot = sim.slot_of[cid]
    sim.brain_ready[slot] = False                 # no brain: the motor layer is driven directly
    sim.sleeping[slot] = False
    sim.vel[slot] = (b - a) / np.linalg.norm(b - a) * 1.0
    sim.cfg.start_day_phase = 0.5
    sim.time = 0.5 * 1200
    went_through = False
    for _ in range(int(seconds / sim.cfg.dt)):
        sim.waypoint[slot] = b
        sim.intent[slot] = I["patrol" if species_id == "shade" else "explore"]
        sim.sleeping[slot] = False
        sim.step()
        p = sim.pos[slot]
        if abs(p[0] - b[0]) < 0.6 and abs(p[2] - (a[2] + b[2]) / 2) < 1.5:
            went_through = True
    return went_through


def test_crevice_admits_small_fish_and_blocks_shade():
    assert _drive_through_crevice("sparkfin"), "sparkfin should swim through the 1 m crevice"
    assert not _drive_through_crevice("shade"), "shade must not squeeze through the crevice"
