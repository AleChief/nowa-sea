// ============================================================================
// renderer: device, pipelines, the tank world from `hello`, frame loop, hooks for the HUD and tests
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  a.finished.catch(() => 0); // a rebuild cancels it
  return new Promise((r) => { a.ready.then(() => setTimeout(r), () => 0); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
$('s').textContent = TXT.connecting;
if (!navigator.gpu) fail(TXT.noGpu);
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail(TXT.noAdapter);
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep(QKEY, LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = TXT.lost;
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: max(4, (data.byteLength + 3) & ~3), usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tWater = tex(WATER, WATER, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
// per world (replaced on every build): skylight / openness volume, ground map; plankton density (on every plankton frame)
let tVol = tex(4, 4, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: 4 }), tMap = tex(4, 4, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);
let tPl = tex(16, 10, 'r8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: 6 });

// uniforms: struct G in shaders.js (84 floats)
const UB = new Float32Array(84), UBS = new Float32Array(84);
const ubo = device.createBuffer({ size: 336, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 336, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });
// species colours: per species index, (body colour, 1) and (glow colour, 1)
const SPCD = new Float32Array(128), spcBuf = device.createBuffer({ size: 512, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} },
  { binding: 9, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 10, visibility: VF, buffer: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tWater.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() }, { binding: 9, resource: tPl.createView() }, { binding: 10, resource: { buffer: spcBuf } }] });
let bg0, bg0s;
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pMip16 = blitPipe('fsMip', HDR), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibCre = { arrayStride: CSTR * 4, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4'), A(5, 48, 'float32x4'), A(6, 64, 'float32x4')] };
const ibBub = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibPart = { arrayStride: PSTR * 4, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32')] };
const ibSnow = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }], constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });
const PRE = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };

await say(TXT.connecting, 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mCre = mod(W_CRE), mSurf = mod(W_SURF), mSpr = mod(W_SPR), mGlass = mod(W_GLASS);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]);
const pLeaf = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } });
const pLeaf5 = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } });
const pLeafS = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 70 } });
const pLeafF = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 200 } });
const pCre = [0, 1, 2, 3].map((k) => scenePipe(mCre, 'vs', 'fs', [vbSolid, ibCre], { constants: { MESH: k } }));
const pJelly = scenePipe(mCre, 'vs', 'fsJelly', [vbSolid, ibCre], { constants: { MESH: 4 }, blend: PRE });
const pSurf = scenePipe(mSurf, 'vs', 'fs', [], { strip: true }), pSurfTop = scenePipe(mSurf, 'vs', 'fsTop', [], { strip: true, blend: PRE });
const pBack = scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true });
const pBub = scenePipe(mSpr, 'vsBub', 'fsBub', [ibBub], { strip: true, blend: PRE });
const pPart = scenePipe(mSpr, 'vsPart', 'fsPart', [ibPart], { strip: true, blend: PRE });
const pSnow = scenePipe(mSpr, 'vsSnow', 'fsSnow', [ibSnow], { strip: true, blend: ADD });
const pPl = scenePipe(mSpr, 'vsPl', 'fsPl', [ibSnow], { strip: true, blend: ADD });
const pGl = scenePipe(mLeaf, 'vsGl', 'fsGl', [ibBub], { strip: true, blend: ADD, constants: { ROWS: 7 } });
const pGlass = scenePipe(mGlass, 'vs', 'fs', [], { blend: PRE });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const pLeafSh = shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });

const mWater = mod(W_WATER);
const pWater = device.createRenderPipeline({ layout: 'auto', vertex: { module: mWater, entryPoint: 'vs' }, fragment: { module: mWater, entryPoint: 'fs', targets: [{ format: HDR }] } });
const bgWater = device.createBindGroup({ layout: pWater.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const waterViews = [0, 1, 2, 3, 4].map((m) => tWater.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const waterBG = waterViews.map((v) => blitBG(v));
const waterPass = waterViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));

const mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });

