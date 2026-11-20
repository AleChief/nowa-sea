// ============================================================================
// WGSL sources
// ============================================================================

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- tank density (compute), > 0 in rock
// The shared tank SDF (docs/protocol.md): rock = max(min(positives), -min(holes)), floor = (y - h(x, z)) * 0.7,
// solid = min(rock, floor). The bake adds render-only relief (lumps, sand ripples, a soft fillet where rock meets
// the floor), kept within 0.15 m of the shared surface, and cuts the solid at the glass so it reads as a section.
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u, b: vec4f, f: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
@group(0) @binding(3) var<storage, read> FL: array<f32>;
fn sdEllipsoid(q: vec3f, r: vec3f) -> f32 { let k0 = length(q / r); let k1 = length(q / (r * r)); return k0 * (k0 - 1.) / max(k1, 1e-9); }
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0., 1.);
  return length(pa - ba * h) - r;
}
fn sdRoundBox(q: vec3f, h: vec3f, rnd: f32) -> f32 {
  let d = abs(q) - (h - rnd);
  return length(max(d, vec3f(0.))) + min(max(d.x, max(d.y, d.z)), 0.) - rnd;
}
fn loc(p: vec3f, c: vec3f, yaw: f32) -> vec3f { let q = p - c; let cs = cos(yaw); let sn = sin(yaw); return vec3f(q.x * cs + q.z * sn, q.y, q.z * cs - q.x * sn); }
// primitive i: P[3i] = type (0 ellipsoid, 1 capsule, 2 box), yaw, rounding, capsule radius; P[3i+1] = c or a; P[3i+2] = r, h or b
fn prim(p: vec3f, i: u32) -> f32 {
  let a = P[i * 3u]; let b = P[i * 3u + 1u]; let c = P[i * 3u + 2u];
  if (a.x < .5) { return sdEllipsoid(loc(p, b.xyz, a.y), c.xyz); }
  if (a.x < 1.5) { return sdCapsule(p, b.xyz, c.xyz, a.w); }
  return sdRoundBox(loc(p, b.xyz, a.y), c.xyz, a.z);
}
// floor height, bilinear between the nodes of the heightfield (clamped like Tank.floor_height)
fn floorH(x: f32, z: f32) -> f32 {
  let nx = u.c.z; let nz = u.c.w;
  let fx = clamp((x - u.f.x) / u.f.z, 0., f32(nx) - 1.001); let fz = clamp((z - u.f.y) / u.f.z, 0., f32(nz) - 1.001);
  let x0 = u32(fx); let z0 = u32(fz); let tx = fx - f32(x0); let tz = fz - f32(z0);
  let i = z0 * nx + x0;
  let a = FL[i] + (FL[i + 1u] - FL[i]) * tx; let b = FL[i + nx] + (FL[i + nx + 1u] - FL[i + nx]) * tx;
  return a + (b - a) * tz;
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
fn dens(p: vec3f) -> f32 {
  var rock = 1e9;
  for (var i = 0u; i < u.c.x; i++) { rock = min(rock, prim(p, i)); }
  if (u.c.y > 0u) { var h = 1e9; for (var i = 0u; i < u.c.y; i++) { h = min(h, prim(p, u.c.x + i)); } rock = max(rock, -h); }
  let fl = (p.y - floorH(p.x, p.z)) * .7;
  // render-only relief: lumps and pits on rock (|.| < .1 m), ripples on sand (< .03 m), fillet k = .3 (< .075 m)
  let lump = (fbm(p * 1.1 + 3.7, 3) - .5) * .13 + (.5 - wor(p * 2.2)) * .04;
  let rip = sin(p.x * 2.3 + p.z * .8 + fbm(p * .35, 2) * 7.) * .022;
  var d = -smin(rock + lump, fl + rip, .3);
  // cut at the glass (3 cm inside, so the glass never z-fights the section) and at the glass bottom
  d = min(d, min(min(u.b.x - .03 - abs(p.x), u.b.z - .03 - abs(p.z)), p.y + u.b.y));
  return d;
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id = vec3u(gid.x, gid.y, gid.z + u.n.w); // dispatched in slabs along z, u.n.w = first layer
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.x == 0u || id.y == 0u || id.z == 0u || id.x == u.n.x - 1u || id.y == u.n.y - 1u || id.z == u.n.z - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock detail texture (tileable): rg = slope, b = height, a = mottling
const W_DETAIL = W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// animated water texture: r = caustic, ba = surface slope
const W_WATER = W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
fn caus(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853;
  var i = p; var c = 0.;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1. - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5., 1.4);
  return pow(abs(c), 8.);
}
const WK = array<vec3f, 10>(vec3f(1., 2., 1.), vec3f(-2., 1., .9), vec3f(3., 1., .6), vec3f(1., -4., .5), vec3f(4., 3., .4),
  vec3f(-3., 5., .32), vec3f(6., -2., .28), vec3f(5., 7., .2), vec3f(-8., 3., .18), vec3f(2., 11., .14));
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${WATER}.; let t = tm.x;
  let c = caus(uv, t * .45 + 23.);
  let wu = uv + .02 * vec2f(sin(6.2831853 * (uv.y * 2. + .1 * t)), cos(6.2831853 * (uv.x * 3. - .07 * t)));
  var s = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let k = WK[i];
    s += k.xy * k.z * cos(dot(k.xy, wu) * 6.2831853 + t * (.5 + .35 * sqrt(length(k.xy))) * select(-1., 1., (i & 1) == 0) + f32(i) * 1.7);
  }
  return vec4f(c, c, s * .06);
}
`;

// ---------------------------------------------------------------- shared scene code
// The water is the box |x| <= box.x, |z| <= box.z, -box.y <= y <= 0. Fog, absorption and light shafts only act on
// the part of a view ray inside it (wseg), so the tank can be seen from the room outside.
// G: box = (half x, depth, half z, glass rim height); sunc = (lamp colour x intensity, night); env = (ambient, in-scatter,
// caustics, glow boost); vo = (volume origin, fog density scale); vsz = (1 / volume size, plankton glow);
// grot = (grotto centre, radius; radius 0 = none)
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f,
  box: vec4f, sunc: vec4f, env: vec4f, vo: vec4f, vsz: vec4f, grot: vec4f };
@group(0) @binding(0) var<uniform> g: G;
const SIG = vec3f(.058, .0235, .0195);
const KD = vec3f(.056, .0245, .0170);
const WCOL = vec3f(.16, .58, .90);
const KDZ = vec3f(.034, .023, .018);
const PCOL = vec3f(.58, .66, .98);
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn kd(z: f32) -> vec3f { return mix(KD, KDZ, z); }
fn sg(z: f32) -> vec3f { return mix(SIG, vec3f(.034, .026, .022), z) * g.vo.w; }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
const KDF = vec3f(.043, .045, .042);
fn fogIn(ro: vec3f, rd: vec3f, d: f32, z: f32, sun: vec3f) -> vec3f {
  let k = mix(KD, KDF, z);
  let a = sg(z) - k * rd.y;
  let I = select((1. - exp(-a * d)) / a, vec3f(d), abs(a) < vec3f(1e-4));
  let mu = max(dot(rd, sun), 0.);
  let m2 = mu * mu;
  return mix(WCOL, PCOL, z) * sg(z) * exp(k * min(ro.y, 0.)) * I * (1.22 + .3 * m2 * m2) * g.env.y;
}
// the part [t0, t1] of the ray ro + t rd, 0 <= t <= d, inside the box lo..hi (t1 <= t0: misses)
fn bseg(ro: vec3f, rd: vec3f, lo: vec3f, hi: vec3f, d: f32) -> vec2f {
  let iv = 1. / select(rd, vec3f(1e-8), abs(rd) < vec3f(1e-8));
  let ta = (lo - ro) * iv; let tb = (hi - ro) * iv;
  let tn = min(ta, tb); let tf = max(ta, tb);
  return vec2f(max(max(max(tn.x, tn.y), tn.z), 0.), min(min(min(tf.x, tf.y), tf.z), d));
}
fn wseg(ro: vec3f, rd: vec3f, d: f32) -> vec2f { return bseg(ro, rd, vec3f(-g.box.x, -g.box.y, -g.box.z), vec3f(g.box.x, 0., g.box.z), d); }
// metres of water between the camera and p
fn wlen(p: vec3f) -> f32 { let v = p - g.cam.xyz; let d = max(length(v), 1e-4); let s = wseg(g.cam.xyz, v / d, d); return max(s.y - s.x, 0.); }
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
@group(0) @binding(9) var tP: texture_3d<f32>;
@group(0) @binding(10) var<uniform> SPC: array<vec4f, 32>;
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.8 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 2.1 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
fn cuv(p: vec3f) -> vec2f { return p.xz - g.sun.xz * (p.y / g.sun.y); }
fn caus(p: vec3f, d: f32) -> vec3f {
  let q = cuv(p);
  let o = vec2f(.004, .0025);
  let a = vec3f(textureSample(tW, sR, q / 3.3 + o).r, textureSample(tW, sR, q / 3.3).r, textureSample(tW, sR, q / 3.3 - o).r);
  let b = textureSample(tW, sR, q.yx / 6.9 + .37).r;
  let c = min(pow(a, vec3f(2.3)) * 5. * (.45 + b * 1.3), vec3f(4.));
  return mix(vec3f(.33), mix(c, vec3f(.33), ss(35., 100., d)), g.env.z);
}
fn caus2(p: vec3f, d: f32) -> f32 {
  let q = cuv(p);
  let c = min(pow(textureSample(tW, sR, q / 4.1).r, 1.4) * 2.6 * (.45 + textureSample(tW, sR, q.yx / 6.9 + .37).r * 1.3), 2.6);
  return mix(.33, mix(c, .33, ss(35., 100., d)), g.env.z);
}
fn sunE(y: f32, z: f32) -> vec3f { return g.sunc.rgb * exp(kd(z) * (min(y, 0.) / g.sun.y)) * (.5 + .5 * sat(-y / 30.)); }
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - g.vo.xyz) * g.vsz.xyz, 0.); }
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return (mix(vec3f(.22, .60, .80), vec3f(.34, .56, .82), z) * exp(kd(z) * min(p.y, 0.) * 1.2) * (.3 + .7 * sky) * (.24 + .76 * up * up) * 1.3 * (.55 + .45 * sat(-p.y / 30.)) + vec3f(.003, .010, .016)) * g.env.x;
}
// purple grotto light: 1 inside the hollow, fading out past its mouth
fn zone3(p: vec3f) -> f32 { let q = (p - g.grot.xyz) / (max(g.grot.w, 1e-3) * vec3f(1.5, 1., 1.1)); return ss(1.7, .9, length(q)) * step(.001, g.grot.w); }
fn zone(p: vec3f) -> f32 { return mix(g.sun.w, zone3(p), .35); }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return mix(WCOL, PCOL, z) * exp(kd(z) * min(p.y, 0.)) * open * (1. - abs(n.y)) * .7 * g.env.x; }
// absorption and in-scattering over the water between the camera and wp
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = max(length(v), 1e-4); let rd = v / d;
  let s = wseg(g.cam.xyz, rd, d); let L = s.y - s.x;
  if (L <= 0.) { return c; }
  let ro = g.cam.xyz + rd * s.x;
  return c * exp(-sg(z) * L) + fogIn(ro, rd, L, z, g.sun.xyz) * (.58 + .42 * vol(ro + rd * L).g);
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
// the dark room around the tank: walls, a floor 7 m below the glass bottom lit by the tank, a black cabinet
fn roomCol(ro: vec3f, rd: vec3f) -> vec3f {
  let fy = -g.box.y - 7.;
  var c = vec3f(.012, .015, .02) * (1. - .6 * sat(abs(rd.y)));
  if (rd.y < -1e-3) {
    let p = ro + rd * ((fy - ro.y) / rd.y);
    let q = max(abs(p.xz) - g.box.xz, vec2f(0.));
    c = vec3f(.008, .009, .01) + vec3f(.03, .07, .09) * exp(-dot(q, q) / 120.) * (.25 + .75 * g.env.x);
  }
  let cb = bseg(ro, rd, vec3f(-g.box.x - .5, fy, -g.box.z - .5), vec3f(g.box.x + .5, -g.box.y, g.box.z + .5), 1e5);
  if (cb.y > cb.x) {
    let p = ro + rd * cb.x;
    c = vec3f(.006, .006, .007) + vec3f(.02, .05, .06) * ss(-g.box.y - .3, -g.box.y, p.y) * (.3 + .7 * g.env.x);
  }
  return c;
}
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, sponges, coral)
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
` + /*wgsl*/`
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let ts = select(1., i.m.z, mat >= 2);
  let A = tri(i.op, on, .1 * ts); let B = tri(i.op, on, .43 * ts); let C = tri(i.op, on, 1.9 * ts); let F = tri(i.op, on, 6.7 * ts); let fk = ss(10., 1.5, dist) * f32(mat <= 1);
  let Wd = textureSample(tD, sR, vec2f(i.op.x * .06, (i.op.y + i.op.z) * .7));
  let big = textureSample(tD, sR, i.op.xz * .013 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .031 + i.op.y * .043 + .37).a;
  var sgro = 0.;
  let gm = textureSample(tM, sC, i.wp.xz / (2. * g.box.xz) + .5);
  let ca = caus(i.wp, dist);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.7; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.72, .93, n0.y);
  if (mat <= 1) {
    // layered rock: grey / olive / brown beds, warm encrustation patches, algae on up-facing parts
    let st = i.op.y * .55 + A.h * 1.6 + big * 5. + big2 * 3.;
    let bed = hs(floor(st)); let sf = fract(st);
    alb = mix(vec3f(.11, .12, .13), vec3f(.33, .30, .25), sat(A.c * 1.5 - .25));
    alb = mix(alb, mix(vec3f(.26, .19, .10), vec3f(.20, .22, .14), bed), ss(.42, .66, big) * .7);
    alb *= mix(.72, 1.15, bed) * (1. - .45 * ss(.12, .0, sf) * (1. - abs(on.y)));
    let enc = ss(.46, .6, big2 * .6 + B.c * .5) * ss(.3, .6, hgt);
    alb = mix(alb, mix(vec3f(.34, .07, .10), vec3f(.40, .25, .07), ss(.45, .6, A.c)) * (.5 + .8 * B.h), enc * .75);
    alb = mix(alb, vec3f(.50, .50, .46) * (.5 + .7 * C.h), ss(.60, .70, B.c * .6 + C.c * .5) * .5);
    let alg = ss(-.1, .6, n0.y) * ss(.3, .52, B.c * .55 + big * .5);
    alb = mix(alb, vec3f(.035, .14, .07), alg * .8);
    alb *= (.22 + 1.3 * hgt) * mix(1., .62 + .76 * F.h, fk);
    sgro = -ss(.14, .0, sf) * (1. - abs(on.y)) * 1.2;
    if (mat == 0) {
      alb = mix(alb, vec3f(.13, .15, .14) * (.55 + .6 * B.h), flt * gm.a * .7);
      let mg = flt * sat(gm.r * 1.5 - .45 + (B.c - .5) * 1.6) * ss(.35, .6, A.h) * ss(-16., -21., i.wp.y);
      alb = mix(alb, vec3f(.20, .02, .12) * (.4 + .9 * B.h), mg * .8);
      flu = mg * .35;
      alb = mix(alb, alb * vec3f(.85, .8, 1.4) + vec3f(.015, .0, .05), gm.b * .8);
    }
  } else if (mat == 4) {
    let hue = fract(sd * 7.31);
    alb = mix(vec3f(.60, .17, .08), vec3f(.64, .35, .10), fract(hue * 3.));
    if (hue > .75) { alb = vec3f(.44, .18, .42); }
    alb *= (.45 + .75 * B.h) * (.7 + .3 * C.h);
    vao = i.ao * i.ao; gloss = .2; bump = 1.4; flu = .55;
  } else {
    let hue = fract(sd * 5.73);
    alb = mix(vec3f(.80, .08, .10), vec3f(.90, .22, .40), fract(hue * 4.));
    if (hue > .7) { alb = vec3f(.88, .42, .10); }
    if (hue > .9) { alb = vec3f(.55, .22, .75); }
    alb *= (.4 + .8 * B.h) * (.5 + .9 * i.ao * i.ao);
    alb = mix(alb, vec3f(1., .75, .6), ss(.8, 1., i.ao) * .35);
    emi = alb * .01; flu = .75; gloss = .25; bump = 1.5;
  }
  let rip = select(0., flt * gm.a * cos((i.wp.x * .8 + i.wp.z * .35) * 5. + A.c * 9.) * .65, mat == 0);
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump + vec3f(.8, sgro, .35) * vec3f(rip, 1., rip))));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * vao * ss(.12, .6, hgt);
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadow9(i.wp + n0 * .35);
  let ndl = sat(dot(N, L));
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao;
  let dl = E * ndl * (.10 + mix(vec3f(.33), ca, ss(.1, .45, dot(n0, L))) * 2.5);
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.1, .5, .5));
  let H = normalize(V + L);
  c += E * (.25 + ca) * pow(sat(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) + side(i.wp, reflect(-V, N), sat((v2.r - .5) * 2.7), z)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  // the grotto's own violet light, stronger to the eye at night
  let gz = zone3(i.wp);
  c += (alb * 1.6 + vec3f(.01, .0, .02)) * vec3f(.62, .3, 1.) * gz * (.5 + .25 * g.env.w) * (.4 + .6 * sat((v1.r - .3) * 3.));
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- leaves (kelp, grasses, ground cover)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.031, .017));
  let a = .024 * pow(max(h, 0.), 1.25);
  return a * (vec2f(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * vec2f(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
fn pal(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .08); }
  if (h < .6) { return vec3f(.12, 1., .22); }
  if (h < .8) { return vec3f(.2, .85, 1.); }
  return vec3f(1., .3, .8);
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  // per type: x sparkle prob, y translucency, z iridescence, w emissive
  var col = vec3f(0.); var pr = vec4f(0.); var spc = vec3f(0.); var shp = vec2f(.75, .7); var wav = 1.; var fls = 1.;
  let hsel = hs(s1 * 13.7 + s2 * 71.3);
  switch ty {
    case 0 { col = mix(vec3f(.11, .125, .022), vec3f(.04, .10, .04), s1); col = mix(col, vec3f(.25, .17, .025), step(.72, s2)); pr = vec4f(.24, .9, 0., 0.); spc = pal(hsel * .72); shp = vec2f(.5, .32); wav = 1.9; }
    case 1 { col = vec3f(.10, .11, .035); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); wav = .3; fls = .3; }
    case 2 { col = mix(vec3f(.05, .20, .16), vec3f(.12, .26, .22), s1); col = mix(col, vec3f(.30, .14, .24), step(.85, s2)); pr = vec4f(.05, 1.0, .25, 0.); spc = vec3f(.6, 1., .9); shp = vec2f(.45, .35); wav = 2.2; }
    case 3 { col = mix(vec3f(.02, .05, .065), vec3f(.05, .03, .08), s1); col = mix(col, vec3f(.09, .03, .09), step(.8, s2)); pr = vec4f(.2, .85, .55, .02); spc = mix(vec3f(.5, .35, 1.), vec3f(.2, 1., .7), step(.6, hsel)); shp = vec2f(.7, .6); wav = 2.4; }
    case 4 { col = mix(vec3f(.30, .15, .02), vec3f(.42, .25, .04), s1); pr = vec4f(.2, 1., .1, 0.); spc = vec3f(1., .85, .5); shp = vec2f(.5, .4); wav = 1.8; }
    case 5 { col = mix(vec3f(.85, .05, .40), vec3f(.60, .10, .80), step(.7, s1)); col = mix(col, vec3f(.95, .25, .55), step(.75, s2)); pr = vec4f(.22, .8, 0., .30); spc = vec3f(1., .35, .8); shp = vec2f(.6, .6); fls = 2.; }
    case 6 { col = mix(vec3f(.80, .16, .16), vec3f(.92, .36, .42), s1); pr = vec4f(.06, 1., 0., .10); spc = vec3f(1., .5, .5); shp = vec2f(.4, .3); wav = 2.; }
    default { col = mix(vec3f(.05, .40, .36), vec3f(.10, .52, .58), s1); pr = vec4f(.1, .9, .2, .04); spc = vec3f(.3, 1., .9); shp = vec2f(.6, .5); }
  }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + i.b.x), pr.x);
  let k = (i.c.w - .3) * 2.0 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .10 * fls;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let wv = sin(wph) * .12 * wav;
  let kq = k * 1.7; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  let N = normalize(pe * cK - d * sl); let T0 = normalize(d * cK + pe * sl);
  let tw = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  let shp_ = g.res.x == 0.;
  let cd = distance(i.a.xyz, g.cam.xyz); let far = FAR * g.mis.z;
  let nearK = select(1. - ss(26., 40., cd), 0., shp_);
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, g.cam.xyz)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(i.a.xyz + d * (len * .5), g.cam.xyz)), 1., shp_);
  let ruf = sin(v * 10. + s2 * 30. + t * .6) * i.b.z * .36 * u * shape2(v) * nearK;
  var p = c + S * (u * farK * select(i.b.z * .5 * shape, select(max(i.b.z * .5, .09) * shape, 0., ty == 1), shp_));
  p += N2 * ruf;
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc;
  return o;
}
struct GO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsGl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GO {
  var o: GO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  var p = a.xyz; let sw = sway(a.xz, a.w, t); p.x += sw.x; p.z += sw.y;
  p += .1 * vec3f(sin(t * .7 + b.x * 50.), sin(t * .9 + b.x * 70.), cos(t * .8 + b.x * 90.));
  let d = length(p - g.cam.xyz);
  if (d > 220. || dot(p - g.cam.xyz, g.fwd.xyz) < -1.) { o.cp = vec4f(0., 0., 2., 1.); return o; }
  let tw = pow(.5 + .5 * sin(t * (.35 + .9 * hs(b.x)) + b.x * 100.), 4.);
  let sz = min(max(b.z, d * .0026), d * .0045);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let z = zone(p);
  let lit = .3 + 1.8 * shadow1(p) * sunE(p.y, z).g + .6 * g.sunc.w;
  let e = b.z / sz;
  o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-sg(z).g * wlen(p)) * ss(.4, 1.5, d) * 17.;
  return o;
}
@fragment fn fsGl(i: GO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 7.) * (1. - ss(.7, 1., r)), vec3f(10.)), 0.);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus2(i.wp, dist);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let z = zone(i.wp);
  let lt = textureSample(tD, sR, vec2f(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  let vv = vol(i.wp + vec3f(0., .8, 0.));
  let E = sunE(i.wp.y, z) * shadow1(i.wp + L * .3);
  let ndl = dot(n, L);
  var alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.5, 1.12, i.uv.y) * (1. - .45 * ss(30., 8., dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + i.sd.x * .22 + i.uv.y * .5 + .55));
  alb = mix(alb, alb * .5 + ir * vec3f(.15, .13, .30), i.pr.z * (1. - ndv) * .8);
  let tr = (max(-ndl, 0.) * .85 + .15) * i.pr.y;
  let trc = alb * mix(vec3f(1.), vec3f(1.5, 1.4, .75), sat(i.pr.y) * (1. - i.pr.z));
  let aov = sat((vv.r - .5) * 6.) * mix(.4, 1., i.uv.y);
  let am = (amb(i.wp, n, vv.g, z) + amb(i.wp, -n, vv.g, z) * i.pr.y * .55 * vec3f(1.1, 1.15, .7) + side(i.wp, n, sat((vv.r - .5) * 4.), z) * .6) * (.3 + .7 * aov);
  var c = E * (.06 + ca * 1.5) * (alb * max(ndl, 0.) + trc * tr) + alb * am;
  let H = normalize(V + L);
  c += E * (pow(sat(dot(n, H)), 40.) * (.45 + ir * i.pr.z * 2.) + pow(sat(dot(n, H)), 9.) * .07) + am * ir * i.pr.z * pow(1. - ndv, 3.) * 1.5;
  c += E * trc * i.pr.y * pow(sat(dot(-V, L)), 3.) * 1.2;
  c += alb * i.pr.w * (.5 + 3. * dot(am + E * .3, vec3f(.1, .5, .5))) * (1. + g.sunc.w);
  // sparkle: whole-leaf glints that twinkle slowly
  let tw = pow(.5 + .5 * sin(g.cam.w * (.5 + i.sd.y * 1.4) + i.sd.x * 90.), 5.);
  let m = ss(.2, .0, abs(i.uv.y - (.35 + .45 * i.sd.y))) * (1. - i.uv.x * i.uv.x);
  let lit = .35 + E.g * 1.2 + .5 * g.sunc.w;
  c += i.spc * i.pr.x * (.1 + tw) * m * lit * .6;
  c += (alb * 1.5 + vec3f(.005, 0., .01)) * vec3f(.62, .3, 1.) * zone3(i.wp) * (.5 + .25 * g.env.w);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- creatures from the server stream
// One module, one pipeline per body plan (MESH): 0 fish (sparkfin), 1 ray (sweeper), 2 needle (needlejaw), 3 shark
// (shade), 4 jelly (lumen, blended). Meshes are built with +x forward, +y up, length (jelly: bell diameter) 1.
// Instance (80 bytes): a = position, size (m) | b = forward, swim phase (cycles) | c = up, glow |
// d = species index, flags, bend, fade-in | e = seed, speed / cruise, lying flat, 0
const W_CRE = S_B + /*wgsl*/`
override MESH: u32 = 0u;
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f, @location(5) d: vec4f, @location(6) e: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f,
  @location(3) @interpolate(flat) s: vec4f, @location(4) @interpolate(flat) x: vec4f, @location(5) lt: f32, @location(6) ax: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let F = i.b.xyz; let U = i.c.xyz; let S = cross(F, U);
  let ph = i.b.w * TAU; let sz = i.a.w * (.2 + .8 * i.d.w);
  var l = i.p; var n = i.n.xyz; let ax = i.n.w;
  let spd = sat(i.e.y);
  // eating: a short bite pulse every ~0.7 s
  let bite = f32((u32(i.d.y + .5) >> 2u) & 1u) * pow(max(sin(g.cam.w * 9. + i.e.x * 30.), 0.), 6.);
  if (MESH == 1u) {
    // ray: a wave runs out along the wings; still while it lies flat on the floor
    let mv = 1. - i.e.z; let au = abs(ax);
    let fp = ph - au * 1.2;
    l.y += (.18 * pow(au, 1.6) * sin(fp) - .03 * sin(ph)) * mv;
    let tail = ss(-.25, -.95, l.x) * step(au, .001);
    l.z += tail * sin(ph * .7 + l.x * 4.) * .05;
    let sl = (.288 * pow(au, .6) * sin(fp) - .216 * pow(au, 1.6) * cos(fp)) * sign(ax) * mv;
    n.z += 2. * sl * n.y;
  } else if (MESH == 4u) {
    // jelly: the bell pulses (ax < 0 on the bell, 0 at its rim), the tentacles (ax 0..1 to the tip) trail and sway
    let c = .5 + .5 * sin(ph);
    if (ax <= 0.) {
      let rim = 1. + ax; let k = 1. - .17 * c * rim * rim;
      l.x *= k; l.z *= k; l.y *= 1. + .1 * c;
    } else {
      let k = 1. - .17 * c * (1. - ax);
      l.x *= k; l.z *= k;
      let sw = ax * ax * .1;
      l.x += sin(ph * .5 + ax * 4. + i.e.x * 20.) * sw; l.z += cos(ph * .43 + ax * 3.3 + i.e.x * 31.) * sw;
      l.y += sin(ph - ax * 3.) * .03 * ax;
    }
  } else {
    // fish, needlejaw, shade: a travelling wave along the body, growing towards the tail
    var A = .075; var K = 7.; var w0 = .3;
    if (MESH == 2u) { A = .045; K = 9.; w0 = .2; }
    if (MESH == 3u) { A = .06; K = 5.5; w0 = .12; }
    A *= .3 + .7 * spd;
    let w = pow(sat((w0 - l.x) / (w0 + .55)), 1.5);
    let wv = ph - l.x * K;
    var f = A * w * sin(wv); var fx = -A * w * K * cos(wv);
    // needlejaw coiled into an S before a strike
    if (MESH == 2u) { let b = i.d.z * .06; f += b * sin(l.x * 6.5); fx += b * 6.5 * cos(l.x * 6.5); }
    l.z += f; n.x -= fx * n.z;
    l.x += bite * .035 * sat((l.x - .15) * 4.);
  }
  if (MESH == 1u) { l.y -= bite * .02; }
  let w = i.a.xyz + (F * l.x + U * l.y + S * l.z) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = F * n.x + U * n.y + S * n.z; o.op = i.p;
  o.s = vec4f(i.c.w, i.d.x, i.d.y, i.d.z); o.x = vec4f(i.e.xyz, bite); o.lt = shadow1(w); o.ax = ax;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let si = u32(i.s.y + .5) * 2u; let col = SPC[si].rgb; let gc = SPC[si + 1u].rgb;
  let fl = u32(i.s.z + .5); let sel = f32((fl >> 4u) & 1u);
  let op = i.op; let gi = i.s.x * g.env.w; let sd = i.x.x;
  var alb = col; var em = vec3f(0.); var sp = .6; var shp = 24.;
  if (MESH == 0u) {
    // sparkfin: dark back, silver belly, a golden line along the flank
    alb = mix(col * 1.25, col * vec3f(.3, .45, .55), ss(-.03, .15, op.y));
    let band = ss(.016, .004, abs(op.y - .003)) * ss(-.34, -.18, op.x) * ss(.44, .28, op.x);
    alb = mix(alb, gc * .7, band * .6);
    em = gc * band * gi * 2.2; sp = 1.2; shp = 30.;
  } else if (MESH == 1u) {
    // sweeper: sandy violet back with turquoise light spots, pale belly
    let top = ss(-.004, .004, op.y);
    let tx = textureSample(tD, sR, op.xz * 1.7 + sd);
    alb = mix(col * vec3f(1.25, 1.2, 1.15) + .08, col * (.6 + .6 * tx.b), top);
    let q = op.xz * 16.; let cl = floor(q); let hh = hs(cl.x * 7.13 + cl.y * 31.7 + sd * 17.);
    let dt = step(.7, hh) * ss(.34, .12, length(fract(q) - .5)) * top * ss(.47, .3, abs(op.z));
    em = gc * dt * gi * 3.; sp = .25; shp = 12.;
  } else if (MESH == 2u) {
    // needlejaw: deep blue, a chain of violet dots and a flickering lure under the chin
    alb = mix(col * 1.5, col * .55, ss(-.02, .05, op.y));
    let lure = f32(i.ax < -.5);
    let fk = .65 + .35 * sin(g.cam.w * 7. + sd * 40.) * sin(g.cam.w * 2.3 + sd * 9.);
    let band = ss(.02, .006, abs(op.y)) * ss(.45, .3, abs(fract(op.x * 10.) - .5) * 2.) * ss(-.45, -.3, op.x) * ss(.42, .3, op.x);
    em = gc * (lure * 4. * fk + band * 1.4) * gi; alb = mix(alb, gc, lure * .5);
    sp = 1.; shp = 40.;
  } else {
    // shade: slate grey, countershaded, a faint blue line along the belly
    alb = mix(col * 1.9 + vec3f(.04, .05, .06), col * .75, ss(-.06, .04, op.y));
    let line = ss(.018, .004, abs(op.z)) * step(op.y, -.01) * ss(-.38, -.22, op.x) * ss(.4, .25, op.x);
    em = gc * line * gi * 1.6; sp = .5; shp = 20.;
  }
  em += gc * i.x.w * .5 * gi;
  let E = sunE(i.wp.y, z) * i.lt;
  var c = alb * (E * (.25 + .75 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  c += E * pow(sat(dot(n, normalize(V + L))), shp) * sp + vec3f(.3, .6, .7) * pow(1. - sat(dot(n, V)), 3.) * .25 * vv.g * g.env.x;
  c += sel * vec3f(.4, .75, 1.) * pow(1. - sat(dot(n, V)), 4.) * (.5 + .3 * sin(g.cam.w * 4.));
  return fin(fog(c + em, i.wp, z));
}
@fragment fn fsJelly(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let z = zone(i.wp);
  let si = u32(i.s.y + .5) * 2u; let col = SPC[si].rgb; let gc = SPC[si + 1u].rgb;
  let fl = u32(i.s.z + .5); let sel = f32((fl >> 4u) & 1u);
  let gi = i.s.x * g.env.w;
  let fr = pow(1. - sat(abs(dot(n, V))), 2.);
  let bell = f32(i.ax <= 0.);
  let rim = ss(-.3, 0., i.ax) * bell;
  let E = sunE(i.wp.y, z) * (.4 + .6 * i.lt);
  let lit = col * (E * .3 + amb(i.wp, n, 1., z) * .9);
  let pul = .8 + .2 * sin(i.x.x * 50. + g.cam.w * 1.3) + i.x.w * .4;
  let em = mix(gc, col, .4) * gi * pul * (bell * (.1 + fr * .45 + rim * .9) + (1. - bell) * (.3 - .15 * i.ax));
  let a = mix(.45 * (1. - .5 * i.ax), .16 + .5 * fr + rim * .3, bell);
  let T = exp(-sg(z).g * wlen(i.wp));
  let c = (lit * a + em + sel * vec3f(.5, .85, 1.) * fr) * T;
  return vec4f(min(c, vec3f(20.)), sat(a * T));
}
`;

// ---------------------------------------------------------------- water surface, background (room) and glass
const W_SURF = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = vec3f(p.x * g.box.x, 0., p.y * g.box.z);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
fn ripple(p: vec2f, d: f32) -> vec2f {
  let fl = ss(260., 60., d);
  return (textureSample(tW, sR, p / 13.).ba + textureSample(tW, sR, p.yx / 4.7 + .2).ba * .7 + textureSample(tW, sR, p / 37. + .6).ba * .8) * fl;
}
// seen from below: Snell's window onto the lamp-lit room, total internal reflection of the water around it
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let v = i.wp - g.cam.xyz; let d = length(v); let V = v / d;
  let s = ripple(i.wp.xz, d);
  let n = normalize(vec3f(-s.x * .8, -1., -s.y * .8));
  let ci = sat(dot(V, -n));
  let k = 1. - 1.769 * (1. - ci * ci);
  let win = ss(0., .22, k);
  let rr = refract(V, n, 1.33);
  let sd = max(dot(rr, g.sun.xyz), 0.);
  let fr = pow(1. - sqrt(max(k, 0.)), 5.);
  let sky = (vec3f(.30, .78, 1.) * 1.3 * g.env.x * clamp(1. + 3.8 * (s.x * .6 - s.y * .8), .25, 3.) + g.sunc.rgb * .6 * (pow(sd, 60.) * 1.3 + pow(sd, 500.) * 12.)) * (1. - fr);
  let z = zone(i.wp);
  let R = reflect(V, n);
  let rs = wseg(i.wp, R, 300.);
  let refl = fogIn(i.wp, R, max(rs.y - rs.x, 1.), z, g.sun.xyz) * 1.15;
  let c = mix(refl, sky, win);
  return fin(fog(c, i.wp, z));
}
// seen from above (blended): a faint reflection of the room and the lamp over the view into the water
@fragment fn fsTop(i: VO) -> @location(0) vec4f {
  let v = i.wp - g.cam.xyz; let d = length(v); let V = v / d;
  let s = ripple(i.wp.xz, d);
  let n = normalize(vec3f(-s.x * .35, 1., -s.y * .35));
  let fr = .02 + .98 * pow(1. - sat(dot(-V, n)), 5.);
  let R = reflect(V, n);
  let c = roomCol(i.wp, R) * fr + g.sunc.rgb * pow(sat(dot(R, g.sun.xyz)), 400.) * 4. + vec3f(.006, .02, .028) * g.env.x;
  return vec4f(min(c, vec3f(20.)), fr * .85 + .05);
}
// behind everything: the room, seen through whatever water lies along the ray
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let rd = normalize(i.wp - g.cam.xyz);
  var c = roomCol(g.cam.xyz, rd);
  let s = wseg(g.cam.xyz, rd, 1e5);
  if (s.y > s.x) {
    let L = s.y - s.x; let ro = g.cam.xyz + rd * s.x; let z = zone(ro);
    c = c * exp(-sg(z) * L) + fogIn(ro, rd, L, z, g.sun.xyz) * (.58 + .42 * vol(ro + rd * L).g);
  }
  return fin(c);
}
`;

// glass walls: four transparent faces from the bottom to the rim, a light Fresnel reflection, bright edges and water line
const W_GLASS = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) uv: vec2f, @location(2) @interpolate(flat) n: vec3f, @location(3) @interpolate(flat) ext: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var o: VO;
  let f = vi / 6u; let k = vi % 6u;
  let u = f32((0x16u >> k) & 1u); let v = f32((0x34u >> k) & 1u);
  let h = g.box.y + g.box.w; let y = v * h - g.box.y;
  let sx = select(-1., 1., (f & 1u) == 0u);
  if (f < 2u) { o.wp = vec3f(sx * g.box.x, y, (u * 2. - 1.) * g.box.z); o.n = vec3f(sx, 0., 0.); o.ext = vec2f(2. * g.box.z, h); }
  else { o.wp = vec3f((u * 2. - 1.) * g.box.x, y, sx * g.box.z); o.n = vec3f(0., 0., sx); o.ext = vec2f(2. * g.box.x, h); }
  o.uv = vec2f(u * o.ext.x, v * h);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let v = i.wp - g.cam.xyz; let d = length(v); let V = v / d;
  let ci = abs(dot(V, i.n));
  let fr = .04 + .96 * pow(1. - ci, 5.);
  let R = reflect(V, i.n * -sign(dot(i.n, V)));
  let px = max(.025, d * .0011);
  let e = min(min(i.uv.x, i.ext.x - i.uv.x), min(i.uv.y, i.ext.y - i.uv.y));
  let edge = ss(px * 2.5, px * .5, e);
  let wl = ss(px * 2., 0., abs(i.wp.y)) * .6;
  // the edges catch the room light: seen from outside only
  let s0 = wseg(g.cam.xyz, V, 1e-3); let ins = f32(s0.y > s0.x);
  let ek = (.4 + .6 * g.env.x) * (1. - ins);
  var c = roomCol(i.wp, R) * fr * 3. + vec3f(.5, .8, .85) * (edge * .55 + wl * .25) * ek + vec3f(.012, .025, .025);
  c += g.sunc.rgb * pow(sat(dot(R, g.sun.xyz)), 200.) * .6;
  let a = sat(fr * .75 + .03 + (edge * .45 + wl * .15) * ek);
  // the far walls are seen through the water
  let s = wseg(g.cam.xyz, V, d - .02); let T = exp(-sg(0.).g * max(s.y - s.x, 0.));
  return vec4f(min(c * T, vec3f(20.)), a * T);
}
`;

// ---------------------------------------------------------------- sprites: bubbles, state particles (alpha); drifting motes, plankton (additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
fn inBox(p: vec3f) -> f32 { return f32(all(abs(p.xz) < g.box.xz) && p.y < 0. && p.y > -g.box.y); }
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let life = fract(t * b.y / b.z + b.x);
  let h = life * b.z;
  var p = a.xyz + vec3f(0., h, 0.);
  let wob = b.w * (.3 + h * .035);
  p.x += sin(t * 1.7 + b.x * 50. + h * .6) * wob + sin(h * .13 + b.x * 9.) * b.w * 2.;
  p.z += cos(t * 1.3 + b.x * 33. + h * .5) * wob + cos(h * .11 + b.x * 7.) * b.w * 2.;
  let sz = a.w * (.55 + .7 * life) * ss(0., .03, life) * ss(0., -1.2, p.y);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  o.pr = vec4f(b.x, sz, shadow1(p), 0.);
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let t = g.cam.w;
  let an = atan2(i.uv.y, i.uv.x + 1e-4);
  let big = ss(.04, .22, i.pr.y);
  let r = length(i.uv) / (.9 + big * .05 * sin(an * 3. + t * 5. + i.pr.x * 40.) + big * .02 * sin(an * 5. - t * 7.));
  let aa = fwidth(r) * 1.5;
  let disc = 1. - ss(1. - aa, 1., r);
  let rim = ss(.55, .98, r);
  let hl = ss(.34, .0, length(i.uv - vec2f(-.36, .42))) + .5 * ss(.2, .0, length(i.uv - vec2f(.4, -.42)));
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * (.25 + .75 * i.pr.z);
  let hi = fogIn(i.wp, vec3f(0., 1., 0.), 80., z, g.sun.xyz) * 1.5;
  let lo = fogIn(i.wp, vec3f(0., -1., 0.), 80., z, g.sun.xyz);
  var c = mix(lo, hi, ss(-.5, .8, i.uv.y + rim * .4)) * (.5 + 1.2 * rim) + E * hl * 1.6;
  var al = disc * sat(.03 + rim * rim * rim * .9 + hl);
  let v = i.wp - g.cam.xyz; let d = length(v); let rd = v / d;
  let s = wseg(g.cam.xyz, rd, d); let L = max(s.y - s.x, 0.);
  let T = exp(-sg(z).g * L) * ss(1.2, 3., d);
  c = c * T + fogIn(g.cam.xyz + rd * s.x, rd, L, z, g.sun.xyz) * (1. - T);
  al *= mix(.35, 1., T);
  return vec4f(min(max(c * al, vec3f(0.)), vec3f(20.)), al);
}
// food pellets, detritus and carcasses from the state frame: a = position, radius (m); k = kind
@vertex fn vsPart(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) k: f32) -> VO {
  var o: VO; let q = quad(vi);
  let d = length(a.xyz - g.cam.xyz);
  let px = d * .0018;
  let sz = max(a.w, px);
  let w = a.xyz + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = a.xyz;
  o.pr = vec4f(k, min(1., a.w / px), shadow1(a.xyz), wlen(a.xyz));
  return o;
}
@fragment fn fsPart(i: VO) -> @location(0) vec4f {
  let r = length(i.uv); let al = (1. - ss(.7, 1., r)) * (.4 + .6 * i.pr.y);
  var col = vec3f(.95, .55, .18); var em = .35;
  if (i.pr.x > .5) { col = vec3f(.32, .28, .22); em = .03; }
  if (i.pr.x > 1.5) { col = vec3f(.78, .74, .66); em = .06; }
  let z = zone(i.wp);
  let c = col * (sunE(i.wp.y, z) * (.25 + .75 * i.pr.z) * .7 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * 1.2) * (1. - r * r * .5) + col * em * g.env.w;
  let T = exp(-sg(z).g * i.pr.w);
  return vec4f(min(c * al * T, vec3f(10.)), al * T);
}
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(t * .22, t * .05, t * .13) + .5 * vec3f(sin(t * .3 + a.x * 60.), sin(t * .23 + a.y * 50.), cos(t * .27 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = (.012 + .045 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0011);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011)) * ss(-.3, -1.5, p.y) * inBox(p);
  let tw = .6 + .4 * sin(t * (1. + a.w * 2.) + a.x * 100.);
  o.pr = vec4f(fade * tw, shadow1(p), a.w, wlen(p));
  return o;
}
@fragment fn fsSnow(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1., .2, r);
  let z = zone(i.wp);
  let c = (sunE(i.wp.y, z) * i.pr.y * .8 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .3) * mix(vec3f(1.), vec3f(.7, 1., .9), i.pr.z);
  return vec4f(min(max(c * m * m * i.pr.x * exp(-sg(z).g * i.pr.w), vec3f(0.)), vec3f(8.)), 0.);
}
// plankton motes, fixed in the tank and drifting; each shows where the density grid (tP) is above its own threshold
@vertex fn vsPl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  var u = a.xyz + vec3f(t * .0011, 0., t * .0007) + .006 * vec3f(sin(t * .21 + a.y * 60.), sin(t * .17 + a.z * 50.), cos(t * .19 + a.x * 70.));
  u = fract(u);
  let p = vec3f(-g.box.x, -g.box.y, -g.box.z) + u * vec3f(2. * g.box.x, g.box.y, 2. * g.box.z);
  let dn = textureSampleLevel(tP, sC, u.xzy, 0.).r;
  let d = length(p - g.cam.xyz);
  let vis = ss(a.w, a.w + .12, dn * 1.3);
  let sz = .018 + .03 * fract(a.w * 13.7);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0012);
  o.cp = select(g.vp * vec4f(w, 1.), vec4f(0., 0., 2., 1.), vis < .01);
  o.uv = q; o.wp = p;
  o.pr = vec4f(vis * min(1., sz / (d * .0012)) * ss(.5, 2., d), shadow1(p), fract(a.w * 7.3), wlen(p));
  return o;
}
@fragment fn fsPl(i: VO) -> @location(0) vec4f {
  let r = length(i.uv); let m = ss(1., .1, r);
  let z = zone(i.wp);
  let lit = sunE(i.wp.y, z) * i.pr.y * .5 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .4;
  let bio = mix(vec3f(.25, 1., .75), vec3f(.4, .7, 1.), i.pr.z) * (.04 + .35 * g.sunc.w) * g.vsz.w;
  let c = (lit * vec3f(.75, 1., .85) + bio) * m * m * i.pr.x * exp(-sg(z).g * i.pr.w);
  return vec4f(min(max(c, vec3f(0.)), vec3f(8.)), 0.);
}
`;

