"""Save -> new process state -> load: bodies identical, NOWA stable memory identical, world keeps running."""

import json

import numpy as np

from conftest import requires_nowa
from nowasea.brains.pool import BrainPool
from nowasea.ecosystem.sim import SimConfig, Simulation
from nowasea.persistence.saves import SaveStore, load_into


def _bodies(sim):
    out = {}
    for cid, slot in sim.slot_of.items():
        out[cid] = (sim.pos[slot].round(5).tolist(), sim.vel[slot].round(5).tolist(), round(float(sim.energy[slot]), 6),
                    round(float(sim.age[slot]), 4), int(sim.gen[slot]), list(sim.meta[slot]["parents"]),
                    int(sim.sp[slot]))
    return out


def _roundtrip(kind, tmp_path, steps=600):
    pool = BrainPool(kind=kind, workers=0)
    cfg = SimConfig(brain_kind=kind, scale=0.12, seed=3)
    sim = Simulation(cfg, pool)
    sim.time = 0.45 * 1200
    for _ in range(steps):
        sim.step()
    pool.wait_idle()
    store = SaveStore(tmp_path)
    info = store.save("t1", sim, pool)
    assert info["creatures"] == len(sim.slot_of)
    before = _bodies(sim)
    payload_before = pool.payloads()
    t_before = sim.time

    pool2 = BrainPool(kind=kind, workers=0)
    sim2, _ = load_into(lambda st: Simulation(SimConfig(**st["config"]), pool2, populate=False), pool2, store, "t1")
    assert abs(sim2.time - t_before) < 1e-9
    assert _bodies(sim2) == before
    payload_after = pool2.payloads()
    assert set(payload_after) == set(payload_before)
    for cid in payload_before:
        a = json.dumps(payload_before[cid], sort_keys=True, default=str)
        b = json.dumps(payload_after[cid], sort_keys=True, default=str)
        assert a == b, f"brain {cid} stable memory differs after load"
    for _ in range(200):
        sim2.step()
    assert not pool2.errors
    return sim2


def test_roundtrip_stub(tmp_path):
    _roundtrip("stub", tmp_path, steps=300)


@requires_nowa
def test_roundtrip_nowa(tmp_path):
    sim2 = _roundtrip("nowa", tmp_path, steps=600)
    assert sum(sim2.populations().values()) > 0


def test_save_listing_and_import(tmp_path):
    pool = BrainPool(kind="stub", workers=0)
    sim = Simulation(SimConfig(brain_kind="stub", scale=0.1), pool)
    store = SaveStore(tmp_path / "a")
    store.save("slot A", sim, pool)
    items = store.list()
    assert items and items[0]["slot"] == "slot A"
    data = store.path("slot A").read_bytes()
    other = SaveStore(tmp_path / "b")
    other.import_bytes("copy", data)
    assert other.list()[0]["slot"] == "copy"


def test_failed_load_keeps_the_running_world(tmp_path):
    """A damaged save must not destroy the world that is running (review P0-1)."""
    import zipfile

    from nowasea.server.sim_source import SimSource

    src = SimSource(scale=0.1, workers=1, brain_kind="stub", saves_dir=str(tmp_path))
    try:
        for _ in range(40):
            src.sim.step()
        ids_before = set(src.sim.slot_of)
        brains_before = len(src.pool.assign)
        # A zip with a manifest but no world.json.
        bad = tmp_path / "broken.zip"
        with zipfile.ZipFile(bad, "w") as z:
            z.writestr("manifest.json", json.dumps({"format": "nowa-sea-save", "version": 1, "brain_kind": "stub"}))
        reply = None
        try:
            src._handle({"t": "load", "slot": "broken"})
        except ValueError as exc:
            reply = str(exc)
        assert reply and "world.json" in reply
        assert set(src.sim.slot_of) == ids_before
        assert len(src.pool.assign) == brains_before
        # A save made with other brains is refused before anything is touched.
        src.store.save("stubworld", src.sim, src.pool)
        try:
            src.store.validate("stubworld", "nowa")
            raise AssertionError("brain kind mismatch not detected")
        except ValueError as exc:
            assert "stub" in str(exc)
    finally:
        src.pool.close()


@requires_nowa
def test_nowa_brains_in_worker_processes_roundtrip(tmp_path):
    """NOWA brains living in a worker process: decide, sleep, save, reload in a fresh pool, same memory."""
    import random

    from nowasea.brains import nowa_adapter as na

    spec = na.BrainSpec("t", ["forage", "flee", "hide", "rest"], wake_interval_s=300.0)
    rng = random.Random(1)
    pool = BrainPool(kind="nowa", workers=1)
    try:
        for cid in (1, 2):
            pool.create(cid, spec, genome=na.random_genome(rng), seed=cid)
        executed = {1: None, 2: None}
        for i in range(120):
            reqs = [(cid, [rng.choice(["threat:near", "threat:none"]), "food:far"], executed[cid],
                     None if executed[cid] is None else rng.uniform(-0.5, 0.5), 1.0, 0.1, 0.0, None)
                    for cid in (1, 2)]
            pool.submit(reqs)
            pool.wait_idle(30)
            for cid, action, *_ in pool.take_answers():
                executed[cid] = action or executed[cid]
            if i == 60:
                for cid in (1, 2):
                    pool.sleep(cid, 3, 300.0)
                import time

                deadline = time.time() + 60
                while len(pool.sleep_ms) < 2 and time.time() < deadline:
                    pool.poll()
                    time.sleep(0.05)
        before = pool.payloads()
        states = pool.save_all(tmp_path / "b")
    finally:
        pool.close()
    pool2 = BrainPool(kind="nowa", workers=1)
    try:
        for cid, hs in states.items():
            pool2.load(cid, spec, str(tmp_path / "b" / f"{cid}.nowa"), hs, seed=9)
        after = pool2.payloads()
        for cid in before:
            assert json.dumps(before[cid], sort_keys=True, default=str) == \
                json.dumps(after[cid], sort_keys=True, default=str)
        info = pool2.inspect(1)
        assert info["episodes"] > 0 and any(abs(v) > 1e-6 for v in info["affect"].values())
    finally:
        pool2.close()