// ---------------------------------------------------------------- the lamp above the tank (fixed direction) + shadow matrix
const SUN = (() => { const v = [0.27, 1, -0.24], l = hypot(...v); return v.map((c) => c / l); })();
for (let i = 0; i < 3; i++) UB[48 + i] = UBS[48 + i] = SUN[i];
UBS[58] = 1;
function setShadow(tank) {
  const L = SUN, lr = [L[1], -L[0], 0], ll = hypot(...lr); lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const c = [0, -tank.depth / 2, 0], R = hypot(tank.half_x, tank.depth / 2, tank.half_z) + 2, cl = c[0] * L[0] + c[1] * L[1] + c[2] * L[2];
  const d0 = cl - R - 2, d1 = cl + R + 2, m = UBS, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  m[0] = lr[0] / R; m[4] = lr[1] / R; m[8] = lr[2] / R; m[12] = -dot(c, lr) / R;
  m[1] = lu[0] / R; m[5] = lu[1] / R; m[9] = lu[2] / R; m[13] = -dot(c, lu) / R;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  UBS[32] = 0; UBS[33] = -tank.depth / 2; UBS[34] = 0; UBS[35] = 0;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- meshes (independent of the world)
// ids: 0-3 rocks, 4-6 sponges, 7-8 coral, 9 tube sponge, 10-14 creatures (fish, ray, needle, shark, jelly),
// 15-21 rock chips + pebbles, 22-23 coral LOD, 24-26 far LOD of the large rock chips
const meshes = [meshChunk(1, 3), meshChunk(7, 3), meshChunk(13, 3), meshChunk(22, 3),
  meshLathe([[0, 0, 0.5], [0.34, 0, 0.6], [0.5, 0.2, 0.85], [0.6, 0.6, 1], [0.55, 0.95, 1], [0.47, 1.08, 1], [0.38, 1.1, 0.9], [0.3, 1.0, 0.45], [0.26, 0.6, 0.15], [0, 0.35, 0.05]], 18, 0.3, 9),
  meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.26, 0.5, 0.85], [0.4, 1.25, 1], [0.4, 1.42, 1], [0.33, 1.48, 0.9], [0.26, 1.38, 0.4], [0.18, 0.8, 0.12], [0, 0.5, 0.05]], 16, 0.35, 8),
  meshLathe([[0, 0, 0.5], [0.5, 0, 0.7], [0.72, 0.18, 1], [0.74, 0.38, 1], [0.62, 0.5, 0.9], [0.48, 0.42, 0.45], [0.4, 0.2, 0.15], [0, 0.14, 0.06]], 18, 0.25, 10),
  meshCoral(0), meshCoral(1), meshTubes(),
  meshFishHi(), meshManta().xf((x, y, z) => [z * 0.5, y * 0.3, -x * 0.5]), meshNeedle(), meshShark(), meshJelly(),
  meshChunk(3), meshChunk(11), meshChunk(29), meshChunk(5, 3), meshChunk(17, 3), meshChunk(41, 3), meshChunk(9, 1), meshCoral(0, 1), meshCoral(1, 1),
  meshChunk(5, 2, 1), meshChunk(17, 2, 1), meshChunk(41, 2, 1)].map((m) => m.build());
const CH = 15, CHF = 21, PRL = 19, CM = meshes.slice(10, 15);
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
// creature + particle instances: one buffer, creatures first, particles from PARTOFF; written once per frame
const PARTOFF = MAXC * CSTR * 4, instB = device.createBuffer({ size: PARTOFF + MAXP * PSTR * 4, usage: BU.VERTEX | BU.COPY_DST });

// ---------------------------------------------------------------- one-time bake: detail texture
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  Q.submit([e.finish()]);
}

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. frame() tunes it and the draw distance scale `det`
// for 60 fps; both start where the last visit left them.
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : 3e5, DETMIN = 0.4;
let W = 0, H = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [], vDp, vRes, vRay, vRay2, vBl;
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  vDp = tDp.createView(); vRes = tRes.createView(); vRay = tRay.createView(); vRay2 = tRay2.createView(); vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bloomPass = [];
  for (let i = 0; i < NB; i++) bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] });
  for (let i = NB - 1; i > 0; i--) bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] });
  mkRT();
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
// bind groups that read the render targets or the world's volume texture
function mkRT() {
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: tWater.createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sClamp }] });
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  bloomBG = [];
  for (let i = 0; i < NB; i++) bloomBG.push(blitBG(i ? vBl[i - 1] : vRes));
  for (let i = NB - 1; i > 0; i--) bloomBG.push(blitBG(vBl[i]));
}
function mkBG() { bg0 = mkBG0(ubo, tShadow); bg0s = mkBG0(uboS, tDummy); if (W) mkRT(); }
mkBG();
resize();
addEventListener('resize', resize);

