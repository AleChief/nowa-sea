"""WebSocket protocol smoke test against the real simulation source (stub brains)."""

import asyncio
import json
import struct

import numpy as np
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from nowasea.server.app import make_app
from nowasea.server.protocol import CREATURE_DTYPE, PARTICLE_DTYPE
from nowasea.server.sim_source import SimSource


def test_ws_stream_and_commands(tmp_path):
    async def run():
        src = SimSource(scale=0.15, workers=1, brain_kind="stub", saves_dir=str(tmp_path))
        # workers=1 still uses a process for stub brains: exercise the real pool path.
        app = make_app(src, dist=tmp_path / "nodist")
        async with TestClient(TestServer(app)) as client:
            ws = await client.ws_connect("/ws")
            hello = json.loads((await ws.receive()).data)
            assert hello["t"] == "hello" and len(hello["species"]) == 5
            floor = (await ws.receive()).data
            assert floor[0] == 3
            nx, nz = struct.unpack("<HH", floor[2:6])
            assert len(floor) == 8 + 4 * nx * nz
            got_state = got_stats = False
            await ws.send_str(json.dumps({"t": "speed", "value": 5}))
            for _ in range(200):
                m = await ws.receive(timeout=10)
                if m.type == WSMsgType.BINARY and m.data[0] == 1:
                    head = struct.unpack("<BBHIdffffHH", m.data[:36])
                    n, mcount = head[2], head[9]
                    assert len(m.data) == 36 + n * CREATURE_DTYPE.itemsize + mcount * PARTICLE_DTYPE.itemsize
                    c = np.frombuffer(m.data, dtype=CREATURE_DTYPE, count=n, offset=36)
                    assert n > 0 and np.isfinite(c["pos"]).all()
                    got_state = True
                elif m.type == WSMsgType.TEXT and json.loads(m.data)["t"] == "stats":
                    got_stats = True
                if got_state and got_stats:
                    break
            assert got_state and got_stats
            await ws.send_str(json.dumps({"t": "save", "slot": "ws"}))
            for _ in range(200):
                m = await ws.receive(timeout=30)
                if m.type == WSMsgType.TEXT and json.loads(m.data)["t"] == "saved":
                    break
            else:
                raise AssertionError("no saved reply")
            r = await client.get("/api/saves/ws.zip")
            assert r.status == 200 and len(await r.read()) > 100
            await ws.close()

    asyncio.run(run())
