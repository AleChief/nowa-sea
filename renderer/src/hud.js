// ============================================================================
// HUD: top bar (clock, speed, camera, tools), population, inspector with vision cone, saves and settings, events,
// event sounds. RU / EN throughout. DOM is touched only on server messages (stats 1 Hz, inspect 4 Hz, replies) and on
// clicks; the one per-frame part, hudFrame(), draws the vision cone on a 2D canvas without allocating.
// ============================================================================
const HT = {
  ru: {
    day: 'День', pause: 'Пауза', turbo: 'Турбо', ach: 'факт', cam: ['Снаружи', 'Внутри', 'Следить'],
    feed: 'Корм', spawn: 'Подселить', random: 'Случайно', saves: 'Сохранения', keys: 'Клавиши', snd: 'Звук',
    feedHint: 'Щёлкните в воду — бросить корм (Esc — выход)', spawnHint: 'Щёлкните, где появиться: {sp} (Esc — отмена)', miss: 'Щёлкните по воде в баке',
    pop: 'Население', share: 'доля от потолка', births: 'рождений', deaths: 'смертей', gen: 'пок.', extinct: 'вымер', back: 'вернётся через',
    brains: 'мозги', proc: 'проц.', lag: 'ожиданий', ms: 'мс', food: 'частиц', plank: 'планктон',
    gener: 'Поколение', age: 'Возраст', energy: 'Энергия', stamina: 'Выносливость', intent: 'Намерение', mode: 'Режим', sleeping: 'спит',
    cover: 'в укрытии', tokens: 'Восприятие', affect: 'Аффект', neuro: 'Нейромодуляторы', family: 'Семья', parents: 'родители', children: 'детей',
    genes: 'Гены тела', speed: 'скорость', vision: 'зрение', metab: 'обмен', decisions: 'решений', episodes: 'эпизодов', sleeps: 'снов',
    showVision: 'Показать обзор', days: 'сут', none: '—', brainNo: 'Простое поведение, без NOWA', brainSleep: 'Мозг спит', brainStub: 'Мозг без аффекта (заглушка)',
    savesT: 'Сохранения и настройки', name: 'Имя', save: 'Сохранить', saving: 'Сохраняю…', saved: 'Сохранено «{slot}» за {s} с, {size}',
    load: 'Загрузить', loading: 'Загружаю «{slot}»…', loaded: 'Загружено', del: 'Удалить', sure: 'Точно?', exp: 'Скачать', imp: 'Импорт .zip',
    impAs: 'под именем', imported: 'Импортировано: {slot}', impFail: 'Импорт не удался: {e}', empty: 'Сохранений пока нет', close: 'Закрыть',
    simDay: 'сутки', crt: 'сущ.', settings: 'Настройки', repop: 'Возрождать вымершие виды', delay: 'Задержка, сим. мин', fmode: 'Основатели',
    fresh: 'новые мозги', archive: 'из архива', autosave: 'Автосохранение', off: 'выкл', every: 'каждые {n} сим. мин', apply: 'Применить',
    applied: 'Применено', world: 'Мир', scale: 'масштаб', brain: 'мозги',
    evCatch: 'Поимка', evBirth: 'Рождение', evExtinct: 'Вымер вид', evRepop: 'Вернулся вид', spawned: 'Подселено: {sp} #{id}',
  },
  en: {
    day: 'Day', pause: 'Pause', turbo: 'Turbo', ach: 'actual', cam: ['Outside', 'Inside', 'Follow'],
    feed: 'Feed', spawn: 'Spawn', random: 'Random', saves: 'Saves', keys: 'Keys', snd: 'Sound',
    feedHint: 'Click into the water to drop food (Esc to stop)', spawnHint: 'Click where it should appear: {sp} (Esc to cancel)', miss: 'Click on the water in the tank',
    pop: 'Population', share: 'share of cap', births: 'births', deaths: 'deaths', gen: 'gen', extinct: 'extinct', back: 'back in',
    brains: 'brains', proc: 'proc.', lag: 'lag waits', ms: 'ms', food: 'particles', plank: 'plankton',
    gener: 'Generation', age: 'Age', energy: 'Energy', stamina: 'Stamina', intent: 'Intent', mode: 'Mode', sleeping: 'asleep',
    cover: 'in cover', tokens: 'Senses', affect: 'Affect', neuro: 'Neuromodulators', family: 'Family', parents: 'parents', children: 'children',
    genes: 'Body genes', speed: 'speed', vision: 'vision', metab: 'metabolism', decisions: 'decisions', episodes: 'episodes', sleeps: 'sleeps',
    showVision: 'Show vision', days: 'd', none: '—', brainNo: 'Simple behaviour, no NOWA', brainSleep: 'Brain asleep', brainStub: 'No affect (stub brain)',
    savesT: 'Saves and settings', name: 'Name', save: 'Save', saving: 'Saving…', saved: 'Saved “{slot}” in {s} s, {size}',
    load: 'Load', loading: 'Loading “{slot}”…', loaded: 'Loaded', del: 'Delete', sure: 'Sure?', exp: 'Download', imp: 'Import .zip',
    impAs: 'as', imported: 'Imported: {slot}', impFail: 'Import failed: {e}', empty: 'No saves yet', close: 'Close',
    simDay: 'day', crt: 'crt.', settings: 'Settings', repop: 'Repopulate extinct species', delay: 'Delay, sim min', fmode: 'Founders',
    fresh: 'fresh brains', archive: 'from the archive', autosave: 'Autosave', off: 'off', every: 'every {n} sim min', apply: 'Apply',
    applied: 'Applied', world: 'World', scale: 'scale', brain: 'brains',
    evCatch: 'Catch', evBirth: 'Birth', evExtinct: 'Extinct', evRepop: 'Back', spawned: 'Spawned: {sp} #{id}',
  },
};
const INTENT_RU = { ambush: 'засада', burrow: 'зарывается', chase: 'погоня', drift: 'дрейф', explore: 'исследует', flee: 'бегство', forage: 'кормится',
  hide: 'прячется', mate: 'ищет пару', patrol: 'патруль', rest: 'отдых', scavenge: 'подбирает останки', school: 'в стае', sleep: 'сон', stalk: 'подкрадывается', strike: 'бросок' };
