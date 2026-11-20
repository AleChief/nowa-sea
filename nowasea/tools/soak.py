"""Headless soak run of the real simulation at a given speed.

    python -m nowasea.tools.soak --scale 0.25 --workers 2 --speed 10 --minutes 5 [--brain nowa|stub] [--json out.json]

Reports achieved speed, decision cost (p50/p95), brain lag waits, memory growth, populations, births/deaths.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from nowasea.server.sim_source import SimSource
from nowasea.tools.sysinfo import rss_mb


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--scale", type=float, default=0.25)
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--speed", default="10")
    p.add_argument("--minutes", type=float, default=5.0, help="wall-clock minutes")
    p.add_argument("--brain", default="nowa")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--json", default=None)
    p.add_argument("--hippocampus", type=int, default=None, help="NOWA hippocampus capacity override")
    a = p.parse_args(argv)
    src = SimSource(seed=a.seed, scale=a.scale, workers=a.workers, brain_kind=a.brain,
                    saves_dir=os.path.join("tmp", "soak-saves"), hippocampus=a.hippocampus)
    src._handle({"t": "speed", "value": a.speed if a.speed == "turbo" else float(a.speed)})
    src.start()
    t0 = time.time()
    sim_t0 = src.sim.time
    rss0 = None
    samples = []
    try:
        while time.time() - t0 < a.minutes * 60:
            time.sleep(10)
            st = src.stats()
            if not st.get("pop"):
                continue
            rss = rss_mb()
            try:
                workers_rss = src.pool.worker_rss()
            except Exception:  # noqa: BLE001
                workers_rss = []
            if rss0 is None and time.time() - t0 > 30:
                rss0 = rss
            row = {"wall_s": round(time.time() - t0), "sim_h": round(src.sim.time / 3600, 3),
                   "achieved": st["speed"]["achieved"], "pop": st["pop"], "births": st["births"],
                   "deaths": sum(st["deaths"].values()), "p50_ms": st["brains"].get("p50_ms"),
                   "p95_ms": st["brains"].get("p95_ms"), "lag_waits": st["brains"].get("lag_waits"),
                   "pending": st["brains"].get("pending"), "rss_mb": round(rss, 1), "workers_rss_mb": [round(x, 1) for x in workers_rss],
                   "gen_max": st["generation_max"]}
            samples.append(row)
            print(json.dumps(row), flush=True)
    finally:
        src._stop = True
        if src._thread:
            src._thread.join(timeout=10)
        src.pool.close()
    wall = time.time() - t0
    summary = {"wall_s": round(wall, 1), "sim_s": round(src.sim.time - sim_t0, 1),
               "mean_speed": round((src.sim.time - sim_t0) / wall, 2), "rss_start_mb": rss0,
               "rss_end_mb": samples[-1]["rss_mb"] if samples else None,
               "deaths_by_cause": src.sim.deaths, "births": src.sim.births,
               "p95_ms_last": samples[-1]["p95_ms"] if samples else None}
    print("SUMMARY " + json.dumps(summary))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump({"summary": summary, "samples": samples}, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
