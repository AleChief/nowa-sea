"""Save slots: one zip per slot with the world, every creature, and every NOWA brain.

    manifest.json   format, version, summary
    world.json      simulation state (time, resources, history, archive, creatures' bodies)
    brains/<id>.nowa        NOWA agent state (written by the brain workers)
    brains/<id>.host.json   brain wrapper state (genome, epigenome, previous tokens)
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import tempfile
import zipfile
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from nowasea import REPO_ROOT
from nowasea.ecosystem.species import BY_ID, SPECIES

FORMAT = "nowa-sea-save"
VERSION = 1

# Per-slot arrays saved for every living creature.
ARRAYS = ["cid", "sp", "pos", "vel", "energy", "stamina", "age", "lifespan", "mature_age", "intent", "burst",
          "sleeping", "in_cover", "glow", "target", "target_seen", "target_pos", "threat_vec", "threat_seen",
          "threat_level", "prey_level", "waypoint", "home", "food_dir", "school_c", "school_v", "school_n", "mate",
          "last_decide", "reward", "cooldown", "gen", "children", "speed_g", "vision_g", "metab_g", "brain_ready",
          "decisions", "strike_cd", "digest", "attempts", "catches", "encounters", "escapes", "in_encounter",
          "reward_sum", "reward_n", "q_counts", "last_threat_d", "last_prey_d"]
SLOT_REFS = {"target", "mate"}   # slot indices that must be remapped through creature ids

_SLOT_RE = re.compile(r"^[\w\-. ]{1,64}$")
RESTORE_SLOT = "_before_load"


def clean_slot(slot: str) -> str:
    slot = (slot or "").strip()
    if not _SLOT_RE.match(slot) or slot.startswith("."):
        raise ValueError(f"bad slot name: {slot!r}")
    return slot


def _nowa_commit() -> Optional[str]:
    try:
        return json.loads((REPO_ROOT / "nowa.lock").read_text(encoding="utf-8")).get("commit")
    except Exception:  # noqa: BLE001
        return None


def _jsonable(v):
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def sim_state(sim) -> dict:
    alive = np.nonzero(sim.alive)[0]
    cid_of_slot = {int(s): int(sim.cid[s]) for s in alive}
    creatures = []
    for slot in alive:
        rec = {}
        for name in ARRAYS:
            v = getattr(sim, name)[slot]
            if name in SLOT_REFS:
                v = cid_of_slot.get(int(v), 0) if int(v) >= 0 else 0
            rec[name] = _jsonable(v)
        m = dict(sim.meta[int(slot)])
        m.pop("urgent", None)
        rec["meta"] = m
        creatures.append(rec)
    return {
        "config": asdict(sim.cfg),
        "time": sim.time, "steps": sim.steps, "next_id": sim.next_id,
        "births": sim.births, "deaths": sim.deaths, "extinct_since": sim.extinct_since,
        "deaths_sp": sim.deaths_sp, "births_sp": sim.births_sp, "gen_stats": sim.gen_stats,
        "lineage": list(sim.lineage.values()),
        "insights": sim.insights.to_state(alive),
        "history": sim.history, "last_history": sim._last_history, "archive": sim.archive,
        "selected": sim.selected, "tank_seed": sim.tank.seed,
        "plankton": sim.plankton.to_state(), "particles": sim.particles.to_state(),
        "rng": sim.rng.bit_generator.state, "prng": sim.prng.getstate(),
        "creatures": creatures,
    }


def restore_sim(sim, state: dict) -> None:
    """Fill an empty Simulation (populate=False) with a saved state. Brains are loaded separately."""
    sim.time = float(state["time"])
    sim.steps = int(state["steps"])
    sim.next_id = int(state["next_id"])
    sim.births = int(state["births"])
    sim.deaths = dict(state["deaths"])
    sim.deaths_sp.update({k: dict(v) for k, v in state.get("deaths_sp", {}).items()})
    sim.births_sp.update(state.get("births_sp", {}))
    sim.gen_stats.update({k: dict(v) for k, v in state.get("gen_stats", {}).items()})
    sim.lineage = {int(r["id"]): dict(r) for r in state.get("lineage", [])}
    sim.insights.load_state(state.get("insights"))
    sim.extinct_since = {k: float(v) for k, v in state["extinct_since"].items()}
    sim.history = state["history"]
    sim._last_history = float(state.get("last_history", sim.time))
    sim.archive = {s.id: list(state["archive"].get(s.id, [])) for s in SPECIES}
    sim.selected = int(state.get("selected", 0))
    sim.plankton.load_state(state["plankton"])
    sim.particles.load_state(state["particles"])
    sim.rng.bit_generator.state = state["rng"]
    p = state["prng"]
    sim.prng.setstate((p[0], tuple(p[1]), p[2]))
    sim.alive[:] = False
    sim.meta.clear()
    sim.slot_of.clear()
    for slot, rec in enumerate(state["creatures"]):
        for name in ARRAYS:
            if name in SLOT_REFS or name not in rec:
                continue
            arr = getattr(sim, name)
            arr[slot] = np.asarray(rec[name], dtype=arr.dtype)
        sim.alive[slot] = True
        sim.meta[slot] = dict(rec["meta"])
        sim.slot_of[int(rec["cid"])] = slot
    for slot, rec in enumerate(state["creatures"]):
        for name in SLOT_REFS:
            ref = int(rec[name])
            getattr(sim, name)[slot] = sim.slot_of.get(ref, -1) if ref else -1


class SaveStore:
    def __init__(self, directory: Optional[Path] = None):
        self.dir = Path(directory) if directory else (Path.cwd() / "saves")
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, slot: str) -> Path:
        return self.dir / f"{clean_slot(slot)}.zip"

    def list(self) -> List[dict]:
        out = []
        for f in sorted(self.dir.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                with zipfile.ZipFile(f) as z:
                    man = json.loads(z.read("manifest.json"))
                if man.get("format") != FORMAT:
                    continue
                out.append({"slot": f.stem, "saved_at": man.get("saved_at"), "sim_time": man.get("sim_time"),
                            "creatures": man.get("creatures"), "size": f.stat().st_size,
                            "populations": man.get("populations", {})})
            except Exception:  # noqa: BLE001
                continue
        return out

    def delete(self, slot: str) -> bool:
        p = self.path(slot)
        if p.is_file():
            p.unlink()
            return True
        return False

    def validate(self, slot: str, brain_kind: Optional[str] = None) -> dict:
        """Check a slot without touching the running world: format, world.json, every brain file present.

        Raises ValueError with a readable reason. Returns the manifest.
        """
        path = self.path(slot)
        if not path.is_file():
            raise FileNotFoundError(f"no save {slot!r}")
        try:
            with zipfile.ZipFile(path) as z:
                names = set(z.namelist())
                manifest = json.loads(z.read("manifest.json"))
                if manifest.get("format") != FORMAT or int(manifest.get("version", 0)) > VERSION:
                    raise ValueError("not a NOWA Sea save, or saved by a newer version")
                if "world.json" not in names:
                    raise ValueError("world.json is missing")
                state = json.loads(z.read("world.json"))
        except zipfile.BadZipFile as exc:
            raise ValueError(f"damaged file: {exc}") from exc
        kind = manifest.get("brain_kind", "nowa")
        if brain_kind and kind != brain_kind:
            raise ValueError(f"saved with '{kind}' brains, the server runs '{brain_kind}' (start it with --brain {kind})")
        missing = [int(r["cid"]) for r in state.get("creatures", []) if SPECIES[int(r["sp"])].brain == "nowa"
                   and (f"brains/{int(r['cid'])}.nowa" not in names or f"brains/{int(r['cid'])}.host.json" not in names)]
        if missing:
            raise ValueError(f"{len(missing)} brain file(s) missing, e.g. #{missing[0]}")
        return manifest

    def quarantine(self, slot: str) -> Optional[Path]:
        """Move a slot that failed to load out of the way (kept for inspection)."""
        path = self.path(slot)
        if not path.is_file():
            return None
        dest = path.with_name(f"{path.stem}.broken-{dt.datetime.now():%Y%m%d-%H%M%S}.zip")
        path.replace(dest)
        return dest

    def save(self, slot: str, sim, pool) -> dict:
        """Pause the caller's loop before calling: brains and world must be a consistent cut."""
        target = self.path(slot)
        with tempfile.TemporaryDirectory(prefix="nowasea-save-") as tmp:
            tmp = Path(tmp)
            brains_dir = tmp / "brains"
            pool.wait_idle()
            sim._apply_answers()                 # answers that arrived while waiting belong to this cut
            host_states = pool.save_all(brains_dir)
            state = sim_state(sim)
            manifest = {
                "format": FORMAT, "version": VERSION, "saved_at": dt.datetime.now().isoformat(timespec="seconds"),
                "sim_time": sim.time, "creatures": len(state["creatures"]), "brain_kind": sim.cfg.brain_kind,
                "nowa_commit": _nowa_commit(), "populations": sim.populations(),
            }
            partial = target.with_suffix(".zip.part")
            with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                z.writestr("manifest.json", json.dumps(manifest, indent=2))
                z.writestr("world.json", json.dumps(state, default=_jsonable))
                for cid, hs in host_states.items():
                    z.write(brains_dir / f"{cid}.nowa", f"brains/{cid}.nowa")
                    z.writestr(f"brains/{cid}.host.json", json.dumps(hs, default=_jsonable))
            if slot == "autosave" and target.is_file():
                target.replace(target.with_name("autosave.prev.zip"))   # one generation of insurance
            partial.replace(target)
        return {"slot": target.stem, "size": target.stat().st_size, **manifest}

    def read(self, slot: str):
        """Returns (manifest, world_state, extract_dir). Caller removes extract_dir."""
        path = self.path(slot)
        if not path.is_file():
            raise FileNotFoundError(f"no save {slot!r}")
        tmp = Path(tempfile.mkdtemp(prefix="nowasea-load-"))
        with zipfile.ZipFile(path) as z:
            manifest = json.loads(z.read("manifest.json"))
            if manifest.get("format") != FORMAT or int(manifest.get("version", 0)) > VERSION:
                raise ValueError("not a NOWA Sea save, or saved by a newer version")
            for name in z.namelist():
                if name.startswith("brains/") and ".." not in name and not name.startswith("/"):
                    z.extract(name, tmp)
            state = json.loads(z.read("world.json"))
        return manifest, state, tmp

    def import_bytes(self, slot: str, data: bytes) -> dict:
        slot = clean_slot(slot)
        tmp = self.dir / f".{slot}.import"
        tmp.write_bytes(data)
        try:
            with zipfile.ZipFile(tmp) as z:
                man = json.loads(z.read("manifest.json"))
                if man.get("format") != FORMAT:
                    raise ValueError("not a NOWA Sea save")
                z.testzip()
            tmp.replace(self.path(slot))
        finally:
            if tmp.exists():
                tmp.unlink()
        return {"slot": slot, **man}


