// ============================================================================
// creatures and particles from the server stream
// ============================================================================
// Binary `state` frames (20 Hz) go into a ring of preallocated snapshots. Every creature id gets a track that lives
// while the id is in the stream, plus a short fade-out after it leaves (death) and a fade-in when it appears (birth).
// Each frame the tracks are placed between the two snapshots around (now - snDelay), oriented from their velocity,
// and packed, grouped by body plan, into one Float32Array that main.js uploads with a single writeBuffer.
// Nothing here allocates per frame; parsing allocates one DataView per received frame.
const MAXC = 2048, MAXP = 8192, RING = 4, MAXT = 4096, HSZ = 8192;
const MESHK = { fish: 0, manta: 1, needle: 2, shark: 3, jelly: 4 }, NKIND = 5;
const CSTR = 24, PSTR = 5; // floats per creature / particle instance
const snap = [];
for (let r = 0; r < RING; r++) snap.push({ t: 0, seq: 0, flags: 0, n: 0, m: 0, simTime: 0, speedSet: 0, speedAchieved: 0, dayPhase: 0, light: 1, selected: 0,
  id: new Uint32Array(MAXC), species: new Uint8Array(MAXC), intent: new Uint8Array(MAXC), cflags: new Uint8Array(MAXC), glow: new Uint8Array(MAXC),
  pos: new Float32Array(MAXC * 3), vel: new Float32Array(MAXC * 3), scale: new Float32Array(MAXC), energy: new Float32Array(MAXC),
  ppos: new Float32Array(MAXP * 3), pkind: new Uint8Array(MAXP), psize: new Uint8Array(MAXP) });
// snPer: measured interval between new frames (ms); snDelay: how far behind the newest frame the creatures are drawn,
// 1.6 intervals (about 110 ms at 20 Hz, 350 ms in turbo at 5 Hz), so there is nearly always a frame on each side
let snHead = 0, snN = 0, snArr = 0, snPer = 50, snDelay = 110;

// per species (from hello): body plan, length (m), cruise speed, tail beats per metre swum, bank gain
const spKind = new Uint8Array(256), spLen = new Float32Array(256).fill(0.5), spCruise = new Float32Array(256).fill(1), spBeat = new Float32Array(256).fill(1), spBank = new Float32Array(256).fill(0.5);
// per intent index: needlejaw coils into an S (ambush, stalk), sweeper lies flat (burrow)
const itBend = new Uint8Array(256), itFlat = new Uint8Array(256), itHunt = new Uint8Array(256);
// per species: hunts (has chase / strike), is prey (has flee), glows at night (fish, jelly)
const spHunt = new Uint8Array(256), spPrey = new Uint8Array(256), spGlowy = new Uint8Array(256);
function setSpecies(hello) {
  for (const s of hello.species || []) {
    const i = s.index & 255, k = MESHK[s.mesh] ?? 0;
    spKind[i] = k; spLen[i] = s.length || 0.5; spCruise[i] = max(s.cruise || 1, 0.1);
    spBeat[i] = k === 1 ? 0.5 / spLen[i] : k === 4 ? 0.3 : k === 3 ? 0.5 / spLen[i] : 0.8 / spLen[i];
    spBank[i] = k === 3 ? 0.7 : k === 1 ? 0.5 : k === 4 ? 0 : 0.35;
    const act = s.actions || [];
    spHunt[i] = act.includes('strike') || act.includes('chase') ? 1 : 0; spPrey[i] = act.includes('flee') ? 1 : 0; spGlowy[i] = k === 4 || k === 0 ? 1 : 0;
  }
  itBend.fill(0); itFlat.fill(0); itHunt.fill(0); itFlee.fill(0);
  (hello.intents || []).forEach((n, i) => { if (n === 'flee') itFlee[i] = 1; if (n === 'ambush' || n === 'stalk') itBend[i] = 1; if (n === 'burrow') itFlat[i] = 1; if (n === 'chase' || n === 'strike') itHunt[i] = 1; });
}

