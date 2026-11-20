"""Brains sharded over worker processes (or run inline for tests).

The host sends batches of decision requests and collects answers without blocking. Sleep (consolidation)
runs on a background thread inside the worker so one sleeping brain does not stall the others' decisions.
Engine-independent: requests carry only tokens, rewards and times.
"""

from __future__ import annotations

import itertools
import multiprocessing as mp
import os
import queue
import threading
import time
import traceback
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from nowasea.brains.nowa_adapter import BrainSpec

# A decision request: (id, tokens, executed_prev, reward_prev, elapsed, novelty, conflict, bias)
Request = Tuple[int, List[str], Optional[str], Optional[float], float, float, float, Optional[dict]]
# A decision answer: (id, action, mode, no_action, cost_ms)
Answer = Tuple[int, str, str, bool, float]


def _brain_class(kind: str):
    if kind == "stub":
        from nowasea.brains.stub import StubBrain

        return StubBrain
    from nowasea.brains.nowa_adapter import NowaBrain

    return NowaBrain


class BrainHost:
    """Holds brains of one shard. Used directly inline, or inside a worker process."""

    def __init__(self, kind: str):
        self.kind = kind
        self.cls = _brain_class(kind)
        self.brains: Dict[int, object] = {}
        self.locks: Dict[int, threading.Lock] = defaultdict(threading.Lock)
        self.sleeping: set[int] = set()
        self.out: "queue.Queue[tuple]" = queue.Queue()
        self._sleep_q: "queue.Queue[tuple]" = queue.Queue()
        self._sleeper = threading.Thread(target=self._sleep_loop, daemon=True, name="brain-sleeper")
        self._sleeper.start()

    def _sleep_loop(self):
        while True:
            bid, cycles = self._sleep_q.get()
            brain = self.brains.get(bid)
            if brain is None:
                self.sleeping.discard(bid)
                continue
            t = time.perf_counter()
            try:
                with self.locks[bid]:
                    brain.sleep(cycles)
                err = None
            except Exception as exc:  # noqa: BLE001
                err = f"{type(exc).__name__}: {exc}"
            self.sleeping.discard(bid)
            self.out.put(("slept", bid, (time.perf_counter() - t) * 1000.0, err))

    def handle(self, msg: tuple) -> Optional[tuple]:
        op = msg[0]
        if op == "decide":
            answers: List[Answer] = []
            for (bid, tokens, executed, reward, elapsed, novelty, conflict, bias) in msg[1]:
                brain = self.brains.get(bid)
                if brain is None or bid in self.sleeping:
                    answers.append((bid, "", "skipped", True, 0.0))  # clears the host's pending flag
                    continue
                t = time.perf_counter()
                with self.locks[bid]:
                    info = brain.decide(tokens, executed_prev=executed, reward_prev=reward, elapsed=elapsed,
                                        novelty=novelty, conflict=conflict, bias=bias)
                answers.append((bid, info.action, info.mode, info.no_action, (time.perf_counter() - t) * 1000.0))
            return ("decided", answers)
        if op == "create":
            _, bid, spec, genome, epigenome, seed = msg
            self.brains[bid] = self.cls(BrainSpec(**spec), genome=genome, epigenome=epigenome, seed=seed)
            return ("created", bid, self.brains[bid].genome())
        if op == "load":
            _, bid, spec, path, host_state, seed = msg
            self.brains[bid] = self.cls.load(BrainSpec(**spec), Path(path), host_state, seed=seed)
            return ("created", bid, self.brains[bid].genome())
        if op == "sleep":
            _, bid, cycles = msg
            if bid in self.brains and bid not in self.sleeping:
                self.sleeping.add(bid)
                self._sleep_q.put((bid, cycles))
            return None
        if op == "remove":
            self.brains.pop(msg[1], None)
            self.sleeping.discard(msg[1])
            return None
        if op == "epigenome":
            _, rid, bid = msg
            brain = self.brains.get(bid)
            if brain is None:
                return ("reply", rid, None)
            with self.locks[bid]:
                return ("reply", rid, {"genome": brain.genome(), "epigenome": brain.epigenome()})
        if op == "inspect":
            _, rid, bid = msg
            brain = self.brains.get(bid)
            if brain is None:
                return ("reply", rid, None)
            if bid in self.sleeping:
                return ("reply", rid, {"sleeping": True})
            with self.locks[bid]:
                return ("reply", rid, brain.introspect())
        if op == "save":
            _, rid, directory = msg
            while self.sleeping:  # a consistent snapshot needs sleeps to finish
                time.sleep(0.01)
            states = {}
            for bid, brain in list(self.brains.items()):
                with self.locks[bid]:
                    brain.save(Path(directory) / f"{bid}.nowa")
                    states[bid] = brain.host_state()
            return ("reply", rid, states)
        if op == "payloads":
            _, rid = msg
            return ("reply", rid, {bid: b.stable_payload() for bid, b in self.brains.items()})
        if op == "rss":
            from nowasea.tools.sysinfo import rss_mb

            return ("reply", msg[1], rss_mb())
        if op == "reset":
            while self.sleeping:
                time.sleep(0.01)
            self.brains.clear()
            return ("reply", msg[1], True)
        raise ValueError(f"unknown op {op}")


