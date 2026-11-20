// ============================================================================
// the tank world: bake grid, terrain mesh and decoration, all built from the server's `hello` (load-time only)
// ============================================================================

// bake grid over the water box plus a 3-voxel margin; culling cells over the larger horizontal extent
function setGrid(tank) {
  const hx = tank.half_x, hz = tank.half_z, dp = tank.depth;
  VS = max(LV > 1 ? 0.4 : 0.3, Math.cbrt(8 * hx * hz * dp / 6.5e6)); // at most ~6.5 M voxels
  const m = 3 * VS;
  NX = Math.ceil((2 * hx + 2 * m) / VS / 4) * 4; NY = Math.ceil((dp + 2 * m) / VS / 4) * 4; NZ = Math.ceil((2 * hz + 2 * m) / VS / 4) * 4;
  OX = -hx - m; OY = -dp - m; OZ = -hz - m;
  const ext = 2 * max(hx, hz) + 2; CELLW = ext / CELLS; CX0 = CZ0 = -ext / 2;
}

// tank primitives for the density bake: 12 floats each, the positives first, then the holes (see W_DENS)
function primBuffer(tank) {
  const all = [...(tank.positives || []), ...(tank.holes || [])], a = new Float32Array(max(1, all.length) * 12);
  all.forEach((p, i) => {
    const o = i * 12, t = p.type === 'ellipsoid' ? 0 : p.type === 'capsule' ? 1 : 2;
    a[o] = t; a[o + 1] = p.yaw || 0; a[o + 2] = p.round || 0; a[o + 3] = t === 1 ? p.r : 0;
    if (t === 1) { a.set(p.a, o + 4); a.set(p.b, o + 8); } else { a.set(p.c, o + 4); a.set(t ? p.h : p.r, o + 8); }
  });
  return a;
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - CX0) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - CZ0) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- decoration (everything here is render-only)
// Kelp grows in tank.kelp patches; sponges, coral, ground cover, pebbles and sparkles are scattered on the terrain,
// gathered around the rock structures, deterministically from tank.seed. Nothing is placed on the glass section.
function makeWorld(D, T, tank) {
  const hx = tank.half_x, hz = tank.half_z, dep = tank.depth, sd0 = (tank.seed | 0) * 31;
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - CX0) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - CZ0) / CELLW), 0, CELLS - 1);
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every kelp stem), made wider; the random stream is the same
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));
  const glints = [];
  const bubbles = [], kelpAbs = new Float32Array((NX / 2) * (NY / 2) * (NZ / 2));
  // in the water, clear of the glass (and its rock section) by m metres
  const inside = (x, y, z, m = 0.5) => abs(x) < hx - m && abs(z) < hz - m && y > -dep + 0.3 && y < -0.5;

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = 0;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, 0) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  // march from outside along -n to the surface
  const snap = (x, y, z, n) => {
    let px = x + n[0] * 2.5, py = y + n[1] * 2.5, pz = z + n[2] * 2.5, prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25, qy = py - n[1] * 0.25, qz = pz - n[2] * 0.25, d = Dw(qx, qy, qz);
      if (d > 0) { const t = prev / (prev - d); const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)]; return p.concat(grad(p[0], p[1], p[2])); }
      px = qx; py = qy; pz = qz; prev = d;
    }
    return null;
  };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const tangent = (n) => { let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]; const l = hypot(...t); t = t.map((v) => v / l); return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]]; };
  // area of the terrain surface, for scatter counts per square metre
  const AREA = T.nv * VS * VS;

  // --- the rock structures (centre x, z, horizontal radius, name) and the grotto
  const ST = [];
  for (const p of tank.positives || []) {
    if (p.type === 'capsule') ST.push([(p.a[0] + p.b[0]) / 2, (p.a[2] + p.b[2]) / 2, hypot(p.a[0] - p.b[0], p.a[2] - p.b[2]) / 2 + p.r, p.name || '']);
    else { const e = p.type === 'box' ? p.h : p.r; ST.push([p.c[0], p.c[2], max(e[0], e[2]), p.name || '']); }
  }
  const hot = (x, z) => { let h = 0.3; for (const s of ST) h = max(h, sstep(s[2] + 7, s[2] * 0.6 + 1, hypot(x - s[0], z - s[1]))); return h; };
  const grotto = (tank.shelters || []).find((s) => s.kind === 'grotto');
  const zoneP = (x, z) => grotto ? sstep(grotto.r * 3.2, grotto.r * 1.3, hypot(x - grotto.c[0], z - grotto.c[2])) : 0;
  // magenta ground-cover patches: beside most structures and a few in the open
  rseed(sd0 + 1);
  const MAG = [];
  for (const s of ST) if (s[3] !== 'boulder' && rnd() < 0.7) { const a = rnd() * TAU, d = s[2] + rr(1, 4); MAG.push([s[0] + cos(a) * d, s[1] + sin(a) * d, rr(3, 6)]); }
  for (let i = 0; i < 5; i++) MAG.push([rr(-hx + 6, hx - 6), rr(-hz + 5, hz - 5), rr(3, 6)]);
  const magAt = (x, z) => {
    let m = sstep(0.56, 0.68, fbm(x * 0.06, 7, z * 0.06, 3)) * 0.8;
    for (const p of MAG) m = max(m, sstep(p[2], p[2] * 0.45, hypot(x - p[0], z - p[1])));
    return m * sstep(0.3, 0.55, fbm(x * 0.17, 1, z * 0.17, 2) + m * 0.25);
  };

  // --- kelp columns
  const column = (x, y, z, H, kind, dens = 1) => {
    const strands = 2 + (rnd() < 0.6) + (rnd() < 0.3), ph = rnd() * TAU, tw = rr(0.1, 0.28), sr = rr(0.2, 0.55), sc = rr(0.75, 1.25);
    const la = rnd() * TAU, lm = rr(0, 0.11), full = rr(0.55, 1.3) * dens;
    const stem = (s, h) => { const a = ph + s * TAU / strands + h * tw, r = sr * (1 - 0.6 * h / H), ln = lm * h * h / H; return [x + cos(a) * r + cos(la) * ln, z + sin(a) * r + sin(la) * ln, a]; };
    for (let s = 0; s < strands; s++) for (let h = 0; h < H - 1; h += 1.7) { const p = stem(s, h); leaf(big, p[0], y + h, p[1], 2.1, p[2] + PI / 2, 0.1, 0.17, h, 1, rnd(), rnd(), 0.3); }
    const n = floor(H * 30 * full);
    for (let i = 0; i < n; i++) {
      const t = pow(rnd(), 0.9), h = t * H, p = stem((rnd() * strands) | 0, h);
      const L = ((0.55 + 0.75 * rnd() * rnd()) * (1 - 0.5 * t * t) * sc + 0.25) * (kind === 1 ? 1.25 : 1.15);
      const tilt = mix(rr(0.4, 1.0), rr(0.15, 0.45), t);
      const type = kind === 1 ? (rnd() < 0.8 ? 3 : 4) : kind === 2 ? (rnd() < 0.5 ? 4 : 0) : 0;
      leaf(big, p[0], y + h, p[1], L, rnd() * TAU, tilt, L * (kind === 1 ? rr(0.09, 0.13) : rr(0.15, 0.21)) + 0.03, h, type, rnd(), rnd(), rr(0.38, 0.95));
    }
    for (let i = floor(H * (kind === 1 ? 16 : 13)); i > 0; i--) { const h = rnd() * H, a = rnd() * TAU, r = rr(0.15, 0.8) * (1 - 0.5 * h / H), ln = lm * h * h / H; glint(x + cos(a) * r + cos(la) * ln, y + h, z + sin(a) * r + sin(la) * ln, h, rnd(), kind === 1 ? rnd() : rnd() * 0.6, rr(0.018, 0.05), 0); }
    // light absorption footprint for the skylight bake
    const hx2 = round((x - OX) / VS / 2), hz2 = round((z - OZ) / VS / 2);
    for (let hy = floor((y - OY) / VS / 2); hy <= floor((y + H - OY) / VS / 2); hy++) {
      if (hy >= 0 && hy < NY / 2 && hx2 > 0 && hx2 < NX / 2 - 1 && hz2 > 0 && hz2 < NZ / 2 - 1) kelpAbs[hx2 + NX / 2 * (hy + NY / 2 * hz2)] += 0.17;
    }
  };
  const occ = new Set();
  rseed(sd0 + 2);
  const tryColumn = (x, z, kind, dens = 1) => {
    if (!inside(x, -10, z, 1.2)) return;
    const key = floor(x / 2) * 4096 + floor(z / 2);
    if (occ.has(key)) return;
    const f = floorsAt(x, z); const c = [];
    for (let i = 0; i < f.length; i += 2) if (f[i + 1] > 6) c.push(i);
    if (!c.length) return;
    const i = c[(rnd() * c.length) | 0], y = f[i];
    if (grad(x, y, z)[1] < 0.55) return;
    occ.add(key);
    column(x, y - 0.3, z, min(f[i + 1] - rr(1.5, 6), rr(12, 25)), kind, dens);
  };
  for (const k of tank.kelp || []) {
    const cx = k.c[0], cz = k.c[1], r = k.r;
    for (let i = round(r * r * 2.2); i > 0; i--) {
      const a = rnd() * TAU, d = sqrt(rnd()) * r;
      if (rnd() > sstep(r, r * 0.5, d) + 0.1) continue;
      tryColumn(cx + cos(a) * d, cz + sin(a) * d, zoneP(cx, cz) > 0.5 && rnd() < 0.5 ? 1 : rnd() < 0.06 ? 2 : 0, rr(0.8, 1.15));
    }
  }

  // --- clusters of ribbon leaves on the ground, hanging fronds, wall tufts
  const cluster = (x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = rnd() * 0.5, L = rr(lmin, lmax);
      leaf(big, x + cos(a) * r, y - 0.15, z + sin(a) * r, L, a, rr(0.05, tmax), rr(wmin, wmax), sway, type, rnd(), rnd(), rr(0.3, 0.8));
    }
  };
  rseed(sd0 + 3);
  for (let i = round(AREA * 0.5); i > 0; i--) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (!inside(x, y, z, 0.8) || y > -4) continue;
    const h = hot(x, z), zp = zoneP(x, z), u = rnd();
    if (ny > 0.75 && u < 0.10 * h) cluster(x, y, z, 8 + rnd() * 14 | 0, 2, 0.8, 2.4, 0.12, 0.24, 0.6, 2.5);
    else if (ny > 0.6 && u < 0.10 * h + 0.07 * max(zp, h * 0.4)) cluster(x, y, z, 10 + rnd() * 18 | 0, rnd() < 0.8 ? 3 : 4, 0.7, 2.0, 0.12, 0.24, 0.9, 1.5);
    else if (ny < -0.35 && u < 0.09 * max(zp, 0.25)) { // hanging fronds
      const n = 8 + rnd() * 14 | 0;
      for (let j = 0; j < n; j++) leaf(big, x + rr(-0.6, 0.6), y + 0.2, z + rr(-0.6, 0.6), rr(0.6, 2.4), rnd() * TAU, PI - rr(0, 0.4), rr(0.08, 0.16), 0, zp > 0.3 || rnd() < 0.5 ? 6 : 0, rnd(), rnd(), rr(0.3, 0.6));
    } else if (ny > -0.2 && ny < 0.8 && u < 0.07) { // wall tufts
      const yaw = atan2(T.wn[k + 2], T.wn[k]), n = 5 + rnd() * 7 | 0;
      for (let j = 0; j < n; j++) leaf(big, x, y, z, rr(0.4, 1.2), yaw + rr(-0.9, 0.9), rr(0.3, 1.1), rr(0.06, 0.12), 0.5, zp > 0.4 && rnd() < 0.6 ? 3 : 0, rnd(), rnd(), rr(0.2, 0.6));
    }
  }
  // --- ground cover: dense carpets of small tufts in the magenta patches
  rseed(sd0 + 4);
  for (const p of MAG) for (let i = p[2] * p[2] * PI * 45; i > 0; i--) {
    const a = rnd() * TAU, r = sqrt(rnd()) * p[2], x = p[0] + cos(a) * r, z = p[1] + sin(a) * r;
    if (rnd() > magAt(x, z) + 0.12 || !inside(x, -10, z, 0.8)) continue;
    const f = floorsAt(x, z); if (!f.length) continue;
    const y = f[0]; if (grad(x, y, z)[1] < 0.7) continue;
    const nl = 2 + (rnd() * 3 | 0), yw = rnd() * TAU;
    for (let j = 0; j < nl; j++) leaf(small, x, y - 0.03, z, rr(0.08, 0.26), yw + j * TAU / nl + rr(-0.4, 0.4), rr(0.15, 0.85), rr(0.035, 0.07), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
    if (rnd() < 0.3) for (let j = 0; j < 2; j++) leaf(small, x + rr(-0.2, 0.2), y - 0.04, z + rr(-0.2, 0.2), rr(0.2, 0.55), rnd() * TAU, rr(0.05, 0.6), rr(0.03, 0.06), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
    if (rnd() < 0.3) glint(x, y + rr(0.08, 0.22), z, 0, rnd(), 0.82 + rnd() * 0.18, rr(0.01, 0.02), 0);
  }
  rseed(sd0 + 5);
  for (let i = round(AREA * 3); i > 0; i--) {
    const k = pickV(), ny = T.wn[k + 1];
    if (ny < 0.72) continue;
    const x = T.wp[k] + rr(-0.15, 0.15), z = T.wp[k + 2] + rr(-0.15, 0.15), y = T.wp[k + 1];
    if (!inside(x, y, z, 0.6)) continue;
    const m = magAt(x, z), zp = zoneP(x, z), u = rnd();
    if (m > 0.3 && u < m * 0.9) for (let j = 0; j < 4; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.12, 0.34), rnd() * TAU, rr(0.05, 0.75), rr(0.04, 0.08), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
    else if (u < m * 0.9 + 0.5 * max(zp, hot(x, z) * 0.7) * sstep(0.42, 0.6, fbm(x * 0.12, 9, z * 0.12, 2))) for (let j = 0; j < 3; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.25, 0.7), rnd() * TAU, rr(0.1, 0.8), rr(0.05, 0.1), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
  }

  // --- sponges and coral (clustered on rock)
  const spots = [];
  rseed(sd0 + 6);
  for (let i = round(AREA * 0.12); i > 0; i--) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (!inside(x, y, z, 1) || y > -6 || T.wn[k + 1] < -0.15 || rnd() > max(0.2, hot(x, z) * 0.6)) continue;
    const n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]], [t1, t2] = tangent(n0), coral = T.wn[k + 1] > 0.85 || rnd() < 0.35, cnt = coral ? 2 + rnd() * 5 | 0 : 3 + rnd() * 9 | 0, sd = rnd();
    for (let j = 0; j < cnt; j++) {
      const a = rr(-1, 1) * (0.5 + cnt * 0.13), b = rr(-1, 1) * (0.5 + cnt * 0.13);
      const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
      if (!s || !inside(s[0], s[1], s[2], 0.8)) continue;
      let ux = s[3], uy = s[4] + (coral ? 0.9 : 1.1), uz = s[5]; const l = hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
      const q = qMul(qFromY(ux, uy, uz), qAxis(0, 1, 0, rnd() * TAU)), sc = coral ? rr(0.4, 1.1) : rr(0.3, 0.75) * (rnd() < 0.1 ? 1.5 : 1);
      solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), s[0] - ux * 0.12 * sc, s[1] - uy * 0.12 * sc, s[2] - uz * 0.12 * sc, sc, q, coral ? 5 : 4, fract(sd + rr(-0.03, 0.03)), 1, 0);
    }
    if (!coral && rnd() < 0.3) spots.push([x + n0[0], y + n0[1] + 0.5, z + n0[2]]);
  }
  // dense sponge / coral gardens around the structures
  rseed(sd0 + 7);
  for (const s of ST) {
    if (s[3] === 'boulder' && rnd() < 0.4) continue;
    const R = s[2] + 2.5, want = s[3] === 'boulder' ? 12 : round(15 + R * 3.5);
    for (let i = 0, made = 0; i < 60000 && made < want; i++) {
      const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
      if (hypot(x - s[0], z - s[1]) > R || !inside(x, y, z, 1) || y > -8 || T.wn[k + 1] < -0.1) continue;
      made++;
      const coral = T.wn[k + 1] > 0.85 || rnd() < 0.3, nx = T.wn[k], ny = T.wn[k + 1] + (coral ? 0.9 : 1.1), nz = T.wn[k + 2], l = hypot(nx, ny, nz);
      const sc = coral ? rr(0.4, 1.1) : rr(0.3, 0.75) * (rnd() < 0.15 ? 1.5 : 1);
      solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), x - nx / l * 0.1 * sc, y - ny / l * 0.1 * sc, z - nz / l * 0.1 * sc, sc, qMul(qFromY(nx / l, ny / l, nz / l), qAxis(0, 1, 0, rnd() * TAU)), coral ? 5 : 4, rnd(), 1, 0);
    }
  }
  // --- small rocks, rock chips and pebbles: decor only, kept small (the server does not know them)
  rseed(sd0 + 9);
  for (let i = round(AREA * 0.02); i > 0; i--) {
    const k = pickV(); if (T.wn[k + 1] < 0.7 || !inside(T.wp[k], T.wp[k + 1], T.wp[k + 2], 1)) continue;
    const sc = rr(0.15, 0.45);
    solid(rnd() * 4 | 0, T.wp[k], T.wp[k + 1] + sc * 0.2, T.wp[k + 2], sc, qRand(), 1, rnd(), 1, 0);
  }
  rseed(sd0 + 10);
  for (let i = round(AREA * 0.3); i > 0; i--) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (!inside(x, y, z, 0.8) || ny < -0.3 || (ny > 0.8 && rnd() < 0.6)) continue;
    const sc = (0.2 + 0.35 * pow(rnd(), 2)) * (ny > 0.8 ? 0.6 : 1), q = qRand();
    chunks[(rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), 96, 0);
  }
  rseed(sd0 + 11);
  for (let i = round(AREA * 1.2); i > 0; i--) { // pebbles and rubble on the sea floor
    const k = pickV(), x = T.wp[k] + rr(-0.15, 0.15), z = T.wp[k + 2] + rr(-0.15, 0.15), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || !inside(x, y, z, 0.6)) continue;
    const sc = 0.04 + 0.2 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }
  // --- violet sparkles inside the grotto
  if (grotto) {
    rseed(sd0 + 12);
    const g = grotto.c, r = grotto.r;
    for (let k = 0; k < T.nv * 3; k += 3) {
      const qx = (T.wp[k] - g[0]) / (r * 1.5), qy = (T.wp[k + 1] - g[1]) / r, qz = (T.wp[k + 2] - g[2]) / (r * 1.1);
      if (qx * qx + qy * qy + qz * qz > 1.6 || rnd() > 0.12) continue;
      glint(T.wp[k] + T.wn[k] * 0.12, T.wp[k + 1] + T.wn[k + 1] * 0.12, T.wp[k + 2] + T.wn[k + 2] * 0.12, 0, rnd(), rnd() < 0.6 ? rr(0.82, 1) : rr(0.62, 0.8), rr(0.018, 0.045), 0);
    }
  }
  // --- bubbles from vents beside the structures, in the open and on some sponges
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[0] : -dep; };
  rseed(sd0 + 13);
  const VENTS = [];
  for (const s of ST) if (rnd() < 0.3) { const a = rnd() * TAU, d = s[2] + rr(0.5, 2.5); VENTS.push([s[0] + cos(a) * d, -1e3, s[1] + sin(a) * d]); }
  for (let i = 0; i < 4; i++) VENTS.push([rr(-hx + 5, hx - 5), -1e3, rr(-hz + 5, hz - 5)]);
  for (const s of spots) if (rnd() < 0.12) VENTS.push(s);
  for (const v of VENTS) {
    const y0 = v[1] < -999 ? gy(v[0], v[2]) : v[1];
    if (!inside(v[0], y0, v[2], 1)) continue;
    const n = 70 + rnd() * 60 | 0;
    for (let i = 0; i < n; i++) {
      const sz = rnd() < 0.24 ? rr(0.08, 0.22) : rr(0.02, 0.06);
      bubbles.push(v[0] + rr(-0.3, 0.3), y0, v[2] + rr(-0.3, 0.3), sz, rnd(), rr(1.1, 2.4) * (0.6 + sz * 3), -y0 - 0.2, rr(0.05, 0.16));
    }
  }

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(max(n, 1) * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume: r = openness, g = skylight (light falling from the surface, blurred, blocked by rock and kelp)
  const hx2 = NX / 2, hy2 = NY / 2, hz2 = NZ / 2, volD = new Uint8Array(hx2 * hy2 * hz2 * 2);
  let Lp = new Float32Array(hx2 * hz2).fill(1), Ln = new Float32Array(hx2 * hz2), tmp = new Float32Array(hx2 * hz2);
  for (let y = hy2 - 1; y >= 0; y--) {
    for (let z = 0; z < hz2; z++) for (let x = 0; x < hx2; x++) { const i = x + hx2 * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx2 - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz2; z++) for (let x = 0; x < hx2; x++) {
      const i = x + hx2 * z, b = (tmp[z > 0 ? i - hx2 : i] + 2 * tmp[i] + tmp[z < hz2 - 1 ? i + hx2 : i]) * 0.25;
      const g0 = gi(x * 2, y * 2, z * 2);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      const o = x + hx2 * (y + hy2 * z);
      const l = b * clamp(0.5 - d / 1.5, 0, 1) * (1 - min(kelpAbs[o], 0.5));
      Ln[i] = l;
      volD[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255; volD[o * 2 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }

  // --- ground map over the tank floor: r magenta cover, b violet zone, a sand
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = ((i + 0.5) / 512 * 2 - 1) * hx, z = ((j + 0.5) / 512 * 2 - 1) * hz, o = (i + 512 * j) * 4;
    gm[o] = magAt(x, z) * 255; gm[o + 2] = zoneP(x, z) * 255; gm[o + 3] = sstep(0.42, 0.6, fbm(x * 0.08, 3, z * 0.08, 3)) * 255;
  }

  // --- drifting motes around the camera, plankton motes fixed in the tank (x, y, z in 0..1 of the box, threshold)
  rseed(sd0 + 14);
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();
  const plank = new Float32Array((16000 >> LV) * 4);
  for (let i = 0; i < plank.length; i++) plank[i] = rnd();

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 4; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(max(n, 1) * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 3); } }
    return { data, n, start, lo, hi };
  };
  return { gy, glints: new Float32Array(glints.length ? glints : [0, -1e4, 0, 0, 0, 0, 0, 0]), chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small),
    solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(bubbles.length ? bubbles : [0, -1e4, 0, 0, 0, 1, 1, 0]), volD, gm, snow, plank };
}

