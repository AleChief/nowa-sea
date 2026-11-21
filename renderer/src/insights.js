// ============================================================================
// Insights panel ("Наблюдения"): what is interesting, and honest, to watch, from the server's `insights` frame (5 s)
// ============================================================================
// Two groups of tabs. Evidence: the brain (choice quality of the brain's own decisions, learning individuals against
// the frozen control caste, the random baseline faint behind; decisions left to instinct; decision modes) and learning
// (cover discrimination, the change across a sleep or within a life, autonomy by age), with a "last 2 days / all time"
// window. Show: hunting (where the prey was when lunged at and what that cost it, the presence map), life and death,
// daily rhythm, mood, heroes and chronicle. Honesty: intervals as whiskers (dots only when the server gives none),
// faded when n < 5, nothing smoothed, the world speed beside time series.
// The frame is read in both forms the server has used (flat and one caste; windowed with plastic / frozen castes).
// The DOM and the charts change only when a frame arrives or on a click; the presence map on the mini-map (drawHeat)
// is the per-frame part and allocates nothing.
const IT = {
  ru: {
    title: 'Наблюдения', groups: ['Доказательства', 'Шоу'],
    tabs: ['Мозг', 'Обучение', 'Охота', 'Жизнь и смерть', 'Распорядок', 'Настроение', 'Герои и хроника'],
    win: { recent: 'Сейчас (2 дня)', all: 'За всё время' }, winAll: 'за всё время',
    wait: 'Наблюдения приходят раз в 5 с — подождите немного.', few: 'мало данных', speed: 'время симуляции; мир сейчас идёт ×{x}',
    key: { evade: 'спасаться', feed: 'есть', hunt: 'охотиться' }, rnd: 'случайный мозг', inst: 'инстинкт',
    pl: 'обучающиеся', fz: 'контроль (замороженные: тот же мозг без обучения)', noFz: 'Контрольной касты пока нет: сравнение только со случайным мозгом.',
    qT: 'Качество выбора мозга — согласие с инстинктом',
    qCap: 'Доля собственных решений мозга, подходящих к ситуации (подмены инстинктом исключены). Точка — среднее по особям, усы — 95 % ДИ (нет усов — особей меньше 3), n — особей с 5+ такими решениями; при n < 5 бледно. Главное сравнение — обучающиеся против контроля; пунктир — случайный мозг, справа — инстинкт (≈100 %). Это согласие с правилами инстинкта, а не «ум».',
    instT: 'Решений на инстинкте', instCap: 'доля решений, когда мозг не предложил ничего и тело действовало по инстинкту',
    modT: 'Режимы решений', mode: { habitual: 'привычка', balanced: 'равновесие', deliberative: 'обдумывание', inhibitory: 'торможение' },
    dT: 'Различение укрытия — главный признак обучения',
    dCap: 'Под угрозой: насколько чаще особь прячется, когда укрытие рядом, чем когда оно далеко (по особям, 95 % ДИ). Инстинкт и случайный мозг дают ровно 0; контроль показывает, сколько дают гены и побуждения без обучения.',
    slT: 'Сон: до и после', slCap: 'По особям: основное качество выбора (добыча — спасаться, хищник — охотиться) в 15 решениях после пробуждения минус в 15 перед сном. Выше нуля у обучающихся и не у контроля — эффект закрепления во сне.',
    wT: 'Изменение за жизнь: после сна',
    wCap: 'Парное сравнение: основное качество выбора после k ночей сна минус у той же особи до первой ночи. Под точками — число особей.',
    nights: ['ночь 1', 'ночь 2', 'ночи 3+'],
    auT: 'Самостоятельность по возрасту', auCap: '1 − доля решений на инстинкте, по числу уже принятых решений.',
    sT: 'Где была добыча, когда на неё бросались', where: { open: 'открытая вода', cover: 'укрытие', school: 'стая', burst: 'в рывке (пересекается)' },
    caught: 'поймано {p} (95 % ДИ {lo}–{hi}) из {n} бросков', burst: 'в рывке {p}', price: 'Цена положения: доля пойманных по положению добычи',
    hmT: 'Карта присутствия', hmOn: 'Показать на мини-карте', hmCap: 'Где вид проводит время (затухание — два дня), обновление раз в 15 с; ✕ — места поимок.',
    ddT: 'Смерти по дням', cause: ['съедены', 'голод', 'старость', 'прочее'],
    svT: 'Выживаемость (Каплан — Майер)', sv: { early: 'поколения 0–1', late: 'поколения 2+', founders: 'основатели', descendants: 'потомки' }, svN: '{l}: n {n}, смертей {e}',
    svCap: 'Доля доживших до возраста t, сутки; живые учтены как цензурированные; бледно, где под риском меньше 5.',
    aT: 'Распорядок дня', aCap: 'Доля времени на каждое намерение по часам суток (затухание — два дня). Полоса под столбцами: синяя — ночь, жёлтая — день; бледные часы — мало наблюдений.',
    mT: 'Настроение сейчас', mCap: 'Медиана (точка) и межквартильный размах по живым особям.', mFew: 'n = {n}: особей мало',
    mood: { valence: 'валентность', arousal: 'возбуждение', stress: 'стресс', cortisol: 'кортизол', uncertainty: 'неопределённость' },
    mhT: 'Стресс во времени (медиана по виду)', lrT: 'Стресс после броска хищника', lrTarget: 'цель', lrWit: 'свидетели (свой вид, до 8 м)', lrNb: 'соседи, видящие того же хищника (свой вид, до 8 м)',
    lrCap: 'Изменение стресса относительно момента броска, секунды; точки с n < 5 бледные.',
    hlT: 'Герои — среди живых', haT: 'Рекорды за всё время', chT: 'Хроника',
    rec: { lived_days: 'дольше всех живёт', children: 'больше всех потомков', catches: 'лучший охотник', dodged: 'пережил больше бросков', generation: 'дальнее поколение' },
    unit: { lived_days: 'сут', children: 'потомков', catches: 'поимок', dodged: 'бросков', generation: 'пок.' },
    follow: 'щёлкните — следить', lin: 'щёлкните — родословная', linT: 'Родословная #{id}', close: 'Закрыть', gen: 'пок.',
  },
  en: {
    title: 'Insights', groups: ['Evidence', 'Show'],
    tabs: ['Brain', 'Learning', 'Hunting', 'Life and death', 'Daily rhythm', 'Mood', 'Heroes and chronicle'],
    win: { recent: 'Now (2 days)', all: 'All time' }, winAll: 'all time',
    wait: 'Insights arrive every 5 s: wait a moment.', few: 'too few data', speed: 'simulation time; the world runs at ×{x} now',
    key: { evade: 'evade', feed: 'feed', hunt: 'hunt' }, rnd: 'random brain', inst: 'instinct',
    pl: 'learning', fz: 'control (frozen: the same brain without learning)', noFz: 'No control caste yet: compared with a random brain only.',
    qT: 'Choice quality of the brain: agreement with instinct',
    qCap: 'Share of the brain\'s own decisions that fitted the situation (instinct substitutions excluded). Dot: mean over individuals; whiskers: 95 % CI (none when fewer than 3); n: individuals with 5+ such decisions; faded when n < 5. The main comparison is learning against control; dashed: a random brain; right edge: instinct (≈100 %). This is agreement with the instinct\'s rules, not "intelligence".',
    instT: 'Left to instinct', instCap: 'share of decisions where the brain offered nothing and the body acted on instinct',
    modT: 'Decision modes', mode: { habitual: 'habitual', balanced: 'balanced', deliberative: 'deliberative', inhibitory: 'inhibitory' },
    dT: 'Cover discrimination: the key learning signal',
    dCap: 'Under threat: how much more often an individual hides when cover is near than when it is far (per individual, 95 % CI). Instinct and a random brain give exactly 0; the control shows what genes and drives give without learning.',
    slT: 'Sleep: before and after', slCap: 'Per individual: the primary choice quality (prey: evade, predators: hunt) in the 15 decisions after waking minus the 15 before sleep. Above zero for the learning caste and not for the control: consolidation in sleep.',
    wT: 'Change within a life: after sleep',
    wCap: 'Paired: the primary choice quality after k nights of sleep minus the same individual\'s before its first night. Individuals under the dots.',
    nights: ['night 1', 'night 2', 'nights 3+'],
    auT: 'Autonomy by age', auCap: '1 − share of decisions left to instinct, by the number of decisions already made.',
    sT: 'Where the prey was when lunged at', where: { open: 'open water', cover: 'cover', school: 'school', burst: 'bursting (overlaps)' },
    caught: 'caught {p} (95 % CI {lo}–{hi}) of {n} lunges', burst: 'bursting {p}', price: 'The price of a position: share caught by where the prey was',
    hmT: 'Presence map', hmOn: 'Show on the mini-map', hmCap: 'Where the species spends its time (two-day decay), refreshed every 15 s; ✕ marks catches.',
    ddT: 'Deaths per day', cause: ['eaten', 'starvation', 'old age', 'other'],
    svT: 'Survival (Kaplan–Meier)', sv: { early: 'generations 0–1', late: 'generations 2+', founders: 'founders', descendants: 'descendants' }, svN: '{l}: n {n}, deaths {e}',
    svCap: 'Share alive at age t, days; the living are censored; faded where fewer than 5 are at risk.',
    aT: 'Daily rhythm', aCap: 'Share of time per intent by hour of the day (two-day decay). The band under the bars: blue is night, yellow is day; faded hours have few observations.',
    mT: 'Mood now', mCap: 'Median (dot) and interquartile range over the living.', mFew: 'n = {n}: few individuals',
    mood: { valence: 'valence', arousal: 'arousal', stress: 'stress', cortisol: 'cortisol', uncertainty: 'uncertainty' },
    mhT: 'Stress over time (species median)', lrT: 'Stress after a predator\'s lunge', lrTarget: 'target', lrWit: 'witnesses (same species, within 8 m)', lrNb: 'neighbours seeing the same predator (same species, within 8 m)',
    lrCap: 'Change of stress against the moment of the lunge, seconds; points with n < 5 faded.',
    hlT: 'Heroes among the living', haT: 'All-time records', chT: 'Chronicle',
    rec: { lived_days: 'longest lived', children: 'most offspring', catches: 'best hunter', dodged: 'survived most lunges', generation: 'furthest generation' },
    unit: { lived_days: 'd', children: 'offspring', catches: 'catches', dodged: 'lunges', generation: 'gen' },
    follow: 'click to follow', lin: 'click for the family tree', linT: 'Family of #{id}', close: 'Close', gen: 'gen',
  },
};
const ITL = () => IT[LANG];
// m: the last insights frame; tab; win: 'recent' | 'all'; sp: species on per-species tabs; heat*: the presence map
const IS = { on: false, m: null, tab: 0, win: 'recent', sp: '', heatOn: false, heatSp: '', heatCv: null, heatTimer: 0, catchXZ: new Float32Array(1024), catchN: 0, linId: 0, linM: null, el: {} };
const KEYS = ['evade', 'feed', 'hunt'], MOODK = ['valence', 'arousal', 'stress', 'cortisol', 'uncertainty'], DMODES = ['habitual', 'balanced', 'deliberative', 'inhibitory'];
const MODE_COL = ['#7ff3ff', '#9fe9a8', '#c9a7ff', '#ffb36b'], T_EVID = 2, T_HALL = 6;
const INT_COL = { sleep: '#4b5a8a', rest: '#6f8fb3', drift: '#7fb8c9', forage: '#9fe9a8', scavenge: '#c3d36b', explore: '#7ff3ff', school: '#5fc9ff', patrol: '#b9a7ff',
  hide: '#ffb36b', burrow: '#d08a4f', flee: '#ff8a7a', ambush: '#e07ad0', stalk: '#c97aff', chase: '#ff6fa8', strike: '#ff4f6a', mate: '#ffd36b', glow: '#f3ff8a' };
