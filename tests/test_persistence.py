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