const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 4; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.8, 0.98)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r, py = y * r * 0.8, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}
function meshLathe(prof, seg, lump, ribs = 0) {
  const m = new Mesh(), rings = [];
  for (const [r, h, ao] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + lump * (fbm(cos(a) * 1.5 + h * 2, h * 3, sin(a) * 1.5, 2) - 0.5) + 0.07 * cos(ribs * a + h * 1.5)); ring.push(m.v(cos(a) * rl, h, sin(a) * rl, ao)); } rings.push(ring); }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  return m;
}
function meshCoral(fan, lo = LV > 1) {
  rseed(200 + fan);
  const m = new Mesh();
  const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
  const br = (p, d, r, len, depth) => {
    const pts = [p]; let q = p;
    for (let i = 0; i < 3; i++) { d = nrm([d[0] + rr(-0.3, 0.3), d[1] + rr(-0.1, 0.3), d[2] + (fan ? rr(-0.05, 0.05) : rr(-0.3, 0.3))]); q = [q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]; pts.push(q); }
    if (!depth) pts.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
    if (lo) m.tube(depth ? [pts[0], pts[3]] : [pts[0], pts[3], pts[4]], (k) => (k > 1 ? r * 0.36 : r * (1 - 0.22 * k)) * 1.25, 3, true, (k) => clamp(1 - (depth + 1 - k) / 5, 0, 1));
    else m.tube(pts, (k) => k > 3 ? r * 0.36 : r * (1 - 0.22 * k / 3), fan ? 5 : 6, true, (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1));
    if (depth > 0) { const n = 2 + (rnd() < 0.5); for (let i = 0; i < n; i++) br(q, nrm([d[0] + rr(-0.8, 0.8), d[1] + rr(-0.1, 0.5), d[2] + (fan ? rr(-0.08, 0.08) : rr(-0.8, 0.8))]), r * 0.78, len * 0.8, depth - 1); }
  };
  const n0 = fan ? 1 : 2 + (rnd() * 2 | 0);
  for (let i = 0; i < n0; i++) br([rr(-0.08, 0.08), 0, rr(-0.08, 0.08)], nrm([rr(-0.5, 0.5), 1, fan ? 0 : rr(-0.5, 0.5)]), fan ? 0.06 : 0.08, fan ? 0.5 : 0.45, 3);
  return m;
}
function meshTubes() {
  rseed(210);
  const m = new Mesh();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, r0 = rr(0, 0.28), h = rr(0.45, 1.1), rad = rr(0.07, 0.12), lean = rr(0.05, 0.3), pts = [];
    for (let k = 0; k <= 4; k++) pts.push([cos(a) * (r0 + lean * k / 4 * h), h * k / 4, sin(a) * (r0 + lean * k / 4 * h)]);
    m.tube(pts, (k) => rad * (0.8 + 0.25 * k / 4), 12, false, (k) => 0.35 + 0.65 * k / 4);
    // rim + dark throat
    const e = pts[4], n = m.p.length / 3, c = m.v(e[0], e[1] - rad * 1.2, e[2], 0.05);
    for (let s2 = 0; s2 < 12; s2++) m.tri(n - 12 + s2, n - 12 + (s2 + 1) % 12, c);
  }
  return m;
}
function meshManta() {
  const m = new Mesh(), NU = 72, M = 22, rings = [];
  for (let j = 0; j <= NU; j++) {
    const u = j / NU * 2 - 1, au = abs(u);
    let zl = 0.52 - 0.74 * pow(au, 1.35) + 0.07 * exp(-pow((au - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(au / 0.05, 2)) - 0.08 * pow(au, 5);
    const zt = -0.5 + 0.3 * pow(au, 0.8) + 0.02 - 0.08 * pow(au, 5);
    if (zl < zt + 0.004) zl = zt + 0.004;
    const th = 0.08 * pow(1 - au, 1.15) + 0.004 + 0.12 * exp(-pow(u / 0.2, 2)), ring = [];
    for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)), mix(zt, zl, 0.5 + 0.5 * cos(a)), u)); }
    rings.push(ring);
  }
  for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  const tail = []; for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
  const n0 = m.p.length / 3;
  m.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
  for (let k = n0; k < m.aux.length; k++) m.aux[k] = 0;
  for (const sx of [-1, 1]) { // cephalic fins
    const n1 = m.p.length / 3;
    m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true);
    for (let k = n1; k < m.aux.length; k++) m.aux[k] = sx * 0.1;
  }
  return m;
}
function meshFish() {
  const m = new Mesh();
  const X = [0.5, 0.3, 0.05, -0.22, -0.34], H = [0.01, 0.13, 0.17, 0.09, 0.035], Wd = [0.01, 0.05, 0.065, 0.03, 0.012], rings = [];
  for (let i = 0; i < 5; i++) { const r = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; r.push(m.v(X[i], sin(a) * H[i], cos(a) * Wd[i])); } rings.push(r); }
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); }
  const a = m.v(-0.33, 0, 0), b = m.v(-0.56, 0.2, 0), c = m.v(-0.47, 0, 0), d = m.v(-0.56, -0.2, 0);
  m.tri(a, b, c); m.tri(a, c, d);
  return m;
}