const icol = (n, i) => INT_COL[n] || `hsl(${(i * 47) % 360} 55% 62%)`;
const nowaSp = () => (nowaSpecies() || []).filter((s) => s.brain === 'nowa');
const pc = (v) => (typeof v === 'number' && isFinite(v) ? `${round(v * 100)} %` : '—');
const sg = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '—');
const fade = (n) => (n >= 5 ? 1 : 0.38);
const lightAt = (ph) => min(1, max(0.04, 0.5 + 0.75 * sin((ph - 0.25) * TAU))); // as the server's light_level
// the evidence blocks of a frame in the chosen window; one caste (older server) reads as the learning caste
function evid(m) {
  const w = m.recent && m.all ? m[IS.win] || m.all : m;
  return { brain: w.brain || {}, disc: w.discrimination || {}, sleep: w.sleep_delta || null, within: w.within_life || m.within_life || null, modes: w.modes || m.modes || {}, windowed: !!(m.recent && m.all) };
}
const castes = (b) => (b && typeof b === 'object' && ('plastic' in b || 'frozen' in b) ? { plastic: b.plastic || null, frozen: b.frozen || null } : { plastic: b || null, frozen: null });

function buildObs() {
  const p = HS.el.hobs; if (!p) return;
  const t = ITL(), tb = (i) => `<button data-t="${i}">${esc(t.tabs[i])}</button>`;
  p.innerHTML = `<h3>🔭 ${t.title}<button class=x title="${esc(t.close)}">✕</button></h3>` +
    `<div class=otabs><span class=ogrp>${esc(t.groups[0])}</span>${[0, 1].map(tb).join('')}<span class=ogrp>${esc(t.groups[1])}</span>${[2, 3, 4, 5, 6].map(tb).join('')}</div>` +
    `<div class=owin>${['recent', 'all'].map((w) => `<button data-w="${w}">${esc(t.win[w])}</button>`).join('')}</div><div class=osp></div><div class=ob></div>`;
  p.querySelector('.x').onclick = () => toggleObs(false);
  p.querySelectorAll('.otabs button').forEach((b) => { b.onclick = () => { IS.tab = +b.dataset.t; renderObs(); }; });
  p.querySelectorAll('.owin button').forEach((b) => { b.onclick = () => { IS.win = b.dataset.w; renderObs(); }; });
  IS.el = { tabs: p.querySelector('.otabs'), win: p.querySelector('.owin'), sp: p.querySelector('.osp'), b: p.querySelector('.ob') };
  // clicks inside: species chips, hall cards, family chips, the presence map switch
  IS.el.sp.onclick = (e) => { const b = e.target.closest('button[data-s]'); if (b) { IS.sp = b.dataset.s; renderObs(); } };
  IS.el.b.onclick = (e) => {
    const c = e.target.closest('[data-hid]');
    if (c) { const id = +c.dataset.hid; if (c.dataset.alive === '1') select(id); else { IS.linId = id; send({ t: 'lineage', id, up: 4, down: 3 }); } return; }
    const f = e.target.closest('.fn'); if (f && !f.classList.contains('dead')) { select(+f.dataset.id); return; }
    if (e.target.closest('.lx')) { IS.linId = 0; IS.linM = null; const l = IS.el.b.querySelector('.olin'); if (l) l.innerHTML = ''; }
  };
  IS.el.b.onchange = (e) => {
    if (e.target.classList.contains('hmon')) setHeat(e.target.checked, IS.heatSp);
    else if (e.target.classList.contains('hmsp')) setHeat(IS.heatOn, e.target.value);
  };
  p.classList.toggle('show', IS.on);
  renderObs();
}
function toggleObs(on) {
  IS.on = on === undefined ? !IS.on : on;
  HS.el.hobs.classList.toggle('show', IS.on);
  const b = HS.el.hbar.querySelector('#hobsb'); if (b) b.classList.toggle('on', IS.on);
  if (IS.on) { if (!IS.m) send({ t: 'insights' }); renderObs(); }
}
function onInsights(m) { IS.m = m; if (IS.on) renderObs(); }