// ---------------------------------------------------------------- tracks
const tkId = new Uint32Array(MAXT), tkSt = new Uint8Array(MAXT), tkRow = new Int16Array(MAXT * RING), tkSp = new Uint8Array(MAXT), tkHas = new Uint8Array(MAXT);
const tkP = new Float32Array(MAXT * 3), tkV = new Float32Array(MAXT * 3), tkF = new Float32Array(MAXT * 3), tkU = new Float32Array(MAXT * 3), tkFp = new Float32Array(MAXT * 3);
const tkPh = new Float32Array(MAXT), tkVis = new Float32Array(MAXT), tkGlow = new Float32Array(MAXT), tkBend = new Float32Array(MAXT), tkFlat = new Float32Array(MAXT), tkSeed = new Float32Array(MAXT), tkSz = new Float32Array(MAXT);
const tkFl = new Uint8Array(MAXT), tkGl = new Uint8Array(MAXT), tkIt = new Uint8Array(MAXT), tkKind = new Uint8Array(MAXT);
// burst pose: sustained tail amplitude (0..1) and a C-flex impulse at the onset, its side alternating
// highlight life: excitement (speed above cruise, a chase, a flight; attack 0.2 s, release 1 s), mode (1 hunting,
// 2 fleeing) and a short flash (catch, birth)
let hlTestId = 0, hlTestMode = 0; // debug.hlTest: show one creature as hunting (1) or fleeing (2)
const tkEx = new Float32Array(MAXT), tkMode = new Uint8Array(MAXT), tkFlash = new Float32Array(MAXT), itFlee = new Uint8Array(256);
const tkBurst = new Float32Array(MAXT), tkFlex = new Float32Array(MAXT), tkFlexS = new Float32Array(MAXT).fill(1), tkWasB = new Uint8Array(MAXT);
const tkList = new Int32Array(MAXT), tkFree = new Int32Array(MAXT);
let tkN = 0, tkNF = 0;
for (let t = MAXT - 1; t >= 0; t--) tkFree[tkNF++] = t;
// id -> track slot: open addressing, rebuilt whenever a track is freed
const hK = new Uint32Array(HSZ), hV = new Int32Array(HSZ).fill(-1);
let hDirty = false;
function hFind(id) { let h = Math.imul(id, 0x9E3779B1) >>> 19; for (;;) { const v = hV[h]; if (v < 0) return -1; if (hK[h] === id) return v; h = (h + 1) & (HSZ - 1); } }
function hPut(id, v) { let h = Math.imul(id, 0x9E3779B1) >>> 19; while (hV[h] >= 0) h = (h + 1) & (HSZ - 1); hK[h] = id; hV[h] = v; }
function hRebuild() { hV.fill(-1); for (let i = 0; i < tkN; i++) hPut(tkId[tkList[i]], tkList[i]); hDirty = false; }
function tkAlloc(id, s, i) {
  if (!tkNF) return -1;
  const t = tkFree[--tkNF]; tkList[tkN++] = t; hPut(id, t);
  tkEx[t] = 0; tkMode[t] = 0; tkFlash[t] = 0;
  tkId[t] = id; tkSt[t] = 1; tkHas[t] = 0; tkVis[t] = 0; tkBend[t] = 0; tkFlat[t] = 0; tkGlow[t] = 0; tkBurst[t] = 0; tkFlex[t] = 0; tkWasB[t] = 0;
  for (let r = 0; r < RING; r++) tkRow[t * RING + r] = -1;
  const sp = s.species[i]; tkSp[t] = sp; tkKind[t] = spKind[sp];
  tkSeed[t] = ((Math.imul(id, 2654435761) >>> 0) % 10007) / 10007; tkPh[t] = tkSeed[t] * 7;
  const o = t * 3, vx = s.vel[i * 3], vy = s.vel[i * 3 + 1], vz = s.vel[i * 3 + 2], l = hypot(vx, vy, vz);
  tkP[o] = s.pos[i * 3]; tkP[o + 1] = s.pos[i * 3 + 1]; tkP[o + 2] = s.pos[i * 3 + 2];
  if (l > 1e-3) { tkF[o] = vx / l; tkF[o + 1] = vy / l * 0.5; tkF[o + 2] = vz / l; } else { tkF[o] = 1; tkF[o + 1] = 0; tkF[o + 2] = 0; }
  const fl = hypot(tkF[o], tkF[o + 1], tkF[o + 2]); tkF[o] /= fl; tkF[o + 1] /= fl; tkF[o + 2] /= fl;
  tkFp[o] = tkF[o]; tkFp[o + 1] = tkF[o + 1]; tkFp[o + 2] = tkF[o + 2];
  tkU[o] = 0; tkU[o + 1] = 1; tkU[o + 2] = 0;
  return t;
}
function tkFreeAt(li) { const t = tkList[li]; tkList[li] = tkList[--tkN]; tkFree[tkNF++] = t; tkSt[t] = 0; hDirty = true; }
function tracksReset() { while (tkN) tkFreeAt(tkN - 1); hRebuild(); snN = 0; }