const TOKEN_RU = { threat: 'угроза', prey: 'добыча', food: 'корм', cover: 'укрытие', school: 'стая', energy: 'энергия', stamina: 'выносл.', light: 'свет',
  edge: 'граница', mate: 'партнёр', none: 'нет', far: 'далеко', near: 'близко', in: 'внутри', alone: 'один', few: 'мало', many: 'много', low: 'мало',
  mid: 'средне', high: 'много', day: 'день', dusk: 'сумерки', night: 'ночь', open: 'открыто' };
const AXIS_RU = { valence: 'валентность', arousal: 'возбуждение', dominance: 'доминантность', stress: 'стресс', curiosity: 'любопытство',
  attachment: 'привязанность', trust: 'доверие', stability: 'стабильность', fear: 'страх', anger: 'гнев', joy: 'радость', fatigue: 'усталость', confidence: 'уверенность', boredom: 'скука' };
const NM_RU = { dopamine: 'дофамин', serotonin: 'серотонин', norepinephrine: 'норадреналин', acetylcholine: 'ацетилхолин', cortisol: 'кортизол' };
const MODE_RU = { habitual: 'привычка', deliberative: 'обдумывание', deliberate: 'обдумывание', exploratory: 'исследование', reflex: 'рефлекс', stub: 'заглушка' };
const SPEEDS = [0, 1, 2, 5, 10, 'turbo'];
const HS = { el: {}, stats: null, ins: null, vision: false, tool: '', toolSp: '', saves: [], turbo: false, spdSet: 1, logN: 0, sndT: 0, bst: new Map() };
const TL = () => HT[LANG];
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const spOf = (id) => (nowaSpecies() || []).find((s) => s.id === id || s.index === id);
const spName = (id) => { const s = spOf(id); return s ? (s.name && s.name[LANG]) || s.id : String(id); };
const intentName = (n) => (LANG === 'ru' ? INTENT_RU[n] || n : n);
const tokName = (t) => LANG === 'ru' ? String(t).split(':').map((p) => TOKEN_RU[p] || p).join(': ') : String(t).replace(':', ': ');
const rgb = (c, a = 1) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
const fsz = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + (LANG === 'ru' ? ' МБ' : ' MB') : Math.round(n / 1024) + (LANG === 'ru' ? ' КБ' : ' kB');
const capOf = (s) => max(2, round((s.cap || 0) * ((HS.stats && HS.stats.settings && HS.stats.settings.scale) || (helloMsg && helloMsg.settings && helloMsg.settings.scale) || 1)));