// ---------------------------------------------------------------- presence map on the mini-map
function setHeat(on, sp) {
  IS.heatOn = !!on; IS.heatSp = sp || IS.heatSp || (nowaSpecies()[0] || {}).id || '';
  clearInterval(IS.heatTimer); IS.heatTimer = 0;
  if (IS.heatOn) { const ask = () => send({ t: 'heatmap', species: IS.heatSp }); ask(); IS.heatTimer = setInterval(ask, 15000); }
}
// the 40 x 25 grid as a small image (transparent -> cyan -> yellow), the catches as points
function onHeat(m) {
  if (m.species !== IS.heatSp || !m.nx || !m.nz || !m.data) return;
  const c = IS.heatCv && IS.heatCv.width === m.nx && IS.heatCv.height === m.nz ? IS.heatCv : Object.assign(document.createElement('canvas'), { width: m.nx, height: m.nz });
  const g = c.getContext('2d'), im = g.createImageData(m.nx, m.nz), d = im.data;
  for (let i = 0; i < m.nx * m.nz; i++) {
    const v = clamp(+m.data[i] || 0, 0, 1), a = sqrt(v);
    d[i * 4] = 40 + 215 * v; d[i * 4 + 1] = 200 + 40 * v; d[i * 4 + 2] = 255 - 175 * v; d[i * 4 + 3] = v > 0.01 ? 60 + 195 * a : 0;
  }
  g.putImageData(im, 0, 0); IS.heatCv = c;
  const cp = m.catches || [], n = min(cp.length, IS.catchXZ.length / 2), o = cp.length - n;
  for (let i = 0; i < n; i++) { IS.catchXZ[i * 2] = +cp[o + i][0] || 0; IS.catchXZ[i * 2 + 1] = +cp[o + i][1] || 0; }
  IS.catchN = n;
}
// per frame (hudFrame -> drawMini): no allocation
function drawHeat(g, x0, y0, w, h, sx) {
  if (IS.heatCv) { g.globalAlpha = 0.85; g.imageSmoothingEnabled = true; g.drawImage(IS.heatCv, x0, y0, w, h); g.globalAlpha = 1; }
  g.strokeStyle = 'rgba(255,110,110,0.95)'; g.lineWidth = 1.2; g.beginPath();
  for (let i = 0; i < IS.catchN; i++) {
    const x = x0 + (IS.catchXZ[i * 2] + tHx) * sx, y = y0 + (IS.catchXZ[i * 2 + 1] + tHz) * sx;
    g.moveTo(x - 2.5, y - 2.5); g.lineTo(x + 2.5, y + 2.5); g.moveTo(x + 2.5, y - 2.5); g.lineTo(x - 2.5, y + 2.5);
  }
  g.stroke();
}

