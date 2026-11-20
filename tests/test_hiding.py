"""A predator loses prey that slips into the grotto and gives up the chase (acceptance: >= 80 % of 20 runs)."""

import numpy as np

from nowasea.brains.pool import BrainPool
from nowasea.ecosystem.sim import I, SimConfig, Simulation


def _trial(seed: int) -> bool:
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(seed=7, brain_kind="stub", repop_enabled=False), pool, populate=False)
    sim.time = 0.5 * 1200          # midday: nobody sleeps
    rng = np.random.default_rng(seed)
    grotto = next(s for s in sim.tank.shelters if s["kind"] == "grotto")
    inside = np.array(grotto["c"])
    outside = inside + np.array([0.0, 1.0, 13.0]) + rng.normal(0, 0.8, 3) * [1, 0.3, 1]
    hunter = sim.spawn("needlejaw", pos=outside, energy=0.3)
    prey = sim.spawn("sparkfin", pos=outside + np.array([0.0, 0.0, -4.0]), energy=0.8)
    h, p = sim.slot_of[hunter], sim.slot_of[prey]
    sim.vel[h] = np.array([0.0, 0.0, -1.0])     # facing the prey
    sim.age[h] = sim.mature_age[h] + 1
    for _ in range(10):
        sim.step()
    sim.pos[p] = outside + np.array([0.0, 0.0, -4.0])
    sim.vel[h] = np.array([0.0, 0.0, -1.0])
    sim._perceive(1.0)
    if sim.prey_level[h] == 0:
        return False                              # setup failed: prey not seen in the open
    # The prey ducks into the grotto.
    sim.pos[p] = inside
    sim.vel[p] = 0.0
    lost_at = None
    for k in range(int(3.0 / sim.cfg.dt)):
        sim.pos[p] = inside
        sim.step()
        if sim.prey_level[h] == 0 and sim.target[h] < 0:
            lost_at = k * sim.cfg.dt
            break
    if lost_at is None:
        return False
    toks = sim.meta[h]["tokens"]
    # After losing it, the hunter is not chasing a live target any more.
    for _ in range(int(4.0 / sim.cfg.dt)):
        sim.pos[p] = inside
        sim.step()
    return "prey:none" in toks and sim.target[h] < 0


def test_predator_loses_hidden_prey():
    results = [_trial(seed) for seed in range(20)]
    assert sum(results) >= 16, f"lost target in {sum(results)}/20 runs"
