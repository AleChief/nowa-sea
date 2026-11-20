// ============================================================================
// cameras and input: outside (orbit around the tank), inside (free flight), follow (trails a selected creature)
// ============================================================================
const TXT_RU = {
  connecting: 'Подключение…', reconnect: 'Нет связи с сервером, переподключение…', sculpt: 'Лепим дно бака…', carve: 'Режем камень…',
  grow: 'Растим келп…', light: 'Включаем свет…', noGpu: 'Нужен WebGPU: откройте в свежем Chrome или Edge.', noAdapter: 'WebGPU-адаптер не найден.',
  lost: 'Видеоустройство потеряно. Перезагрузите страницу.',
  modes: ['Снаружи', 'Внутри', 'Следить'], cycle: 'по кругу',
  inside: 'плыть', look: 'мышь — обзор (щёлкните, чтобы захватить)', updown: 'вниз / вверх', fast: 'быстрее',
  outside: 'тяните — вращать, колесо — приблизить (сквозь стекло — внутрь)',
  follow: 'щелчок по существу — выбрать и следовать', leave: 'следовать / отпустить, Esc — снять выбор', stats: 'статистика', mute: 'звук', detail: 'Детали:',
  lv: ['Мин', 'Сред', 'Макс'],
};
const TXT_EN = {
  connecting: 'Connecting…', reconnect: 'No connection to the server, reconnecting…', sculpt: 'Sculpting the tank floor…', carve: 'Carving rock…',
  grow: 'Growing kelp…', light: 'Letting the light in…', noGpu: 'This scene needs WebGPU. Try a current Chrome or Edge.', noAdapter: 'No WebGPU adapter found.',
  lost: 'The graphics device was lost. Reload the page to try again.',
  modes: ['Outside', 'Inside', 'Follow'], cycle: 'cycle',
  inside: 'swim', look: 'mouse look (click to capture)', updown: 'down / up', fast: 'faster',
  outside: 'drag to orbit, wheel to zoom (through the glass to dive in)',
  follow: 'click a creature to select and follow it', leave: 'follow / stop, Esc drops the selection', stats: 'stats', mute: 'sound', detail: 'Detail:',
  lv: ['Low', 'Med', 'High'],
};
// interface language: remembered choice, else the browser's; setLang switches every text (legend, HUD)
const TXT = {};
let LANG = 'en';
try { LANG = localStorage['nowasea.lang']; } catch {}
if (LANG !== 'ru' && LANG !== 'en') LANG = /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en';
Object.assign(TXT, LANG === 'ru' ? TXT_RU : TXT_EN);
function setLang(l) { LANG = l === 'ru' ? 'ru' : 'en'; Object.assign(TXT, LANG === 'ru' ? TXT_RU : TXT_EN); keep('nowasea.lang', LANG); legend(); hudLang(); }

// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(64);
// mode camera: position, yaw, pitch; basis (render); free-flight velocity; clock
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, LAST = 18, GPU = 19, HUDT = 20, MX = 22, MY = 23, MZ = 24;
// displayed pose = mode pose + an offset that dies away after an outside <-> inside switch (TRK: 0..1)
const DX = 25, DY = 26, DZ = 27, DYAW = 28, DPIT = 29, OFX = 30, OFY = 31, OFZ = 32, OFYAW = 33, OFPIT = 34, TRK = 35;
// orbit: yaw, elevation, distance (targets and smoothed), target point
const OYAW = 36, OPIT = 37, ODIST = 38, OYS = 39, OPS = 40, ODS = 41, OTX = 42, OTY = 43, OTZ = 44;
// follow: yaw / elevation offsets, distance factor (targets and smoothed), smoothed look-at point
const FOY = 45, FOP = 46, FOD = 47, FOYS = 48, FOPS = 49, FODS = 50, FLX = 51, FLY = 52, FLZ = 53;
// the inside pose to come back to
const IX = 54, IY = 55, IZ = 56, IYAW = 57, IPIT = 58, CPU = 59;
const MODES = ['outside', 'inside', 'follow'];
let camMode = 0, followId = 0, insideSet = false, tHx = 40, tDep = 30, tHz = 25;
F[TRK] = 1; F[OYAW] = F[OYS] = -0.42; F[OPIT] = F[OPS] = 0.34; F[ODIST] = F[ODS] = 100; F[OTY] = -15; F[FOD] = F[FODS] = 1; F[FOP] = F[FOPS] = 0.22; F[FOY] = F[FOYS] = 0.5;
const inBox = (x, y, z, m) => abs(x) < tHx - m && abs(z) < tHz - m && y < -m && y > -tDep + m;
const wrapA = (a) => a - TAU * floor((a + PI) / TAU);