// ---------------------------------------------------------------- binary state frame (docs/protocol.md)
// returns false for a repeated frame: the server resends its latest frame at 20 Hz even when it has made fewer (turbo)
function onStateFrame(buf) {
  if (hDirty) hRebuild();
  const dv = new DataView(buf), r = snN ? (snHead + 1) % RING : 0, s = snap[r];
  if (snN && dv.getUint32(4, true) === snap[snHead].seq) return false;
  const n = dv.getUint16(2, true), m = dv.getUint16(32, true), nn = min(n, MAXC), mm = min(m, MAXP);
  s.flags = dv.getUint8(1); s.seq = dv.getUint32(4, true); s.simTime = dv.getFloat64(8, true);
  s.speedSet = dv.getFloat32(16, true); s.speedAchieved = dv.getFloat32(20, true); s.dayPhase = dv.getFloat32(24, true); s.light = dv.getFloat32(28, true);
  s.selected = dv.getUint16(34, true);
  if (buf.byteLength < 36 + 40 * n + 16 * m) return false;
  for (let i = 0, o = 36; i < nn; i++, o += 40) {
    s.id[i] = dv.getUint32(o, true); s.species[i] = dv.getUint8(o + 4); s.intent[i] = dv.getUint8(o + 5); s.cflags[i] = dv.getUint8(o + 6); s.glow[i] = dv.getUint8(o + 7);
    s.pos[i * 3] = dv.getFloat32(o + 8, true); s.pos[i * 3 + 1] = dv.getFloat32(o + 12, true); s.pos[i * 3 + 2] = dv.getFloat32(o + 16, true);
    s.vel[i * 3] = dv.getFloat32(o + 20, true); s.vel[i * 3 + 1] = dv.getFloat32(o + 24, true); s.vel[i * 3 + 2] = dv.getFloat32(o + 28, true);
    s.scale[i] = dv.getFloat32(o + 32, true); s.energy[i] = dv.getFloat32(o + 36, true);
  }
  for (let i = 0, o = 36 + 40 * n; i < mm; i++, o += 16) {
    s.ppos[i * 3] = dv.getFloat32(o, true); s.ppos[i * 3 + 1] = dv.getFloat32(o + 4, true); s.ppos[i * 3 + 2] = dv.getFloat32(o + 8, true);
    s.pkind[i] = dv.getUint8(o + 12); s.psize[i] = dv.getUint8(o + 13);
  }
  s.n = nn; s.m = mm;
  // arrival time on a smoothed clock: snapshots are spaced evenly unless the stream stalls
  const now = performance.now();
  if (!snN || now - snArr > max(400, snPer * 3)) s.t = now;
  else { snPer += (min(now - snArr, 1000) - snPer) * 0.1; const est = snap[snHead].t + snPer; s.t = est + (now - est) * 0.2; }
  snDelay += (clamp(snPer * 1.6 + 25, 90, 800) - snDelay) * 0.1;
  snArr = now; snHead = r; snN++;
  for (let k = 0; k < tkN; k++) tkRow[tkList[k] * RING + r] = -1;
  for (let i = 0; i < nn; i++) {
    let t = hFind(s.id[i]);
    if (t < 0) { t = tkAlloc(s.id[i], s, i); if (t < 0) continue; }
    tkRow[t * RING + r] = i; tkSt[t] = 1;
  }
  for (let k = 0; k < tkN; k++) { const t = tkList[k]; if (tkRow[t * RING + r] < 0) tkSt[t] = 2; }
  return true;
}

