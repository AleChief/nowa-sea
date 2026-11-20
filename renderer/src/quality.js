// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th leaf, glint and pebble and bake fewer shadows;
// Low also drops anti-aliasing and uses coarser meshes, cheaper filtering and fewer light shaft steps.
// localStorage['nowasea.q'] = "level,pixels,detail". 'nowasea.load' is set while the world is built: still set on the
// next visit means that load crashed the tab, so this one runs a level lower. ?q=low|med|high overrides the level.
const QKEY = 'nowasea.q', LKEY = 'nowasea.load';
const URLQ = new URLSearchParams(location.search);
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage[QKEY] || '').split(','); bad = localStorage[LKEY]; } catch {}
LV = SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
{ const q = { high: 0, med: 1, medium: 1, low: 2 }[URLQ.get('q')]; if (q !== undefined) { LV = q; SV = [q]; bad = 0; } }
if (bad && LV < 2) { SV = [++LV]; keep(QKEY, LV); }
const THIN = 1 << LV, SHADOW = LV ? 2048 : 4096, AA = LV > 1 ? 1 : 4, WATER = LV > 1 ? 256 : 512, RAYN = LV > 1 ? 12 : 28;
