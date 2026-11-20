"""The single place that talks to the NOWA core.

NOWA is fetched by ``scripts/setup`` into ``vendor/nowa`` (or wherever ``NOWA_PATH`` points) and is used
unmodified. Every known pitfall of the host contract lives here; see docs/nowa-host-guide.md.
"""

from __future__ import annotations

import logging
import math
import os
import random
import sys
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LOADED_ROOT: Optional[Path] = None

NO_ACTION = "NO_ACTION"


class NowaMissing(RuntimeError):
    pass


def nowa_root() -> Path:
    env = os.environ.get("NOWA_PATH")
    return Path(env).resolve() if env else (_REPO_ROOT / "vendor" / "nowa")


def ensure_nowa(root: Optional[Path] = None) -> Path:
    """Make the NOWA core importable. NOWA modules have flat names (``agent``, ``storage``...)."""
    global _LOADED_ROOT
    root = Path(root).resolve() if root else nowa_root()
    if _LOADED_ROOT is not None:
        if _LOADED_ROOT != root:
            raise RuntimeError(f"NOWA already loaded from {_LOADED_ROOT}, cannot switch to {root} in-process")
        return root
    src = root / "src"
    if not (src / "agent.py").is_file():
        raise NowaMissing(f"NOWA core not found at {src}. Run scripts/setup (or set NOWA_PATH).")
    if str(src) not in sys.path:
        sys.path.append(str(src))
    # The core logs one-time notices (wake interval, production guard skips); keep the host console clean.
    for name in ("nowa", "nowa.plasticity", "agent", "sleep", "hippocampus", "learning_guard"):
        logging.getLogger(name).setLevel(logging.ERROR)
    warnings.filterwarnings("ignore", category=RuntimeWarning, module=r"(agent|agent_factory|sleep|epigenome).*")
    import agent as _agent_module  # noqa: F401  (fail fast with a clear path)

    loaded = Path(_agent_module.__file__).resolve().parent
    if loaded != src.resolve():
        raise NowaMissing(f"module 'agent' resolved to {loaded}, expected NOWA core at {src}")
    _LOADED_ROOT = root
    return root


@dataclass
class BrainSpec:
    """What a host species needs from a brain. Times are simulation seconds."""

    species: str
    actions: Sequence[str]
    wake_interval_s: float
    hippocampus_capacity: int = 256
    cortex_capacity: int = 128
    sleep_cycles: int = 3
    default_action: str = ""

    def __post_init__(self):
        self.actions = [str(a) for a in self.actions]
        if not self.default_action:
            self.default_action = self.actions[0]


def _factory(spec: BrainSpec):
    ensure_nowa()
    from agent_factory import AgentConfig, AgentFactory

    return AgentFactory(
        AgentConfig(
            actions=list(spec.actions),
            hippocampus_capacity=int(spec.hippocampus_capacity),
            cortex_capacity=int(spec.cortex_capacity),
            sleep_cycles_default=int(spec.sleep_cycles),
        )
    )


def random_genome(rng: random.Random) -> dict:
    ensure_nowa()
    from genome import GenomeVector

    return GenomeVector.random(rng).to_dict()


def child_genome(mother: dict, father: dict, rng: random.Random, mutation_rate: float = 0.05) -> dict:
    ensure_nowa()
    from genome import GenomeVector

    a, b = GenomeVector.from_dict(mother), GenomeVector.from_dict(father)
    child, _ = a.crossover(b, mode="uniform", rng=rng)
    return child.mutate(rate=mutation_rate, rng=rng).to_dict()


def genome_generation(genome: dict) -> int:
    try:
        return int(genome.get("generation", 0))
    except Exception:
        return 0


def lifespan_factor(genome: dict) -> float:
    genes = (genome or {}).get("genes", {}) or {}
    try:
        value = float(genes.get("lt_max_lifespan_factor", 1.0))
    except Exception:
        value = 1.0
    return min(2.0, max(0.5, value))


def blend_epigenomes(a: Optional[dict], b: Optional[dict], rng: random.Random) -> Optional[dict]:
    ensure_nowa()
    from epigenome import EpigenomeSnapshot

    ea = EpigenomeSnapshot.from_dict(a) if a else EpigenomeSnapshot.empty()
    eb = EpigenomeSnapshot.from_dict(b) if b else EpigenomeSnapshot.empty()
    try:
        blended = ea.blend(eb, alpha=0.5, rng=rng)
    except Exception:
        return None
    return None if blended.is_empty() else blended.to_dict()