def load_into(sim_factory, pool, store: SaveStore, slot: str):
    """Build a new Simulation from a slot: world state + every brain reloaded in the pool."""
    manifest, state, tmp = store.read(slot)
    try:
        sim = sim_factory(state)
        from nowasea.ecosystem.sim import I  # noqa: F401
        restore_sim(sim, state)
        for slot_i, rec in enumerate(state["creatures"]):
            s = SPECIES[int(rec["sp"])]
            if s.brain != "nowa":
                continue
            cid = int(rec["cid"])
            host = json.loads((tmp / "brains" / f"{cid}.host.json").read_text(encoding="utf-8"))
            frozen = (rec.get("meta") or {}).get("caste") == "frozen"
            spec = (sim.specs_frozen if frozen else sim.specs)[s.id]
            pool.load(cid, spec, str(tmp / "brains" / f"{cid}.nowa"), host, seed=int(sim.prng.randrange(1 << 30)))
        pool.poll()
        # Wait until every brain is created before the files go away.
        import time

        deadline = time.time() + 600
        want = {int(r["cid"]) for r in state["creatures"] if SPECIES[int(r["sp"])].brain == "nowa"}
        while not want.issubset(pool.created):
            if pool.errors:
                raise RuntimeError(pool.errors.pop(0))
            if time.time() > deadline:
                raise TimeoutError("brains did not load")
            pool.poll()
            time.sleep(0.01)
        return sim, manifest
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