function uploadSpecies(h) {
  SPCD.fill(0);
  for (const s of h.species || []) {
    const i = (s.index | 0) & 15, c = s.color || [0.6, 0.7, 0.8], g = s.glow || [1, 0.8, 0.3];
    SPCD[i * 8] = c[0]; SPCD[i * 8 + 1] = c[1]; SPCD[i * 8 + 2] = c[2]; SPCD[i * 8 + 3] = 1;
    SPCD[i * 8 + 4] = g[0]; SPCD[i * 8 + 5] = g[1]; SPCD[i * 8 + 6] = g[2]; SPCD[i * 8 + 7] = 1;
  }
  Q.writeBuffer(spcBuf, 0, SPCD);
}
// plankton density (u8, x fastest, then z, then y from the floor up) -> 3D texture (nx, nz, ny)
function uploadPlankton() {
  if (!plank) return;
  const { nx, ny, nz, data } = plank;
  if (tPl.width !== nx || tPl.height !== nz || tPl.depthOrArrayLayers !== ny) { const old = tPl; tPl = tex(nx, nz, 'r8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: ny }); mkBG(); old.destroy(); }
  Q.writeTexture({ texture: tPl }, data, { bytesPerRow: nx, rowsPerImage: nz }, [nx, nz, ny]);
}

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- the world, built from `hello` + the floor frame
let WD = null, urlDone = false;
const FOGK = 0.5; // water clarity: SIG scale (abyssal's open sea is murkier than a tank)
addEventListener('pagehide', () => keep(LKEY, ''));
async function buildWorld(job) {
  const tank = job.hello.tank, old = WD;
  WD = null; body.className = 'l'; $('m').style.display = ''; $('b').getAnimations().forEach((a) => a.cancel()); loaded = 0;
  await say(TXT.sculpt, 0.2, 700);
  keep(LKEY, 1); // marks a load in progress (quality.js); leaving the page before it ends is not a crash
  setGrid(tank); setTankCamera(tank);
  // density bake on the GPU, in slabs of 32 z-layers (short GPU jobs), read back once
  const nPos = (tank.positives || []).length, nHole = (tank.holes || []).length;
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  const size = NX * NY * NZ * 4, u = new ArrayBuffer(80), uu = new Uint32Array(u), uf = new Float32Array(u);
  const fo = (tank.floor && tank.floor.origin) || [-tank.half_x, -tank.half_z];
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  uu[8] = nPos; uu[9] = nHole; uu[10] = job.nx; uu[11] = job.nz;
  uf[12] = tank.half_x; uf[13] = tank.depth; uf[14] = tank.half_z; uf[16] = fo[0]; uf[17] = fo[1]; uf[18] = (tank.floor && tank.floor.res) || 1;
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(primBuffer(tank), BU.STORAGE), bf = buf(job.h, BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }, { binding: 3, resource: { buffer: bf } }] });
  for (let z0 = 0; z0 < NZ; z0 += 32) {
    uu[3] = z0; Q.writeBuffer(bu, 0, u);
    const e = device.createCommandEncoder(), c = e.beginComputePass();
    c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, min(32, NZ - z0) / 4); c.end();
    Q.submit([e.finish()]);
  }
  { const e = device.createCommandEncoder(); e.copyBufferToBuffer(bd, 0, br, 0, size); Q.submit([e.finish()]); }
  await br.mapAsync(GPUMapMode.READ);
  const D = new Float32Array(br.getMappedRange().slice(0));
  br.unmap(); for (const b of [br, bd, bu, bp, bf]) b.destroy();
  // collision grid for the camera: the density as Int8, 127 = 1 m into rock
  const cg = new Int8Array(D.length);
  for (let i = 0; i < D.length; i++) { const v = D[i]; cg[i] = v >= 1 ? 127 : v <= -1 ? -127 : round(v * 127); }
  await say(TXT.carve, 0.4, 600);
  const T = buildTerrain(D);
  await say(TXT.grow, 0.75, 1800);
  const Wd = makeWorld(D, T, tank);

  // GPU copies; kept in `res` so the next world can free them
  const res = [], B = (data, usage) => { const b = buf(data, usage); res.push(b); return b; };
  const vbTerrain = B(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = B(T.ib, BU.INDEX);
  const nSolid = Wd.solids.data.length / 12;
  const solidData = new Float32Array((nSolid + 1) * 12); solidData.set(Wd.solids.data); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], nSolid * 12);
  const ibSolids = B(solidData, BU.VERTEX);
  const ibChunk = Wd.chunks.map((c) => B(c.data, BU.VERTEX)), ibProp = Wd.props.map((c) => B(c.data, BU.VERTEX));
  const ibBig = B(new Uint8Array(Wd.big.buf), BU.VERTEX), ibBigF = B(new Uint8Array(Wd.bigF.buf), BU.VERTEX), ibSmall = B(new Uint8Array(Wd.small.buf), BU.VERTEX);
  const ibBubbles = B(Wd.bubbles, BU.VERTEX), ibSnowB = B(Wd.snow, BU.VERTEX), ibGl = B(Wd.glints, BU.VERTEX), ibPl = B(Wd.plank, BU.VERTEX);
  const nVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 }), nMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);
  Q.writeTexture({ texture: nVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
  Q.writeTexture({ texture: nMap }, Wd.gm, { bytesPerRow: 2048 }, [512, 512]);
  const oVol = tVol, oMap = tMap; tVol = nVol; tMap = nMap;
  // per-world uniforms: water box, volume mapping, grotto
  const gr = (tank.shelters || []).find((s) => s.kind === 'grotto');
  const PW = [tank.half_x, tank.depth, tank.half_z, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, OX, OY, OZ, FOGK, 1 / (NX * VS), 1 / (NY * VS), 1 / (NZ * VS), 1,
    gr ? gr.c[0] : 0, gr ? gr.c[1] : -1e3, gr ? gr.c[2] : 0, gr ? gr.r : 0];
  for (let i = 0; i < 24; i++) if (i < 4 || i >= 12) UB[60 + i] = UBS[60 + i] = PW[i];
  setShadow(tank);
  mkBG();
  oVol.destroy(); oMap.destroy();
  // shadow map: terrain, rocks, (High: chips and props), kelp
  {
    const e = device.createCommandEncoder();
    const r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    r.setBindGroup(0, bg0s);
    r.setPipeline(pTerrSh); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
    r.drawIndexed(T.ib.length, 1, 0, 0, nSolid);
    r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
    for (let i = 0; i < 4; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
    if (!LV) for (let i = 0; i < NCHUNK; i++) if (Wd.chunks[i].n) { r.setVertexBuffer(1, ibChunk[i]); r.drawIndexed(meshes[CH + i].ib.length, Wd.chunks[i].n, meshes[CH + i].i0, meshes[CH + i].v0, 0); }
    if (!LV) for (let i = 0; i < 6; i++) if (Wd.props[i].n) { r.setVertexBuffer(1, ibProp[i]); r.drawIndexed(meshes[4 + i].ib.length, Wd.props[i].n, meshes[4 + i].i0, meshes[4 + i].v0, 0); }
    if (Wd.big.n) { r.setPipeline(pLeafSh); r.setVertexBuffer(0, ibBig); r.draw(6, Wd.big.n); }
    r.end();
    Q.submit([e.finish()]);
  }
  if (old) for (const b of old.res) b.destroy();
  CG = cg;
  WD = { T: { start: T.start, lo: T.lo, hi: T.hi, ni: T.ib.length, nv: T.nv }, chunks: Wd.chunks, props: Wd.props, big: Wd.big, bigF: Wd.bigF, small: Wd.small, solids: Wd.solids,
    nSolid, vbTerrain, ibTerrain, ibSolids, ibChunk, ibProp, ibBig, ibBigF, ibSmall, ibBubbles, ibSnowB, ibGl, ibPl,
    nBub: Wd.bubbles.length / 8, nSnow: Wd.snow.length / 4, nGl: Wd.glints.length / 8, nPl: Wd.plank.length / 4, res };
  for (const o of [Wd.big, Wd.bigF, Wd.small, ...Wd.chunks, ...Wd.props]) o.buf = o.data = 0;
  if (!urlDone) { urlDone = true; applyUrl(); }
  await say(TXT.light, 1, 400);
  // the first frame compiles the pipelines; wait for it (not forever: a hidden tab may not run the GPU queue)
  updateLight(0.016); updateCamera(0.016); render(); await Promise.race([Q.onSubmittedWorkDone(), new Promise((r) => setTimeout(r, 4000))]);
  setTimeout(keep, 15e3, LKEY, ''); // the load counts as survived after 15 s of frames
  body.className = document.pointerLockElement ? 'g p' : 'g';
  setTimeout(() => { if (WD) $('m').style.display = 'none'; }, 900); // also where a throttled tab never runs the fade
  nowa.ready = true;
}

// ---------------------------------------------------------------- day and night from the stream
// light 0..1 (server) -> lamp colour and intensity, ambient, in-scatter, caustics, light shafts, glow boost, exposure
let lightS = -1, nightS = 0;
function updateLight(dt) {
  const s = snN ? snap[snHead] : null, dl = nowa.debug.light;
  const tgt = typeof dl === 'number' ? clamp(dl, 0, 1) : s ? clamp(s.light, 0, 1) : 0.8;
  lightS = lightS < 0 ? tgt : lightS + (tgt - lightS) * (1 - exp(-dt * 1.5));
  const L = lightS, I = pow(L, 1.15), night = sstep(0.32, 0.06, L), dusk = sstep(0.1, 0.35, L) * sstep(0.85, 0.5, L);
  nightS = night;
  UB[64] = mix(1.7, 2.0, dusk) * I + 0.05 * night; UB[65] = mix(1.6, 1.3, dusk) * I + 0.09 * night; UB[66] = mix(1.45, 0.9, dusk) * I + 0.17 * night; UB[67] = night;
  UB[68] = 0.05 + 0.95 * I + 0.05 * night; UB[69] = 0.05 + 0.95 * I + 0.07 * night; UB[70] = 0.15 + 0.85 * I; UB[71] = 1 + 2.2 * night;
}

// ---------------------------------------------------------------- frame
let hud = false, lastDraw = 0, statFps = 0, statFrames = 0, sfN = 0, sfT = 0;
const TANH = 0.6, NEAR = 0.05, EXPO = 0.62, RAYS = 0.54;
const submitList = [null], noop = () => {};
const rowOrd = new Uint8Array(CELLS);
// Draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) (scaled by `det`, but not for the
// terrain) as merged runs, nearest rows first.
function drawCells(r, start, lo, hi, mar, indexed, verts, minD, maxD) {
  const cx = F[DX], cy = F[DY], cz = F[DZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = CZ0 + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = CX0 + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * TANH;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, WD.nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
        run = -1;
      }
    }
  }
}
function render() {
  const Wd = WD, T = WD.T;
  // camera basis (right vector is horizontal)
  const cx = F[DX], cy = F[DY], cz = F[DZ], pitch = F[DPIT], yaw = F[DYAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const asp = W / H, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  // the camera inside the grotto tints the water violet
  let zt = 0;
  if (m[83] > 0) { const qx = (cx - m[80]) / (m[83] * 1.5), qy = (cy - m[81]) / m[83], qz = (cz - m[82]) / (m[83] * 1.1); zt = sstep(1.7, 0.9, sqrt(qx * qx + qy * qy + qz * qz)); }
  m[51] = zt;
  // exposure: brighter down in the water and at night (the eye adapts); from the room a fixed middle value
  let ek = cy < 0 && abs(cx) < m[60] && abs(cz) < m[62] ? (-cy - 5) / 22 : 0.45; ek = ek < 0 ? 0 : ek > 1 ? 1 : ek;
  m[56] = EXPO * (0.6 + 0.4 * ek) * (1 + 0.9 * nightS); m[57] = RAYS * pow(lightS, 1.3); m[58] = det;
  Q.writeBuffer(ubo, 0, UB);
  WT[0] = F[TIME]; Q.writeBuffer(uboW, 0, WT);
  if (nCre) Q.writeBuffer(instB, 0, CI, 0, nCre * CSTR);
  if (nPart) Q.writeBuffer(instB, PARTOFF, PI_, 0, nPart * PSTR);

  { let cr = floor((cz - CZ0) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr; let n = 0; rowOrd[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  waterPass[0].timestampWrites = slot ? tsBegin : undefined;
  passPost.timestampWrites = slot ? tsEnd : undefined;
  // animated water texture + mips
  let r = e.beginRenderPass(waterPass[0]); r.setPipeline(pWater); r.setBindGroup(0, bgWater); r.draw(3); r.end();
  for (let i = 1; i < 5; i++) { r = e.beginRenderPass(waterPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, waterBG[i - 1]); r.draw(3); r.end(); }
  // scene
  r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setVertexBuffer(0, Wd.vbTerrain); r.setVertexBuffer(1, Wd.ibSolids); r.setIndexBuffer(Wd.ibTerrain, 'uint32');
  drawCells(r, T.start, T.lo, T.hi, 1.5, 1, 0, 0, 260);
  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 0; i < 4; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  for (let i = 0; i < NCHUNK; i++) {
    const c = Wd.chunks[i]; if (!c.n) continue;
    const big = i > 2 && i < 6; r.setVertexBuffer(1, Wd.ibChunk[i]);
    drawCells(r, c.start, c.lo, c.hi, 3, meshes[CH + i], 0, 0, i > 5 ? 40 : big ? 50 : 110);
    if (big) drawCells(r, c.start, c.lo, c.hi, 3, meshes[CHF + i], 0, 50, 170);
  }
  for (let i = 0; i < 6; i++) {
    const p = Wd.props[i]; if (!p.n) continue;
    const lod = i === 3 || i === 4; r.setVertexBuffer(1, Wd.ibProp[i]);
    drawCells(r, p.start, p.lo, p.hi, 3, meshes[4 + i], 0, 0, lod ? 8 : 170);
    if (lod) drawCells(r, p.start, p.lo, p.hi, 3, meshes[PRL + i], 0, 8, 170);
  }
  // creatures (opaque body plans), one instanced draw each
  r.setVertexBuffer(1, instB, 0);
  for (let k = 0; k < 4; k++) if (kindN[k]) { const cm = CM[k]; r.setPipeline(pCre[k]); r.drawIndexed(cm.ib.length, kindN[k], cm.i0, cm.v0, kindOff[k]); }
  // kelp and plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  if (Wd.big.n) {
    r.setPipeline(pLeaf); r.setVertexBuffer(0, Wd.ibBig); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 18, 0, 24);
    r.setPipeline(pLeaf5); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 10, 24, 58);
    r.setPipeline(pLeafF); r.setVertexBuffer(0, Wd.ibBigF); drawCells(r, Wd.bigF.start, Wd.bigF.lo, Wd.bigF.hi, 5, false, 6, 58, 200);
  }
  if (Wd.small.n) { r.setPipeline(pLeafS); r.setVertexBuffer(0, Wd.ibSmall); drawCells(r, Wd.small.start, Wd.small.lo, Wd.small.hi, 1.5, false, 6, 0, 70); }
  if (cy < 0) { r.setPipeline(pSurf); r.draw(4); }
  r.setPipeline(pBack); r.draw(4);
  // translucent: jellies, bubbles, particles, sparkles, motes, plankton, the surface from above, the glass
  if (kindN[4]) { const cm = CM[4]; r.setPipeline(pJelly); r.setVertexBuffer(0, vbMesh); r.setVertexBuffer(1, instB, 0); r.drawIndexed(cm.ib.length, kindN[4], cm.i0, cm.v0, kindOff[4]); }
  r.setPipeline(pBub); r.setVertexBuffer(0, Wd.ibBubbles); r.draw(4, Wd.nBub);
  if (nPart) { r.setPipeline(pPart); r.setVertexBuffer(0, instB, PARTOFF); r.draw(4, nPart); }
  r.setPipeline(pGl); r.setVertexBuffer(0, Wd.ibGl); r.draw(4, Wd.nGl);
  r.setPipeline(pSnow); r.setVertexBuffer(0, Wd.ibSnowB); r.draw(4, Wd.nSnow);
  r.setPipeline(pPl); r.setVertexBuffer(0, Wd.ibPl); r.draw(4, Wd.nPl);
  if (cy >= 0) { r.setPipeline(pSurfTop); r.draw(4); }
  r.setPipeline(pGlass); r.draw(24);
  r.end();
  // light shafts
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  // composite
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done, noop); }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  if (!WD) return;
  // turbo: the server sends two frames a second and runs flat out; draw about four times a second
  if (snN && (snap[snHead].flags & 2)) { if (now - lastDraw < 250) return; dynT = -300; }
  lastDraw = now;
  // Dynamic resolution for 60 fps: every second scale the load by k
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > 1000)) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), mid = max(top / 2, PIXMIN), was = pix + det;
    // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep(QKEY, [LV, pix < top ? pix | 0 : '', det]); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt;
  const c0 = performance.now();
  updateLight(dt);
  updateCreatures(now, dt);
  updateCamera(dt);
  render();
  hudFrame();
  F[CPU] += (performance.now() - c0 - F[CPU]) * 0.1;
  statFrames++; sfN++; sfT += dtr;
  if (sfT >= 500) {
    statFps = sfN * 1000 / sfT; sfN = 0; sfT = 0;
    if (hud) info.textContent = `${statFps.toFixed(0)} fps  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)  ·  ${MODES[camMode]}  ·  creatures ${nCre}  ·  particles ${nPart}`;
  }
}