def _all_components(agent) -> Dict[str, Any]:
    """AgentStorage needs every component passed explicitly, or slow affect is silently lost."""
    names = (
        "neuromodulators", "affective_persistence", "affective_background", "affective_space",
        "semantic_emotions", "emotional_memory", "emotional_expectations", "emotional_regulation",
        "conflict_arbitration", "intent_memory", "affect_state",
    )
    out = {n: getattr(agent, n, None) for n in names}
    out["sleep_manager"] = agent.sleep_manager
    out["agent"] = agent
    return out


def _decision_mode(agent) -> str:
    """Habitual / balanced / deliberative / inhibitory, as the arbitrator last reported it."""
    try:
        out = agent._last_decision_arbitration_output or {}
        mode = out.get("decision_mode", out.get("mode", ""))
        mode = getattr(mode, "value", mode)
        mode = getattr(mode, "name", mode)
        return str(mode or "").split(".")[-1].lower()
    except Exception:  # noqa: BLE001
        return ""


@dataclass
class DecisionInfo:
    action: str
    mode: str = ""
    no_action: bool = False


class NowaBrain:
    """One creature's mind. Not thread-safe: one caller at a time."""

    def __init__(self, spec: BrainSpec, genome: Optional[dict] = None, epigenome: Optional[dict] = None,
                 seed: Optional[int] = None):
        ensure_nowa()
        from epigenome import EpigenomeSnapshot
        from genome import GenomeVector
        from labile_layer import LabileLayer

        self.spec = spec
        rng = random.Random(seed)
        g = GenomeVector.from_dict(genome) if genome else GenomeVector.random(rng)
        epi = EpigenomeSnapshot.from_dict(epigenome) if epigenome else None
        factory = _factory(spec)
        agent = factory.spawn(genome=g, epigenome=epi, rng=rng)
        # The factory builds the Agent without a PlasticityConfig wake interval (core default 3600 s).
        # Set it on the shared config and rebuild the still-empty labile layer from it.
        agent.plasticity.expected_wake_interval_s = float(spec.wake_interval_s)
        agent.labile = LabileLayer(agent.plasticity)
        if agent.sleep_manager is not None:
            agent.sleep_manager.labile = agent.labile
            agent.sleep_manager.plasticity = agent.plasticity
        if seed is not None:
            agent._rng = random.Random(seed)
            try:
                agent.affective_space.rng.seed(int(seed))
            except Exception:
                pass
        self.agent = agent
        self._factory = factory
        self._prev_tokens: Optional[List[str]] = None
        self._prev_decided: Optional[str] = None
        self.decisions = 0
        self.sleeps = 0

    # ----- waking -------------------------------------------------------------------------------
    def decide(self, tokens: Sequence[str], *, executed_prev: Optional[str] = None,
               reward_prev: Optional[float] = None, elapsed: float = 0.0, novelty: float = 0.0,
               conflict: float = 0.0, intensity: float = 1.0,
               bias: Optional[Dict[str, float]] = None) -> DecisionInfo:
        """Close the previous action with its reward, then choose the next one.

        ``elapsed`` is simulation time since the previous call. The clock is advanced once, here; the
        commit and the step then run with no extra time so the interval is not counted twice.
        """
        agent = self.agent
        if elapsed > 0.0:
            agent.advance_time(float(elapsed))
        if self._prev_tokens is not None and executed_prev:
            r = float("nan") if reward_prev is None else max(-1.0, min(1.0, float(reward_prev)))
            agent.commit_executed_transition(
                action=str(executed_prev), reward=r, context_events=list(self._prev_tokens),
                decided_action=self._prev_decided, overridden=(executed_prev != self._prev_decided),
                override_source="host:body" if executed_prev != self._prev_decided else None,
                novelty=novelty, conflict=conflict, intensity=intensity,
            )
        ctx = [str(t) for t in tokens]
        action = agent.step(context_events=ctx, reward=None, novelty=float(novelty), conflict=float(conflict),
                            intensity=float(intensity), decision_only=True, physiological_bias=bias or None,
                            dt=0.0)
        action = str(action) if action else NO_ACTION
        no_action = action == NO_ACTION or action not in self.spec.actions
        if no_action:
            action = self.spec.default_action
        self._prev_tokens = ctx
        self._prev_decided = action
        self.decisions += 1
        return DecisionInfo(action=action, mode=_decision_mode(agent), no_action=no_action)

    def advance(self, elapsed: float) -> None:
        if elapsed > 0.0:
            self.agent.advance_time(float(elapsed))

    # ----- sleep --------------------------------------------------------------------------------
    def sleep(self, cycles: Optional[int] = None) -> dict:
        """Consolidate. The previous action is left open: the next decide() after waking closes it."""
        stats = self.agent.sleep(cycles=int(cycles or self.spec.sleep_cycles), sleep_duration_seconds=0.0)
        self.sleeps += 1
        return stats if isinstance(stats, dict) else {}

    # ----- inheritance --------------------------------------------------------------------------
    def genome(self) -> dict:
        return self._factory.extract_genome(self.agent).to_dict()

    def epigenome(self) -> Optional[dict]:
        snap = self._factory.extract_epigenome(self.agent)
        return None if snap.is_empty() else snap.to_dict()

    # ----- persistence --------------------------------------------------------------------------
    def save(self, path: Path) -> Path:
        ensure_nowa()
        from storage import AgentStorage

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        a = self.agent
        written = AgentStorage(save_dir=str(path.parent)).save_agent(
            a.hippocampus, a.cortex, a.selector, filename=path.name, **_all_components(a))
        written = Path(written)
        if not written.is_absolute():
            written = path.parent / written.name
        return written

    def host_state(self) -> dict:
        """What the .nowa file does not carry but the brain wrapper needs to resume."""
        epi = getattr(self.agent, "epigenome", None)
        return {
            "prev_tokens": self._prev_tokens,
            "prev_decided": self._prev_decided,
            "decisions": self.decisions,
            "sleeps": self.sleeps,
            "genome": self.genome(),
            "epigenome": epi.to_dict() if epi is not None and not epi.is_empty() else None,
        }

    @classmethod
    def load(cls, spec: BrainSpec, path: Path, host_state: dict, seed: Optional[int] = None) -> "NowaBrain":
        ensure_nowa()
        from storage import AgentStorage

        brain = cls(spec, genome=host_state.get("genome"), epigenome=None, seed=seed)
        a = brain.agent
        path = Path(path)
        AgentStorage(save_dir=str(path.parent)).load_agent(
            a.hippocampus, a.cortex, a.selector, str(path), **_all_components(a))
        if host_state.get("epigenome"):
            from epigenome import EpigenomeSnapshot

            a.epigenome = EpigenomeSnapshot.from_dict(host_state["epigenome"])
        brain._prev_tokens = host_state.get("prev_tokens")
        brain._prev_decided = host_state.get("prev_decided")
        brain.decisions = int(host_state.get("decisions", 0))
        brain.sleeps = int(host_state.get("sleeps", 0))
        return brain

    # ----- introspection ------------------------------------------------------------------------
    def stable_payload(self) -> dict:
        ensure_nowa()
        from learning_guard import stable_payload

        return stable_payload(self.agent)

    def introspect(self) -> dict:
        a = self.agent
        axes = {}
        try:
            axes = {k: round(float(v), 3) for k, v in dict(a.affective_space.axes).items()}
        except Exception:
            pass
        nm = {}
        try:
            n = a.neuromodulators
            nm = {k: round(float(getattr(n, k)), 3)
                  for k in ("dopamine", "serotonin", "norepinephrine", "acetylcholine", "cortisol")}
        except Exception:
            pass
        uncertainty = None
        try:
            uncertainty = round(float((a._last_decision_arbitration_output or {}).get("global_uncertainty")), 3)
        except Exception:  # noqa: BLE001
            pass
        return {
            "uncertainty": uncertainty,
            "affect": axes,
            "neuromodulators": nm,
            "mode": _decision_mode(a),
            "episodes": len(getattr(a.hippocampus, "experiences", []) or []),
            "decisions": self.decisions,
            "sleeps": self.sleeps,
            "last_tokens": list(self._prev_tokens or []),
            "last_action": self._prev_decided,
        }


def payload_diff(a: dict, b: dict) -> List[str]:
    """Names of stable_payload sections that differ."""
    import json

    def canon(x):
        return json.dumps(x, sort_keys=True, default=str)

    keys = sorted(set(a) | set(b))
    return [k for k in keys if canon(a.get(k)) != canon(b.get(k))]


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
        return v if math.isfinite(v) else default
    except Exception:
        return default
