"""Observation metrics: what is interesting — and honest — to watch in the aquarium.

Designed and reviewed by three independent models (Fable, GPT-6 Astra, Gemini-4 Carbon):
- the unit of analysis is the individual, not the decision; small samples get t-quantile intervals or none;
- the baseline for "does NOWA learn" is a within-world control caste of *frozen* NOWA brains (same core, genes
  and drives, no learning), not a random or hard-coded brain;
- learning is read from context discrimination (cover near vs far under threat: drives are identical there)
  and from the change across a single sleep (15 decisions before vs after), compared between castes;
- "show" metrics (hunting, rhythm, mood, heroes) are kept apart from "evidence".

Hooks are called by ``Simulation``; ``summary()`` runs every few seconds.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Dict, List, Optional

import numpy as np

from nowasea.ecosystem.species import BY_ID, DAY_S, SPECIES

EVASIVE = {"flee", "hide", "burrow"}
HIDING = {"hide", "burrow"}
HUNT = {"strike", "chase", "stalk"}
FEED = {"forage", "scavenge", "ambush", "stalk", "chase", "strike", "patrol"}
PRIMARY = {"sparkfin": "evade", "sweeper": "evade", "needlejaw": "hunt", "shade": "hunt"}
MOOD_KEYS = ("valence", "arousal", "stress", "cortisol", "uncertainty")
MODES = ("habitual", "balanced", "deliberative", "inhibitory")
CASTES = ("plastic", "frozen")
RESP_BINS = np.arange(0.0, 135.0, 15.0)          # seconds after a lunge: 0 .. 120
AGE_BUCKETS = ((0, 100, "0-100"), (100, 300, "100-300"), (300, 10 ** 9, "300+"))
HEAT_NX, HEAT_NZ = 40, 25
MIN_DEC = 5                                      # decisions per individual and context to count it
SLEEP_WIN = 15                                   # decisions before / after a sleep
RECENT_S = 2 * DAY_S
# Two-sided 95 % t quantiles for df = 1..30 (normal beyond).
_T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
         2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042]


def random_baseline(species_id: str) -> Dict[str, Optional[float]]:
    """Exact choice quality of a uniformly random brain: suitable actions / all actions of the species."""
    acts = set(BY_ID[species_id].actions)
    n = len(acts)
    out = {}
    for key, good in (("evade", EVASIVE), ("feed", FEED), ("hunt", HUNT)):
        k = len(acts & good)
        out[key] = round(k / n, 3) if k else None
    return out


def wilson(ok: int, n: int, z: float = 1.96):
    if n <= 0:
        return None
    p = ok / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def mean_ci(values: List[float]) -> Optional[dict]:
    """Mean with a t-based 95 % interval; no interval for n < 3 (dots only)."""
    n = len(values)
    if n == 0:
        return None
    m = float(np.mean(values))
    if n < 3:
        return {"mean": round(m, 3), "lo": None, "hi": None, "n": n}
    t = _T975[n - 2] if n - 1 <= len(_T975) else 1.96
    half = t * float(np.std(values, ddof=1)) / math.sqrt(n)
    return {"mean": round(m, 3), "lo": round(m - half, 3), "hi": round(m + half, 3), "n": n}


class Insights:
    SLOT_ARRAYS = ("q_brain", "noact", "ndec", "disc", "dodged", "mood", "age_q", "ring_ok", "ring_len",
                   "ring_pos", "post_n", "post_ok", "pre_rate", "sd_sum", "sd_n")

    def __init__(self, capacity: int, intents: List[str], tank):
        self.capacity = capacity
        self.intents = list(intents)
        self.tank = tank
        self._reset()

    def _reset(self) -> None:
        C = self.capacity
        # ----- per creature (slot) -----
        self.q_brain = np.zeros((C, 6), dtype=np.int32)      # threat n/ok, hunger n/ok, prey n/ok (brain's own)
        self.noact = np.zeros(C, dtype=np.int32)              # gate admitted nothing: the body chose by instinct
        self.ndec = np.zeros(C, dtype=np.int32)
        self.disc = np.zeros((C, 4), dtype=np.int32)          # threat near & cover near: n, hid; cover far: n, hid
        self.dodged = np.zeros(C, dtype=np.int32)             # lunges survived
        self.mood = np.full((C, len(MOOD_KEYS)), np.nan)
        self.age_q = np.zeros((C, 3, 2), dtype=np.int32)      # by decision age bucket: decisions, instinct
        self.ring_ok = np.zeros((C, SLEEP_WIN), dtype=np.int8)  # last primary outcomes before a sleep
        self.ring_len = np.zeros(C, dtype=np.int32)
        self.ring_pos = np.zeros(C, dtype=np.int32)
        self.post_n = np.full(C, -1, dtype=np.int32)          # -1: not collecting
        self.post_ok = np.zeros(C, dtype=np.int32)
        self.pre_rate = np.zeros(C)
        self.sd_sum = np.zeros(C)                             # sum of (after - before) over this one's sleeps
        self.sd_n = np.zeros(C, dtype=np.int32)
        self.caste = ["plastic"] * C
        # ----- population -----
        self.prey_ids = [s.id for s in SPECIES if any(s.id in p.diet for p in SPECIES)]
        self.strikes = {sid: self._new_strike() for sid in self.prey_ids}
        self.modes = {s.id: {c: {m: 0 for m in MODES} for c in CASTES} for s in SPECIES}
        self.actogram = {s.id: np.zeros((24, len(self.intents))) for s in SPECIES}
        self.heat = {s.id: np.zeros((HEAT_NZ, HEAT_NX)) for s in SPECIES}
        self.catch_pts: deque = deque(maxlen=200)
        self.death_log: deque = deque(maxlen=1000)            # (species, gen, cause, lived_s, t, founder)
        self.life_log: Dict[str, deque] = {s.id: deque(maxlen=3000) for s in SPECIES}   # (lived_s, gen) per death
        self.ind_log: Dict[str, deque] = {s.id: deque(maxlen=400) for s in SPECIES}     # finished lives
        self.chronicle: deque = deque(maxlen=100)
        self.records: Dict[str, dict] = {}
        self.gen_reached: Dict[str, int] = {s.id: 0 for s in SPECIES}
        self.mood_hist: deque = deque(maxlen=360)
        self._watches: List[dict] = []
        self.resp = {"target": np.zeros((len(RESP_BINS), 2)), "neighbours": np.zeros((len(RESP_BINS), 2))}
        self._last_mood_hist = -1e9

    @staticmethod
    def _new_strike() -> dict:
        return {"lunges": 0, "caught": 0, "by_state": {k: {"lunges": 0, "caught": 0}
                                                       for k in ("open", "cover", "school", "burst")}}

    # ----- hooks ------------------------------------------------------------------------------------------------
    def on_spawn(self, slot: int, caste: str = "plastic") -> None:
        for arr in (self.q_brain, self.disc, self.age_q, self.ring_ok):
            arr[slot] = 0
        for arr in (self.noact, self.ndec, self.dodged, self.ring_len, self.ring_pos, self.post_ok, self.sd_n):
            arr[slot] = 0
        self.post_n[slot] = -1
        self.pre_rate[slot] = self.sd_sum[slot] = 0.0
        self.mood[slot] = np.nan
        self.caste[slot] = caste

    def on_decision(self, sim, slot: int, tokens, action: str, no_action: bool, mood, mode: str = "") -> None:
        sid = SPECIES[sim.sp[slot]].id
        b = 0 if self.ndec[slot] < 100 else (1 if self.ndec[slot] < 300 else 2)
        self.age_q[slot, b, 0] += 1
        self.age_q[slot, b, 1] += int(bool(no_action))
        self.ndec[slot] += 1
        if mood is not None:
            self.mood[slot] = mood
            self._watch_sample(sim, slot, mood[2])
        if mode in MODES:
            self.modes[sid][self.caste[slot]][mode] += 1
        if no_action:
            self.noact[slot] += 1
            return                                   # the body chose, not the brain: not scored as the brain's
        t = set(tokens)
        q = self.q_brain[slot]
        ok_primary = None
        if "threat:near" in t:
            q[0] += 1
            ok = action in EVASIVE
            q[1] += ok
            if PRIMARY.get(sid) == "evade":
                ok_primary = ok
            # Only before entering cover: "cover:in" is a consequence of hiding, not a context for it.
            if "cover:near" in t or "cover:far" in t:
                i = 0 if "cover:near" in t else 2
                self.disc[slot, i] += 1
                self.disc[slot, i + 1] += action in HIDING
        elif "energy:low" in t and ({"food:near", "food:far", "prey:near", "prey:far"} & t):
            q[2] += 1
            q[3] += action in FEED
        elif "prey:near" in t and "stamina:low" not in t:
            q[4] += 1
            ok = action in HUNT
            q[5] += ok
            if PRIMARY.get(sid) == "hunt":
                ok_primary = ok
        if ok_primary is not None:
            self.ring_ok[slot, self.ring_pos[slot]] = int(ok_primary)
            self.ring_pos[slot] = (self.ring_pos[slot] + 1) % SLEEP_WIN
            self.ring_len[slot] = min(SLEEP_WIN, self.ring_len[slot] + 1)
            if self.post_n[slot] >= 0:
                self.post_n[slot] += 1
                self.post_ok[slot] += int(ok_primary)
                if self.post_n[slot] >= SLEEP_WIN:
                    self._close_sleep_window(slot)

    def _close_sleep_window(self, slot: int) -> None:
        if self.post_n[slot] >= MIN_DEC:
            self.sd_sum[slot] += self.post_ok[slot] / self.post_n[slot] - self.pre_rate[slot]
            self.sd_n[slot] += 1
        self.post_n[slot] = -1
        self.post_ok[slot] = 0

    def on_slept(self, slot: int) -> None:
        """After the core actually slept: the last outcomes before it become the 'before' window."""
        if self.post_n[slot] >= 0:
            self._close_sleep_window(slot)
        if self.ring_len[slot] >= MIN_DEC:
            n = int(self.ring_len[slot])
            self.pre_rate[slot] = float(self.ring_ok[slot, :n].mean()) if n < SLEEP_WIN else float(self.ring_ok[slot].mean())
            self.post_n[slot] = 0
            self.post_ok[slot] = 0
        self.ring_len[slot] = 0
        self.ring_pos[slot] = 0

    def on_lunge(self, sim, h: int, prey: int, caught: bool) -> None:
        ps = SPECIES[sim.sp[prey]]
        st = self.strikes.setdefault(ps.id, self._new_strike())
        st["lunges"] += 1
        st["caught"] += int(caught)
        state = "cover" if sim.in_cover[prey] else ("school" if sim.school_n[prey] >= 4 else "open")
        for key in (state, "burst") if sim.burst[prey] else (state,):
            st["by_state"][key]["lunges"] += 1
            st["by_state"][key]["caught"] += int(caught)
        if caught:
            p = sim.pos[prey]
            self.catch_pts.append([round(float(p[0]), 1), round(float(p[2]), 1), ps.id])
            return
        self.dodged[prey] += 1
        if self.dodged[prey] == 3:
            self._chron(sim, "escape", ps.id, int(sim.cid[prey]),
                        {"ru": f"{ps.name_ru} #{int(sim.cid[prey])} пережила уже третий бросок",
                         "en": f"{ps.name_en} #{int(sim.cid[prey])} survived a third lunge"})
        base = float(self.mood[prey, 2]) if np.isfinite(self.mood[prey, 2]) else None
        neighbours = {}
        same = np.nonzero(sim.alive & (sim.sp == sim.sp[prey]))[0]
        if len(same):
            d = np.linalg.norm(sim.pos[same] - sim.pos[prey], axis=1)
            for w in same[(d < 8.0) & (same != prey)][:6]:
                s = self.mood[w, 2]
                neighbours[int(sim.cid[w])] = float(s) if np.isfinite(s) else None
        self._watches.append({"t0": sim.time, "target": (int(sim.cid[prey]), base), "neighbours": neighbours,
                              "seen": set()})
        if len(self._watches) > 60:
            del self._watches[:-60]

    def on_death(self, sim, slot: int, cause: str) -> None:
        s = SPECIES[sim.sp[slot]]
        meta = sim.meta.get(slot, {})
        lived = sim.time - float(meta.get("born", sim.time))
        founder = not any(meta.get("parents") or [])
        self.death_log.append((s.id, int(sim.gen[slot]), cause, lived, sim.time, founder))
        self.life_log[s.id].append((lived, int(sim.gen[slot])))
        if s.brain == "nowa":
            if self.post_n[slot] >= 0:
                self._close_sleep_window(slot)
            self.ind_log[s.id].append(self._individual(slot, t_death=sim.time))
        self._check_records(sim, slot)

    def on_birth(self, sim, species_id: str, generation: int, cid: int) -> None:
        if generation > self.gen_reached.get(species_id, 0):
            self.gen_reached[species_id] = generation
            if generation in (1, 2, 3, 5, 10) or generation % 10 == 0:
                s = BY_ID[species_id]
                self._chron(sim, "generation", species_id, cid,
                            {"ru": f"{s.name_ru}: родилось поколение {generation}",
                             "en": f"{s.name_en}: generation {generation} is born"})

    def on_extinct(self, sim, species_id: str) -> None:
        s = BY_ID[species_id]
        self._chron(sim, "extinct", species_id, None, {"ru": f"{s.name_ru}: вид вымер", "en": f"{s.name_en} went extinct"})

    def on_repopulate(self, sim, species_id: str, n: int, mode: str) -> None:
        s = BY_ID[species_id]
        how = {"archive": ("из архива геномов", "from the genome archive"), "fresh": ("с чистыми мозгами", "with fresh brains")}
        ru, en = how.get(mode, ("", ""))
        self._chron(sim, "repopulate", species_id, None,
                    {"ru": f"{s.name_ru}: {n} основателей {ru}", "en": f"{s.name_en}: {n} founders {en}"})

    def tick(self, sim, idx: np.ndarray, phase: float, dt: float) -> None:
        """At the perception rate: time budget by hour of day and presence map, decaying (half-life 2 days)."""
        decay = 0.5 ** (dt / (2 * DAY_S))
        for s in SPECIES:                              # decay even when a species is absent
            self.actogram[s.id] *= decay
            self.heat[s.id] *= decay
        if len(idx):
            hour = min(23, int(phase * 24))
            t = self.tank
            ix = np.clip(((sim.pos[idx, 0] + t.half_x) / (2 * t.half_x) * HEAT_NX).astype(int), 0, HEAT_NX - 1)
            iz = np.clip(((sim.pos[idx, 2] + t.half_z) / (2 * t.half_z) * HEAT_NZ).astype(int), 0, HEAT_NZ - 1)
            sp = sim.sp[idx]
            intents = np.clip(sim.intent[idx], 0, len(self.intents) - 1)
            for s in SPECIES:
                m = sp == s.index
                if m.any():
                    np.add.at(self.actogram[s.id][hour], intents[m], dt)
                    np.add.at(self.heat[s.id], (iz[m], ix[m]), dt)
        if sim.time - self._last_mood_hist >= 10.0:
            self._last_mood_hist = sim.time
            row = {}
            for s in SPECIES:
                vals = self.mood[sim.alive & (sim.sp == s.index)]
                vals = vals[np.isfinite(vals[:, 2])] if len(vals) else vals
                if len(vals):
                    row[s.id] = [round(float(np.median(vals[:, 2])), 3), round(float(np.median(vals[:, 0])), 3)]
            self.mood_hist.append([round(sim.time, 1), row])

    # ----- internals -------------------------------------------------------------------------------------------
    def _chron(self, sim, kind: str, species_id: str, cid, text: dict) -> None:
        self.chronicle.append({"t": round(sim.time, 1), "kind": kind, "species": species_id, "id": cid, "text": text})

    def _watch_sample(self, sim, slot: int, stress) -> None:
        if stress is None or not np.isfinite(stress) or not self._watches:
            return
        cid = int(sim.cid[slot])
        horizon = RESP_BINS[-1] + 15
        for w in self._watches:
            dtw = sim.time - w["t0"]
            if dtw < 0 or dtw > horizon:
                continue
            b = int(np.clip(np.searchsorted(RESP_BINS, dtw, side="right") - 1, 0, len(RESP_BINS) - 1))
            if (cid, b) in w["seen"]:
                continue                               # one sample per individual per bin and lunge
            if w["target"][0] == cid and w["target"][1] is not None:
                self.resp["target"][b] += (float(stress) - w["target"][1], 1)
                w["seen"].add((cid, b))
            elif w["neighbours"].get(cid) is not None:
                self.resp["neighbours"][b] += (float(stress) - w["neighbours"][cid], 1)
                w["seen"].add((cid, b))
        self._watches = [w for w in self._watches if sim.time - w["t0"] <= horizon]

    def _individual(self, slot: int, t_death: Optional[float] = None) -> dict:
        return {"q": self.q_brain[slot].tolist(), "noact": int(self.noact[slot]), "ndec": int(self.ndec[slot]),
                "disc": self.disc[slot].tolist(), "age_q": self.age_q[slot].tolist(),
                "sd": [float(self.sd_sum[slot]), int(self.sd_n[slot])], "caste": self.caste[slot],
                "t_death": t_death}

    def _check_records(self, sim, slot: int) -> None:
        s = SPECIES[sim.sp[slot]]
        meta = sim.meta.get(slot, {})
        cid = int(sim.cid[slot])
        values = {
            "lived_days": (sim.time - float(meta.get("born", sim.time))) / DAY_S,
            "children": float(sim.children[slot]),
            "catches": float(sim.catches[slot]),
            "dodged": float(self.dodged[slot]),
            "generation": float(sim.gen[slot]),
        }
        for key, v in values.items():
            if v <= 0:
                continue
            cur = self.records.get(key)
            if cur is not None and cur["id"] == cid:
                if v > cur["raw"]:
                    cur["raw"] = float(v)
                    cur["value"] = round(float(v), 3)
                continue
            # A different holder needs a clear margin: twins born together must not trade the record forever.
            margin = 0.05 if key == "lived_days" else 0.5
            if cur is None or v > cur["raw"] + margin:
                broke = cur is not None
                self.records[key] = {"raw": float(v), "value": round(float(v), 3), "id": cid, "species": s.id,
                                     "gen": int(sim.gen[slot]), "t": round(sim.time, 1)}
                if broke and key != "generation":
                    names = {"lived_days": ("дольше всех прожила", "lived longer than anyone"),
                             "children": ("больше всех потомков", "has the most offspring"),
                             "catches": ("лучший охотник за всё время", "best hunter of all time"),
                             "dodged": ("больше всех пережитых бросков", "survived the most lunges")}
                    ru, en = names[key]
                    val = f"{v:.1f}" if key == "lived_days" else f"{v:.0f}"
                    unit = (" сут." if key == "lived_days" else "", " d" if key == "lived_days" else "")
                    self._chron(sim, "record", s.id, cid, {"ru": f"Рекорд: {s.name_ru} #{cid} — {ru} ({val}{unit[0]})",
                                                          "en": f"Record: {s.name_en} #{cid} {en} ({val}{unit[1]})"})

    # ----- summary ---------------------------------------------------------------------------------------------
    def summary(self, sim) -> dict:
        alive = np.nonzero(sim.alive)[0]
        for slot in alive:
            self._check_records(sim, int(slot))
        out = {"t": "insights", "time": round(sim.time, 1),
               "baselines": {s.id: random_baseline(s.id) for s in SPECIES if s.brain == "nowa"},
               "recent": {"brain": {}, "discrimination": {}, "sleep_delta": {}},
               "all": {"brain": {}, "discrimination": {}, "sleep_delta": {}},
               "modes": {}, "strikes": {}, "hall": self._hall(sim, alive), "chronicle": list(self.chronicle)[-40:],
               "actogram": {}, "deaths_daily": self._deaths_daily(sim), "survival": {}, "mood": {},
               "mood_history": list(self.mood_hist)[-180:], "lunge_response": {},
               "catch_points": list(self.catch_pts)}
        for s in SPECIES:
            if s.brain != "nowa":
                continue
            living = [self._individual(int(k)) for k in alive if sim.sp[k] == s.index]
            dead = list(self.ind_log[s.id])
            recent_dead = [d for d in dead if d["t_death"] is not None and sim.time - d["t_death"] <= RECENT_S]
            for window, inds in (("recent", living + recent_dead), ("all", living + dead)):
                by = {c: [d for d in inds if d["caste"] == c] for c in CASTES}
                out[window]["brain"][s.id] = {c: self._brain_block(by[c]) for c in CASTES}
                out[window]["discrimination"][s.id] = {c: self._discrimination(by[c]) for c in CASTES}
                out[window]["sleep_delta"][s.id] = {c: self._sleep_delta(by[c]) for c in CASTES}
            out["modes"][s.id] = {}
            for c in CASTES:
                tot = sum(self.modes[s.id][c].values())
                out["modes"][s.id][c] = {m: round(v / tot, 3) for m, v in self.modes[s.id][c].items()} if tot else None
        for sid, st in self.strikes.items():
            out["strikes"][sid] = {"lunges": st["lunges"], "caught": st["caught"],
                                   "catch_ci": wilson(st["caught"], st["lunges"]),
                                   "by_state": {k: {**v, "catch_ci": wilson(v["caught"], v["lunges"])}
                                                for k, v in st["by_state"].items()}}
        for s in SPECIES:
            a = self.actogram[s.id]
            idx = [self.intents.index(x) for x in s.actions + ["sleep"] if x in self.intents]
            sub = a[:, idx]
            tot = sub.sum(axis=1, keepdims=True)
            out["actogram"][s.id] = {"intents": [self.intents[i] for i in idx],
                                     "shares": np.round(np.where(tot > 0, sub / np.maximum(tot, 1e-9), 0.0), 3).tolist(),
                                     "weight": np.round(tot[:, 0], 1).tolist()}
            out["survival"][s.id] = self._survival(sim, s)
            vals = self.mood[sim.alive & (sim.sp == s.index)]
            if len(vals):
                vals = vals[np.isfinite(vals[:, 2])]
            if len(vals):
                q = np.percentile(vals, [25, 50, 75], axis=0)
                out["mood"][s.id] = {k: [round(float(q[1, i]), 3), round(float(q[0, i]), 3), round(float(q[2, i]), 3)]
                                     for i, k in enumerate(MOOD_KEYS)} | {"n": int(len(vals))}
        for who, arr in self.resp.items():
            out["lunge_response"][who] = [[int(RESP_BINS[i]), round(float(arr[i, 0] / arr[i, 1]), 3) if arr[i, 1] else None,
                                           int(arr[i, 1])] for i in range(len(RESP_BINS))]
        return out

    @staticmethod
    def _rate_mean(inds, n_i, ok_i):
        return mean_ci([d["q"][ok_i] / d["q"][n_i] for d in inds if d["q"][n_i] >= MIN_DEC])

    def _brain_block(self, inds) -> dict:
        """Choice quality of the brain's own decisions (instinct substitutions excluded), mean over individuals."""
        autonomy = []
        for b, (_lo, _hi, label) in enumerate(AGE_BUCKETS):
            vals = [1.0 - d["age_q"][b][1] / d["age_q"][b][0] for d in inds if d["age_q"][b][0] >= MIN_DEC]
            autonomy.append({"bucket": label, **(mean_ci(vals) or {"mean": None, "lo": None, "hi": None, "n": 0})})
        return {"evade": self._rate_mean(inds, 0, 1), "feed": self._rate_mean(inds, 2, 3),
                "hunt": self._rate_mean(inds, 4, 5),
                "instinct_share": mean_ci([d["noact"] / d["ndec"] for d in inds if d["ndec"] >= MIN_DEC]),
                "autonomy_by_age": autonomy, "individuals": len(inds)}

    @staticmethod
    def _discrimination(inds):
        """Hiding with cover near minus cover far, per individual. Drives are identical in both contexts."""
        return mean_ci([d["disc"][1] / d["disc"][0] - d["disc"][3] / d["disc"][2]
                        for d in inds if d["disc"][0] >= MIN_DEC and d["disc"][2] >= MIN_DEC])

    @staticmethod
    def _sleep_delta(inds):
        """Per individual: mean change of primary choice quality across a sleep (15 decisions after - before)."""
        return mean_ci([d["sd"][0] / d["sd"][1] for d in inds if d["sd"][1] > 0])

    def _hall(self, sim, alive) -> dict:
        living = {}
        if len(alive):
            born = np.array([float(sim.meta[int(k)].get("born", sim.time)) for k in alive])
            cand = {"lived_days": (sim.time - born) / DAY_S, "children": sim.children[alive].astype(float),
                    "catches": sim.catches[alive].astype(float), "dodged": self.dodged[alive].astype(float),
                    "generation": sim.gen[alive].astype(float)}
            for key, v in cand.items():
                j = int(np.argmax(v))
                if v[j] > 0:
                    k = int(alive[j])
                    living[key] = {"value": round(float(v[j]), 3), "id": int(sim.cid[k]),
                                   "species": SPECIES[sim.sp[k]].id, "gen": int(sim.gen[k])}
        return {"living": living, "all_time": {k: {kk: vv for kk, vv in v.items() if kk != "raw"}
                                               for k, v in self.records.items()}}

    def _deaths_daily(self, sim) -> dict:
        today = int(sim.time // DAY_S)
        days = list(range(max(0, today - 11), today + 1))
        out = {}
        for s in SPECIES:
            rows = {d: {"eaten": 0, "starvation": 0, "old_age": 0, "other": 0} for d in days}
            for sid, _g, cause, _lived, t, _f in self.death_log:
                if sid == s.id and int(t // DAY_S) in rows:
                    rows[int(t // DAY_S)][cause if cause in ("eaten", "starvation", "old_age") else "other"] += 1
            out[s.id] = [[d, r["eaten"], r["starvation"], r["old_age"], r["other"]] for d, r in rows.items()]
        return out

    def _survival(self, sim, s) -> dict:
        """Kaplan-Meier by time lived in the world: generations 0-1 vs 2+; living creatures are censored."""
        res = {}
        alive = np.nonzero(sim.alive & (sim.sp == s.index))[0]
        for label, early in (("early", True), ("late", False)):
            times, events = [], []
            for lived, gen in self.life_log[s.id]:
                if (gen <= 1) == early:
                    times.append(lived)
                    events.append(1)
            for k in alive:
                if (int(sim.gen[k]) <= 1) == early:
                    times.append(sim.time - float(sim.meta[int(k)].get("born", sim.time)))
                    events.append(0)
            if not times:
                continue
            t_arr, e_arr = np.asarray(times), np.asarray(events)
            order = np.lexsort((-e_arr, t_arr))           # deaths before censorings at equal times
            t_sorted, e_sorted = t_arr[order], e_arr[order]
            n = len(t_sorted)
            surv, pts = 1.0, [[0.0, 1.0, n]]
            for i in range(n):
                at_risk = n - i
                if at_risk < 2:
                    break
                if e_sorted[i]:
                    surv *= (1 - 1 / at_risk)
                    pts.append([round(float(t_sorted[i]) / DAY_S, 3), round(surv, 3), at_risk])
            res[label] = {"points": pts, "n": n, "events": int(e_arr.sum())}
        return res

    def heatmap(self, species_id: str) -> dict:
        h = self.heat.get(species_id)
        if h is None:
            raise ValueError(f"unknown species {species_id}")
        mx = float(h.max()) or 1.0
        return {"t": "heatmap", "species": species_id, "nx": HEAT_NX, "nz": HEAT_NZ,
                "data": np.round(h / mx, 3).ravel().tolist(), "catches": list(self.catch_pts)}

    # ----- persistence -----------------------------------------------------------------------------------------
    def to_state(self, slots) -> dict:
        slots = list(int(x) for x in slots)
        return {
            "slots": {name: np.nan_to_num(getattr(self, name)[slots], nan=-9.0).tolist() for name in self.SLOT_ARRAYS},
            "caste": [self.caste[k] for k in slots],
            "strikes": self.strikes, "modes": self.modes,
            "actogram": {k: v.round(3).tolist() for k, v in self.actogram.items()},
            "heat": {k: v.round(3).tolist() for k, v in self.heat.items()}, "catch_pts": list(self.catch_pts),
            "death_log": list(self.death_log), "life_log": {k: list(v) for k, v in self.life_log.items()},
            "ind_log": {k: list(v) for k, v in self.ind_log.items()},
            "chronicle": list(self.chronicle), "records": self.records, "gen_reached": self.gen_reached,
            "mood_hist": list(self.mood_hist), "resp": {k: v.tolist() for k, v in self.resp.items()},
        }

    def load_state(self, st: Optional[dict]) -> None:
        """Replace everything (idempotent). Slots are the compacted order used by saves.restore_sim."""
        self._reset()
        if not st:
            return
        for name, rows in (st.get("slots") or {}).items():
            arr = getattr(self, name, None)
            if arr is None or not rows:
                continue
            vals = np.asarray(rows, dtype=float)
            if name == "mood":
                vals = np.where(vals == -9.0, np.nan, vals)
            if vals.shape[1:] != arr.shape[1:]:
                continue                                  # saved by an older layout: start this array fresh
            arr[: len(vals)] = vals.astype(arr.dtype)
        for i, c in enumerate(st.get("caste") or []):
            self.caste[i] = c if c in CASTES else "plastic"
        for sid, v in (st.get("strikes") or {}).items():
            base = self.strikes.setdefault(sid, self._new_strike())
            base["lunges"] = int(v.get("lunges", 0))
            base["caught"] = int(v.get("caught", 0))
            for k, vv in (v.get("by_state") or {}).items():
                base["by_state"].setdefault(k, {"lunges": 0, "caught": 0}).update(vv)
        for sid, by in (st.get("modes") or {}).items():
            for c, counts in (by or {}).items():
                if sid in self.modes and c in self.modes[sid]:
                    self.modes[sid][c].update(counts)
        for k, v in (st.get("actogram") or {}).items():
            if k in self.actogram and np.asarray(v).shape == self.actogram[k].shape:
                self.actogram[k] = np.asarray(v, dtype=float)
        for k, v in (st.get("heat") or {}).items():
            if k in self.heat and np.asarray(v).shape == self.heat[k].shape:
                self.heat[k] = np.asarray(v, dtype=float)
        self.catch_pts.extend(st.get("catch_pts", []))
        self.death_log.extend(tuple(x) for x in st.get("death_log", []))
        for k, v in (st.get("life_log") or {}).items():
            if k in self.life_log:
                self.life_log[k].extend(tuple(x) for x in v)
        for k, v in (st.get("ind_log") or {}).items():
            if k in self.ind_log:
                self.ind_log[k].extend(d for d in v if "age_q" in d)
        self.chronicle.extend(st.get("chronicle", []))
        for k, v in (st.get("records") or {}).items():
            self.records[k] = {**v, "raw": float(v.get("raw", v.get("value", 0.0)))}
        self.gen_reached.update(st.get("gen_reached", {}))
        self.mood_hist.extend(st.get("mood_hist", []))
        for k, v in (st.get("resp") or {}).items():
            if k in self.resp and np.asarray(v).shape == self.resp[k].shape:
                self.resp[k] = np.asarray(v, dtype=float)