// ---------------------------------------------------------------- hooks for the HUD and tests (README.md)
const nowa = window.nowa = {
  get ws() { return ws; },
  send,
  onJson(fn) { jsonL.push(fn); return () => { const i = jsonL.indexOf(fn); if (i >= 0) jsonL.splice(i, 1); }; },
  onState(fn) { stateL.push(fn); return () => { const i = stateL.indexOf(fn); if (i >= 0) stateL.splice(i, 1); }; },
  get species() { return nowaSpecies(); },
  get tank() { return helloMsg ? helloMsg.tank : null; },
  get hello() { return helloMsg; },
  get state() { return snN ? snap[snHead] : null; },
  camera: { get mode() { return MODES[camMode]; }, setMode(m) { setMode(typeof m === 'string' ? MODES.indexOf(m) : m); }, pose: camPose, setPose: setCamPose },
  select(id) { select(id); },
  get selected() { return followId || null; },
  stats() {
    return { fps: statFps, gpuMs: F[GPU], cpuMs: F[CPU], det, creaturesDrawn: nCre, particlesDrawn: nPart, plankton: WD ? WD.nPl : 0, frames: statFrames,
      resolution: [W, H], quality: ['high', 'medium', 'low'][LV], world: !!WD, connected: wsOk };
  },
  // debug.light: a number 0..1 overrides the stream's light level; debug.settle(s): advance the camera and creature
  // smoothing by s seconds in 1/60 s steps and draw once (for screenshots from a throttled, hidden browser tab)
  debug: { light: null, audio: () => (AC ? AC.state : 'none') + (muted ? ', muted' : ''),
    counts() { return WD && { terrainVerts: WD.T.nv, terrainTris: WD.T.ni / 3, leaves: WD.big.n, smallLeaves: WD.small.n, props: WD.props.map((p) => p.n), chips: WD.chunks.map((c) => c.n), rocks: WD.nSolid, glints: WD.nGl, bubbles: WD.nBub, grid: [NX, NY, NZ, VS] }; },
    // CPU time of n frames (update + encode) and the wall time until the GPU has finished them
    async bench(n = 30) { const t0 = performance.now(); let cpu = 0; for (let i = 0; i < n; i++) { const c = performance.now(); updateCreatures(c, 1 / 60); updateCamera(1 / 60); render(); cpu += performance.now() - c; } await Q.onSubmittedWorkDone(); return { cpuMs: cpu / n, wallMs: (performance.now() - t0) / n, gpuMs: F[GPU], res: [W, H] }; },
    settle(s = 2) { if (!WD) return; const now = performance.now(); for (let t = 0; t < s; t += 1 / 60) { updateLight(1 / 60); updateCreatures(now, 1 / 60); updateCamera(1 / 60); } render(); } },
  get lang() { return LANG; },
  setLang,
  ready: false,
};
// ?cam=outside|inside|follow&x=&y=&z=&yaw=&pitch=&dist=&id=&species=&light=
function applyUrl() {
  const L = URLQ.get('light'); if (L !== null && L !== '' && isFinite(+L)) nowa.debug.light = +L;
  const cam = URLQ.get('cam'); if (!cam) return;
  const p = { mode: cam };
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'dist']) { const v = URLQ.get(k); if (v !== null && v !== '' && isFinite(+v)) p[k] = +v; }
  const id = URLQ.get('id'); if (id) p.id = +id;
  const sp = URLQ.get('species'); if (sp) p.species = sp;
  if (cam === 'follow') { const go = (n) => { if (!setCamPose(p) && n > 0) setTimeout(go, 300, n - 1); }; go(30); }
  else setCamPose(p);
}

initInput();
connect();
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