// ---------------------------------------------------------------- creature meshes: +x forward, +y up, length 1
// Catmull-Rom through evenly spaced samples a[0..n] at t in 0..1
function crs(a, t) {
  const n = a.length - 1, s = clamp(t, 0, 1) * n; let i = floor(s); if (i > n - 1) i = n - 1;
  const u = s - i, p0 = a[max(i - 1, 0)], p1 = a[i], p2 = a[i + 1], p3 = a[min(i + 2, n)];
  return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
}
// body of revolution along x: elliptic rings (half height H, half width W, centre height Y) from the snout back
function revBody(m, X, H, W, Y, rings, sides) {
  const R = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1), x = crs(X, t), h = max(crs(H, t), 0.002), w = max(crs(W, t), 0.002), yc = Y ? crs(Y, t) : 0, r = [];
    for (let k = 0; k < sides; k++) { const a = k / sides * TAU; r.push(m.v(x, yc + sin(a) * h, cos(a) * w)); }
    R.push(r);
  }
  for (let i = 0; i < rings - 1; i++) for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; m.quad(R[i][k], R[i + 1][k], R[i + 1][k2], R[i][k2]); }
  return R;
}
const finTri = (m, pts) => { const v = pts.map((p) => m.v(p[0], p[1], p[2])); for (let i = 1; i < v.length - 1; i++) m.tri(v[0], v[i], v[i + 1]); };
// sparkfin: the abyssal fish profile, smoother (9 rings x 8 sides), forked tail and a small dorsal fin
function meshFishHi() {
  const m = new Mesh();
  revBody(m, [0.5, 0.3, 0.05, -0.22, -0.34], [0.01, 0.13, 0.17, 0.09, 0.035], [0.01, 0.05, 0.065, 0.03, 0.012], null, 9, 8);
  const a = m.v(-0.33, 0, 0), b = m.v(-0.56, 0.2, 0), c = m.v(-0.47, 0, 0), d = m.v(-0.56, -0.2, 0);
  m.tri(a, b, c); m.tri(a, c, d);
  finTri(m, [[0.12, 0.16, 0], [-0.13, 0.115, 0], [-0.09, 0.25, 0]]);
  return m.xf((x, y, z) => [(x + 0.03) / 1.06, y / 1.06, z / 1.06]);
}
// needlejaw: long, narrow, compressed from the sides; long jaw, rear dorsal and anal fins, forked tail, and a lure
// on a barbel under the chin (aux -1 marks the glowing bulb)
function meshNeedle() {
  const m = new Mesh();
  const H = [0.003, 0.016, 0.034, 0.046, 0.044, 0.03, 0.012];
  revBody(m, [0.5, 0.42, 0.3, 0.12, -0.08, -0.26, -0.4], H, H.map((h) => h * 0.55), [-0.004, -0.002, 0, 0, 0, 0, 0], 14, 8);
  finTri(m, [[-0.14, 0.04, 0], [-0.34, 0.022, 0], [-0.36, 0.07, 0], [-0.2, 0.082, 0]]);
  finTri(m, [[-0.16, -0.04, 0], [-0.34, -0.022, 0], [-0.36, -0.064, 0], [-0.22, -0.07, 0]]);
  finTri(m, [[-0.39, 0, 0], [-0.5, 0.075, 0], [-0.455, 0, 0], [-0.5, -0.075, 0]]);
  m.tube([[0.36, -0.03, 0], [0.355, -0.06, 0], [0.345, -0.085, 0]], 0.0025, 3, false);
  const c = [0.343, -0.094, 0], r = 0.013, o = [];
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) o.push(m.v(c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r, -1));
  for (const f of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]) m.tri(o[f[0]], o[f[1]], o[f[2]]);
  return m;
}
// shade: fusiform shark body, tall swept dorsal fin, small second dorsal, crescent (heterocercal) tail, pectorals
function meshShark() {
  const m = new Mesh();
  revBody(m, [0.5, 0.47, 0.42, 0.34, 0.24, 0.12, 0.0, -0.12, -0.22, -0.3, -0.36],
    [0.006, 0.03, 0.05, 0.068, 0.08, 0.085, 0.08, 0.066, 0.046, 0.028, 0.018],
    [0.006, 0.03, 0.046, 0.058, 0.066, 0.068, 0.062, 0.05, 0.034, 0.02, 0.012],
    [-0.016, -0.012, -0.007, -0.003, 0, 0, 0, 0.003, 0.006, 0.008, 0.01], 16, 12);
  finTri(m, [[0.1, 0.08, 0], [-0.05, 0.215, 0], [-0.06, 0.1, 0], [-0.08, 0.072, 0]]);
  finTri(m, [[-0.22, 0.05, 0], [-0.27, 0.095, 0], [-0.28, 0.046, 0]]);
  finTri(m, [[-0.355, 0.005, 0], [-0.33, -0.012, 0], [-0.48, -0.13, 0], [-0.44, -0.06, 0], [-0.405, 0.01, 0], [-0.45, 0.085, 0], [-0.53, 0.22, 0], [-0.33, 0.026, 0]]);
  for (const s of [-1, 1]) finTri(m, [[0.2, -0.04, s * 0.05], [0.1, -0.05, s * 0.055], [0.04, -0.075, s * 0.16], [-0.03, -0.125, s * 0.27]]);
  return m;
}
// lumen jelly: lathe bell (aux -1 at the top .. 0 at the rim), four ribbon-like oral arms and twelve thin tentacles
// (aux 0..1 from root to tip); bell diameter 1
function meshJelly() {
  const m = new Mesh(), prof = [[0, 0.36], [0.12, 0.35], [0.24, 0.31], [0.34, 0.25], [0.42, 0.17], [0.47, 0.09], [0.5, 0.02], [0.49, -0.02], [0.44, -0.03]], seg = 20, rings = [];
  prof.forEach(([r, y], j) => { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + 0.04 * cos(a * 8)); ring.push(m.v(cos(a) * rl, y, sin(a) * rl, -(1 - j / (prof.length - 1)))); } rings.push(ring); });
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  for (let i = 0; i < 4; i++) {
    const a = i * PI / 2 + 0.4, pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([cos(a) * (0.05 + 0.08 * t) + sin(t * 9 + i) * 0.035, 0.02 - 0.85 * t, sin(a) * (0.05 + 0.08 * t) + cos(t * 8 + i) * 0.035]); }
    m.tube(pts, (k) => 0.045 * (1 - k / 9) + 0.008, 4, true, (k) => 0.03 + 0.97 * k / 8);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * TAU, pts = [];
    for (let k = 0; k <= 9; k++) { const t = k / 9, r = 0.45 - 0.08 * t + 0.03 * sin(t * 7 + i); pts.push([cos(a) * r, -0.02 - 1.35 * t, sin(a) * r]); }
    m.tube(pts, 0.007, 3, false, (k) => 0.02 + 0.98 * k / 9);
  }
  return m;
}
