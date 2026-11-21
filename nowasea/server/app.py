"""aiohttp server: static renderer, WebSocket stream, save import/export."""

from __future__ import annotations

import asyncio
import json
import logging
import webbrowser
from pathlib import Path

from aiohttp import WSMsgType, web

from nowasea import REPO_ROOT

log = logging.getLogger("nowasea.server")
HUB_KEY = web.AppKey("hub", object)
TASK_KEY = web.AppKey("hub_task", asyncio.Task)

STATE_HZ = 20.0
STATS_HZ = 1.0
INSPECT_HZ = 4.0
PLANKTON_HZ = 1.0

PLACEHOLDER = """<!doctype html><meta charset=utf-8><title>NOWA Sea</title>
<body style="font:16px system-ui;background:#06121c;color:#cfe;padding:2em">
<h1>NOWA Sea</h1><p>Renderer is not built. Run <code>scripts/setup</code> (it builds <code>renderer/dist</code>).</p>
<p>Server is running; WebSocket at <code>/ws</code>.</p></body>"""


class Hub:
    def __init__(self, source):
        self.source = source
        self.clients: set[web.WebSocketResponse] = set()
        self.selected: dict[web.WebSocketResponse, int | None] = {}

    async def send_hello(self, ws):
        await ws.send_str(json.dumps(self.source.hello()))
        await ws.send_bytes(self.source.floor_frame())
        await ws.send_bytes(self.source.plankton_frame())

    async def broadcast_hello(self):
        for ws in list(self.clients):
            try:
                await self.send_hello(ws)
            except Exception:  # noqa: BLE001
                self.clients.discard(ws)

    async def _send_all(self, payload, binary: bool):
        dead = []
        for ws in list(self.clients):
            try:
                if binary:
                    await ws.send_bytes(payload)
                else:
                    await ws.send_str(payload)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def loop(self):
        tick = 0
        period = 1.0 / STATE_HZ
        while True:
            await asyncio.sleep(period)
            tick += 1
            if not self.clients:
                continue
            frame = self.source.state_frame()
            if frame:
                await self._send_all(frame, True)
            for ev in self.source.pop_events():
                await self._send_all(json.dumps(ev), False)
            if tick % int(STATE_HZ / INSPECT_HZ) == 0:
                for ws, cid in list(self.selected.items()):
                    if cid:
                        info = self.source.inspect(cid)
                        if info is not None:
                            try:
                                await ws.send_str(json.dumps(info))
                            except Exception:  # noqa: BLE001
                                pass
            if tick % int(STATE_HZ / STATS_HZ) == 0:
                await self._send_all(json.dumps(self.source.stats()), False)
            if tick % int(STATE_HZ * 5) == 0:
                ins = getattr(self.source, "insights", lambda: None)()
                if ins:
                    await self._send_all(json.dumps(ins), False)
            if tick % int(STATE_HZ / PLANKTON_HZ) == 0:
                await self._send_all(self.source.plankton_frame(), True)

    async def handle_command(self, ws, msg: dict):
        if msg.get("t") == "select":
            self.selected[ws] = msg.get("id")
        loop = asyncio.get_running_loop()
        reply = await loop.run_in_executor(None, self.source.command, msg)
        if reply:
            replies = reply if isinstance(reply, list) else [reply]
            for r in replies:
                if r.get("t") == "hello":
                    await self.broadcast_hello()
                else:
                    await ws.send_str(json.dumps(r))


def make_app(source, dist: Path | None = None) -> web.Application:
    dist = dist or (REPO_ROOT / "renderer" / "dist")
    hub = Hub(source)
    app = web.Application(client_max_size=512 * 1024 * 1024)
    app[HUB_KEY] = hub

    async def index(_req):
        f = dist / "index.html"
        if f.is_file():
            return web.FileResponse(f, headers={"Cache-Control": "no-store"})
        return web.Response(text=PLACEHOLDER, content_type="text/html")

    async def health(_req):
        return web.json_response({"ok": True, "clients": len(hub.clients)})

    async def ws_handler(req):
        # Only the page served by this server may drive the aquarium (load, delete, spawn...).
        origin = req.headers.get("Origin")
        if origin:
            from urllib.parse import urlparse

            if urlparse(origin).netloc != req.host:
                raise web.HTTPForbidden(text="cross-origin WebSocket refused")
        ws = web.WebSocketResponse(max_msg_size=16 * 1024 * 1024, heartbeat=20)
        await ws.prepare(req)
        hub.clients.add(ws)
        try:
            await hub.send_hello(ws)
            async for m in ws:
                if m.type == WSMsgType.TEXT:
                    try:
                        msg = json.loads(m.data)
                    except ValueError:
                        continue
                    if isinstance(msg, dict):
                        try:
                            await hub.handle_command(ws, msg)
                        except Exception as exc:  # noqa: BLE001
                            log.exception("command failed: %s", msg)
                            await ws.send_str(json.dumps({"t": "toast", "level": "error",
                                                          "text": {"ru": f"Ошибка: {exc}", "en": f"Error: {exc}"}}))
                elif m.type == WSMsgType.ERROR:
                    break
        finally:
            hub.clients.discard(ws)
            hub.selected.pop(ws, None)
        return ws

    async def export_save(req):
        slot = req.match_info["slot"]
        path = getattr(source, "save_path", lambda s: None)(slot)
        if not path or not Path(path).is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={"Content-Disposition": f'attachment; filename="{Path(path).name}"'})

    async def import_save(req):
        slot = req.query.get("slot") or "imported"
        data = await req.read()
        fn = getattr(source, "import_save", None)
        if not fn:
            raise web.HTTPNotImplemented()
        loop = asyncio.get_running_loop()
        info = await loop.run_in_executor(None, fn, slot, data)
        return web.json_response(info)

    async def on_startup(app_):
        source.start()
        app_[TASK_KEY] = asyncio.create_task(hub.loop())

    async def on_cleanup(app_):
        app_[TASK_KEY].cancel()
        source.stop()

    app.router.add_get("/", index)
    app.router.add_get("/api/health", health)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/saves/{slot}.zip", export_save)
    app.router.add_post("/api/saves/import", import_save)
    if dist.is_dir():
        app.router.add_static("/static/", dist, show_index=False)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def serve(source, host: str, port: int, open_browser: bool):
    app = make_app(source)
    url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '') else host}:{port}/"
    if open_browser:
        async def _open(_app):
            asyncio.get_running_loop().call_later(0.8, webbrowser.open, url)
        app.on_startup.append(_open)
    print(f"NOWA Sea at {url}  (Ctrl+C to stop)", flush=True)
    web.run_app(app, host=host, port=port, print=None, handle_signals=True)