// ---------------------------------------------------------------- rendering (on a frame, a tab or a click)
const spCol = (id, a = 1) => { const s = spOf(id); return s ? rgb(s.glow || s.color, a) : `rgba(255,255,255,${a})`; };
const chipBtn = (id) => { const s = spOf(id); return `<button data-s="${esc(id)}" class="${id === IS.sp ? 'on' : ''}"><i class=chip style="background:${s ? rgb(s.color) : '#888'};box-shadow:0 0 0 2px ${s ? rgb(s.glow, 0.8) : '#aaa'}"></i> ${esc(spName(id))}</button>`; };
const sec = (title, cap, body) => `<div class=osec><h4>${esc(title)}</h4>${body}${cap ? `<div class=ocap>${esc(cap)}</div>` : ''}</div>`;
const canvasHtml = (cls, w, h) => `<canvas class="oc ${cls}" width=${w} height=${h}></canvas>`;
const casteLeg = (t, hasF) => `<div class=oleg><span>● ${esc(t.pl)}</span>${hasF ? ` <span>○ ${esc(t.fz)}</span>` : ''}</div>${hasF ? '' : `<div class=ocap>${esc(t.noFz)}</div>`}`;
function renderObs() {
  if (!IS.on || !IS.el.b) return;
  const t = ITL(), m = IS.m;
  IS.el.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.t === IS.tab));
  // the window applies to the evidence tabs, when the server sends both
  const winOk = m && IS.tab < T_EVID && evid(m).windowed;
  IS.el.win.style.display = winOk ? '' : 'none';
  IS.el.win.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === IS.win));
  const per = IS.tab === 3 || IS.tab === 4; // tabs that show one species at a time
  const all = (nowaSpecies() || []).map((s) => s.id);
  if (!all.includes(IS.sp)) IS.sp = all[0] || '';
  IS.el.sp.innerHTML = per ? all.map(chipBtn).join('') : '';
  if (!m) { IS.el.b.innerHTML = `<div class=ocap>${esc(t.wait)}</div>`; return; }
  (([obsBrain, obsLearn, obsHunt, obsLife, obsRhythm, obsMood, obsHall])[IS.tab] || obsBrain)(m, t);
}
// a dot with its 95 % interval (whiskers only when the server gives both ends); hollow: the control caste
function ciMark(g, x, y, r, col, hollow) {
  if (!r || typeof r.mean !== 'number') return;
  g.globalAlpha = fade(r.n || 0); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
  if (typeof r.lo === 'number' && typeof r.hi === 'number') { g.beginPath(); g.moveTo(x(r.lo), y); g.lineTo(x(r.hi), y); g.moveTo(x(r.lo), y - 4); g.lineTo(x(r.lo), y + 4); g.moveTo(x(r.hi), y - 4); g.lineTo(x(r.hi), y + 4); g.stroke(); }
  g.beginPath(); g.arc(x(r.mean), y, 4.5, 0, TAU);
  if (hollow) { g.fillStyle = '#081820'; g.fill(); g.stroke(); } else g.fill();
  g.globalAlpha = 1;
}
function ctx2(cls) { const c = IS.el.b.querySelector('canvas.' + cls); if (!c) return null; const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.font = '12px system-ui, sans-serif'; g.textBaseline = 'middle'; return [g, c.width, c.height]; }
const txt = (g, s, x, y, col = '#cfe9ef', al = 'left') => { g.fillStyle = col; g.textAlign = al; g.fillText(s, x, y); };
// rows of two marks (learning above, control below) on a symmetric scale around zero
function zeroRows(cls, rows, t) {
  const c = ctx2(cls); if (!c) return;
  const [g, W, h] = c, L = 150, R = W - 150;
  let mx = 0.2; for (const [, P, F] of rows) for (const r of [P, F]) if (r && typeof r.mean === 'number') mx = max(mx, abs(r.lo ?? r.mean), abs(r.hi ?? r.mean), abs(r.mean));
  mx = Math.ceil(mx * 10) / 10; const x = (v) => L + (clamp(v, -mx, mx) + mx) / (2 * mx) * (R - L);
  g.strokeStyle = '#ffffff20'; g.lineWidth = 1; g.beginPath(); for (const v of [-mx, -mx / 2, mx / 2, mx]) { g.moveTo(x(v), 14); g.lineTo(x(v), h - 4); } g.stroke();
  g.strokeStyle = '#ffffffcc'; g.lineWidth = 2; g.beginPath(); g.moveTo(x(0), 10); g.lineTo(x(0), h - 2); g.stroke();
  txt(g, '0', x(0), 6, '#fff', 'center'); txt(g, sg(-mx, 1), x(-mx), 6, '#9fcbd5', 'center'); txt(g, sg(mx, 1), x(mx), 6, '#9fcbd5', 'center');
  if (!rows.length) txt(g, t.few, L, 28, '#9fcbd5');
  rows.forEach(([id, P, F], i) => {
    const y = 30 + i * 32;
    txt(g, spName(id), 8, y, spCol(id));
    if (!P && !F) { txt(g, t.few, L + 6, y, '#9fcbd5'); return; }
    ciMark(g, x, y - 6, P, spCol(id), false); ciMark(g, x, y + 7, F, '#d6e6ea', true);
    txt(g, P && typeof P.mean === 'number' ? `● ${sg(P.mean)} n ${P.n}` : '● —', R + 10, y - 6, P && P.n >= 5 ? '#e8fdff' : '#9fcbd5');
    if (F) txt(g, typeof F.mean === 'number' ? `○ ${sg(F.mean)} n ${F.n}` : '○ —', R + 10, y + 7, F.n >= 5 ? '#e8fdff' : '#9fcbd5');
  });
}

// ---- Evidence: the brain
function obsBrain(m, t) {
  const E = evid(m), sps = nowaSp().map((s) => s.id).filter((id) => E.brain[id]);
  const rows = []; let hasF = false;
  for (const id of sps) {
    const B = castes(E.brain[id]); if (B.frozen) hasF = true;
    for (const k of KEYS) {
      const P = B.plastic && B.plastic[k], F = B.frozen && B.frozen[k], base = m.baselines && m.baselines[id] ? m.baselines[id][k] : null;
      if (P || F || typeof base === 'number') rows.push([id, k, P, F, base]);
    }
  }
  const instOne = (r) => (r ? `${pc(r.mean)}${typeof r.lo === 'number' ? ` (${pc(r.lo)}–${pc(r.hi)})` : ''}, n ${r.n}` : t.few);
  const inst = sps.map((id) => { const B = castes(E.brain[id]), P = B.plastic && B.plastic.instinct_share, F = B.frozen && B.frozen.instinct_share;
    return `<span><i class=chip style="background:${spCol(id)}"></i> ${esc(spName(id))}: <span style="opacity:${P ? fade(P.n) : 0.4}">● ${esc(instOne(P))}</span>${B.frozen ? ` <span style="opacity:${F ? fade(F.n) : 0.4}">○ ${esc(instOne(F))}</span>` : ''}</span>`; }).join('');
  const msp = sps.filter((id) => E.modes[id]);
  const modes = msp.length ? sec(t.modT, '', `<div class=oleg>${DMODES.map((k, i) => `<span><i class=chip style="background:${MODE_COL[i]}"></i> ${esc(t.mode[k])}</span>`).join(' ')}</div>` +
    msp.map((id) => {
      // per caste when the server splits them (learning ●, control ○), else one bar
      const C = castes(E.modes[id]), bar = (md, mk) => { const sum = DMODES.reduce((a, k) => a + (+md[k] || 0), 0) || 1; return `<div class=omode><span><i class=chip style="background:${spCol(id)}"></i> ${esc(spName(id))} ${mk}</span><div class=o100>${DMODES.map((k, i) => `<i style="width:${((+md[k] || 0) / sum * 100).toFixed(1)}%;background:${MODE_COL[i]}" title="${esc(t.mode[k])} ${pc((+md[k] || 0) / sum)}"></i>`).join('')}</div><span class=ocap>${DMODES.filter((k) => +md[k] > 0).map((k) => `${esc(t.mode[k])} ${pc((+md[k] || 0) / sum)}`).join(' · ')}</span></div>`; };
      return (C.plastic ? bar(C.plastic, C.frozen ? '●' : '') : '') + (C.frozen ? bar(C.frozen, '○') : '');
    }).join('')) : '';
  IS.el.b.innerHTML = sec(t.qT, t.qCap, casteLeg(t, hasF) + canvasHtml('oq', 640, 34 + 30 * max(1, rows.length))) +
    sec(t.instT, t.instCap, `<div class=oinst>${inst}</div>`) + modes;
  const c = ctx2('oq'); if (!c) return;
  const [g, w, h] = c, L = 190, R = w - 120, x = (v) => L + clamp(v, 0, 1) * (R - L);
  g.strokeStyle = '#ffffff20'; g.lineWidth = 1; g.beginPath(); for (let v = 0; v <= 1.001; v += 0.25) { g.moveTo(x(v), 16); g.lineTo(x(v), h - 14); } g.stroke();
  for (let v = 0; v <= 1.001; v += 0.25) txt(g, `${round(v * 100)}`, x(v), 7, '#9fcbd5', 'center');
  g.strokeStyle = '#ffc46b'; g.lineWidth = 2; g.beginPath(); g.moveTo(x(1), 14); g.lineTo(x(1), h - 14); g.stroke(); txt(g, t.inst, x(1), h - 6, '#ffc46b', 'center');
  rows.forEach(([id, k, P, F, base], i) => {
    const y = 32 + i * 30;
    txt(g, `${spName(id)} · ${t.key[k]}`, 8, y, spCol(id));
    if (typeof base === 'number') { g.globalAlpha = 0.55; g.strokeStyle = '#d6e6ea'; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x(base), y - 12); g.lineTo(x(base), y + 12); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
    if (!P && !F) { txt(g, t.few, L + 6, y, '#9fcbd5'); return; }
    ciMark(g, x, y - 6, P, spCol(id), false); ciMark(g, x, y + 7, F, '#d6e6ea', true);
    txt(g, P ? `● ${pc(P.mean)} n ${P.n}` : '● —', R + 10, y - 6, P && P.n >= 5 ? '#e8fdff' : '#9fcbd5');
    if (F) txt(g, `○ ${pc(F.mean)} n ${F.n}`, R + 10, y + 7, F.n >= 5 ? '#e8fdff' : '#9fcbd5');
  });
  if (rows.length) { g.globalAlpha = 0.7; txt(g, `┆ ${t.rnd}`, L, h - 6, '#d6e6ea'); g.globalAlpha = 1; }
}

