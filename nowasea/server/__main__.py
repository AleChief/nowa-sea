"""python -m nowasea.server [--demo] [--port 8770] [--open] ..."""

from __future__ import annotations

import argparse
import logging
import multiprocessing as mp


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m nowasea.server", description="NOWA Sea aquarium server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8770)
    p.add_argument("--open", action="store_true", help="open the aquarium in the default browser")
    p.add_argument("--demo", action="store_true", help="scripted motion only (renderer development)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--scale", type=float, default=1.0,
                   help="population scale: 1.0 = targets from docs/species.md; 0.25 for a light machine load")
    p.add_argument("--brain-workers", type=int, default=0, help="NOWA worker processes (0 = auto)")
    p.add_argument("--saves", default=None, help="save directory (default: ./saves)")
    p.add_argument("--load", default=None, help="slot to load at start")
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--brain", choices=("nowa", "stub", "reflex", "random"), default="nowa",
                   help="nowa (default); stub = rule-based stand-ins for fast UI work; reflex / random = "
                        "non-learning control groups for comparing against NOWA")
    p.add_argument("--new", action="store_true", help="start a new world instead of continuing the autosave")
    p.add_argument("--control-share", type=float, default=0.25,
                   help="share of NOWA creatures in the frozen control caste (same brain, no learning); new worlds")
    p.add_argument("--autosave-min", type=float, default=15.0,
                   help="autosave every N simulated minutes and on shutdown (0 = off); the next start continues it")
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(name)s: %(message)s")

    from nowasea.server.app import serve

    if a.demo:
        from nowasea.server.demo import DemoSource

        source = DemoSource(seed=a.seed, scale=a.scale)
    else:
        from nowasea.server.sim_source import SimSource

        source = SimSource(seed=a.seed, scale=a.scale, workers=a.brain_workers, saves_dir=a.saves,
                           load_slot=a.load, speed=a.speed, brain_kind=a.brain,
                           resume=not a.new, autosave_min=a.autosave_min, control_share=a.control_share)
    serve(source, a.host, a.port, a.open)
    return 0


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