function initHud(nowa) {
  const root = document.getElementById('hud');
  root.innerHTML = '<canvas id=hov></canvas><div id=hbar class=hpan></div><div id=hpop class=hpan></div><div id=hins class=hpan></div>' +
    '<div id=hlog></div><div id=htoast></div><div id=hhint></div><div id=hturbo></div><div id=hmod><div class="box hpan"></div></div>';
  for (const id of ['hov', 'hbar', 'hpop', 'hins', 'hlog', 'htoast', 'hhint', 'hturbo', 'hmod']) HS.el[id] = document.getElementById(id);
  HS.ov = HS.el.hov.getContext('2d');
  try { if (localStorage['nowasea.popmin'] === '1') HS.el.hpop.classList.add('min'); if (localStorage['nowasea.keys'] === '0') $('k').style.display = 'none'; } catch {}
  const fit = () => { const d = devicePixelRatio || 1; HS.el.hov.width = max(1, round(innerWidth * d)); HS.el.hov.height = max(1, round(innerHeight * d)); HS.ovW = innerWidth; HS.ovH = innerHeight; HS.ov.setTransform(d, 0, 0, d, 0, 0); };
  addEventListener('resize', fit); fit();
  nowa.onJson(onMsg);
  nowa.onState(onFrame);
  addEventListener('keydown', (e) => { if (e.code === 'Escape') { if (HS.tool) setTool(''); else if (HS.el.hmod.classList.contains('show')) HS.el.hmod.classList.remove('show'); } });
  hudLang();
}
// (re)builds every static text for the current language
function hudLang() {
  if (!HS.el.hbar) return;
  const t = TL();
  const spOpts = (nowaSpecies() || []).map((s) => `<option value="${esc(s.id)}"${s.id === HS.toolSp ? ' selected' : ''}>${esc(spName(s.id))}</option>`).join('');
  HS.el.hbar.innerHTML = `<span id=hclk><i>☀</i><span></span></span>` +
    `<span class=g id=hspd>${SPEEDS.map((v) => `<button data-v="${v}">${v === 0 ? '⏸ ' + t.pause : v === 'turbo' ? '⏩ ' + t.turbo : v + '×'}</button>`).join('')}<span id=hach></span></span>` +
    `<span class=g id=hcam>${t.cam.map((n, i) => `<button data-m="${i}">${n}</button>`).join('')}</span>` +
    `<span class=g><button id=hfeed>🍤 ${t.feed}</button><select id=hsp>${spOpts}</select><button id=hspawn>✚ ${t.spawn}</button><button id=hrnd title="${t.random}">🎲</button></span>` +
    `<span class=g><button id=hsav>💾 ${t.saves}</button><button id=hsnd title="${t.snd} (M)">🔊</button><button id=hkeys title="${t.keys}">?</button><button id=hlang>${LANG === 'ru' ? 'EN' : 'RU'}</button></span>`;
  const q = (s) => HS.el.hbar.querySelector(s);
  HS.el.clk = q('#hclk span'); HS.el.ico = q('#hclk i'); HS.el.ach = q('#hach');
  HS.el.hbar.querySelectorAll('#hspd button').forEach((b) => { b.onclick = () => { const v = b.dataset.v, val = v === 'turbo' ? 'turbo' : +v; send({ t: 'speed', value: val }); HS.spdSet = val; markSpeed(); }; });
  HS.el.hbar.querySelectorAll('#hcam button').forEach((b) => { b.onclick = () => setMode(+b.dataset.m); });
  q('#hfeed').onclick = () => setTool(HS.tool === 'feed' ? '' : 'feed');
  q('#hsp').onchange = (e) => { HS.toolSp = e.target.value; if (HS.tool === 'spawn') setTool('spawn'); };
  if (!HS.toolSp && nowaSpecies().length) HS.toolSp = nowaSpecies()[0].id;
  q('#hspawn').onclick = () => setTool(HS.tool === 'spawn' ? '' : 'spawn');
  q('#hrnd').onclick = () => { send({ t: 'spawn', species: q('#hsp').value || HS.toolSp }); };
  q('#hsav').onclick = openSaves;
  q('#hsnd').onclick = () => { sound(); mute(); markSound(); };
  q('#hkeys').onclick = () => { const k = $('k'), hide = k.style.display !== 'none'; k.style.display = hide ? 'none' : ''; keep('nowasea.keys', hide ? '0' : '1'); };
  q('#hlang').onclick = () => setLang(LANG === 'ru' ? 'en' : 'ru');
  markSpeed(); markSound(); hudMode(); setTool(HS.tool);
  buildPop(); if (HS.stats) onStats(HS.stats);
  buildIns(); if (HS.ins) onInspect(HS.ins);
  if (HS.el.hmod.classList.contains('show')) openSaves();
}
function markSpeed() {
  HS.el.hbar.querySelectorAll('#hspd button').forEach((b) => b.classList.toggle('on', String(HS.spdSet) === b.dataset.v));
}
function markSound() { const b = HS.el.hbar && HS.el.hbar.querySelector('#hsnd'); if (b) b.textContent = !AC || muted ? '🔇' : '🔊'; }
// camera mode changed (called by legend())
function hudMode() {
  if (!HS.el.hbar) return;
  hudSel();
  HS.el.hbar.querySelectorAll('#hcam button').forEach((b) => b.classList.toggle('on', +b.dataset.m === camMode));
}
function toast(text, err) {
  const d = document.createElement('div'); d.textContent = text; if (err) d.className = 'err';
  HS.el.htoast.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; }, 4000); setTimeout(() => d.remove(), 4700);
}

