"""A rule-based stand-in with the NowaBrain interface, for tests and fast ecology tuning."""

from __future__ import annotations

import random
from typing import Dict, Optional, Sequence

from nowasea.brains.nowa_adapter import BrainSpec, DecisionInfo

# token -> preferred action, first match wins (per species action set)
RULES = [
    ("threat:near", ("flee", "hide")),
    ("prey:near", ("strike", "chase", "stalk")),
    ("energy:low", ("forage", "scavenge", "patrol", "ambush", "chase")),
    ("prey:far", ("chase", "stalk", "patrol")),
    ("threat:far", ("hide", "school")),
    ("food:near", ("forage", "scavenge")),
    ("mate:near", ("mate",)),
    ("stamina:low", ("rest",)),
    ("school:alone", ("school",)),
    ("food:far", ("forage", "scavenge")),
]


class StubBrain:
    def __init__(self, spec: BrainSpec, genome: Optional[dict] = None, epigenome: Optional[dict] = None,
                 seed: Optional[int] = None):
        self.spec = spec
        self.rng = random.Random(seed)
        self.decisions = 0
        self.sleeps = 0
        self._genome = genome or {"genes": {}, "generation": 0}
        self._last = None
        self._tokens = []

    def decide(self, tokens: Sequence[str], *, executed_prev=None, reward_prev=None, elapsed: float = 0.0,
               novelty: float = 0.0, conflict: float = 0.0, intensity: float = 1.0,
               bias: Optional[Dict[str, float]] = None) -> DecisionInfo:
        self.decisions += 1
        toks = set(tokens)
        self._tokens = list(tokens)
        for tok, prefs in RULES:
            if tok in toks:
                for a in prefs:
                    if a in self.spec.actions and (a != "mate" or "energy:high" in toks):
                        self._last = a
                        return DecisionInfo(action=a, mode="stub")
        explore = [a for a in ("explore", "patrol", "school", "forage") if a in self.spec.actions]
        self._last = self.rng.choice(explore or list(self.spec.actions))
        return DecisionInfo(action=self._last, mode="stub")

    def advance(self, elapsed: float) -> None:
        pass

    def sleep(self, cycles=None) -> dict:
        self.sleeps += 1
        return {}

    def genome(self) -> dict:
        return self._genome

    def epigenome(self):
        return None

    def save(self, path):
        import json
        from pathlib import Path

        path = Path(path)
        path.write_text(json.dumps({"stub": True}), encoding="utf-8")
        return path

    def host_state(self) -> dict:
        return {"genome": self._genome, "epigenome": None, "decisions": self.decisions, "sleeps": self.sleeps,
                "prev_tokens": self._tokens, "prev_decided": self._last}

    @classmethod
    def load(cls, spec, path, host_state, seed=None):
        b = cls(spec, genome=host_state.get("genome"), seed=seed)
        b.decisions = int(host_state.get("decisions", 0))
        b.sleeps = int(host_state.get("sleeps", 0))
        return b

    def introspect(self) -> dict:
        return {"affect": {}, "neuromodulators": {}, "mode": "stub", "episodes": 0, "decisions": self.decisions,
                "sleeps": self.sleeps, "last_tokens": self._tokens, "last_action": self._last}

    def stable_payload(self) -> dict:
        return {"decisions": self.decisions}