// ---- Evidence: learning
function obsLearn(m, t) {
  const E = evid(m), sps = nowaSp().map((s) => s.id);
  const drows = sps.filter((id) => id in E.disc).map((id) => { const c = castes(E.disc[id]); return [id, c.plastic, c.frozen]; });
  const hasF = drows.some((r) => r[2]) || sps.some((id) => E.brain[id] && castes(E.brain[id]).frozen);
  let html = casteLeg(t, hasF) + sec(t.dT, t.dCap, canvasHtml('od', 640, 22 + 32 * max(1, drows.length)));
  let srows = null;
  if (E.sleep) { srows = sps.filter((id) => id in E.sleep).map((id) => { const c = castes(E.sleep[id]); return [id, c.plastic, c.frozen]; }); html += sec(t.slT, t.slCap, canvasHtml('osl', 640, 22 + 32 * max(1, srows.length))); }
  else if (E.within) html += sec(t.wT, t.wCap, canvasHtml('ow', 640, 150));
  const au = sps.map((id) => [id, castes(E.brain[id])]).filter(([, B]) => (B.plastic && B.plastic.autonomy_by_age) || (B.frozen && B.frozen.autonomy_by_age));
  if (au.length) html += sec(t.auT, t.auCap, canvasHtml('oau', 640, 150));
  IS.el.b.innerHTML = html;
  zeroRows('od', drows, t);
  if (srows) zeroRows('osl', srows, t);
  // older server: change after 1, 2, 3+ nights against zero, one small chart per species
  let c = !E.sleep && E.within ? ctx2('ow') : null;
  if (c) {
    const [g, w, h] = c, ws = sps.filter((id) => E.within[id]), cw = w / max(1, ws.length);
    let mx = 0.2; for (const id of ws) for (const r of E.within[id]) if (typeof r.mean === 'number') mx = max(mx, abs(r.lo ?? r.mean), abs(r.hi ?? r.mean));
    mx = Math.ceil(mx * 10) / 10;
    ws.forEach((id, j) => {
      const x0 = j * cw, top = 22, bot = h - 30, y = (v) => top + (mx - clamp(v, -mx, mx)) / (2 * mx) * (bot - top);
      txt(g, spName(id), x0 + 8, 9, spCol(id));
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0 + 26, y(0)); g.lineTo(x0 + cw - 8, y(0)); g.stroke();
      txt(g, sg(mx, 1), x0 + 22, top, '#9fcbd5', 'right'); txt(g, '0', x0 + 22, y(0), '#fff', 'right'); txt(g, sg(-mx, 1), x0 + 22, bot, '#9fcbd5', 'right');
      E.within[id].forEach((r, i) => {
        const xx = x0 + 40 + i * (cw - 56) / 2;
        g.globalAlpha = fade(r.n || 0); g.strokeStyle = spCol(id); g.fillStyle = spCol(id); g.lineWidth = 2;
        if (typeof r.lo === 'number' && typeof r.hi === 'number') { g.beginPath(); g.moveTo(xx, y(r.lo)); g.lineTo(xx, y(r.hi)); g.moveTo(xx - 4, y(r.lo)); g.lineTo(xx + 4, y(r.lo)); g.moveTo(xx - 4, y(r.hi)); g.lineTo(xx + 4, y(r.hi)); g.stroke(); }
        if (typeof r.mean === 'number') { g.beginPath(); g.arc(xx, y(r.mean), 4.5, 0, TAU); g.fill(); }
        g.globalAlpha = 1;
        txt(g, t.nights[i], xx, h - 19, '#9fcbd5', 'center'); txt(g, `n ${r.n || 0}`, xx, h - 6, (r.n || 0) >= 5 ? '#e8fdff' : '#9fcbd5', 'center');
      });
    });
    if (!ws.length) txt(g, t.few, 8, h / 2, '#9fcbd5');
  }
  // autonomy by age: buckets on x, 0..1 on y, one small chart per species, both castes
  c = au.length ? ctx2('oau') : null;
  if (c) {
    const [g, w, h] = c, cw = w / au.length;
    au.forEach(([id, B], j) => {
      const x0 = j * cw, top = 22, bot = h - 22, y = (v) => top + (1 - clamp(v, 0, 1)) * (bot - top);
      txt(g, spName(id), x0 + 8, 9, spCol(id));
      g.strokeStyle = '#ffffff25'; g.lineWidth = 1; g.beginPath(); for (const v of [0, 0.5, 1]) { g.moveTo(x0 + 26, y(v)); g.lineTo(x0 + cw - 8, y(v)); } g.stroke();
      txt(g, '1', x0 + 22, y(1), '#9fcbd5', 'right'); txt(g, '0', x0 + 22, y(0), '#9fcbd5', 'right');
      const bk = (B.plastic && B.plastic.autonomy_by_age) || (B.frozen && B.frozen.autonomy_by_age) || [];
      bk.forEach((b, i) => {
        const xx = x0 + 44 + i * (cw - 64) / max(1, bk.length - 1);
        txt(g, String(b.bucket), xx, h - 8, '#9fcbd5', 'center');
        for (const [r, col, hol, dx] of [[B.plastic && B.plastic.autonomy_by_age && B.plastic.autonomy_by_age[i], spCol(id), false, -5], [B.frozen && B.frozen.autonomy_by_age && B.frozen.autonomy_by_age[i], '#d6e6ea', true, 5]]) {
          if (!r || typeof r.mean !== 'number') continue;
          g.globalAlpha = fade(r.n || 0); g.strokeStyle = col; g.lineWidth = 2;
          if (typeof r.lo === 'number' && typeof r.hi === 'number') { g.beginPath(); g.moveTo(xx + dx, y(r.lo)); g.lineTo(xx + dx, y(r.hi)); g.stroke(); }
          g.beginPath(); g.arc(xx + dx, y(r.mean), 4, 0, TAU); if (hol) { g.fillStyle = '#081820'; g.fill(); g.stroke(); } else { g.fillStyle = col; g.fill(); }
          g.globalAlpha = 1;
        }
      });
    });
  }
}

