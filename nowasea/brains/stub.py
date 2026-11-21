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

    def sleep(self, cycles=None, duration_s: float = 0.0) -> dict:
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


class ReflexBrain(StubBrain):
    """No learning: picks the action the body pushes hardest (the drives passed as ``bias``), else wanders.

    The control group for NOWA: it sees exactly what NOWA's bias input carries, but never learns.
    """

    def decide(self, tokens, *, executed_prev=None, reward_prev=None, elapsed=0.0, novelty=0.0, conflict=0.0,
               intensity=1.0, bias=None):
        self.decisions += 1
        self._tokens = list(tokens)
        if bias:
            best = max(bias.items(), key=lambda kv: kv[1])
            if best[1] > 0 and best[0] in self.spec.actions:
                self._last = best[0]
                return DecisionInfo(action=self._last, mode="reflex")
        wander = [a for a in ("forage", "scavenge", "patrol", "explore", "school", "drift") if a in self.spec.actions]
        self._last = self.rng.choice(wander or list(self.spec.actions))
        return DecisionInfo(action=self._last, mode="reflex")


class RandomBrain(StubBrain):
    """No learning, no drives: a uniformly random action each time (the lower bound)."""

    def decide(self, tokens, *, executed_prev=None, reward_prev=None, elapsed=0.0, novelty=0.0, conflict=0.0,
               intensity=1.0, bias=None):
        self.decisions += 1
        self._tokens = list(tokens)
        self._last = self.rng.choice(list(self.spec.actions))
        return DecisionInfo(action=self._last, mode="random")
