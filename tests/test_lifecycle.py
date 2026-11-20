"""Extinction triggers the timer and a founder group; the stub ecosystem runs without errors."""

from nowasea.brains.pool import BrainPool
from nowasea.ecosystem.sim import SimConfig, Simulation
from nowasea.ecosystem.species import BY_ID


def test_extinction_then_repopulation():
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(brain_kind="stub", scale=0.25, repop_delay_s=20.0), pool)
    for slot in list(sim.slot_of.values()):
        if sim.sp[slot] == BY_ID["needlejaw"].index:
            sim.kill(slot, "removed")
    assert sim.count("needlejaw") == 0
    for _ in range(sim.cfg.perceive_every):     # slow processes (life cycle, repopulation) run at 4 Hz
        sim.step()
    assert "needlejaw" in sim.extinct_since
    for _ in range(int(10 / sim.cfg.dt)):
        sim.step()
    assert sim.count("needlejaw") == 0, "must wait for the timer"
    for _ in range(int(15 / sim.cfg.dt)):
        sim.step()
    assert sim.count("needlejaw") >= 2
    kinds = [e["kind"] for e in sim.events]
    assert "extinct" in kinds and "repopulate" in kinds


def test_stub_ecosystem_runs_and_breeds():
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(brain_kind="stub", scale=0.5), pool)
    for _ in range(int(900 / sim.cfg.dt)):      # 15 simulated minutes
        sim.step()
    assert sim.births > 0
    assert sum(sim.populations().values()) > 0
    assert not pool.errors