// ---- Show: hunting
function obsHunt(m, t) {
  const st = m.strikes || {}, ids = Object.keys(st), CL = { open: '#7ff3ff', cover: '#9fe9a8', school: '#c9a7ff', burst: '#ffb36b' };
  const opts = (nowaSpecies() || []).map((s) => `<option value="${esc(s.id)}"${s.id === IS.heatSp ? ' selected' : ''}>${esc(spName(s.id))}</option>`).join('');
  const rows = ids.map((id) => {
    const s = st[id], n = +s.lunges || 0, few = n < 10, ci = s.catch_ci || [];
    const head = `<span><i class=chip style="background:${spCol(id)}"></i> ${esc(spName(id))}</span>`;
    const tail = `<span class=ocap>${few ? `${esc(t.few)} (${n})` : esc(fmt(t.caught, { p: pc(s.caught / n), lo: pc(ci[0]), hi: pc(ci[1]), n }))}</span>`;
    if (s.by_state) {
      // the price of a position: lunges by where the prey was, and the share of them that caught it
      const bs = s.by_state, keys = ['open', 'cover', 'school', 'burst'].filter((k) => bs[k]), sum = max(1, keys.filter((k) => k !== 'burst').reduce((a, k) => a + (+bs[k].lunges || 0), 0));
      const bar = keys.filter((k) => k !== 'burst').map((k) => `<i style="width:${((+bs[k].lunges || 0) / sum * 100).toFixed(1)}%;background:${CL[k]}" title="${esc(t.where[k])} ${bs[k].lunges || 0}"></i>`).join('');
      const pr = keys.map((k) => { const b = bs[k], bn = +b.lunges || 0, c2 = b.catch_ci || []; return `<div class="oprice${bn < 10 ? ' low' : ''}"><span><i class=chip style="background:${CL[k]}"></i> ${esc(t.where[k])}</span><div class=opb><i style="left:${(c2[0] || 0) * 100}%;width:${max(0, (c2[1] || 0) - (c2[0] || 0)) * 100}%"></i><b style="left:${bn ? (b.caught / bn) * 100 : 0}%"></b></div><span class=ocap>${bn ? `${pc(b.caught / bn)} · ${b.caught}/${bn}` : '—'}</span></div>`; }).join('');
      return `<div class="ostr${few ? ' low' : ''}">${head}<div class=o100>${n ? bar : ''}</div>${tail}</div><div class=oprices>${pr}</div>`;
    }
    const sum = max(1, (+s.open || 0) + (+s.cover || 0) + (+s.school || 0));
    const seg = ['open', 'cover', 'school'].map((k) => `<i style="width:${((+s[k] || 0) / sum * 100).toFixed(1)}%;background:${CL[k]}" title="${esc(t.where[k])} ${s[k] || 0}"></i>`).join('');
    return `<div class="ostr${few ? ' low' : ''}">${head}<div class=o100>${n ? seg : ''}</div>${few ? tail : `<span class=ocap>${esc(fmt(t.caught, { p: pc(s.caught / n), lo: pc(ci[0]), hi: pc(ci[1]), n }))} · ${esc(fmt(t.burst, { p: pc(s.burst / n) }))}</span>`}</div>`;
  }).join('');
  const hasBS = ids.some((id) => st[id].by_state);
  const leg = ['open', 'cover', 'school'].concat(hasBS ? ['burst'] : []).map((k) => `<span><i class=chip style="background:${CL[k]}"></i> ${esc(t.where[k])}</span>`).join(' ');
  IS.el.b.innerHTML = sec(t.sT, hasBS ? t.price : '', `<div class=oleg>${leg}</div>${rows || `<div class=ocap>${esc(t.few)}</div>`}`) +
    sec(t.hmT, t.hmCap, `<label class=oline><input type=checkbox class=hmon${IS.heatOn ? ' checked' : ''}> ${esc(t.hmOn)}</label> <select class=hmsp>${opts}</select>`);
}