function setTankCamera(tank) {
  tHx = tank.half_x; tDep = tank.depth; tHz = tank.half_z;
  F[OTX] = 0; F[OTY] = -tDep * 0.5; F[OTZ] = 0;
  F[ODIST] = F[ODS] = max(2.2 * tHx, 60);
  if (!insideSet) { F[IX] = -0.1 * tHx; F[IY] = -0.55 * tDep; F[IZ] = 0.85 * tHz; F[IYAW] = 0.55; F[IPIT] = -0.12; }
}
// orbit pose -> mode camera
function orbitPose() {
  const y = F[OYS], e = F[OPS], d = F[ODS], ce = cos(e);
  F[CX] = F[OTX] - ce * sin(y) * d; F[CY] = F[OTY] + sin(e) * d; F[CZ] = F[OTZ] + ce * cos(y) * d;
  F[YAW] = y; F[PIT] = -e;
}
// switch camera mode; outside <-> inside glides there over 1.6 s (the offset dies away), follow chases on its own
function setMode(m) {
  m = m | 0; if (m < 0 || m > 2) return;
  if (m === 2 && !followId) { const id = autoPick(-1); if (!id) return; followId = id; sendSelect(id); }
  if (m !== 1 && document.pointerLockElement) document.exitPointerLock();
  const from = camMode;
  if (m === 0 && from !== 0) {
    F[OYAW] = F[OYS] = F[DYAW]; F[OPIT] = F[OPS] = clamp(-F[DPIT], 0.25, 0.9); F[ODIST] = F[ODS] = max(F[ODIST], 2.2 * tHx);
    orbitPose(); startGlide();
  } else if (m === 1 && from === 0) {
    F[CX] = F[IX]; F[CY] = F[IY]; F[CZ] = F[IZ]; F[YAW] = F[IYAW]; F[PIT] = F[IPIT]; F[VX] = F[VY] = F[VZ] = 0;
    startGlide();
  } else if (m === 1 && from === 2) {
    F[CX] = F[DX]; F[CY] = F[DY]; F[CZ] = F[DZ]; F[YAW] = F[DYAW]; F[PIT] = F[DPIT]; F[VX] = F[VY] = F[VZ] = 0;
  } else if (m === 2) {
    F[CX] = F[DX]; F[CY] = F[DY]; F[CZ] = F[DZ]; F[YAW] = F[DYAW]; F[PIT] = F[DPIT]; F[TRK] = 1;
    F[FOY] = F[FOYS] = 0.5; const t = trackOf(followId);
    if (t >= 0) { F[FLX] = tkP[t * 3]; F[FLY] = tkP[t * 3 + 1]; F[FLZ] = tkP[t * 3 + 2]; }
  }
  camMode = m; legend();
}
function startGlide() {
  F[OFX] = F[DX] - F[CX]; F[OFY] = F[DY] - F[CY]; F[OFZ] = F[DZ] - F[CZ]; F[OFYAW] = wrapA(F[DYAW] - F[YAW]); F[OFPIT] = F[DPIT] - F[PIT]; F[TRK] = 0;
}
// a creature to follow when none is selected: the one nearest the middle of the view (of species `sp`, or any)
function autoPick(sp) {
  let best = -1, bs = -2;
  for (let li = 0; li < tkN; li++) {
    const t = tkList[li]; if (!tkHas[t] || tkVis[t] < 0.5 || (sp >= 0 && tkSp[t] !== sp)) continue;
    const dx = tkP[t * 3] - F[DX], dy = tkP[t * 3 + 1] - F[DY], dz = tkP[t * 3 + 2] - F[DZ], d = hypot(dx, dy, dz) || 1;
    const s = (dx * F[FX] + dy * F[FY] + dz * F[FZ]) / d - d * 0.002;
    if (s > bs) { bs = s; best = t; }
  }
  return best >= 0 ? tkId[best] : 0;
}
function select(id) {
  id = id ? id >>> 0 : 0;
  if (id) { if (followId !== id) { followId = id; sendSelect(id); } if (camMode !== 2) setMode(2); }
  else { if (camMode === 2) setMode(1); if (followId) { sendSelect(null); followId = 0; } }
  hudSel();
}

