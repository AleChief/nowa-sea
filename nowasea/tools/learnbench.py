"""Can a NOWA brain learn a simple contingency through our host interface? A controlled bench.

    python -m nowasea.tools.learnbench [--decisions 1500] [--sleep-every 200] [--reward 0.5] [--bias 0]

World: each decision the context is either danger (``threat:near``) or calm. In danger, an evasive action
(flee/hide) is rewarded +R, anything else -R; in calm, foraging is rewarded +R/2. Prints the share of evasive
choices in danger per block, for NOWA and for a uniform random policy. No ecology, no noise from predators.
"""

from __future__ import annotations

import argparse
import json
import random
import sys

ACTIONS = ["forage", "school", "flee", "hide", "rest", "explore", "mate"]
EVASIVE = {"flee", "hide"}


def run(decisions: int, sleep_every: int, reward: float, bias: float, seed: int, kind: str, noise: int = 0) -> list:
    from nowasea.brains import nowa_adapter as na
    from nowasea.brains.stub import RandomBrain

    # The core samples actions from the module-level random (selector.py), not the agent's seeded RNG:
    # without this a seed does not make a run reproducible.
    random.seed(seed)
    spec = na.BrainSpec("bench", ACTIONS, wake_interval_s=(sleep_every or 200) * 1.5, hippocampus_capacity=128)
    brain = na.NowaBrain(spec, genome=na.random_genome(random.Random(seed)), seed=seed) if kind == "nowa" \
        else RandomBrain(spec, seed=seed)
    rng = random.Random(seed + 1)
    executed = prev_reward = None
    blocks, cur = [], [0, 0]
    for i in range(decisions):
        danger = rng.random() < 0.4
        toks = ["threat:near" if danger else "threat:none", "food:" + rng.choice(("near", "far")),
                "energy:" + rng.choice(("mid", "high")), "light:day"]
        toks += [f"f{k}:" + rng.choice(("low", "mid", "high")) for k in range(noise)]  # irrelevant features
        b = {"flee": bias, "hide": bias} if (danger and bias > 0) else None
        info = brain.decide(toks, executed_prev=executed, reward_prev=prev_reward, elapsed=1.5, bias=b)
        a = info.action
        if danger:
            cur[0] += 1
            cur[1] += a in EVASIVE
            prev_reward = reward if a in EVASIVE else -reward
        else:
            prev_reward = reward / 2 if a == "forage" else 0.0
        executed = a
        if sleep_every and (i + 1) % sleep_every == 0:
            brain.sleep(3)
        if (i + 1) % 150 == 0:
            blocks.append(round(cur[1] / max(1, cur[0]), 2))
            cur = [0, 0]
    return blocks


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--decisions", type=int, default=1500)
    p.add_argument("--sleep-every", type=int, default=200)
    p.add_argument("--reward", type=float, default=0.5)
    p.add_argument("--bias", type=float, default=0.0)
    p.add_argument("--seeds", type=int, default=3)
    p.add_argument("--noise", type=int, default=0, help="extra irrelevant 3-level features per context")
    a = p.parse_args(argv)
    out, tails = {}, {}
    for kind in ("nowa", "random"):
        runs = [run(a.decisions, a.sleep_every, a.reward, a.bias, s, kind, a.noise) for s in range(a.seeds)]
        out[kind] = [round(sum(col) / len(col), 2) for col in zip(*runs)]
        tails[kind] = [round(sum(r[-3:]) / len(r[-3:]), 3) for r in runs]  # per seed: mean of the last 3 blocks
    print(json.dumps({"args": vars(a), "evasive_share_per_150_decisions": out, "per_seed_last3": tails}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
