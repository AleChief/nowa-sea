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


def test_waking_starts_a_fresh_decision_interval():
    """sleep(duration) already advanced the core over the night: the first waking decision must not count the night
    as time awake, and rewards gathered asleep must not go to the action chosen before sleep."""
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(brain_kind="stub", scale=0.25), pool)
    slot = next(s for s in sim.slot_of.values() if sim.sp[s] == BY_ID["sparkfin"].index)
    sim.time = 5000.0
    sim.sleeping[slot] = True
    sim.last_decide[slot] = 4000.0
    sim.reward[slot] = 0.7
    sim._sleep_schedule(0.4)                    # mid-day: outside the sparkfin sleep window, so it wakes
    assert not sim.sleeping[slot]
    assert sim.last_decide[slot] == sim.time
    assert sim.reward[slot] == 0.0


def test_elders_give_way_to_a_new_generation():
    """A cohort that filled the ceiling together must still be able to breed once it grows old; otherwise it dies
    of old age together and the species goes extinct (shades did)."""
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(brain_kind="stub", scale=1.0), pool)
    s = BY_ID["shade"]
    cap = sim.cap(s)
    while sim.count("shade") < cap:
        sim.spawn("shade")
    shades = [k for k in sim.slot_of.values() if sim.sp[k] == s.index]
    full, crowd = sim._crowding(s)
    assert full and crowd == 1.0                       # young cohort at the ceiling: no room
    for k in shades:
        sim.age[k] = 0.9 * sim.lifespan[k]             # the whole cohort is old now
    full, crowd = sim._crowding(s)
    assert not full and crowd == 0.0                   # elders give way: breeding is possible again