// ---------------------------------------------------------------- per frame: interpolate, orient, pack
const CI = new Float32Array(MAXC * CSTR), PI_ = new Float32Array(MAXP * PSTR);
const kindN = new Int32Array(NKIND), kindOff = new Int32Array(NKIND), kindCur = new Int32Array(NKIND);
let nCre = 0, nPart = 0, snB = 0;
function updateCreatures(now, dt) {
  nCre = nPart = 0;
  if (!snN) return;
  if (hDirty) hRebuild();
  // the two snapshots around the render time
  const tr = now - snDelay, cnt = min(snN, RING);
  let a = -1, b = snHead;
  for (let j = 0, k = snHead; j < cnt - 1; j++) {
    const p = (k + RING - 1) % RING;
    if (snap[p].t <= tr || j === cnt - 2) { a = p; b = k; break; }
    k = p;
  }
  const sb = snap[b], sa = a >= 0 ? snap[a] : sb;
  // past the newest frame (a late one): carry on along the last step for at most 35 % of an interval
  let al = a >= 0 ? (tr - sa.t) / max(sb.t - sa.t, 1) : 1; al = al < 0 ? 0 : al > 1.35 ? 1.35 : al;
  snB = b;
  // sim seconds per wall second: swim animation runs at the speed the creatures are seen to move, frozen on pause
  const ws = sb.speedAchieved > 0 ? sb.speedAchieved : 0, kF = 1 - exp(-dt * 5), kU = 1 - exp(-dt * 4), kG = 1 - exp(-dt * 4), kS = 1 - exp(-dt * 2);
  for (let k = 0; k < NKIND; k++) kindN[k] = 0;
  for (let li = 0; li < tkN; li++) {
    const t = tkList[li], o = t * 3, ib = tkRow[t * RING + b], ia = a >= 0 ? tkRow[t * RING + a] : -1;
    if (ib >= 0) {
      let x = sb.pos[ib * 3], y = sb.pos[ib * 3 + 1], z = sb.pos[ib * 3 + 2], vx = sb.vel[ib * 3], vy = sb.vel[ib * 3 + 1], vz = sb.vel[ib * 3 + 2];
      if (ia >= 0) {
        x = sa.pos[ia * 3] + (x - sa.pos[ia * 3]) * al; y = sa.pos[ia * 3 + 1] + (y - sa.pos[ia * 3 + 1]) * al; z = sa.pos[ia * 3 + 2] + (z - sa.pos[ia * 3 + 2]) * al;
        vx = sa.vel[ia * 3] + (vx - sa.vel[ia * 3]) * al; vy = sa.vel[ia * 3 + 1] + (vy - sa.vel[ia * 3 + 1]) * al; vz = sa.vel[ia * 3 + 2] + (vz - sa.vel[ia * 3 + 2]) * al;
      }
      tkP[o] = x; tkP[o + 1] = y; tkP[o + 2] = z; tkV[o] = vx; tkV[o + 1] = vy; tkV[o + 2] = vz;
      tkFl[t] = sb.cflags[ib]; tkGl[t] = sb.glow[ib]; tkIt[t] = sb.intent[ib]; tkSz[t] = spLen[tkSp[t]] * (sb.scale[ib] > 0 ? sb.scale[ib] : 1);
      // the highlight follows this client's selection (full id); the server's flag is for its own last selection
      tkFl[t] = followId && sb.id[ib] === followId ? tkFl[t] | 16 : tkFl[t] & ~16;
      tkHas[t] = 1;
    }
    if (!tkHas[t]) continue; // born after the render time: not shown yet
    const present = ib >= 0;
    tkVis[t] += ((present ? 1 : 0) - tkVis[t]) * (1 - exp(-dt * (present ? 3 : 4)));
    if (!present && tkSt[t] === 2 && tkVis[t] < 0.02) { tkFreeAt(li); li--; continue; }
    const sp = tkSp[t], kind = tkKind[t], fl = tkFl[t];
    const vx = tkV[o], vy = tkV[o + 1], vz = tkV[o + 2], v = sqrt(vx * vx + vy * vy + vz * vz);
    let fx = tkF[o], fy = tkF[o + 1], fz = tkF[o + 2];
    tkFp[o] = fx; tkFp[o + 1] = fy; tkFp[o + 2] = fz;
    if (kind === 4) {
      // jelly: the bell axis stays near vertical and leans a little into its drift; "forward" is any horizontal
      let ux = vx / max(v, 1e-3) * 0.45 * min(v / spCruise[sp], 1), uy = 1, uz = vz / max(v, 1e-3) * 0.45 * min(v / spCruise[sp], 1);
      const ul = 1 / sqrt(ux * ux + uy * uy + uz * uz); ux *= ul; uy *= ul; uz *= ul;
      tkU[o] += (ux - tkU[o]) * kS; tkU[o + 1] += (uy - tkU[o + 1]) * kS; tkU[o + 2] += (uz - tkU[o + 2]) * kS;
      const u0 = tkU[o], u1 = tkU[o + 1], u2 = tkU[o + 2], d = fx * u0 + fy * u1 + fz * u2;
      fx -= u0 * d; fy -= u1 * d; fz -= u2 * d;
    } else if (v > 0.03) {
      // forward follows the velocity (pitch damped a little), smoothed
      const iv = 1 / v;
      fx += (vx * iv - fx) * kF; fy += (vy * iv * 0.85 - fy) * kF; fz += (vz * iv - fz) * kF;
    }
    let l = 1 / max(sqrt(fx * fx + fy * fy + fz * fz), 1e-6); fx *= l; fy *= l; fz *= l;
    tkF[o] = fx; tkF[o + 1] = fy; tkF[o + 2] = fz;
    let ux = tkU[o], uy = tkU[o + 1], uz = tkU[o + 2];
    if (kind !== 4) {
      // up: world up made perpendicular to forward, leaning into the turn (towards where forward is turning)
      let ax = -fx * fy, ay = 1 - fy * fy, az = -fz * fy;
      const bk = spBank[sp] * (fl & 2 ? 1.6 : 1) / max(dt, 1e-3);
      let lx = (fx - tkFp[o]) * bk, lz = (fz - tkFp[o + 2]) * bk; const ll = sqrt(lx * lx + lz * lz);
      if (ll > 0.7) { lx *= 0.7 / ll; lz *= 0.7 / ll; }
      ax += lx; az += lz;
      l = 1 / max(sqrt(ax * ax + ay * ay + az * az), 1e-6);
      ux += (ax * l - ux) * kU; uy += (ay * l - uy) * kU; uz += (az * l - uz) * kU;
    }
    const d = ux * fx + uy * fy + uz * fz; ux -= fx * d; uy -= fy * d; uz -= fz * d;
    l = 1 / max(sqrt(ux * ux + uy * uy + uz * uz), 1e-6); ux *= l; uy *= l; uz *= l;
    tkU[o] = ux; tkU[o + 1] = uy; tkU[o + 2] = uz;
    // swim phase: tail beats per metre swum, plus a slow idle beat; dimmer and slower asleep, faster in a burst
    let rate = (0.35 + v * spBeat[sp]) * (fl & 1 ? 0.35 : 1) * (fl & 2 ? 1.3 : 1) * ws;
    if (kind === 4) rate = (0.45 + v * 0.8) * ws;
    tkPh[t] += dt * (rate < 9 ? rate : 9);
    // glow: excitement byte; asleep it smoulders, in a burst it flares; a ray lying flat goes dark
    const flat = kind === 1 && itFlat[tkIt[t]] ? 1 : 0;
    let gt = (kind === 4 ? 0.9 : 0.35) + 1.4 * tkGl[t] / 255;
    if (fl & 1) gt *= 0.12; if (fl & 2) gt *= 1.8; if (fl & 8) gt *= 0.45; if (flat) gt *= 0.08;
    tkGlow[t] += (gt - tkGlow[t]) * kG;
    tkBend[t] += ((kind === 2 && itBend[tkIt[t]] && !(fl & 2) ? 1 : 0) - tkBend[t]) * kS;
    const bu = fl & 2 ? 1 : 0;
    if (bu && !tkWasB[t]) { tkFlex[t] = 1; tkFlexS[t] = -tkFlexS[t]; }
    tkWasB[t] = bu;
    tkBurst[t] += (bu - tkBurst[t]) * (1 - exp(-dt * (bu ? 8 : 3)));
    tkFlex[t] *= exp(-dt * 4.5);
    tkFlat[t] += (flat - tkFlat[t]) * kS;
    {
      const hunt = spHunt[sp] && itHunt[tkIt[t]] ? 1 : 0, flee = !hunt && spPrey[sp] && (itFlee[tkIt[t]] || (fl & 2)) ? 1 : 0;
      let et = (v / spCruise[sp] - 1.15) / 1.6; et = et < 0 ? 0 : et > 1 ? 1 : et;
      if (fl & 2) et = max(et, 0.9); if (hunt || flee) et = max(et, 0.75);
      if (hlTestId && tkId[t] === hlTestId) et = 1;
      tkMode[t] = hlTestId && tkId[t] === hlTestId ? hlTestMode : hunt ? 1 : flee ? 2 : 0;
      tkEx[t] += (et - tkEx[t]) * (1 - exp(-dt / (et > tkEx[t] ? 0.2 : 1)));
      tkFlash[t] *= exp(-dt * 2.2);
    }
    if (tkVis[t] > 0.01) kindN[kind]++;
  }
  // pack, grouped by body plan
  let off = 0;
  for (let k = 0; k < NKIND; k++) { kindOff[k] = off; kindCur[k] = off; off += kindN[k]; }
  nCre = off;
  for (let li = 0; li < tkN; li++) {
    const t = tkList[li];
    if (!tkHas[t] || tkVis[t] <= 0.01) continue;
    const kind = tkKind[t], j = kindCur[kind]++ * CSTR, o = t * 3, sp = tkSp[t];
    CI[j] = tkP[o]; CI[j + 1] = tkP[o + 1]; CI[j + 2] = tkP[o + 2]; CI[j + 3] = tkSz[t];
    CI[j + 4] = tkF[o]; CI[j + 5] = tkF[o + 1]; CI[j + 6] = tkF[o + 2]; CI[j + 7] = tkPh[t];
    CI[j + 8] = tkU[o]; CI[j + 9] = tkU[o + 1]; CI[j + 10] = tkU[o + 2]; CI[j + 11] = tkGlow[t];
    CI[j + 12] = sp; CI[j + 13] = tkFl[t]; CI[j + 14] = tkBend[t]; CI[j + 15] = tkVis[t];
    CI[j + 16] = tkSeed[t]; CI[j + 17] = sqrt(tkV[o] * tkV[o] + tkV[o + 1] * tkV[o + 1] + tkV[o + 2] * tkV[o + 2]) / spCruise[sp]; CI[j + 18] = tkFlat[t]; CI[j + 19] = tkMode[t];
    CI[j + 20] = tkBurst[t]; CI[j + 21] = tkFlex[t] * tkFlexS[t]; CI[j + 22] = tkEx[t]; CI[j + 23] = tkFlash[t];
  }
  // particles of the same snapshot: position, radius (size byte is the diameter in cm), kind
  const m = sb.m;
  for (let i = 0; i < m; i++) {
    const j = i * PSTR;
    PI_[j] = sb.ppos[i * 3]; PI_[j + 1] = sb.ppos[i * 3 + 1]; PI_[j + 2] = sb.ppos[i * 3 + 2];
    PI_[j + 3] = max(sb.psize[i], 1) * 0.005 * (sb.pkind[i] === 2 ? 1.6 : 1); PI_[j + 4] = sb.pkind[i];
  }
  nPart = m;
}

