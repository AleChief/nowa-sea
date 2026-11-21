"""The aquarium continues where it stopped: autosave on shutdown, resume on the next start."""

import time

from nowasea.server.sim_source import AUTOSAVE, SimSource


def test_shutdown_autosave_and_resume(tmp_path):
    src = SimSource(scale=0.1, workers=1, brain_kind="stub", saves_dir=str(tmp_path), autosave_min=15, resume=True)
    assert src.resumed_from is None
    src._handle({"t": "speed", "value": 10})
    t0 = src.sim.time
    src.start()
    deadline = time.time() + 60
    while src.sim.time - t0 < 20.0 and time.time() < deadline:   # wait for real progress, not a fixed sleep
        time.sleep(0.2)
    src.stop()
    assert src.sim.time - t0 >= 20.0
    assert (tmp_path / f"{AUTOSAVE}.zip").is_file()
    t_saved = src.sim.time
    ids = set(src.sim.slot_of)
    gens = src.sim.max_generation()

    again = SimSource(scale=0.1, workers=1, brain_kind="stub", saves_dir=str(tmp_path), autosave_min=15, resume=True)
    try:
        assert again.resumed_from == AUTOSAVE
        assert abs(again.sim.time - t_saved) < 1e-6
        assert set(again.sim.slot_of) == ids
        assert again.sim.max_generation() == gens
    finally:
        again.pool.close()

    fresh = SimSource(scale=0.1, workers=1, brain_kind="stub", saves_dir=str(tmp_path), autosave_min=15, resume=False)
    try:
        assert fresh.resumed_from is None
    finally:
        fresh.pool.close()


def test_learning_summary_shape():
    from nowasea.brains.pool import BrainPool
    from nowasea.ecosystem.sim import SimConfig, Simulation

    sim = Simulation(SimConfig(brain_kind="stub", scale=0.3), BrainPool(kind="stub", workers=0))
    for _ in range(int(600 / sim.cfg.dt)):
        sim.step()
    summary = sim.learning_summary()
    assert set(summary) == {"sparkfin", "sweeper", "needlejaw", "shade"}
    rows = summary["sparkfin"]
    assert rows and {"gen", "dead", "alive", "age_days", "reward", "catch", "escape", "eaten"} <= set(rows[0])
    assert sum(r["decisions"] for rows in summary.values() for r in rows) > 0
