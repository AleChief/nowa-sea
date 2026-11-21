"""Compatibility check of a NOWA checkout against our host contract.

    python -m nowasea.brains.compat [--nowa PATH] [--baseline FILE] [--write-baseline] [--json]

Exit code 0 when the contract holds. Performance is compared with a machine-local baseline and only warns.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
import time
import traceback
from pathlib import Path

ACTIONS = ["forage", "school", "flee", "hide", "rest", "explore"]
LEVELS = ("low", "mid", "high")


def _tokens(rng: random.Random, state: dict) -> list:
    for k in ("threat", "food", "energy", "cover"):
        state[k] = min(2, max(0, state.get(k, 1) + rng.choice((-1, 0, 0, 1))))
    return [f"{k}:{LEVELS[v]}" for k, v in sorted(state.items())]


def _reward(action: str, state: dict) -> float:
    threat, food = state["threat"], state["food"]
    if action in ("flee", "hide"):
        return 0.3 * threat - 0.1
    if action == "forage":
        return 0.3 * food - 0.4 * threat
    return 0.05 - 0.2 * threat


def _run(brain, rng, n, elapsed=0.7):
    state, executed, reward, costs = {}, None, None, []
    for _ in range(n):
        toks = _tokens(rng, state)
        t = time.perf_counter()
        info = brain.decide(toks, executed_prev=executed, reward_prev=reward, elapsed=elapsed)
        costs.append((time.perf_counter() - t) * 1000)
        if info.action not in ACTIONS:
            raise AssertionError(f"action outside channels: {info.action}")
        executed, reward = info.action, _reward(info.action, state)
    return costs


def check(nowa: str | None, baseline_file: Path | None, write_baseline: bool) -> dict:
    if nowa:
        os.environ["NOWA_PATH"] = str(Path(nowa).resolve())
    from nowasea.brains import nowa_adapter as na

    report = {"nowa_path": str(na.nowa_root()), "checks": {}, "perf": {}, "warnings": []}
    checks = report["checks"]

    def step(name, fn):
        try:
            fn()
            checks[name] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks[name] = f"FAIL: {type(exc).__name__}: {exc}"
            report.setdefault("tracebacks", {})[name] = traceback.format_exc(limit=6)

    ctx = {}
    spec = na.BrainSpec(species="compat", actions=ACTIONS, wake_interval_s=600.0, hippocampus_capacity=128)

    def import_core():
        na.ensure_nowa()

    def smoke():
        rng = random.Random(3)
        brain = na.NowaBrain(spec, genome=na.random_genome(rng), seed=3)
        costs = _run(brain, rng, 300)
        t = time.perf_counter()
        brain.sleep()
        sleep_ms = (time.perf_counter() - t) * 1000
        costs += _run(brain, rng, 50)
        intro = brain.introspect()
        assert intro["episodes"] > 0, "no episodes recorded"
        assert intro["affect"], "affect axes unavailable"
        assert any(abs(v) > 1e-6 for v in intro["affect"].values()),             "affect is frozen at zero: the host contract (step dt / commit order) is broken"
        ctx["brain"], ctx["rng"] = brain, rng
        tail = sorted(costs[-100:])
        report["perf"] = {"decision_ms_p50": round(tail[50], 3), "decision_ms_p95": round(tail[94], 3),
                          "sleep_ms": round(sleep_ms, 1)}

    def roundtrip():
        brain = ctx["brain"]
        with tempfile.TemporaryDirectory() as d:
            path = brain.save(Path(d) / "a.nowa")
            host = brain.host_state()
            json.dumps(host)  # must be JSON-serialisable
            restored = na.NowaBrain.load(spec, path, host, seed=99)
        diff = na.payload_diff(brain.stable_payload(), restored.stable_payload())
        assert not diff, f"stable_payload differs after load: {diff}"
        _run(restored, random.Random(5), 20)

    def breeding():
        rng = random.Random(7)
        mother, father = ctx["brain"], na.NowaBrain(spec, genome=na.random_genome(rng), seed=8)
        _run(father, rng, 60)
        father.sleep()
        g = na.child_genome(mother.genome(), father.genome(), rng)
        assert na.genome_generation(g) >= 1, "child generation not incremented"
        epi = na.blend_epigenomes(mother.epigenome(), father.epigenome(), rng)
        child = na.NowaBrain(spec, genome=g, epigenome=epi, seed=9)
        _run(child, rng, 20)
        assert 0.5 <= na.lifespan_factor(g) <= 2.0

    step("import", import_core)
    if checks["import"] == "ok":
        step("smoke", smoke)
        if checks["smoke"] == "ok":
            step("save_load_roundtrip", roundtrip)
            step("breeding", breeding)

    if baseline_file and report["perf"]:
        if write_baseline:
            baseline_file.parent.mkdir(parents=True, exist_ok=True)
            baseline_file.write_text(json.dumps(report["perf"], indent=2), encoding="utf-8")
        elif baseline_file.is_file():
            base = json.loads(baseline_file.read_text(encoding="utf-8"))
            report["baseline"] = base
            for key, value in report["perf"].items():
                if key in base and base[key] > 0 and value > 1.5 * base[key]:
                    report["warnings"].append(f"{key}: {value} vs baseline {base[key]} (>1.5x)")
    report["ok"] = all(v == "ok" for v in checks.values()) and len(checks) == 4
    return report


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--nowa", help="NOWA checkout (default: NOWA_PATH or vendor/nowa)")
    p.add_argument("--baseline", type=Path, help="machine-local perf baseline JSON")
    p.add_argument("--write-baseline", action="store_true")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    report = check(a.nowa, a.baseline, a.write_baseline)
    if a.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"NOWA: {report['nowa_path']}")
        for name, status in report["checks"].items():
            print(f"  {name:22s} {status}")
        if report["perf"]:
            print("  perf: " + ", ".join(f"{k}={v}" for k, v in report["perf"].items()))
        for w in report["warnings"]:
            print(f"  WARNING {w}")
        for name, tb in (report.get("tracebacks") or {}).items():
            print(f"--- {name}\n{tb}")
        print("RESULT: " + ("OK" if report["ok"] else "FAILED"))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