// ---------------------------------------------------------------- server messages
function onMsg(m) {
  switch (m && m.t) {
    case 'hello': HS.ins = null; buildIns(); hudLang(); if (HS.loading) { HS.loading = false; status(TL().loaded); } break;
    case 'stats': onStats(m); break;
    case 'inspect': if (m.id === followId) onInspect(m); break;
    case 'event': onEvent(m); break;
    case 'toast': toast((m.text && (m.text[LANG] || m.text.en)) || '', m.level === 'error'); if (m.level === 'error') status(m.text[LANG] || m.text.en, 1); break;
    case 'spawned': toast(fmt(TL().spawned, { sp: spName(m.species), id: m.id })); break;
    case 'saves': HS.saves = m.items || []; renderSaves(); break;
    case 'saved': status(fmt(TL().saved, { slot: m.slot, s: m.seconds, size: fsz(m.size || 0) })); break;
    case 'settings': HS.setStatus = TL().applied; renderSettings(m); break;
  }
}
function onFrame(s) {
  const tb = (s.flags & 2) !== 0;
  if (tb !== HS.turbo) { HS.turbo = tb; HS.el.hturbo.style.display = tb ? 'block' : 'none'; if (tb && !HS.el.hturbo.textContent) HS.el.hturbo.textContent = TL().turbo.toUpperCase(); }
  // a burst flag that turns on near the camera: a swish (throttled; only when the sound is on)
  if (!AC || muted || AC.state !== 'running') return;
  const now = performance.now();
  if (HS.bst.size > 4096) HS.bst.clear();
  for (let i = 0; i < s.n; i++) {
    const id = s.id[i], f = s.cflags[i], was = HS.bst.get(id) || 0;
    if ((f & 2) && !(was & 2) && now - HS.sndT > 450) {
      const dx = s.pos[i * 3] - F[DX], dy = s.pos[i * 3 + 1] - F[DY], dz = s.pos[i * 3 + 2] - F[DZ], d = sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 16) { HS.sndT = now; sfx('burst', 1 - d / 18); }
    }
    if (f !== was) HS.bst.set(id, f);
  }
}
function onStats(m) {
  HS.stats = m;
  if (followId && camMode !== 2 && snN && trackOf(followId) < 0) select(0); // the selected creature is gone
  markSound();
  const t = TL(), day = m.day || 0, ph = day - floor(day), mins = floor(ph * 1440);
  HS.el.clk.textContent = `${t.day} ${floor(day) + 1} · ${String(floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  HS.el.ico.textContent = ph > 0.25 && ph < 0.75 ? '☀' : '☾';
  const sp = m.speed || {}, set = sp.set, ach = +sp.achieved || 0;
  if (set !== undefined && set !== HS.spdSet) { HS.spdSet = set; markSpeed(); }
  HS.el.ach.textContent = `${t.ach} ×${ach.toFixed(1)}`;
  HS.el.ach.classList.toggle('warn', set === 'turbo' ? false : set > 0 && ach < 0.8 * set);
  if (HS.turbo || set === 'turbo') HS.el.hturbo.innerHTML = `${esc(t.turbo.toUpperCase())}<small>×${ach.toFixed(0)}</small>`;
  // population rows
  const pop = m.pop || {}, gm = m.generation_max || {}, ex = m.extinct || {};
  for (const s of nowaSpecies() || []) {
    const r = HS.el.rows && HS.el.rows[s.id]; if (!r) continue;
    r.cnt.textContent = `${pop[s.id] ?? 0} / ${capOf(s)}`;
    r.gen.textContent = `${t.gen} ${gm[s.id] ?? 0}`;
    const e = ex[s.id];
    r.ext.style.display = e ? '' : 'none';
    if (e) { const st = m.settings && m.settings.repopulate; r.ext.textContent = st && st.enabled ? `${t.extinct}, ${t.back} ${clock(e.respawn_in)}` : t.extinct; }
  }
  const deaths = typeof m.deaths === 'object' && m.deaths ? Object.values(m.deaths).reduce((a, b) => a + (+b || 0), 0) : +m.deaths || 0;
  const b = m.brains || {};
  HS.el.foot.textContent = `${t.births} ${m.births || 0} · ${t.deaths} ${deaths}\n${t.brains}: ${b.workers ?? '–'} ${t.proc} · ${b.brains ?? 0} · p95 ${(+(b.p95_ms || 0)).toFixed(1)} ${t.ms} · ${t.lag} ${b.lag_waits ?? 0}` +
    (m.particles !== undefined ? `\n${t.food} ${m.particles} · ${t.plank} ${m.plankton}` : '');
  drawChart(m.history || []);
  if (m.settings) renderSettings(m.settings, true);
}
const clock = (s) => { s = max(0, round(s || 0)); return `${floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- population panel
function buildPop() {
  const t = TL(), p = HS.el.hpop;
  p.innerHTML = `<h3>${t.pop}<span>${p.classList.contains('min') ? '▸' : '▾'}</span></h3><div class=body><div class=rows></div><canvas width=480 height=140 title="${t.share}"></canvas><div class=foot style="white-space:pre-line"></div></div>`;
  p.querySelector('h3').onclick = () => { const mn = p.classList.toggle('min'); keep('nowasea.popmin', mn ? '1' : '0'); p.querySelector('h3 span').textContent = mn ? '▸' : '▾'; };
  const rows = p.querySelector('.rows'); HS.el.rows = {};
  for (const s of nowaSpecies() || []) {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = `<i class=chip style="background:${rgb(s.color)};box-shadow:0 0 0 2px ${rgb(s.glow, 0.8)}"></i><span>${esc(spName(s.id))}</span><span class=cnt></span><span class=gen></span><span class=ext style="display:none"></span>`;
    rows.appendChild(d);
    HS.el.rows[s.id] = { cnt: d.querySelector('.cnt'), gen: d.querySelector('.gen'), ext: d.querySelector('.ext') };
  }
  HS.el.chart = p.querySelector('canvas'); HS.el.foot = p.querySelector('.foot');
}
// lines of count / cap per species over the history the server keeps
function drawChart(hist) {
  const c = HS.el.chart; if (!c || HS.el.hpop.classList.contains('min')) return;
  const g = c.getContext('2d'), w = c.width, h = c.height, sp = nowaSpecies() || [];
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#ffffff22'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 8.5); g.lineTo(w, 8.5); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();
  if (hist.length < 2) return;
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0], span = max(t1 - t0, 1e-6);
  g.lineWidth = 2.5;
  sp.forEach((s, k) => {
    const cap = capOf(s);
    g.strokeStyle = rgb(s.glow, 0.95); g.beginPath();
    hist.forEach((e, i) => { const x = (e[0] - t0) / span * (w - 2) + 1, y = h - 2 - min(1.05, (e[1][k] || 0) / cap) * (h - 12); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  });
}

// ---------------------------------------------------------------- inspector
function buildIns() {
  const t = TL(), p = HS.el.hins;
  p.innerHTML = `<h3><span class=nm></span><button class=x title="${t.close}">✕</button></h3><div class=sub></div>` +
    `<div class=kv><span>${t.energy}</span><div class=bar><i class=en></i></div><span>${t.stamina}</span><div class=bar><i class=st></i></div>` +
    `<span>${t.intent}</span><b class=it></b><span>${t.mode}</span><span class=md></span></div><div class=tags></div>` +
    `<div class=sec>${t.tokens}</div><div class=toks></div>` +
    `<div class=brain><div class=sec>${t.affect}</div><div class="kv af"></div><div class=sec>${t.neuro}</div><div class="kv nm2"></div></div><div class=bno></div>` +
    `<div class=sec>${t.family}</div><div class=fam></div><div class=sec>${t.genes}</div><div class=gn></div><div class=dc style="margin-top:.35em;color:#9fcbd5"></div>` +
    `<label style="display:block;margin-top:.5em;cursor:pointer"><input type=checkbox class=vis${HS.vision ? ' checked' : ''}> ${t.showVision}</label>`;
  const q = (s) => p.querySelector(s);
  HS.el.ins = { nm: q('.nm'), sub: q('.sub'), en: q('.en'), st: q('.st'), it: q('.it'), md: q('.md'), tags: q('.tags'), toks: q('.toks'), brain: q('.brain'),
    af: q('.af'), nm2: q('.nm2'), bno: q('.bno'), fam: q('.fam'), gn: q('.gn'), dc: q('.dc') };
  q('.x').onclick = () => select(0);
  q('.vis').onchange = (e) => { HS.vision = e.target.checked; };
  p.classList.toggle('show', !!(HS.ins && followId));
}
const bars = (o, names, centred) => Object.keys(o).map((k) => {
  const v = clamp(+o[k] || 0, -1, 1), lab = (names && LANG === 'ru' && names[k]) || k;
  const st = centred && v < 0 ? `left:${50 + v * 50}%;width:${-v * 50}%` : centred ? `left:50%;width:${v * 50}%` : `width:${max(0, v) * 100}%`;
  return `<span title="${esc(k)} ${(+o[k]).toFixed(2)}">${esc(lab)}</span><div class="bar${centred ? ' c' : ''}"><i style="${st}"></i></div>`;
}).join('');
function onInspect(m) {
  HS.ins = m;
  const t = TL(), e = HS.el.ins, p = HS.el.hins;
  p.classList.add('show');
  e.nm.textContent = `${spName(m.species)} #${m.id}`;
  e.sub.textContent = `${t.gener} ${m.generation} · ${t.age} ${(+m.age_days).toFixed(2)} / ${(+m.lifespan_days).toFixed(1)} ${t.days}`;
  e.en.style.width = `${clamp(+m.energy, 0, 1) * 100}%`; e.st.style.width = `${clamp(+m.stamina, 0, 1) * 100}%`;
  e.it.textContent = intentName(m.intent);
  const mode = (m.brain && m.brain.mode) || m.mode || '';
  e.md.textContent = mode ? (LANG === 'ru' && MODE_RU[mode]) || mode : t.none;
  e.tags.innerHTML = (m.sleeping ? `<span class=w>${t.sleeping}</span>` : '') + (m.in_cover ? `<span>${t.cover}</span>` : '');
  e.toks.innerHTML = (m.tokens || []).map((k) => `<span>${esc(tokName(k))}</span>`).join('') || t.none;
  const br = m.brain;
  const hasB = br && !br.sleeping && (Object.keys(br.affect || {}).length || Object.keys(br.neuromodulators || {}).length);
  e.brain.style.display = hasB ? '' : 'none';
  e.bno.style.display = hasB ? 'none' : '';
  e.bno.textContent = br && br.sleeping ? t.brainSleep : spOf(m.species) && spOf(m.species).brain === 'nowa' ? (br ? t.brainStub : '') : t.brainNo;
  if (hasB) { e.af.innerHTML = bars(br.affect || {}, AXIS_RU, true); e.nm2.innerHTML = bars(br.neuromodulators || {}, NM_RU, false); }
  const par = (m.parents || []).filter((x) => x);
  e.fam.textContent = `${t.parents}: ${par.length ? par.map((x) => '#' + x).join(', ') : t.none} · ${t.children}: ${m.children ?? 0}`;
  const g = m.body || {};
  e.gn.textContent = `${t.speed} ${(+g.speed || 0).toFixed(2)} · ${t.vision} ${(+g.vision || 0).toFixed(2)} · ${t.metab} ${(+g.metabolism || 0).toFixed(2)}`;
  e.dc.textContent = `${t.decisions} ${(br && br.decisions) ?? m.decisions ?? 0}` + (br && br.episodes !== undefined ? ` · ${t.episodes} ${br.episodes} · ${t.sleeps} ${br.sleeps}` : '');
}
// hide the inspector as soon as nothing is followed (checked on every inspect / stats and when selection changes)
function hudSel() { if (!followId && HS.el.hins) { HS.el.hins.classList.remove('show'); HS.ins = null; } }
// Esc belongs to the HUD while a tool or the dialog is open
const hudBusy = () => !!(HS.tool || (HS.el.hmod && HS.el.hmod.classList.contains('show')));

// ---------------------------------------------------------------- events: log + sounds
function onEvent(m) {
  const t = TL(); let txt = '', col = '#7ff3ff';
  if (m.kind === 'catch') { txt = `<b>${t.evCatch}</b>: ${esc(spName(m.species))} → ${esc(spName(m.prey))}`; col = '#ff8a7a'; sfx('catch', 0.8); }
  else if (m.kind === 'birth') { txt = `<b>${t.evBirth}</b>: ${esc(spName(m.species))}${m.generation !== undefined ? ` (${t.gen} ${m.generation})` : ''}`; col = '#9fe9a8'; sfx('birth', 0.7); }
  else if (m.kind === 'extinct') { txt = `<b>${t.evExtinct}</b>: ${esc(spName(m.species))}`; col = '#ffb36b'; }
  else if (m.kind === 'repopulate') { txt = `<b>${t.evRepop}</b>: ${esc(spName(m.species))} ×${m.n ?? ''} (${m.mode === 'archive' ? t.archive : t.fresh})`; col = '#c9a7ff'; }
  else return;
  const d = document.createElement('div'); d.innerHTML = txt; d.style.borderLeft = `3px solid ${col}`;
  const log = HS.el.hlog; log.appendChild(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0'; }, 9000); setTimeout(() => d.remove(), 10000);
}
// short synthesized sounds through the ambience's master gain (so M mutes them too)
let noiseB = null;
function sfx(kind, vol) {
  if (!AC || muted || AC.state !== 'running') return;
  const now = performance.now(); if (kind !== 'burst') { if (now - (HS['t' + kind] || 0) < 350) return; HS['t' + kind] = now; }
  const t = AC.currentTime + 0.01, g = new GainNode(AC, { gain: 0 }); g.connect(OUT);
  if (kind === 'burst') {
    if (!noiseB) { noiseB = new AudioBuffer({ length: AC.sampleRate * 0.3 | 0, numberOfChannels: 1, sampleRate: AC.sampleRate }); const d = noiseB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
    const src = new AudioBufferSourceNode(AC, { buffer: noiseB }), f = new BiquadFilterNode(AC, { type: 'bandpass', frequency: 700, Q: 1.2 });
    src.connect(f); f.connect(g); f.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
    g.gain.linearRampToValueAtTime(0.22 * vol, t + 0.03); g.gain.setTargetAtTime(0, t + 0.06, 0.05); src.start(t); src.stop(t + 0.3);
  } else if (kind === 'catch') {
    const o = new OscillatorNode(AC, { frequency: 150 }); o.connect(g);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.22); g.gain.linearRampToValueAtTime(0.45 * vol, t + 0.01); g.gain.setTargetAtTime(0, t + 0.03, 0.08);
    o.start(t); o.stop(t + 0.5);
  } else {
    for (const f of [988, 1480]) { const o = new OscillatorNode(AC, { frequency: f }); o.connect(g); o.start(t); o.stop(t + 1.6); }
    g.gain.linearRampToValueAtTime(0.05 * vol, t + 0.02); g.gain.setTargetAtTime(0, t + 0.05, 0.35);
  }
}

// ---------------------------------------------------------------- tools: feed and spawn at a clicked point
function setTool(k) {
  HS.tool = k; body.classList.toggle('tool', !!k);
  const t = TL(), hint = HS.el.hhint;
  if (!hint) return;
  hint.style.display = k ? 'block' : 'none';
  hint.textContent = k === 'feed' ? t.feedHint : k === 'spawn' ? fmt(t.spawnHint, { sp: spName(HS.toolSp) }) : '';
  const f = HS.el.hbar.querySelector('#hfeed'), s = HS.el.hbar.querySelector('#hspawn');
  if (f) f.classList.toggle('arm', k === 'feed'); if (s) s.classList.toggle('arm', k === 'spawn');
}
// a point in the water for a click at (sx, sy): from the room, where the ray crosses y = -1 inside the tank (else
// 2 m past where it enters the water); from inside, 3 m along the ray. null if the ray misses the tank.
function waterPoint(sx, sy, w, h) {
  const nx = (sx / w) * 2 - 1, ny = 1 - (sy / h) * 2, ax = TANH * w / h;
  let dx = F[FX] + F[RX] * nx * ax + F[UX] * ny * TANH, dy = F[FY] + F[UY] * ny * TANH, dz = F[FZ] + F[RZ] * nx * ax + F[UZ] * ny * TANH;
  const l = hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const cx = F[DX], cy = F[DY], cz = F[DZ], m = 0.6;
  const inside = abs(cx) < tHx && abs(cz) < tHz && cy < 0 && cy > -tDep;
  let p;
  if (inside) p = [cx + dx * 3, cy + dy * 3, cz + dz * 3];
  else {
    if (dy < -1e-4 && cy > -1) { const tt = (-1 - cy) / dy, x = cx + dx * tt, z = cz + dz * tt; if (abs(x) < tHx - m && abs(z) < tHz - m) p = [x, -1, z]; }
    if (!p) {
      let t0 = 0, t1 = 1e9; const lo = [-tHx, -tDep, -tHz], hi = [tHx, 0, tHz], o = [cx, cy, cz], d = [dx, dy, dz];
      for (let i = 0; i < 3; i++) { if (abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; } let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i]; if (a > b) { const q = a; a = b; b = q; } t0 = max(t0, a); t1 = min(t1, b); }
      if (t1 <= t0) return null;
      const tt = min(t0 + 2, (t0 + t1) / 2); p = [cx + dx * tt, cy + dy * tt, cz + dz * tt];
    }
  }
  p[0] = clamp(p[0], -tHx + m, tHx - m); p[1] = clamp(p[1], -tDep + m, -0.5); p[2] = clamp(p[2], -tHz + m, tHz - m);
  return p.map((v) => round(v * 100) / 100);
}
// canvas click hook (camera.js): true when a tool used it
function hudClick(sx, sy, w, h) {
  if (!HS.tool) return false;
  const p = waterPoint(sx, sy, w, h);
  if (!p) { toast(TL().miss); return true; }
  if (HS.tool === 'feed') send({ t: 'feed', pos: p });
  else { send({ t: 'spawn', species: HS.toolSp, pos: p }); setTool(''); }
  return true;
}

// ---------------------------------------------------------------- saves and settings dialog
function openSaves() {
  const t = TL(), box = HS.el.hmod.querySelector('.box');
  const d = new Date(), pad = (x) => String(x).padStart(2, '0'), def = `save-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  box.innerHTML = `<h2>${t.savesT}<button class=x>✕</button></h2><div class=cols><div>` +
    `<h4>${t.saves}</h4><div class=line><input type=text class=sn value="${def}" style="flex:1"><button class=sv>💾 ${t.save}</button></div>` +
    `<div class=line><label class=fbtn>📂 ${t.imp}<input type=file class=fi accept=".zip" hidden></label> ${t.impAs} <input type=text class=in placeholder="imported" style="width:9em"></div>` +
    `<div class=st></div><table class=ls></table></div><div>` +
    `<h4>${t.settings}</h4><div class=line><label><input type=checkbox class=re> ${t.repop}</label></div>` +
    `<div class=line>${t.delay} <input type=number class=dl min=0 step=0.5 style="width:5em"></div>` +
    `<div class=line>${t.fmode} <select class=fm><option value=fresh>${t.fresh}</option><option value=archive>${t.archive}</option></select></div>` +
    `<div class=line>${t.autosave} <select class=as>${[0, 5, 15, 60].map((n) => `<option value=${n * 60}>${n ? fmt(t.every, { n }) : t.off}</option>`).join('')}</select></div>` +
    `<div class=line><button class=ap>${t.apply}</button><span class="st2" style="color:#9fe9a8"></span></div><div class=wi style="color:#9fcbd5;margin-top:.6em"></div></div></div>`;
  const q = (s) => box.querySelector(s);
  HS.el.mod = { st: q('.st'), ls: q('.ls'), re: q('.re'), dl: q('.dl'), fm: q('.fm'), as: q('.as'), st2: q('.st2'), wi: q('.wi') };
  q('.x').onclick = () => HS.el.hmod.classList.remove('show');
  HS.el.hmod.onclick = (e) => { if (e.target === HS.el.hmod) HS.el.hmod.classList.remove('show'); };
  q('.sv').onclick = () => { status(t.saving); send({ t: 'save', slot: q('.sn').value.trim() || def }); };
  q('.fi').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const slot = q('.in').value.trim() || f.name.replace(/\.zip$/i, '') + '-import';
    try {
      const r = await fetch(`/api/saves/import?slot=${encodeURIComponent(slot)}`, { method: 'POST', body: f });
      const j = r.ok ? await r.json() : null; if (!r.ok) throw new Error(`HTTP ${r.status}`);
      status(fmt(t.imported, { slot: j.slot || slot })); send({ t: 'list_saves' });
    } catch (er) { status(fmt(t.impFail, { e: er.message }), 1); }
    e.target.value = '';
  };
  q('.ap').onclick = () => {
    const m = HS.el.mod;
    send({ t: 'settings', repopulate: { enabled: m.re.checked, delay_s: max(0, +m.dl.value || 0) * 60, mode: m.fm.value }, autosave_s: +m.as.value });
  };
  HS.el.hmod.classList.add('show');
  renderSaves(); if (HS.stats && HS.stats.settings) renderSettings(HS.stats.settings);
  send({ t: 'list_saves' });
}
function status(text, err) { const s = HS.el.mod && HS.el.mod.st; if (s) { s.textContent = text; s.classList.toggle('err', !!err); } }
function renderSaves() {
  const m = HS.el.mod; if (!m || !HS.el.hmod.classList.contains('show')) return;
  const t = TL();
  if (!HS.saves.length) { m.ls.innerHTML = `<tr><td class=m>${t.empty}</td></tr>`; return; }
  m.ls.innerHTML = HS.saves.map((s, i) => `<tr><td class=n>${esc(s.slot)}<div class=m>${esc((s.saved_at || '').replace('T', ' '))} · ${t.simDay} ${((s.sim_time || 0) / ((helloMsg && helloMsg.day_s) || 1200) + 1).toFixed(1)} · ${s.creatures ?? 0} ${t.crt} · ${fsz(s.size || 0)}</div></td>` +
    `<td class=b><button data-l="${i}">${t.load}</button> <a href="/api/saves/${encodeURIComponent(s.slot)}.zip" download="${esc(s.slot)}.zip">${t.exp}</a> <button data-d="${i}">${t.del}</button></td></tr>`).join('');
  m.ls.querySelectorAll('button[data-l]').forEach((b) => { b.onclick = () => { const s = HS.saves[+b.dataset.l]; HS.loading = true; status(fmt(t.loading, { slot: s.slot })); send({ t: 'load', slot: s.slot }); }; });
  m.ls.querySelectorAll('button[data-d]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.arm) { send({ t: 'delete_save', slot: HS.saves[+b.dataset.d].slot }); return; }
      b.dataset.arm = 1; b.textContent = t.sure; b.classList.add('arm');
      setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = t.del; b.classList.remove('arm'); } }, 3000);
    };
  });
}
// settings form; from stats only while the user is not editing it
function renderSettings(s, fromStats) {
  const m = HS.el.mod; if (!m || !HS.el.hmod.classList.contains('show') || !s) return;
  const t = TL(), rp = s.repopulate || {}, act = document.activeElement;
  const editing = fromStats && act && act.closest && act.closest('#hmod') && /INPUT|SELECT/.test(act.tagName) && act.type !== 'file' && act.type !== 'text';
  if (!editing) {
    m.re.checked = !!rp.enabled; m.dl.value = rp.delay_s !== undefined ? +(rp.delay_s / 60).toFixed(2) : '';
    if (rp.mode) m.fm.value = rp.mode;
    const as = +s.autosave_s || 0; if (![...m.as.options].some((o) => +o.value === as)) m.as.add(new Option(`${(as / 60).toFixed(1)}`, as)); m.as.value = String(as);
  }
  m.wi.textContent = `${t.world}: ${t.scale} ${s.scale ?? '–'} · ${t.brain} ${s.brain ?? '–'} ×${s.workers ?? '–'}`;
  if (!fromStats && HS.setStatus) { m.st2.textContent = HS.setStatus; HS.setStatus = ''; setTimeout(() => { if (m.st2) m.st2.textContent = ''; }, 2500); }
}

// ---------------------------------------------------------------- per frame: the selected creature's view (no allocation)
const VPT = new Float64Array(3 * 72);
let ovDirty = false;
// screen point of world (x, y, z) into VPT[k]: x, y, visible
function vproj(x, y, z, k) {
  const M = UB, w = M[3] * x + M[7] * y + M[11] * z + M[15];
  VPT[k * 3 + 2] = w > 0.05 ? 1 : 0; if (w <= 0.05) return;
  VPT[k * 3] = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / w * 0.5 + 0.5) * HS.ovW; VPT[k * 3 + 1] = (0.5 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / w * 0.5) * HS.ovH;
}
function hudFrame() {
  const g = HS.ov; if (!g) return;
  if (ovDirty) { g.clearRect(0, 0, HS.ovW, HS.ovH); ovDirty = false; }
  if (!HS.vision || !followId || !HS.ins || HS.ins.id !== followId) return;
  const t = trackOf(followId); if (t < 0) return;
  const o = t * 3, px = tkP[o], py = tkP[o + 1], pz = tkP[o + 2], fx = tkF[o], fy = tkF[o + 1], fz = tkF[o + 2], ux = tkU[o], uy = tkU[o + 1], uz = tkU[o + 2];
  const sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux, R = +HS.ins.vision || 0, half = min(+HS.ins.fov_deg || 0, 360) * PI / 360;
  if (R <= 0 || half <= 0) return;
  ovDirty = true;
  // horizontal fan (forward / side plane) and a vertical arc (forward / up plane, at most +-80 degrees)
  const N = 48;
  vproj(px, py, pz, 0);
  for (let i = 0; i <= N; i++) { const a = -half + 2 * half * i / N, c = cos(a) * R, s = sin(a) * R; vproj(px + fx * c + sx * s, py + fy * c + sy * s, pz + fz * c + sz * s, 1 + i); }
  const hv = min(half, 1.4), NV = 20;
  for (let i = 0; i <= NV; i++) { const a = -hv + 2 * hv * i / NV, c = cos(a) * R, s = sin(a) * R; vproj(px + fx * c + ux * s, py + fy * c + uy * s, pz + fz * c + uz * s, N + 2 + i); }
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(127,243,255,0.65)'; g.fillStyle = 'rgba(127,243,255,0.1)';
  if (VPT[2]) {
    g.beginPath(); g.moveTo(VPT[0], VPT[1]); let open = true;
    for (let i = 1; i <= N + 1; i++) { if (VPT[i * 3 + 2]) { if (open) g.lineTo(VPT[i * 3], VPT[i * 3 + 1]); else { g.moveTo(VPT[i * 3], VPT[i * 3 + 1]); open = true; } } else open = false; }
    if (half < PI - 1e-3) g.lineTo(VPT[0], VPT[1]);
    g.fill(); g.stroke();
  }
  g.strokeStyle = 'rgba(127,243,255,0.35)'; g.beginPath(); let on = false;
  for (let i = 0; i <= NV; i++) { const k = N + 2 + i; if (VPT[k * 3 + 2]) { if (on) g.lineTo(VPT[k * 3], VPT[k * 3 + 1]); else { g.moveTo(VPT[k * 3], VPT[k * 3 + 1]); on = true; } } else on = false; }
  g.stroke();
  // range rings at a third and two thirds of the vision radius: the near part of the cone stays on screen
  for (let r = 1; r <= 2; r++) {
    const rr = R * r / 3;
    for (let i = 0; i <= N; i++) { const a = -half + 2 * half * i / N, c = cos(a) * rr, s = sin(a) * rr; vproj(px + fx * c + sx * s, py + fy * c + sy * s, pz + fz * c + sz * s, 1 + i); }
    g.strokeStyle = 'rgba(127,243,255,0.3)'; g.beginPath(); on = false;
    for (let i = 1; i <= N + 1; i++) { if (VPT[i * 3 + 2]) { if (on) g.lineTo(VPT[i * 3], VPT[i * 3 + 1]); else { g.moveTo(VPT[i * 3], VPT[i * 3 + 1]); on = true; } } else on = false; }
    g.stroke();
  }
  if (VPT[2]) { g.strokeStyle = 'rgba(127,243,255,0.9)'; g.beginPath(); g.arc(VPT[0], VPT[1], 7, 0, TAU); g.stroke(); }
  // line to the current target
  const tg = HS.ins.target ? trackOf(HS.ins.target) : -1;
  if (tg >= 0 && VPT[2]) {
    vproj(tkP[tg * 3], tkP[tg * 3 + 1], tkP[tg * 3 + 2], 71);
    if (VPT[71 * 3 + 2]) {
      g.strokeStyle = 'rgba(255,140,120,0.95)'; g.lineWidth = 2; g.beginPath(); g.moveTo(VPT[0], VPT[1]); g.lineTo(VPT[213], VPT[214]); g.stroke();
      g.beginPath(); g.arc(VPT[213], VPT[214], 6, 0, TAU); g.stroke();
    }
  }
}