// ---- Show: life and death
function obsLife(m, t) {
  const id = IS.sp, dd = (m.deaths_daily || {})[id] || [], sv = (m.survival || {})[id] || {};
  const CC = ['#ff8a7a', '#ffc46b', '#b9a7ff', '#8aa0a8'], SK = ['early', 'late', 'founders', 'descendants'].filter((k) => sv[k]), SC = (i) => (i ? spCol(id) : '#e8fdff');
  const svLeg = SK.map((k, i) => `<span><i class=chip style="background:${SC(i)}"></i> ${esc(fmt(t.svN, { l: t.sv[k] || k, n: sv[k].n, e: sv[k].events }))}</span>`).join(' ');
  IS.el.b.innerHTML = sec(t.ddT, '', `<div class=oleg>${t.cause.map((c, i) => `<span><i class=chip style="background:${CC[i]}"></i> ${esc(c)}</span>`).join(' ')}</div>` + canvasHtml('odd', 640, 150)) +
    sec(t.svT, t.svCap, `<div class=oleg>${svLeg}</div>` + canvasHtml('osv', 640, 170));
  let c = ctx2('odd');
  if (c) {
    const [g, w, h] = c, n = dd.length, bw = (w - 40) / max(1, n);
    let mx = 1; for (const r of dd) mx = max(mx, r[1] + r[2] + r[3] + r[4]);
    const y = (v) => h - 18 - v / mx * (h - 30);
    txt(g, String(mx), 30, 10, '#9fcbd5', 'right');
    dd.forEach((r, i) => {
      let acc = 0; const x = 36 + i * bw;
      for (let k = 0; k < 4; k++) { const v = r[k + 1]; if (!v) continue; g.fillStyle = CC[k]; g.fillRect(x + 2, y(acc + v), bw - 4, y(acc) - y(acc + v)); acc += v; }
      txt(g, `${r[0] + 1}`, x + bw / 2, h - 7, '#9fcbd5', 'center');
    });
    g.strokeStyle = '#ffffff30'; g.beginPath(); g.moveTo(34, y(0) + 0.5); g.lineTo(w, y(0) + 0.5); g.stroke();
  }
  c = ctx2('osv');
  if (c) {
    const [g, w, h] = c, L = 36, B = h - 18;
    let tm = 0.5; for (const k of SK) for (const p of sv[k].points) tm = max(tm, p[0]);
    const x = (v) => L + v / tm * (w - L - 10), y = (v) => 8 + (1 - v) * (B - 8);
    g.strokeStyle = '#ffffff20'; g.beginPath(); for (const v of [0, 0.5, 1]) { g.moveTo(L, y(v)); g.lineTo(w, y(v)); } g.stroke();
    txt(g, '1', L - 6, y(1), '#9fcbd5', 'right'); txt(g, '0.5', L - 6, y(0.5), '#9fcbd5', 'right'); txt(g, '0', L - 6, y(0), '#9fcbd5', 'right');
    txt(g, `${tm.toFixed(1)}`, w - 10, h - 7, '#9fcbd5', 'right');
    // steps, each segment faded where fewer than 5 are at risk
    SK.forEach((k, i) => {
      const P = sv[k].points; g.strokeStyle = SC(i); g.lineWidth = 2;
      for (let j = 1; j < P.length; j++) {
        g.globalAlpha = (P[j][2] ?? 5) < 5 ? 0.35 : 1; g.beginPath(); g.moveTo(x(P[j - 1][0]), y(P[j - 1][1])); g.lineTo(x(P[j][0]), y(P[j - 1][1])); g.lineTo(x(P[j][0]), y(P[j][1])); g.stroke();
      }
      g.globalAlpha = 1;
    });
    if (!SK.length) txt(g, t.few, L + 8, h / 2, '#9fcbd5');
  }
}

// ---- Show: daily rhythm
function obsRhythm(m, t) {
  const a = (m.actogram || {})[IS.sp];
  const ints = a ? a.intents : [];
  IS.el.b.innerHTML = sec(t.aT, t.aCap, `<div class=oleg>${ints.map((n, i) => `<span><i class=chip style="background:${icol(n, i)}"></i> ${esc(intentName(n))}</span>`).join(' ')}</div>` + canvasHtml('oac', 640, 190));
  const c = ctx2('oac'); if (!c) return;
  const [g, w, h] = c, L = 30, B = h - 22, bw = (w - L - 4) / 24;
  if (!a) { txt(g, t.few, L, h / 2, '#9fcbd5'); return; }
  let wm = 0; for (const v of a.weight) wm = max(wm, +v || 0);
  // day and night as a band under the bars (the bars fill their hour)
  for (let hr = 0; hr < 24; hr++) { g.fillStyle = lightAt((hr + 0.5) / 24) < 0.25 ? '#5b7cff' : '#e8d77a'; g.fillRect(L + hr * bw + 1, B + 1, bw - 2, 4); }
  for (let hr = 0; hr < 24; hr++) {
    const row = a.shares[hr] || [], wt = +a.weight[hr] || 0; let acc = 0;
    g.globalAlpha = wt <= 0 ? 0 : wt < wm * 0.15 ? 0.35 : 0.92;
    for (let k = 0; k < ints.length; k++) { const v = +row[k] || 0; if (v <= 0) continue; g.fillStyle = icol(ints[k], k); g.fillRect(L + hr * bw + 1, 4 + (1 - acc - v) * (B - 4), bw - 2, v * (B - 4)); acc += v; }
  }
  g.globalAlpha = 1;
  for (let hr = 0; hr <= 24; hr += 6) txt(g, `${String(hr).padStart(2, '0')}:00`, L + hr * bw, h - 7, '#9fcbd5', 'center');
  txt(g, '100', L - 4, 6, '#9fcbd5', 'right'); txt(g, '0', L - 4, B, '#9fcbd5', 'right');
}