// creature under screen point (sx, sy) in CSS pixels of a w x h canvas, with view-projection M (column-major);
// returns its id or 0. A creature with rock or kelp between it and the camera is skipped (ray marched in the rock grid).
let pickScore = 0;
function pickCreature(sx, sy, w, h, M, tanh) {
  let after = -1;
  for (;;) {
    const t = pickNext(sx, sy, w, h, M, tanh, after);
    if (t < 0) return 0;
    const o = t * 3;
    if (!rockBetween(F[DX], F[DY], F[DZ], tkP[o], tkP[o + 1], tkP[o + 2], tkSz[t] * 0.5 + 0.3, true)) return tkId[t];
    after = pickScore; // hidden: try the next candidate
  }
}
// the best-scoring candidate with a score above `after` (pickScore = its score), or -1
function pickNext(sx, sy, w, h, M, tanh, after) {
  let best = -1, bs = 1e9;
  for (let li = 0; li < tkN; li++) {
    const t = tkList[li]; if (!tkHas[t] || tkVis[t] < 0.5) continue;
    const o = t * 3, x = tkP[o], y = tkP[o + 1], z = tkP[o + 2];
    const cw = M[3] * x + M[7] * y + M[11] * z + M[15]; if (cw < 0.2) continue;
    const px = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / cw * 0.5 + 0.5) * w, py = (0.5 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / cw * 0.5) * h;
    const rad = max(16, tkSz[t] * 0.55 * (h * 0.5) / (cw * tanh)), dd = hypot(px - sx, py - sy) / rad;
    const sc = dd + cw * 0.004;
    if (dd < 1 && sc < bs && sc > after) { bs = sc; best = t; }
  }
  pickScore = bs;
  return best;
}
// track slot of a creature id that is on screen, or -1
const trackOf = (id) => { if (!id) return -1; if (hDirty) hRebuild(); const t = hFind(id); return t >= 0 && tkHas[t] ? t : -1; };

// a short highlight flash: creature id, or (species index, position) for the nearest of that species
function hlFlash(id, sp, x, y, z) {
  let best = -1, bd = 1e9;
  for (let li = 0; li < tkN; li++) {
    const t = tkList[li];
    if (id) { if (tkId[t] === id) { best = t; break; } continue; }
    if (tkSp[t] !== sp) continue;
    const dx = tkP[t * 3] - x, dy = tkP[t * 3 + 1] - y, dz = tkP[t * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = t; }
  }
  if (best >= 0 && (id || bd < 64)) tkFlash[best] = 1;
}
