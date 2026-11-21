// ============================================================================
// director: an automatic camera for unattended demos (camera mode 3, key 4)
// ============================================================================
// Tour shots: a slow orbit outside the tank, a glide through the water between two clear points looking at a rock
// structure, a look out of the grotto. Between them it follows an interesting creature for 10-20 s: interest comes
// from events (a catch, a birth) and from the stream (a hunter chasing or bursting with prey near, prey slipping into
// cover while a hunter is near); at night glowing species are preferred. A subject or a species seen lately scores
// lower. Shot changes glide (the displayed pose eases over) unless the straight way crosses rock: then they cut.
// Any key, click, wheel or a deliberate mouse move on the scene hands the camera back (camera.js).
// Per frame (directorUpdate) nothing is allocated; events and subject changes allocate a little (captions).
const DO = 0, DG = 1, DGR = 2, DF = 3; // shot kinds: orbit, glide, grotto, follow
const DS = new Float64Array(40);
const S_T = 0, S_DUR = 1, S_KIND = 2, S_YAW = 3, S_EL = 4, S_DIST = 5, S_AX = 6, S_AY = 7, S_AZ = 8, S_BX = 9, S_BY = 10, S_BZ = 11,
  S_LX = 12, S_LY = 13, S_LZ = 14, S_SCAN = 15, S_SINCE = 16, S_N = 17, S_KS = 18, S_PRI = 19, S_MOVE = 20, S_CLOCK = 21, S_PAN = 22, S_LOS = 23;
let dirPrev = 0, dirSubj = 0;
// candidate from the last scan / event: id, score, reason (0 hunt, 1 cover, 2 glow, 3 catch, 4 birth, 5 any), prey species
let candId = 0, candScore = 0, candWhy = 0, candPrey = -1, evId = 0, evScore = 0, evWhy = 0, evPrey = -1, evT = -1e9;
// recently followed: creature id and when (sim clock of the director, s)
const RECENT = new Float64Array(16), RECENTT = new Float64Array(16).fill(-1e9);
let recentI = 0, lastSp = -1;
const POI = []; // [x, y, z, horizontal radius] of rock structures and kelp patches, from the tank
let lastTour = -1;

