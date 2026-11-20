// ============================================================================
// WebSocket link to the server (same origin, /ws): hello -> floor -> world build; state, plankton; commands out
// ============================================================================
let ws = null, wsOk = false, helloMsg = null, worldKey = '', wantBuild = null, building = false, queued = null;
let plank = null; // last plankton frame: { nx, ny, nz, data }
const jsonL = [], stateL = [];
const nowaSpecies = () => (helloMsg ? helloMsg.species : []);
function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
const sendSelect = (id) => send({ t: 'select', id: id || null });
function notice(m) { const n = document.getElementById('n'); if (n) { n.textContent = m; n.style.display = m ? 'block' : 'none'; } }
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsOk = true; notice(''); };
  ws.onclose = () => { if (wsOk || !helloMsg) notice(TXT.reconnect); wsOk = false; setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const d = e.data;
    if (typeof d === 'string') {
      let m; try { m = JSON.parse(d); } catch { return; }
      if (m && m.t === 'hello') onHello(m);
      for (let i = 0; i < jsonL.length; i++) { try { jsonL[i](m); } catch (er) { console.error(er); } }
      return;
    }
    if (!(d instanceof ArrayBuffer) || d.byteLength < 8) return;
    const ty = new DataView(d).getUint8(0);
    if (ty === 1) { onStateFrame(d); const s = snap[snHead]; for (let i = 0; i < stateL.length; i++) { try { stateL[i](s); } catch (er) { console.error(er); } } }
    else if (ty === 2) onPlankton(d);
    else if (ty === 3) onFloor(d);
  };
}
function onHello(m) {
  if (helloMsg && helloMsg.world_id !== m.world_id) { tracksReset(); select(0); }
  helloMsg = m; setSpecies(m); uploadSpecies(m);
  const key = JSON.stringify(m.tank);
  wantBuild = key !== worldKey ? key : null; // the floor frame that follows completes it
}
function onFloor(buf) {
  if (!wantBuild || !helloMsg) return;
  const dv = new DataView(buf), nx = dv.getUint16(2, true), nz = dv.getUint16(4, true);
  if (buf.byteLength < 8 + nx * nz * 4) return;
  const job = { hello: helloMsg, key: wantBuild, nx, nz, h: new Float32Array(buf.slice(8, 8 + nx * nz * 4)) };
  wantBuild = null;
  if (building) { queued = job; return; }
  runBuild(job);
}
function runBuild(job) {
  building = true;
  buildWorld(job).then(() => { worldKey = job.key; }, (e) => { console.error(e); dead || ($('s').textContent = 'World build failed: ' + e.message); })
    .finally(() => { building = false; if (queued) { const q = queued; queued = null; runBuild(q); } });
}
function onPlankton(buf) {
  const dv = new DataView(buf), nx = dv.getUint16(2, true), ny = dv.getUint16(4, true), nz = dv.getUint16(6, true);
  if (buf.byteLength < 8 + nx * ny * nz || !nx || !ny || !nz) return;
  plank = { nx, ny, nz, data: new Uint8Array(buf, 8, nx * ny * nz) };
  uploadPlankton();
}