def _worker_main(conn, kind: str, nowa_path: Optional[str]):
    if nowa_path:
        os.environ["NOWA_PATH"] = nowa_path
    try:
        os.nice(5)  # type: ignore[attr-defined]  # be polite to the simulation thread on POSIX
    except Exception:  # noqa: BLE001
        pass
    host = BrainHost(kind)
    while True:
        try:
            while not host.out.empty():
                conn.send(host.out.get_nowait())
            if not conn.poll(0.02):
                continue
            msg = conn.recv()
            if msg[0] == "stop":
                break
            reply = host.handle(msg)
            if reply is not None:
                conn.send(reply)
        except (EOFError, BrokenPipeError):
            break
        except Exception as exc:  # noqa: BLE001
            try:
                conn.send(("error", f"{type(exc).__name__}: {exc}", traceback.format_exc(limit=8)))
            except Exception:  # noqa: BLE001
                break


class BrainPool:
    """Front end used by the simulation. ``workers == 0`` runs brains inline (tests)."""

    def __init__(self, kind: str = "nowa", workers: int = 2, nowa_path: Optional[str] = None):
        self.kind = kind
        self.workers = max(0, int(workers))
        self.assign: Dict[int, int] = {}
        self.pending: Dict[int, float] = {}         # id -> wall time of the outstanding request
        self.answers: List[Answer] = []
        self.slept: List[Tuple[int, float, Optional[str]]] = []
        self.created_genomes: Dict[int, dict] = {}
        self.errors: List[str] = []
        self._rid = itertools.count(1)
        self._replies: Dict[int, object] = {}
        self.cost_ms: List[float] = []
        self.sleep_ms: List[float] = []
        self.decisions_done = 0
        if self.workers == 0:
            self._inline = BrainHost(kind)
            self._conns = []
            self._procs = []
        else:
            ctx = mp.get_context("spawn")
            self._inline = None
            self._conns, self._procs = [], []
            for i in range(self.workers):
                parent, child = ctx.Pipe()
                p = ctx.Process(target=_worker_main, args=(child, kind, nowa_path), daemon=True,
                                name=f"nowa-brain-{i}")
                p.start()
                self._conns.append(parent)
                self._procs.append(p)

    # ----- plumbing -------------------------------------------------------------------------------
    def _send(self, shard: int, msg: tuple) -> None:
        if self._inline is not None:
            reply = self._inline.handle(msg)
            if reply is not None:
                self._on_reply(reply)
            self._drain_inline()
        else:
            self._conns[shard].send(msg)

    def _drain_inline(self):
        while not self._inline.out.empty():
            self._on_reply(self._inline.out.get_nowait())

    def _on_reply(self, reply: tuple) -> None:
        op = reply[0]
        if op == "decided":
            for ans in reply[1]:
                self.pending.pop(ans[0], None)
                self.answers.append(ans)
                self.cost_ms.append(ans[4])
                self.decisions_done += 1
            if len(self.cost_ms) > 4000:
                del self.cost_ms[:2000]
        elif op == "slept":
            self.slept.append((reply[1], reply[2], reply[3]))
            self.sleep_ms.append(reply[2])
            if len(self.sleep_ms) > 500:
                del self.sleep_ms[:250]
        elif op == "created":
            self.created_genomes[reply[1]] = reply[2]
        elif op == "reply":
            self._replies[reply[1]] = reply[2]
        elif op == "error":
            self.errors.append(reply[1] + "\n" + reply[2])

    def poll(self) -> None:
        if self._inline is not None:
            self._drain_inline()
            return
        for conn in self._conns:
            while conn.poll(0):
                self._on_reply(conn.recv())

    def _shard_for(self, bid: int) -> int:
        if bid not in self.assign:
            counts = [0] * max(1, self.workers)
            for s in self.assign.values():
                counts[s] += 1
            self.assign[bid] = counts.index(min(counts))
        return self.assign[bid]

    def _call(self, shard: int, msg_fn, timeout: float = 120.0):
        rid = next(self._rid)
        self._send(shard, msg_fn(rid))
        deadline = time.time() + timeout
        while rid not in self._replies:
            if time.time() > deadline:
                raise TimeoutError(f"brain worker {shard} did not answer")
            self.poll()
            if rid not in self._replies:
                time.sleep(0.002)
        return self._replies.pop(rid)

    # ----- API ------------------------------------------------------------------------------------
    def create(self, bid: int, spec: BrainSpec, genome=None, epigenome=None, seed=None) -> None:
        self._send(self._shard_for(bid), ("create", bid, asdict(spec), genome, epigenome, seed))

    def load(self, bid: int, spec: BrainSpec, path: str, host_state: dict, seed=None) -> None:
        self._send(self._shard_for(bid), ("load", bid, asdict(spec), str(path), host_state, seed))

    def submit(self, requests: List[Request]) -> None:
        by_shard: Dict[int, List[Request]] = defaultdict(list)
        now = time.time()
        for r in requests:
            if r[0] in self.pending:
                continue
            self.pending[r[0]] = now
            by_shard[self._shard_for(r[0])].append(r)
        for shard, batch in by_shard.items():
            self._send(shard, ("decide", batch))

    def take_answers(self) -> List[Answer]:
        self.poll()
        out, self.answers = self.answers, []
        return out

    def take_slept(self):
        self.poll()
        out, self.slept = self.slept, []
        return out

    def sleep(self, bid: int, cycles: int) -> None:
        self._send(self._shard_for(bid), ("sleep", bid, int(cycles)))

    def remove(self, bid: int) -> None:
        if bid in self.assign:
            self._send(self.assign[bid], ("remove", bid))
            del self.assign[bid]
        self.pending.pop(bid, None)

    def inheritance(self, bid: int) -> Optional[dict]:
        if bid not in self.assign:
            return None
        return self._call(self.assign[bid], lambda rid: ("epigenome", rid, bid))

    def inspect(self, bid: int) -> Optional[dict]:
        if bid not in self.assign:
            return None
        return self._call(self.assign[bid], lambda rid: ("inspect", rid, bid), timeout=10.0)

    def save_all(self, directory: Path) -> Dict[int, dict]:
        """Blocking: every shard writes <id>.nowa into directory and returns host states."""
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        shards = range(self.workers) if self.workers else [0]
        rids = {}
        for s in shards:
            rid = next(self._rid)
            rids[rid] = s
            self._send(s, ("save", rid, str(directory)))
        states: Dict[int, dict] = {}
        deadline = time.time() + 600
        while any(r not in self._replies for r in rids):
            if time.time() > deadline:
                raise TimeoutError("save timed out")
            self.poll()
            time.sleep(0.005)
        for r in rids:
            states.update(self._replies.pop(r))
        return states

    def payloads(self) -> Dict[int, dict]:
        shards = range(self.workers) if self.workers else [0]
        out = {}
        for s in shards:
            out.update(self._call(s, lambda rid: ("payloads", rid)))
        return out

    def worker_rss(self) -> List[float]:
        if not self.workers:
            return []
        return [self._call(s, lambda rid: ("rss", rid), timeout=10.0) for s in range(self.workers)]

    def reset(self) -> None:
        shards = range(self.workers) if self.workers else [0]
        for s in shards:
            self._call(s, lambda rid: ("reset", rid))
        self.assign.clear()
        self.pending.clear()
        self.answers.clear()
        self.slept.clear()

    def wait_idle(self, timeout: float = 60.0) -> None:
        deadline = time.time() + timeout
        while self.pending and time.time() < deadline:
            self.poll()
            time.sleep(0.002)

    def close(self) -> None:
        for conn in self._conns:
            try:
                conn.send(("stop",))
            except Exception:  # noqa: BLE001
                pass
        for p in self._procs:
            p.join(timeout=5)
            if p.is_alive():
                p.terminate()

    def load_stats(self) -> dict:
        costs = sorted(self.cost_ms[-1000:])
        p95 = costs[int(len(costs) * 0.95)] if costs else 0.0
        return {"workers": self.workers, "brains": len(self.assign), "pending": len(self.pending),
                "p95_ms": round(p95, 2), "p50_ms": round(costs[len(costs) // 2], 2) if costs else 0.0,
                "sleep_ms_mean": round(sum(self.sleep_ms[-50:]) / max(1, len(self.sleep_ms[-50:])), 1),
                "decisions": self.decisions_done}