function directorSetup(tank) {
  POI.length = 0;
  const seen = {};
  for (const p of tank.positives || []) {
    const nm = (p.name || '').replace(/[-\d]+$/, '');
    if (!nm || nm === 'boulder' || seen[nm]) continue;
    seen[nm] = 1;
    const c = p.type === 'capsule' ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2] : p.c;
    const r = p.type === 'capsule' ? hypot(p.a[0] - p.b[0], p.a[2] - p.b[2]) / 2 + p.r : max((p.h || p.r)[0], (p.h || p.r)[2]);
    POI.push([c[0], c[1], c[2], r]);
  }
  for (const k of tank.kelp || []) POI.push([k.c[0], -tDep * 0.6, k.c[1], 0]);
}
function directorStart() {
  DS[S_CLOCK] = DS[S_CLOCK] || 0; DS[S_N] = 0; DS[S_MOVE] = 0;
  dirSubj = 0; evScore = 0; candScore = 0;
  const inWater = inBox(F[DX], F[DY], F[DZ], 0.5);
  shotTour(inWater ? DG : DO);
}
// rock grid value at a point (-127 water .. 127 rock; 127 outside the grid counts as rock-free water: -127)
function rockAt(x, y, z) {
  if (!CG) return -127;
  const ix = round((x - OX) / VS), iy = round((y - OY) / VS), iz = round((z - OZ) / VS);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ) return -127;
  return CG[ix + NX * (iy + NY * iz)];
}
// start a shot: the new pose goes into the mode camera, the displayed one glides over (or cuts when rock is between)
function shotBegin(kind, dur) {
  DS[S_KIND] = kind; DS[S_T] = 0; DS[S_DUR] = dur; DS[S_N]++;
  const inA = inBox(F[DX], F[DY], F[DZ], 0.3), inB = inBox(F[CX], F[CY], F[CZ], 0.3);
  if (inA && inB && rockBetween(F[DX], F[DY], F[DZ], F[CX], F[CY], F[CZ], 0, false)) { F[TRK] = 1; F[OFX] = F[OFY] = F[OFZ] = F[OFYAW] = F[OFPIT] = 0; }
  else startGlide();
}
function lookFrom(x, y, z, lx, ly, lz) { const dx = lx - x, dy = ly - y, dz = lz - z; F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz)); }
// a tour shot of the given kind (falls back to the orbit when no clear glide is found)
function shotTour(kind) {
  dirSubj = 0; hudCaption('');
  if (kind === lastTour && kind !== DG) kind = DG; // no two orbits or grotto looks in a row
  lastTour = kind;
  if (kind === DGR) {
    const gr = (helloMsg && helloMsg.tank.shelters || []).find((s) => s.kind === 'grotto'), wide = (helloMsg && helloMsg.tank.holes || []).find((h) => h.name === 'grotto_wide');
    if (gr && rockAt(gr.c[0], gr.c[1] + 0.4, gr.c[2]) < -40) {
      DS[S_AX] = gr.c[0]; DS[S_AY] = gr.c[1] + 0.4; DS[S_AZ] = gr.c[2];
      const t = wide ? wide.b : [gr.c[0], gr.c[1], gr.c[2] + 6];
      DS[S_LX] = t[0]; DS[S_LY] = t[1]; DS[S_LZ] = t[2]; DS[S_PAN] = rr(-0.5, 0.5);
      F[CX] = DS[S_AX]; F[CY] = DS[S_AY]; F[CZ] = DS[S_AZ]; lookFrom(F[CX], F[CY], F[CZ], DS[S_LX], DS[S_LY], DS[S_LZ]);
      shotBegin(DGR, rr(12, 16)); return;
    }
    kind = DG;
  }
  if (kind === DG && POI.length) {
    for (let tries = 0; tries < 40; tries++) {
      const p = POI[(rnd() * POI.length) | 0], a0 = rnd() * TAU, r0 = p[3] + rr(6, 11), a1 = a0 + rr(0.6, 1.2) * (rnd() < 0.5 ? -1 : 1), r1 = p[3] + rr(5, 9);
      const ax = clamp(p[0] + cos(a0) * r0, -tHx + 1.5, tHx - 1.5), az = clamp(p[2] + sin(a0) * r0, -tHz + 1.5, tHz - 1.5), ay = clamp(p[1] + rr(2, 6), -tDep + 2, -2);
      const bx = clamp(p[0] + cos(a1) * r1, -tHx + 1.5, tHx - 1.5), bz = clamp(p[2] + sin(a1) * r1, -tHz + 1.5, tHz - 1.5), by = clamp(p[1] + rr(1.5, 5), -tDep + 2, -2);
      if (rockAt(ax, ay, az) > -70 || rockAt(bx, by, bz) > -70) continue;
      // the way is clear, and the structure is in sight (up to its surface)
      if (rockBetween(ax, ay, az, bx, by, bz, 0, false) || rockBetween(ax, ay, az, p[0], p[1], p[2], p[3] + 0.5, false)) continue;
      DS[S_AX] = ax; DS[S_AY] = ay; DS[S_AZ] = az; DS[S_BX] = bx; DS[S_BY] = by; DS[S_BZ] = bz; DS[S_LX] = p[0]; DS[S_LY] = p[1]; DS[S_LZ] = p[2];
      F[CX] = ax; F[CY] = ay; F[CZ] = az; lookFrom(ax, ay, az, p[0], p[1], p[2]);
      shotBegin(DG, rr(15, 21)); return;
    }
  }
  // orbit outside: slow, from a random side, a little above the water line
  DS[S_YAW] = F[DYAW] + rr(-0.6, 0.6); DS[S_EL] = rr(0.16, 0.42); DS[S_DIST] = rr(1.9, 2.4) * tHx;
  dirOrbit(0); shotBegin(DO, rr(16, 22));
}
function dirOrbit(dt) {
  DS[S_YAW] += dt * 0.035;
  const y = DS[S_YAW], e = DS[S_EL], d = DS[S_DIST], ce = cos(e);
  F[CX] = -ce * sin(y) * d; F[CY] = -tDep * 0.5 + sin(e) * d; F[CZ] = ce * cos(y) * d; F[YAW] = y; F[PIT] = -e;
}
// the follow offset (DS yaw, elevation, distance) for track t that leaves clear water and a clear line of sight;
// keeps the current one if it is fine, else tries 8 directions at two heights
function clearView(t) {
  const o = t * 3, px = tkP[o], py = tkP[o + 1], pz = tkP[o + 2], h0 = atan2(tkF[o], -tkF[o + 2]), d0 = DS[S_DIST] * max(tkSz[t] * 2.6, 1.4);
  for (let k = 0; k < 48; k++) {
    const j = k % 16, yaw = DS[S_YAW] + (j >> 1) * 0.785 * (j & 1 ? 1 : -1), el = j > 7 ? 0.6 : DS[S_EL], f = k < 16 ? 1 : k < 32 ? 0.65 : 0.4;
    const d = d0 * f, ce = cos(el), hy = h0 + yaw;
    const x = clamp(px - ce * sin(hy) * d, -tHx + 0.6, tHx - 0.6), y = clamp(py + sin(el) * d, -tDep + 0.6, -0.4), z = clamp(pz + ce * cos(hy) * d, -tHz + 0.6, tHz - 0.6);
    if (rockAt(x, y, z) < -40 && !rockBetween(x, y, z, px, py, pz, tkSz[t] * 0.5 + 0.2, true)) { DS[S_YAW] = yaw; DS[S_EL] = el; DS[S_DIST] *= f; return true; }
  }
  return false;
}
// follow creature `id` for a while; `why` picks the caption
function shotFollow(id, why, prey) {
  const t = trackOf(id); if (t < 0) return false;
  dirSubj = id; lastSp = tkSp[t];
  RECENT[recentI] = id; RECENTT[recentI] = DS[S_CLOCK]; recentI = (recentI + 1) & 15;
  DS[S_YAW] = rr(0.4, 1.3) * (rnd() < 0.5 ? -1 : 1); DS[S_EL] = rr(0.12, 0.35); DS[S_DIST] = rr(2.2, 3.2);
  clearView(t);
  const o = t * 3, d = DS[S_DIST] * max(tkSz[t] * 2.6, 1.4), hy = atan2(tkF[o], -tkF[o + 2]) + DS[S_YAW], ce = cos(DS[S_EL]);
  F[CX] = tkP[o] - ce * sin(hy) * d; F[CY] = tkP[o + 1] + sin(DS[S_EL]) * d; F[CZ] = tkP[o + 2] + ce * cos(hy) * d;
  F[MX] = F[MY] = F[MZ] = 0; F[VX] = F[VY] = F[VZ] = 0; collide();
  DS[S_LX] = tkP[o]; DS[S_LY] = tkP[o + 1]; DS[S_LZ] = tkP[o + 2]; lookFrom(F[CX], F[CY], F[CZ], tkP[o], tkP[o + 1], tkP[o + 2]);
  DS[S_PRI] = why === 3 ? 9 : why === 4 ? 7 : why === 0 ? 6 : 4;
  shotBegin(DF, why === 0 || why === 3 ? rr(14, 20) : rr(10, 15));
  hudCaption(dirCaption(t, why, prey));
  return true;
}
const ACC_RU = { sparkfin: 'искорку', sweeper: 'ската-чистильщика', needlejaw: 'иглозуба', shade: 'тень', lumen: 'медузу-люмен' };
function dirCaption(t, why, prey) {
  const sp = (nowaSpecies() || []).find((s) => s.index === tkSp[t]), nm = sp ? (sp.name && sp.name[LANG]) || sp.id : '';
  const pr = prey >= 0 ? (nowaSpecies() || []).find((s) => s.index === prey) : null, pid = pr ? pr.id : '', pn = pr ? (pr.name && pr.name[LANG]) || pr.id : '';
  const ru = LANG === 'ru', low = (s) => s.toLowerCase();
  if (why === 0) return pr ? (ru ? `${nm} охотится на ${ACC_RU[pid] || low(pn)}` : `${nm} hunting a ${low(pn)}`) : (ru ? `${nm} на охоте` : `${nm} on the hunt`);
  if (why === 3) return pr ? (ru ? `${nm} настигает ${ACC_RU[pid] || low(pn)}` : `${nm} catches a ${low(pn)}`) : (ru ? `${nm}: поимка` : `${nm} makes a catch`);
  if (why === 4) return ru ? `Рождение: ${low(nm)}` : `A ${low(nm)} is born`;
  if (why === 1) return ru ? `${nm} прячется в укрытии` : `${nm} slips into cover`;
  if (why === 2) return ru ? `${nm} светится в темноте` : `${nm} glowing in the dark`;
  return '';
}
// a new interest from an event (net.js JSON listener)
function directorEvent(m) {
  if (!m || m.t !== 'event' || camMode !== 3) return;
  const sp = (nowaSpecies() || []).find((s) => s.id === m.species), pr = (nowaSpecies() || []).find((s) => s.id === m.prey);
  if (m.kind === 'catch' && m.pos && sp) {
    // the hunter: the nearest creature of the catching species
    let best = -1, bd = 64;
    for (let li = 0; li < tkN; li++) { const t = tkList[li]; if (!tkHas[t] || tkSp[t] !== sp.index) continue; const dx = tkP[t * 3] - m.pos[0], dy = tkP[t * 3 + 1] - m.pos[1], dz = tkP[t * 3 + 2] - m.pos[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = t; } }
    if (best >= 0 && 9 > evScore) { evId = tkId[best]; evScore = 9; evWhy = 3; evPrey = pr ? pr.index : -1; evT = DS[S_CLOCK]; }
  } else if (m.kind === 'birth' && m.id && 7 > evScore) { evId = m.id; evScore = 7; evWhy = 4; evPrey = -1; evT = DS[S_CLOCK]; }
}
// how much a creature is worth watching now (0 = not)
function seenLately(id) { for (let i = 0; i < 16; i++) if (RECENT[i] === id && DS[S_CLOCK] - RECENTT[i] < 90) return true; return false; }
function scanInterest() {
  candId = 0; candScore = 0; candWhy = 5; candPrey = -1;
  const night = nightS > 0.5;
  for (let li = 0; li < tkN; li++) {
    const t = tkList[li]; if (!tkHas[t] || tkVis[t] < 0.6) continue;
    const sp = tkSp[t], fl = tkFl[t], o = t * 3;
    let sc = night ? (spGlowy[sp] ? 2 : 0.5) : 1, why = night && spGlowy[sp] ? 2 : 5, prey = -1;
    if (spHunt[sp] && (itHunt[tkIt[t]] || fl & 2)) {
      // a prey of another species within 10 m makes it a hunt
      let pd = 100;
      for (let lj = 0; lj < tkN; lj++) { const u = tkList[lj]; if (u === t || !tkHas[u] || tkSp[u] === sp || !spPrey[tkSp[u]] || tkSz[u] > tkSz[t] * 0.8) continue; const dx = tkP[u * 3] - tkP[o], dy = tkP[u * 3 + 1] - tkP[o + 1], dz = tkP[u * 3 + 2] - tkP[o + 2], d = dx * dx + dy * dy + dz * dz; if (d < pd) { pd = d; prey = tkSp[u]; } }
      if (prey >= 0) { sc = fl & 2 ? 8 : 6; why = 0; }
    }
    if (why !== 0 && spPrey[sp] && (fl & 8) && !(DCOV[t])) {
      for (let lj = 0; lj < tkN; lj++) { const u = tkList[lj]; if (!tkHas[u] || !spHunt[tkSp[u]] || tkSp[u] === sp) continue; const dx = tkP[u * 3] - tkP[o], dy = tkP[u * 3 + 1] - tkP[o + 1], dz = tkP[u * 3 + 2] - tkP[o + 2]; if (dx * dx + dy * dy + dz * dz < 81) { sc = 5; why = 1; break; } }
    }
    if (why !== 1 && fl & 8) sc *= 0.3; // tucked away in a shelter: hard to see
    DCOV[t] = fl & 8 ? 1 : 0;
    if (seenLately(tkId[t])) sc *= 0.2;
    if (sp === lastSp) sc *= 0.6;
    if (sc > candScore) { candScore = sc; candId = tkId[t]; candWhy = why; candPrey = prey; }
  }
}
const DCOV = new Uint8Array(MAXT); // cover flag at the last scan, per track slot
function directorUpdate(dt) {
  DS[S_T] += dt; DS[S_SCAN] += dt; DS[S_CLOCK] += dt;
  if (DS[S_SCAN] > 0.7) { DS[S_SCAN] = 0; scanInterest(); }
  const kind = DS[S_KIND], t = DS[S_T];
  // a fresh catch or birth cuts in (not more often than every 8 s); a strong live candidate ends a tour shot early
  if (evScore && DS[S_CLOCK] - evT > 6) evScore = 0;
  if (evScore && t > 8 && (kind !== DF || evScore > DS[S_PRI])) { const id = evId, w = evWhy, p = evPrey; evScore = 0; if (shotFollow(id, w, p)) return dirFrame(0); }
  if (kind !== DF && t > 6 && candScore >= 5) { if (shotFollow(candId, candWhy, candPrey)) return dirFrame(0); }
  if (t > DS[S_DUR] || (kind === DF && trackOf(dirSubj) < 0)) {
    // next: alternate following and touring; at night a glowing creature often fills in
    if (kind !== DF && candScore >= (nightS > 0.5 ? 1.5 : 1) && rnd() < 0.55 && shotFollow(candId, candWhy, candPrey)) return dirFrame(0);
    const r = rnd();
    shotTour(DS[S_N] % 5 === 0 ? DO : r < 0.2 ? DGR : r < 0.4 ? DO : DG);
  }
  dirFrame(dt);
}
// moves the mode camera for the current shot
function dirFrame(dt) {
  const kind = DS[S_KIND], s0 = clamp(DS[S_T] / max(DS[S_DUR], 1), 0, 1), s = s0 * s0 * (3 - 2 * s0);
  if (kind === DO) dirOrbit(dt);
  else if (kind === DG) {
    F[CX] = DS[S_AX] + (DS[S_BX] - DS[S_AX]) * s; F[CY] = DS[S_AY] + (DS[S_BY] - DS[S_AY]) * s; F[CZ] = DS[S_AZ] + (DS[S_BZ] - DS[S_AZ]) * s;
    lookFrom(F[CX], F[CY], F[CZ], DS[S_LX], DS[S_LY], DS[S_LZ]);
  } else if (kind === DGR) {
    // slow pan across the grotto mouth
    lookFrom(F[CX], F[CY], F[CZ], DS[S_LX], DS[S_LY], DS[S_LZ]); F[YAW] += DS[S_PAN] * sin(DS[S_T] * 0.25); F[PIT] += 0.08 * sin(DS[S_T] * 0.17);
  } else {
    const t = trackOf(dirSubj); if (t < 0) return;
    const o = t * 3, px = tkP[o], py = tkP[o + 1], pz = tkP[o + 2];
    DS[S_YAW] += dt * 0.1;
    // every half second: if rock or kelp now hides the subject, swing round to a clear side
    DS[S_LOS] += dt; if (DS[S_LOS] > 0.5) { DS[S_LOS] = 0; if (rockBetween(F[CX], F[CY], F[CZ], px, py, pz, tkSz[t] * 0.5 + 0.2, true) && !clearView(t)) DS[S_DUR] = min(DS[S_DUR], DS[S_T] + 1.5); }
    const hy = atan2(tkF[o], -tkF[o + 2]) + DS[S_YAW], e = DS[S_EL], d = DS[S_DIST] * max(tkSz[t] * 2.6, 1.4), ce = cos(e), k = 1 - exp(-dt * 1.6);
    F[MX] = (px - ce * sin(hy) * d - F[CX]) * k; F[MY] = (py + sin(e) * d - F[CY]) * k; F[MZ] = (pz + ce * cos(hy) * d - F[CZ]) * k;
    F[VX] = F[VY] = F[VZ] = 0; collide();
    const kl = 1 - exp(-dt * 5);
    DS[S_LX] += (px - DS[S_LX]) * kl; DS[S_LY] += (py - DS[S_LY]) * kl; DS[S_LZ] += (pz - DS[S_LZ]) * kl;
    lookFrom(F[CX], F[CY], F[CZ], DS[S_LX], DS[S_LY], DS[S_LZ]);
  }
}