// ---------------------------------------------------------------- volumetric light shafts (half res), inside the water only
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  let sgm = wseg(g.cam.xyz, rd, min(zl * rl, 400.));
  if (sgm.y <= sgm.x) { return vec4f(0., 0., 0., zl); }
  let ro = g.cam.xyz + rd * sgm.x; let tm = sgm.y - sgm.x;
  let sx = g.sun.xyz; let k = kd(g.sun.w); let sgz = sg(g.sun.w);
  let dt = tm / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = vec3f(0.);
  for (var n = 0; n < ${RAYN}; n++) {
    let t = (f32(n) + j) * dt;
    let p = ro + rd * t;
    let s = g.sm * vec4f(p, 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
    let q = p.xz - sx.xz * (p.y / sx.y);
    let pat = ss(.3, .7, textureSampleLevel(tW, sR, q / 27., 2.5).r) * ss(.15, .6, textureSampleLevel(tW, sR, q.yx / 11. + .3, 2.).r);
    let o = textureSampleLevel(tV, sC, (p - g.vo.xyz) * g.vsz.xyz, 0.).r;
    let mist = sat(1. - (o - .5) * 3.4);
    acc += exp(-sgz * t + k * (p.y / sx.y)) * (vis * (.012 + pat * 6.) * (1. + 1.2 * mist * mist));
  }
  let mu = max(dot(rd, sx), 0.);
  let ph = mix(.2 + 2.0 * mu * mu * mu, .8, g.sun.w);
  let wc = mix(WCOL + vec3f(.04, .07, .05), PCOL + vec3f(.28, .16, .12), g.sun.w);
  return vec4f(min(acc * dt * sgz * wc * g.sunc.rgb * ph * g.mis.y * (1. - .55 * g.sun.w), vec3f(20.)), zl);
}
`;
// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  // depth-aware upsample of the half-res shafts
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .06) + bl * .03;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .55;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .55);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, .93) + vec3f(.008, .002, 0.);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
