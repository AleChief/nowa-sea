"""The simulation thread behind the server: speed control, throttling on brains, frames, commands, saves."""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
import uuid
from concurrent.futures import Future
from pathlib import Path
from typing import Optional

from nowasea.brains.pool import BrainPool
from nowasea.ecosystem.sim import INTENTS, SimConfig, Simulation
from nowasea.ecosystem.species import BY_ID, DAY_S, SPECIES
from nowasea.persistence.saves import SaveStore, load_into
from nowasea.server import protocol as P
from nowasea.ecosystem.sim import day_phase, light_level

log = logging.getLogger("nowasea.sim")

SPEEDS = (0.0, 1.0, 2.0, 5.0, 10.0)
AUTOSAVE = "autosave"
FRAME_DT = 0.05            # publish creature frames at 20 Hz wall
MAX_LAG_SIM_S = 1.5        # brains may lag at most this much simulated time before the world waits
MAX_STEPS_PER_TICK = 60


def default_workers(scale: float = 1.0) -> int:
    """Brain processes for a population scale: 2 up to half the targets, 5 for the full aquarium.

    Measured on a 14-core laptop already ~30-50 % busy: full scale (≈60 NOWA agents) keeps ~10x with 4 workers,
    about 5x with 2. Never more than a quarter of the logical CPUs by default.
    """
    n = os.cpu_count() or 4
    want = 2 if scale <= 0.5 else 5
    return max(1, min(want, n // 4))


class SimSource:
    def __init__(self, seed: int = 7, scale: float = 1.0, workers: int = 0, saves_dir: Optional[str] = None,
                 load_slot: Optional[str] = None, speed: float = 1.0, brain_kind: str = "nowa",
                 hippocampus: Optional[int] = None, resume: bool = False, autosave_min: float = 0.0,
                 control_share: Optional[float] = None):
        self.brain_kind = brain_kind
        self.workers = workers or default_workers(scale)
        self.pool = BrainPool(kind=brain_kind, workers=self.workers)
        self.store = SaveStore(Path(saves_dir) if saves_dir else None)
        self.cfg = SimConfig(seed=seed, scale=scale, brain_kind=brain_kind)
        if hippocampus:
            self.cfg.hippocampus_capacity = int(hippocampus)
        if control_share is not None:
            self.cfg.control_share = min(0.9, max(0.0, float(control_share)))
        self.world_id = uuid.uuid4().hex[:8]
        self.speed = float(speed)
        self.turbo = False
        self.achieved = 0.0
        self.autosave_s = max(0.0, float(autosave_min)) * 60.0
        self.resumed_from: Optional[str] = None
        self._selected: set[int] = set()
        # The "eternal" aquarium: continue the last autosave unless told to start a new world.
        self.sim = None
        candidates = [load_slot] if load_slot else ([AUTOSAVE, "autosave.prev"] if resume else [])
        for slot in candidates:
            if not self.store.path(slot).is_file():
                continue
            try:
                self.store.validate(slot, self.brain_kind)
                self._load(slot)
                self.resumed_from = slot
                log.info("continuing world from save %r (sim day %.2f)", slot, self.sim.time / DAY_S)
                break
            except Exception as exc:  # noqa: BLE001
                if load_slot:
                    raise
                moved = self.store.quarantine(slot)
                log.error("could not continue from %r (%s); moved it to %s", slot, exc, moved)
                self.pool.reset()
                self.sim = None
        if self.sim is None:
            self.sim = Simulation(self.cfg, self.pool)
        self._last_autosave_sim = self.sim.time
        self._cmds: "queue.Queue[tuple[dict, Future]]" = queue.Queue()
        self._lock = threading.Lock()
        self._frame = b""
        self._plankton = P.plankton_frame(self.sim.plankton.rho)
        self._stats = {}
        self._insights = None
        self._inspect = {}
        self._events = []
        self._stop = False
        self._thread: Optional[threading.Thread] = None
        self.seq = 0
        self.lag_waits = 0
        self.debug_commands = bool(os.environ.get("NOWASEA_DEBUG_COMMANDS"))
        self.error: Optional[str] = None
        self._error_at = 0.0
        self._started_sim_time = self.sim.time

    # ----- interface used by the hub (any thread) -----------------------------------------------------
    def hello(self) -> dict:
        sim = self.sim
        return {"t": "hello", "protocol": P.PROTOCOL, "world_id": self.world_id, "tank": sim.tank.describe(),
                "species": [s.describe() for s in SPECIES], "intents": INTENTS, "day_s": DAY_S,
                "plankton": {"nx": sim.plankton.nx, "ny": sim.plankton.ny, "nz": sim.plankton.nz},
                "settings": self._settings(), "genes": self._genes()}

    def _genes(self):
        if self.brain_kind != "nowa":
            return []
        if not hasattr(self, "_gene_cache"):
            from nowasea.brains import nowa_adapter as na

            self._gene_cache = na.gene_registry()
        return self._gene_cache

    def floor_frame(self) -> bytes:
        return P.floor_frame(self.sim.tank.floor)

    def state_frame(self) -> bytes:
        with self._lock:
            return self._frame

    def plankton_frame(self) -> bytes:
        with self._lock:
            return self._plankton

    def stats(self) -> dict:
        with self._lock:
            return dict(self._stats) if self._stats else {"t": "stats", "pop": {}}

    def inspect(self, cid) -> Optional[dict]:
        if not cid:
            return None
        with self._lock:
            return self._inspect.get(int(cid))

    def insights(self) -> Optional[dict]:
        with self._lock:
            return self._insights

    def pop_events(self):
        with self._lock:
            ev, self._events = self._events, []
        return ev

    def command(self, msg: dict):
        """Called from a worker thread of the web server; executed on the simulation thread."""
        fut: Future = Future()
        self._cmds.put((msg, fut))
        return fut.result(timeout=900)

    def save_path(self, slot: str):
        try:
            return self.store.path(slot)
        except ValueError:
            return None

    def import_save(self, slot: str, data: bytes) -> dict:
        info = self.store.import_bytes(slot, data)
        return {"ok": True, **info}

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True, name="nowasea-sim")
        self._thread.start()

    def stop(self):
        self._stop = True
        if self._thread:
            self._thread.join(timeout=10)
        # Leave the world where it was: the next start continues from here.
        if self.autosave_s > 0 and self.sim is not None and self.sim.time - self._started_sim_time > 1.0 \
                and not self.error:
            try:
                info = self.store.save(AUTOSAVE, self.sim, self.pool)
                log.info("autosaved on shutdown (%d creatures, %.1f MB)", info["creatures"], info["size"] / 2**20)
            except Exception:  # noqa: BLE001
                log.exception("autosave on shutdown failed")
        self.pool.close()

    # ----- simulation thread ------------------------------------------------------------------------------
    def _run(self):
        """Keeps the thread alive on errors: a crash is reported in stats/toasts instead of a silent freeze."""
        while not self._stop:
            try:
                self._loop()
            except Exception as exc:  # noqa: BLE001
                log.exception("simulation loop crashed")
                self.error = f"{type(exc).__name__}: {exc}"
                with self._lock:
                    self._events.append({"t": "toast", "level": "error",
                                         "text": {"ru": f"Сбой симуляции: {self.error}",
                                                  "en": f"Simulation failure: {self.error}"}})
                    self._stats = {**self._stats, "error": self.error}
                self.speed = 0.0
                self.turbo = False
                self._error_at = time.time()
                time.sleep(1.0)

    def _loop(self):
        last = time.perf_counter()
        last_frame = 0.0
        last_stats = 0.0
        last_inspect = 0.0
        acc = 0.0
        ema_wall, ema_sim = 1e-6, 0.0
        while not self._stop:
            self._drain_commands()
            now = time.perf_counter()
            wall_dt = min(0.25, now - last)
            last = now
            sim = self.sim
            dt = sim.cfg.dt
            t0 = sim.time
            if self.turbo:
                deadline = now + 0.045
                while time.perf_counter() < deadline:
                    if not self._brains_keep_up(1e9):
                        break
                    sim.step()
                acc = 0.0
            elif self.speed > 0:
                acc += wall_dt * self.speed
                steps = 0
                while acc >= dt and steps < MAX_STEPS_PER_TICK:
                    if not self._brains_keep_up(self.speed):
                        break
                    sim.step()
                    acc -= dt
                    steps += 1
                acc = min(acc, dt * MAX_STEPS_PER_TICK)
            else:
                acc = 0.0
                sim.pool.poll()
            ema_wall = 0.9 * ema_wall + 0.1 * wall_dt
            ema_sim = 0.9 * ema_sim + 0.1 * (sim.time - t0)
            self.achieved = ema_sim / max(ema_wall, 1e-6)
            if self.autosave_s > 0 and sim.time - self._last_autosave_sim >= self.autosave_s:
                self._last_autosave_sim = sim.time
                try:
                    self.store.save(AUTOSAVE, sim, self.pool)
                except Exception:  # noqa: BLE001
                    log.exception("autosave failed")
            if now - last_frame >= (0.2 if self.turbo else FRAME_DT):
                last_frame = now
                self._publish()
            if now - last_inspect >= 1.0:
                last_inspect = now
                self._refresh_inspect()
            if now - getattr(self, "_last_insights", 0.0) >= 5.0:
                self._last_insights = now
                try:
                    ins = self.sim.insights.summary(self.sim)
                    with self._lock:
                        self._insights = ins
                except Exception:  # noqa: BLE001
                    log.exception("insights summary failed")
            if now - last_stats >= 1.0:
                last_stats = now
                if self.error and time.time() - self._error_at > 30.0:
                    self.error = None                # recovered: the loop has run cleanly for 30 s
                self._refresh_stats()
            spent = time.perf_counter() - now
            time.sleep(max(0.001, 0.01 - spent))

    def _brains_keep_up(self, speed: float) -> bool:
        """False when outstanding decisions are older than MAX_LAG_SIM_S of simulated time."""
        wall_age = self.sim.oldest_pending_s(time.time())
        if wall_age * max(speed, 1.0) > MAX_LAG_SIM_S and wall_age > 0.05:
            self.lag_waits += 1
            self.sim.pool.poll()
            return False
        return True

    def _publish(self):
        sim = self.sim
        sel = self._selected
        sim.selected = next(iter(sel), 0) if sel else 0
        phase = day_phase(sim.time)
        speed_set = self.achieved if self.turbo else self.speed
        frame = P.state_frame(self.seq, sim.time, speed_set, self.achieved, phase, light_level(phase),
                              sim.creature_array(), sim.particle_array(), selected=sim.selected,
                              paused=self.speed == 0 and not self.turbo, turbo=self.turbo)
        self.seq += 1
        plank = P.plankton_frame(sim.plankton.rho) if self.seq % 20 == 0 else None
        with self._lock:
            self._frame = frame
            if plank is not None:
                self._plankton = plank
            if sim.events:
                self._events.extend(sim.events[-50:])
                sim.events.clear()
                del self._events[:-200]            # nobody listening: keep only the recent ones

    def _refresh_inspect(self):
        out = {}
        sel = set(self._selected)
        for cid in sel:
            info = self.sim.describe_creature(cid)
            if info is None:
                self._selected = self._selected - {cid}
                continue
            if BY_ID[info["species"]].brain == "nowa":
                try:
                    brain = self.pool.inspect(cid)
                except Exception:  # noqa: BLE001
                    brain = None
                if brain:
                    info["brain"] = brain
                    info["mode"] = brain.get("mode") or info.get("mode", "")
                # The genome does not change during a life: fetch it once per creature.
                cache = self.__dict__.setdefault("_genome_cache", {})
                if cid not in cache:
                    try:
                        inh = self.pool.inheritance(cid) or {}
                        cache[cid] = {"genome": inh.get("genome"),
                                      "epigenome_size": len(((inh.get("epigenome") or {}).get("patterns")) or [])}
                    except Exception:  # noqa: BLE001
                        cache[cid] = None
                    if len(cache) > 200:
                        cache.pop(next(iter(cache)))
                if cache.get(cid):
                    info.update(cache[cid])
            out[cid] = info
        with self._lock:
            self._inspect = out

    def _refresh_stats(self):
        sim = self.sim
        extinct = {k: {"since": v, "respawn_in": max(0.0, sim.cfg.repop_delay_s - (sim.time - v))}
                   for k, v in sim.extinct_since.items()}
        stats = {"t": "stats", "time": sim.time, "day": sim.time / DAY_S, "pop": sim.populations(),
                 "history": sim.history[-360:], "births": sim.births, "deaths": sim.deaths, "extinct": extinct,
                 "births_species": sim.births_sp, "deaths_species": sim.deaths_sp,
                 "brains": {**self.pool.load_stats(), "lag_waits": self.lag_waits},
                 "speed": {"set": "turbo" if self.turbo else self.speed, "achieved": round(self.achieved, 2)},
                 "generation_max": sim.max_generation(), "plankton": round(float(sim.plankton.rho.mean()), 3),
                 "error": self.error, "learning": sim.learning_summary(), "resumed_from": self.resumed_from,
                 "particles": len(sim.particles), "settings": self._settings()}
        with self._lock:
            self._stats = stats

    def _settings(self) -> dict:
        c = self.sim.cfg
        return {"control_share": c.control_share,
                "repopulate": {"enabled": c.repop_enabled, "delay_s": c.repop_delay_s, "mode": c.repop_mode},
                "autosave_s": self.autosave_s, "scale": c.scale, "workers": self.workers, "brain": self.brain_kind}

    # ----- commands (simulation thread) ----------------------------------------------------------------
    def _drain_commands(self):
        while True:
            try:
                msg, fut = self._cmds.get_nowait()
            except queue.Empty:
                return
            try:
                fut.set_result(self._handle(msg))
            except Exception as exc:  # noqa: BLE001
                log.exception("command %s failed", msg.get("t"))
                fut.set_result({"t": "toast", "level": "error",
                                "text": {"ru": f"Ошибка: {exc}", "en": f"Error: {exc}"}})

    def _handle(self, msg: dict):
        t = msg.get("t")
        sim = self.sim
        if t == "speed":
            v = msg.get("value")
            if v == "turbo":
                self.turbo = True
            else:
                self.turbo = False
                self.speed = float(v) if float(v) in SPEEDS else 1.0
            return None
        if t == "select":
            cid = msg.get("id")
            self._selected = {int(cid)} if cid else set()
            return None
        if t == "feed":
            sim.feed(msg.get("pos") or [0.0, -1.0, 0.0], int(msg.get("n", 30)))
            return None
        if t == "spawn":
            sid = msg.get("species")
            if sid not in BY_ID:
                raise ValueError(f"unknown species {sid}")
            s = BY_ID[sid]
            if sim.count(sid) >= sim.cap(s) or not sim.has_room(s):
                return {"t": "toast", "level": "info", "text": {"ru": f"{s.name_ru}: достигнут потолок {sim.cap(s)}",
                                                                "en": f"{s.name_en}: cap {sim.cap(s)} reached"}}
            pos = sim.clamp_point(msg["pos"]) if msg.get("pos") is not None else None
            cid = sim.spawn(sid, pos=pos, energy=0.8, age_frac=0.2)
            return {"t": "spawned", "id": cid, "species": sid}
        if t == "heatmap":
            return sim.insights.heatmap(str(msg.get("species")))
        if t == "insights":
            return sim.insights.summary(sim)
        if t == "lineage":
            fam = sim.family(int(msg.get("id") or 0), int(msg.get("up", 4)), int(msg.get("down", 3)))
            return fam or {"t": "lineage", "id": msg.get("id"), "nodes": []}
        if t == "list_saves":
            return {"t": "saves", "items": self.store.list()}
        if t == "save":
            slot = msg.get("slot") or time.strftime("save-%Y%m%d-%H%M%S")
            t0 = time.perf_counter()
            info = self.store.save(slot, sim, self.pool)
            info["seconds"] = round(time.perf_counter() - t0, 2)
            return [{"t": "saved", **info}, {"t": "saves", "items": self.store.list()}]
        if t == "load":
            self.store.validate(msg["slot"], self.brain_kind)    # fails here without touching the world
            self._safe_load(msg["slot"])
            return [{"t": "hello"}, {"t": "toast", "level": "info",
                                     "text": {"ru": f"Загружено: {msg['slot']}", "en": f"Loaded: {msg['slot']}"}}]
        if t == "delete_save":
            self.store.delete(msg["slot"])
            return {"t": "saves", "items": self.store.list()}
        if t == "settings":
            rp = msg.get("repopulate") or {}
            if "enabled" in rp:
                sim.cfg.repop_enabled = bool(rp["enabled"])
            if "delay_s" in rp:
                sim.cfg.repop_delay_s = max(0.0, float(rp["delay_s"]))
            if rp.get("mode") in ("fresh", "archive"):
                sim.cfg.repop_mode = rp["mode"]
            if "autosave_s" in msg:
                self.autosave_s = max(0.0, float(msg["autosave_s"]))
            return {"t": "settings", **self._settings()}
        if t == "new_world":
            self.pool.reset()
            self.pool.created.clear()
            from dataclasses import replace

            cfg = replace(self.sim.cfg, seed=int(msg.get("seed", self.cfg.seed)))
            self.sim = Simulation(cfg, self.pool)
            self.cfg = cfg
            self.world_id = uuid.uuid4().hex[:8]
            self._selected.clear()
            return {"t": "hello"}
        if t == "kill_species" and self.debug_commands:   # test hook: force an extinction
            sid = msg["species"]
            for slot in list(sim.slot_of.values()):
                if sim.sp[slot] == BY_ID[sid].index:
                    sim.kill(slot, "removed")
            return None
        raise ValueError(f"unknown command {t}")

    def _safe_load(self, slot: str):
        """Load a slot; if anything fails after the old world was dropped, bring the old world back."""
        from nowasea.persistence.saves import RESTORE_SLOT

        had_world = self.sim is not None
        if had_world:
            self.store.save(RESTORE_SLOT, self.sim, self.pool)
        try:
            self._load(slot)
        except Exception:
            if had_world:
                log.exception("loading %r failed; restoring the previous world", slot)
                self._load(RESTORE_SLOT)
            raise
        finally:
            try:
                self.store.path(RESTORE_SLOT).unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass

    def _load(self, slot: str):
        self.pool.reset()

        def factory(state):
            from dataclasses import fields

            known = {f.name for f in fields(SimConfig)}
            cfg = SimConfig(**{k: v for k, v in state["config"].items() if k in known})
            cfg.brain_kind = self.brain_kind
            return Simulation(cfg, self.pool, populate=False)

        sim, _manifest = load_into(factory, self.pool, self.store, slot)
        self.sim = sim
        self.cfg = sim.cfg
        self.world_id = uuid.uuid4().hex[:8]
        self._selected.clear()
        self._last_autosave_sim = sim.time