// ---------------------------------------------------------------- collision with rock (inside and follow)
// CS[j] = distance into rock (metres, < 0 in water, clamped to +-1) at the camera + CE[3j..3j+2]: the camera, then
// +-0.375 m on each axis for the gradient. CG: the baked density as Int8, 127 = 1 m.
let CG = null;
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
function sdAt(j) {
  let x = (F[CX] + CE[j * 3] - OX) / VS, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2] - OZ) / VS;
  x = x < 0 ? 0 : x > NX - 1.001 ? NX - 1.001 : x; y = y < 0 ? 0 : y > NY - 1.001 ? NY - 1.001 : y; z = z < 0 ? 0 : z > NZ - 1.001 ? NZ - 1.001 : z;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, w = z - iz, i = ix + NX * (iy + NY * iz), sy = NX, sz = NX * NY;
  const a = CG[i] + (CG[i + 1] - CG[i]) * u, b = CG[i + sy] + (CG[i + sy + 1] - CG[i + sy]) * u;
  const c = CG[i + sz] + (CG[i + sz + 1] - CG[i + sz]) * u, d = CG[i + sz + sy] + (CG[i + sz + sy + 1] - CG[i + sz + sy]) * u;
  const e = a + (b - a) * v; CS[j] = (e + (c + (d - c) * v - e) * w) / 127;
}
// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along; then keeps it in the water box.
const CR = 0.35;
// true when rock lies on the segment a -> b (stopping `short` metres before b), sampled every 0.2 m
function rockBetween(ax, ay, az, bx, by, bz, short) {
  if (!CG) return false;
  const dx = bx - ax, dy = by - ay, dz = bz - az, d = sqrt(dx * dx + dy * dy + dz * dz), n = floor((d - short) / 0.2);
  for (let i = 1; i <= n; i++) {
    const t = i * 0.2 / d, x = round((ax + dx * t - OX) / VS), y = round((ay + dy * t - OY) / VS), z = round((az + dz * t - OZ) / VS);
    if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
    if (CG[x + NX * (y + NY * z)] > 20) return true; // > 0.15 m into rock
  }
  return false;
}
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.3) + 1;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    if (CG) for (let k = 0; k < 2; k++) {
      sdAt(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sdAt(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
  const m = 0.4;
  F[CX] = clamp(F[CX], -tHx + m, tHx - m); F[CY] = clamp(F[CY], -tDep + m, -0.3); F[CZ] = clamp(F[CZ], -tHz + m, tHz - m);
}

// ---------------------------------------------------------------- per frame
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0;
function updateCamera(dt) {
  // mouse look through two cascaded low-pass stages
  const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
  const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
  const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
  if (camMode === 0) {
    const k = 1 - exp(-dt * 7);
    F[OYS] += (F[OYAW] - F[OYS]) * k; F[OPS] += (F[OPIT] - F[OPS]) * k; F[ODS] += (F[ODIST] - F[ODS]) * k;
    orbitPose();
    // zoomed in through the glass: carry on swimming from there
    if (F[TRK] >= 1 && inBox(F[CX], F[CY], F[CZ], 0.45)) { camMode = 1; F[VX] = F[VY] = F[VZ] = 0; legend(); }
  } else if (camMode === 1) {
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = pitch < -1.55 ? -1.55 : pitch > 1.55 ? 1.55 : pitch;
    const sp = ks ? 16 : 4.5, k = 1 - exp(-dt * 4.5), mf = kf - kb, mr = kr - kl, mu = ku - kd, cp = cos(pitch), sy = sin(yaw), cw = cos(yaw);
    const vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k, vy = F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k, vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = vx * dt; F[MY] = vy * dt; F[MZ] = vz * dt;
    collide();
    F[IX] = F[CX]; F[IY] = F[CY]; F[IZ] = F[CZ]; F[IYAW] = F[YAW]; F[IPIT] = F[PIT]; insideSet = true;
  } else {
    const t = trackOf(followId);
    if (t < 0) { if (snN) select(0); }
    else {
      const k = 1 - exp(-dt * 6);
      F[FOYS] += (F[FOY] - F[FOYS]) * k; F[FOPS] += (F[FOP] - F[FOPS]) * k; F[FODS] += (F[FOD] - F[FODS]) * k;
      const o = t * 3, px = tkP[o], py = tkP[o + 1], pz = tkP[o + 2];
      const hy = atan2(tkF[o], -tkF[o + 2]) + F[FOYS], e = F[FOPS], d = F[FODS] * max(tkSz[t] * 2.6, 1.4), ce = cos(e);
      const kc = 1 - exp(-dt * 2.5);
      F[MX] = (px - ce * sin(hy) * d - F[CX]) * kc; F[MY] = (py + sin(e) * d - F[CY]) * kc; F[MZ] = (pz + ce * cos(hy) * d - F[CZ]) * kc;
      F[VX] = F[MX] / max(dt, 1e-3); F[VY] = F[MY] / max(dt, 1e-3); F[VZ] = F[MZ] / max(dt, 1e-3);
      collide();
      const kl2 = 1 - exp(-dt * 8);
      F[FLX] += (px - F[FLX]) * kl2; F[FLY] += (py - F[FLY]) * kl2; F[FLZ] += (pz - F[FLZ]) * kl2;
      const lx = F[FLX] - F[CX], ly = F[FLY] - F[CY], lz = F[FLZ] - F[CZ];
      F[YAW] = atan2(lx, -lz); F[PIT] = atan2(ly, sqrt(lx * lx + lz * lz));
    }
  }
  // displayed pose
  F[TRK] = F[TRK] + dt / 1.6; if (F[TRK] > 1) F[TRK] = 1;
  const s0 = F[TRK], s = 1 - s0 * s0 * (3 - 2 * s0);
  F[DX] = F[CX] + F[OFX] * s; F[DY] = F[CY] + F[OFY] * s; F[DZ] = F[CZ] + F[OFZ] * s; F[DYAW] = F[YAW] + F[OFYAW] * s; F[DPIT] = F[PIT] + F[OFPIT] * s;
}

// ---------------------------------------------------------------- poses for the hooks and URL parameters
function camPose() { return { mode: MODES[camMode], x: F[DX], y: F[DY], z: F[DZ], yaw: F[DYAW], pitch: F[DPIT], follow: followId || null }; }
// p: {mode?, x?, y?, z?, yaw?, pitch?, dist?, id?, species?}; jumps there (no glide)
function setCamPose(p) {
  p = p || {};
  const m = typeof p.mode === 'string' ? MODES.indexOf(p.mode) : camMode;
  const has = (k) => typeof p[k] === 'number' && isFinite(p[k]);
  if (m === 0) {
    if (has('x') && has('y') && has('z')) {
      const dx = F[OTX] - p.x, dy = F[OTY] - p.y, dz = F[OTZ] - p.z, d = hypot(dx, dy, dz) || 1;
      F[ODIST] = d; F[OYAW] = atan2(dx, -dz); F[OPIT] = Math.asin(clamp(-dy / d, -1, 1));
    }
    if (has('yaw')) F[OYAW] = p.yaw; if (has('pitch')) F[OPIT] = -p.pitch; if (has('dist')) F[ODIST] = p.dist;
    F[OYS] = F[OYAW]; F[OPS] = F[OPIT]; F[ODS] = F[ODIST]; camMode = 0; orbitPose();
  } else if (m === 1) {
    camMode = 1;
    if (has('x')) F[CX] = p.x; if (has('y')) F[CY] = p.y; if (has('z')) F[CZ] = p.z; if (has('yaw')) F[YAW] = p.yaw; if (has('pitch')) F[PIT] = p.pitch;
    F[VX] = F[VY] = F[VZ] = 0; F[MX] = F[MY] = F[MZ] = 0; collide();
  } else if (m === 2) {
    let id = has('id') ? p.id >>> 0 : 0;
    if (!id && p.species !== undefined) { const s = (nowaSpecies() || []).find((q) => q.id === p.species || q.index === p.species); if (s) id = autoPick(s.index); }
    if (!id) id = followId || autoPick(-1);
    if (!id) return false;
    if (has('dist')) F[FOD] = F[FODS] = p.dist; if (has('yaw')) F[FOY] = F[FOYS] = p.yaw; if (has('pitch')) F[FOP] = F[FOPS] = -p.pitch;
    followId = id; sendSelect(id); camMode = 2;
    const t = trackOf(id);
    if (t >= 0) { const o = t * 3; F[FLX] = tkP[o]; F[FLY] = tkP[o + 1]; F[FLZ] = tkP[o + 2]; const d = max(tkSz[t] * 2.6, 1.4) * F[FOD]; F[CX] = tkP[o] - tkF[o] * d; F[CY] = tkP[o + 1] + d * 0.25; F[CZ] = tkP[o + 2] - tkF[o + 2] * d; }
  }
  F[TRK] = 1; F[OFX] = F[OFY] = F[OFZ] = F[OFYAW] = F[OFPIT] = 0;
  F[DX] = F[CX]; F[DY] = F[CY]; F[DZ] = F[CZ]; F[DYAW] = F[YAW]; F[DPIT] = F[PIT];
  legend();
  return true;
}

// ---------------------------------------------------------------- input (registered by main.js once it is ready)
function initInput() {
  const typing = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const key = (e, v) => {
    switch (e.code) {
      case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
      case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
      default: if (v && !e.repeat) {
        if (e.code === 'KeyH') { hud = !hud; info.textContent = ''; }
        else if (e.code === 'KeyM') mute();
        else if (e.code === 'Digit1') setMode(0);
        else if (e.code === 'Digit2') setMode(1);
        else if (e.code === 'Digit3') setMode(2);
        else if (e.code === 'KeyC') setMode((camMode + 1) % 3);
        // F: follow the selected creature / stop following; Esc: stop following, then drop the selection
        else if (e.code === 'KeyF') { if (camMode === 2) setMode(1); else if (followId) setMode(2); }
        else if (e.code === 'Escape' && !hudBusy()) { if (camMode === 2) setMode(1); else if (followId) select(0); }
      }
    }
  };
  addEventListener('keydown', (e) => { if (typing(e)) return; sound(); key(e, 1); });
  addEventListener('keyup', (e) => key(e, 0));
  addEventListener('blur', () => { kf = kb = kl = kr = ku = kd = ks = 0; drag = false; });
  let drag = false, moved = 0, lx = 0, ly = 0;
  const locked = () => document.pointerLockElement === canvas;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    sound(); drag = true; moved = 0; lx = e.clientX; ly = e.clientY;
    if (!locked()) { try { canvas.setPointerCapture(e.pointerId); } catch {} canvas.classList.add('drag'); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (locked()) { mdx += e.movementX; mdy += e.movementY; return; }
    if (!drag) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += abs(dx) + abs(dy);
    if (camMode === 0) { F[OYAW] += dx * 0.005; F[OPIT] = clamp(F[OPIT] + dy * 0.004, 0.02, 1.45); }
    else if (camMode === 1) { mdx += dx; mdy += dy; }
    else { F[FOY] -= dx * 0.006; F[FOP] = clamp(F[FOP] + dy * 0.004, -0.7, 1.3); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return; drag = false; canvas.classList.remove('drag');
    if (moved > 6) return;
    const r = canvas.getBoundingClientRect(), lk = locked(), sx = lk ? r.width / 2 : e.clientX - r.left, sy = lk ? r.height / 2 : e.clientY - r.top;
    // a HUD tool (feed, spawn) takes the click first
    if (hudClick(sx, sy, r.width, r.height)) return;
    // a creature under the cursor is selected in any mode; elsewhere a click inside the water captures the mouse
    const id = pickCreature(sx, sy, r.width, r.height, UB, TANH);
    if (id) { select(id); return; }
    if (camMode === 1 && !lk) { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = exp(clamp(e.deltaY, -300, 300) * 0.0012);
    if (camMode === 0) F[ODIST] = clamp(F[ODIST] * k, 6, 260);
    else if (camMode === 2) F[FOD] = clamp(F[FOD] * k, 0.3, 6);
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => { body.classList.toggle('p', locked()); });
}

// key legend (bottom left), the current mode lit; detail buttons reload the page with their level
function legend() {
  hudMode();
  const el = document.getElementById('k'); if (!el) return;
  const b = (k) => `<b>${k}</b>`, md = (i) => `<span class="${i === camMode ? 'on' : ''}">${b(i + 1)}${TXT.modes[i]}</span>`;
  el.innerHTML = `${md(0)} · ${md(1)} · ${md(2)} · ${b('C')}${TXT.cycle}<br>` +
    `${b('W')}${b('A')}${b('S')}${b('D')}${TXT.inside} · ${TXT.look} · ${b('Q')}${b('E')}${TXT.updown} · ${b('Shift')}${TXT.fast}<br>` +
    `${TXT.outside}<br>${TXT.follow} · ${b('F')}${TXT.leave} · ${b('H')}${TXT.stats} · ${b('M')}${TXT.mute} · ${TXT.detail}` +
    TXT.lv.map((n, i) => `<button class="q${2 - i === LV ? ' on' : ''}" data-q="${2 - i}">${n}</button>`).join('');
  el.querySelectorAll('button').forEach((x) => { x.onclick = () => { keep(QKEY, x.dataset.q); keep(LKEY, ''); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.href; }; });
}