// ---- Show: mood
function obsMood(m, t) {
  const mood = m.mood || {}, ids = Object.keys(mood), mh = m.mood_history || [], lr = m.lunge_response || {};
  const sp = HS.stats && HS.stats.speed, x = sp ? (sp.set === 'turbo' ? (+sp.achieved || 0).toFixed(0) : (+sp.achieved || 0).toFixed(1)) : '?';
  const nbKey = lr.neighbours ? 'neighbours' : 'witness';
  const notes = ids.map((id) => `<span style="color:${spCol(id)}">${esc(spName(id))}</span>${mood[id].n <= 6 ? ` <span class=ocap>(${esc(fmt(t.mFew, { n: mood[id].n }))})</span>` : ` <span class=ocap>(n ${mood[id].n})</span>`}`).join(' · ');
  IS.el.b.innerHTML = sec(t.mT, t.mCap, `<div class=oleg>${notes}</div>` + canvasHtml('omd', 640, 34 + 22 * MOODK.length)) +
    sec(t.mhT, fmt(t.speed, { x }), canvasHtml('omh', 640, 130)) +
    sec(t.lrT, t.lrCap, `<div class=oleg><span><i class=chip style="background:#ff8a7a"></i> ${esc(t.lrTarget)}</span> <span><i class=chip style="background:#7ff3ff"></i> ${esc(nbKey === 'neighbours' ? t.lrNb : t.lrWit)}</span></div>` + canvasHtml('olr', 640, 140));
  // mood now: one row per key, a dot and an IQR bar per species
  let c = ctx2('omd');
  if (c) {
    const [g, w, h] = c, L = 130, R = w - 10, X = (v) => L + (clamp(v, -1, 1) + 1) / 2 * (R - L);
    g.strokeStyle = '#ffffff20'; g.beginPath(); for (const v of [-1, -0.5, 0.5, 1]) { g.moveTo(X(v), 14); g.lineTo(X(v), h - 4); } g.stroke();
    g.strokeStyle = '#ffffff90'; g.beginPath(); g.moveTo(X(0), 12); g.lineTo(X(0), h - 4); g.stroke();
    for (const v of [-1, 0, 1]) txt(g, String(v), X(v), 6, '#9fcbd5', 'center');
    MOODK.forEach((k, i) => {
      const y = 28 + i * 22; txt(g, t.mood[k], 8, y, '#cfe9ef');
      ids.forEach((id, j) => {
        const q = mood[id][k]; if (!q) return; const yy = y - 6 + j * 12 / max(1, ids.length - 1);
        g.globalAlpha = mood[id].n <= 6 ? 0.45 : 1; g.strokeStyle = spCol(id); g.fillStyle = spCol(id); g.lineWidth = 3;
        g.beginPath(); g.moveTo(X(q[1]), yy); g.lineTo(X(q[2]), yy); g.stroke(); g.beginPath(); g.arc(X(q[0]), yy, 3.5, 0, TAU); g.fill(); g.globalAlpha = 1;
      });
    });
  }
  // stress median over time, per species
  c = ctx2('omh');
  if (c) {
    const [g, w, h] = c, L = 30, B = h - 16;
    if (mh.length < 2) txt(g, t.few, L, h / 2, '#9fcbd5');
    else {
      const t0 = mh[0][0], t1 = mh[mh.length - 1][0], X = (v) => L + (v - t0) / max(t1 - t0, 1e-6) * (w - L - 6), Y = (v) => 6 + (1 - clamp(v, 0, 1)) * (B - 6);
      g.strokeStyle = '#ffffff20'; g.beginPath(); for (const v of [0, 0.5, 1]) { g.moveTo(L, Y(v)); g.lineTo(w, Y(v)); } g.stroke();
      txt(g, '1', L - 4, Y(1), '#9fcbd5', 'right'); txt(g, '0', L - 4, Y(0), '#9fcbd5', 'right');
      const day = (helloMsg && helloMsg.day_s) || 1200;
      txt(g, `${TL().day} ${(t0 / day + 1).toFixed(1)}`, L, h - 5, '#9fcbd5'); txt(g, `${TL().day} ${(t1 / day + 1).toFixed(1)}`, w - 4, h - 5, '#9fcbd5', 'right');
      for (const s of nowaSpecies() || []) {
        g.strokeStyle = spCol(s.id); g.lineWidth = 1.8; g.beginPath(); let on = false;
        for (const r of mh) { const v = r[1] && r[1][s.id]; if (!v) { on = false; continue; } on ? g.lineTo(X(r[0]), Y(v[0])) : g.moveTo(X(r[0]), Y(v[0])); on = true; }
        g.stroke();
      }
    }
  }
  // stress change after a lunge: target vs neighbours (or witnesses, older server)
  c = ctx2('olr');
  if (c) {
    const [g, w, h] = c, L = 40, B = h - 16, P = [lr.target || [], lr[nbKey] || []];
    let s0 = 0, s1 = 120; for (const pts of P) for (const p of pts) { s0 = min(s0, p[0]); s1 = max(s1, p[0]); }
    const X = (s) => L + (s - s0) / max(s1 - s0, 1) * (w - L - 10);
    let mx = 0.05; for (const pts of P) for (const p of pts) if (typeof p[1] === 'number') mx = max(mx, abs(p[1]));
    const Y = (v) => 6 + (mx - clamp(v, -mx, mx)) / (2 * mx) * (B - 6);
    g.strokeStyle = '#ffffff90'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(w, Y(0)); g.moveTo(X(0), 4); g.lineTo(X(0), B); g.stroke();
    txt(g, sg(mx, 2), L - 4, Y(mx), '#9fcbd5', 'right'); txt(g, '0', L - 4, Y(0), '#9fcbd5', 'right'); txt(g, sg(-mx, 2), L - 4, Y(-mx), '#9fcbd5', 'right');
    for (let s = Math.ceil(s0 / 30) * 30; s <= s1; s += 30) txt(g, `${s}`, X(s), h - 5, '#9fcbd5', 'center');
    let any = false;
    P.forEach((pts, j) => {
      const col = j ? '#7ff3ff' : '#ff8a7a'; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.8; g.beginPath(); let on = false;
      for (const p of pts) { if (typeof p[1] !== 'number') { on = false; continue; } any = true; on ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); on = true; }
      g.stroke();
      for (const p of pts) { if (typeof p[1] !== 'number') continue; g.globalAlpha = fade(p[2]); g.beginPath(); g.arc(X(p[0]), Y(p[1]), 3.5, 0, TAU); g.fill(); g.globalAlpha = 1; }
    });
    if (!any) txt(g, t.few, L + 8, h / 2, '#9fcbd5');
  }
}

// ---- Show: heroes and chronicle
function obsHall(m, t) {
  const hl = m.hall || {}, day = (helloMsg && helloMsg.day_s) || 1200;
  const stamp = (s) => { const d = (s || 0) / day, mins = floor((d - floor(d)) * 1440); return `${TL().day} ${floor(d) + 1} · ${String(floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; };
  const living = new Set(); const s = nowa.state; if (s) for (let i = 0; i < s.n; i++) living.add(s.id[i]);
  const card = (k, r, all) => {
    if (!r) return '';
    const alive = living.has(r.id), v = k === 'lived_days' ? (+r.value).toFixed(1) : round(+r.value);
    return `<button class="ocard${alive ? '' : ' dead'}" data-hid="${esc(r.id)}" data-alive="${alive ? 1 : 0}" title="${esc(alive ? t.follow : t.lin)}">` +
      `<small>${esc(t.rec[k])}</small><span class=ov><b>${esc(v)}</b> <small>${esc(t.unit[k])}</small></span><span><i class=chip style="background:${spCol(r.species)}"></i> ${esc(spName(r.species))} #${esc(r.id)} · ${esc(t.gen)} ${esc(r.gen)}${all && r.t !== undefined ? ` · ${esc(stamp(r.t))}` : ''}${alive ? '' : ' ✝'}</span></button>`;
  };
  const keys = ['lived_days', 'children', 'catches', 'dodged', 'generation'];
  const IC = { extinct: '☠', repopulate: '↺', generation: '★', record: '🏆', escape: '💨' };
  const ch = (m.chronicle || []).slice().reverse().map((e) => `<div class="ochr k-${esc(e.kind)}"><span class=ocap>${esc(stamp(e.t))}</span> ${IC[e.kind] || '•'} ${esc((e.text && (e.text[LANG] || e.text.en)) || '')}</div>`).join('');
  IS.el.b.innerHTML = sec(t.hlT, '', `<div class=ocards>${keys.map((k) => card(k, (hl.living || {})[k], false)).join('')}</div>`) +
    sec(t.haT, '', `<div class=ocards>${keys.map((k) => card(k, (hl.all_time || {})[k], true)).join('')}</div><div class=olin></div>`) +
    sec(t.chT, '', `<div class=ochl>${ch || `<div class=ocap>${esc(t.few)}</div>`}</div>`);
  if (IS.linM && IS.linM.id === IS.linId) obsLineage(IS.linM);
}
function obsLineage(m) {
  IS.linM = m;
  const box = IS.on && IS.tab === T_HALL && IS.el.b ? IS.el.b.querySelector('.olin') : null; if (!box) return;
  box.innerHTML = `<h4>${esc(fmt(ITL().linT, { id: m.id }))} <button class=lx title="${esc(ITL().close)}">✕</button></h4>${famHtml(m)}`;
}
