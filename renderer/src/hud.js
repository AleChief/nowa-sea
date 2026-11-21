// ============================================================================
// HUD: top bar (clock, speed, camera, tools), population, inspector with vision cone, saves and settings, events,
// event sounds. RU / EN throughout. DOM is touched only on server messages (stats 1 Hz, inspect 4 Hz, replies) and on
// clicks; the one per-frame part, hudFrame(), draws the vision cone on a 2D canvas without allocating.
// ============================================================================
const HT = {
  ru: {
    day: 'День', pause: 'Пауза', turbo: 'Турбо', ach: 'факт', cam: ['Снаружи', 'Внутри', 'Следить', '🎬 Режиссёр'],
    feed: 'Корм', spawn: 'Подселить', random: 'Случайно', saves: 'Сохранения', keys: 'Клавиши', snd: 'Звук', vol: 'Громкость',
    feedHint: 'Щёлкните в воду — бросить корм (Esc — выход)', spawnHint: 'Щёлкните, где появиться: {sp} (Esc — отмена)', miss: 'Щёлкните по воде в баке',
    pop: 'Население', share: 'доля от потолка', strip: 'внизу: планктон (зелёный) и питательные вещества (жёлтый); метки — вымирания и возвращения', births: 'рождений', deaths: 'смертей', gen: 'пок.', extinct: 'вымер', back: 'вернётся через',
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
    learn: 'Обучение', menu: 'Меню', simErr: 'Ошибка симуляции: {e}', resumed: 'Продолжен мир из сохранения «{slot}»',
    lrnT: 'Обучение по поколениям', lGen: 'пок.', lN: 'n', lAge: 'жизнь, сут', lRew: 'награда', lCatch: 'поимки', lEsc: 'уход от угроз', lAlive: 'живы', lEvade: 'выбор: спасаться', lFeed: 'выбор: есть', lHunt: 'выбор: охотиться',
    told: 'Мозг видит', senses: 'Ощущения', pl: 'обучается', fz: 'контроль: без обучения', fzTip: 'замороженная каста: тот же мозг, гены и побуждения, но без награды и закрепления во сне', ctl: 'контроль', lost: 'незакреплено до сна', bKind: { nowa: 'NOWA', reflex: 'рефлекс (контроль)', random: 'случайный (контроль)', stub: 'заглушка' },
    lFew: 'Пока одно поколение: потомкам нужно время (сутки — 20 сим. мин).',
    lTip: 'погибло {dead}, живы {alive}, съедены {eaten}, решений {dec}',
    lCap: 'Строка — поколение (0 — основатели); потомки наследуют геном и эпигеном и учатся сами, закрепляя опыт во сне. <b>Качество выбора</b> (первые столбцы, самый чувствительный признак обучения) — доля решений, подходящих к ситуации: <b>спасаться</b> — хищник рядом → бегство, укрытие или зарывание; <b>есть</b> — голоден и видит корм или добычу → кормление или охота; <b>охотиться</b> — добыча рядом и силы есть → бросок, погоня или подкрадывание. Для масштаба: мозг <code>reflex</code> (жёсткие правила, без обучения) даёт ≈100 %, <code>random</code> ≈30 %; обучение — это рост от поколения к поколению. Исходы, где много случая: <b>жизнь</b> (средний возраст гибели, сутки), <b>награда</b> (средняя награда NOWA за решение, −1…1), <b>уход от угроз</b> (доля переживших встречу с хищником), <b>поимки</b> (доля удачных бросков). <b>n</b> — живые + погибшие; бледные строки (n < 3) слишком малы для выводов. Без сглаживания; линия в заголовке — те же числа.',
    famUp: ['родители', 'деды', 'прадеды', 'прапрадеды'], famDown: ['дети', 'внуки', 'правнуки'], famMe: 'он сам', famNo: 'родословная пока пуста',
    famMore: 'ещё {n}', famTip: '{sp} #{id} · пок. {gen} · род. {born}', famDied: 'погиб: {c}', famAlive: 'жив — щёлкните, чтобы следить',
    cause: { eaten: 'съеден', starvation: 'голод', old_age: 'старость', removed: 'убран' },
    genome: 'Геном', gHead: 'наследуемых генов: {n} · паттернов эпигенома: {e}', gNo: 'Геном есть только у видов с мозгом NOWA.',
    gTip: '{d}\n{k} = {v} (диапазон {a}…{b}, по умолчанию {c})',
  },
  en: {
    day: 'Day', pause: 'Pause', turbo: 'Turbo', ach: 'actual', cam: ['Outside', 'Inside', 'Follow', '🎬 Director'],
    feed: 'Feed', spawn: 'Spawn', random: 'Random', saves: 'Saves', keys: 'Keys', snd: 'Sound', vol: 'Volume',
    feedHint: 'Click into the water to drop food (Esc to stop)', spawnHint: 'Click where it should appear: {sp} (Esc to cancel)', miss: 'Click on the water in the tank',
    pop: 'Population', share: 'share of cap', strip: 'below: plankton (green) and nutrients (amber); ticks mark extinctions and returns', births: 'births', deaths: 'deaths', gen: 'gen', extinct: 'extinct', back: 'back in',
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
    learn: 'Learning', menu: 'Menu', simErr: 'Simulation error: {e}', resumed: 'Continuing the world from save “{slot}”',
    lrnT: 'Learning across generations', lGen: 'gen', lN: 'n', lAge: 'lifespan, d', lRew: 'reward', lCatch: 'catch', lEsc: 'escape', lAlive: 'alive', lEvade: 'choice: evade', lFeed: 'choice: feed', lHunt: 'choice: hunt',
    told: 'Brain is told', senses: 'Senses', pl: 'learning', fz: 'control: no learning', fzTip: 'frozen caste: the same brain, genes and drives, but no reward and no consolidation in sleep', ctl: 'control', lost: 'lost before sleep', bKind: { nowa: 'NOWA', reflex: 'reflex (control)', random: 'random (control)', stub: 'stub' },
    lFew: 'Only one generation so far: offspring take time (a day is 20 sim min).',
    lTip: 'dead {dead}, alive {alive}, eaten {eaten}, decisions {dec}',
    lCap: 'Rows are generations (0 = founders); offspring inherit genome and epigenome and learn on their own, consolidating in sleep. <b>Choice quality</b> (the first columns, the most sensitive learning signal) is the share of decisions that fitted the situation: <b>evade</b>, a predator near → flee, hide or burrow; <b>feed</b>, hungry with food or prey in sight → feed or hunt; <b>hunt</b>, prey near and strength left → strike, chase or stalk. For scale: the <code>reflex</code> brain (fixed rules, no learning) scores ≈100 %, <code>random</code> ≈30 %; learning shows as a rise over generations. Outcomes, where luck weighs a lot: <b>lifespan</b> (mean age at death, days), <b>reward</b> (mean NOWA reward per decision, −1…1), <b>escape</b> (encounters with a hunter survived), <b>catch</b> (lunges that caught prey). <b>n</b>: alive + dead; faded rows (n < 3) are too few to judge. No smoothing; the header lines plot the same numbers.',
    famUp: ['parents', 'grandparents', 'great-grandparents', 'great-great-gp.'], famDown: ['children', 'grandchildren', 'great-grandchildren'], famMe: 'itself', famNo: 'no family records yet',
    famMore: '{n} more', famTip: '{sp} #{id} · gen {gen} · born {born}', famDied: 'died: {c}', famAlive: 'alive: click to follow',
    cause: { eaten: 'eaten', starvation: 'starvation', old_age: 'old age', removed: 'removed' },
    genome: 'Genome', gHead: '{n} inheritable genes · epigenome: {e} patterns', gNo: 'Only species with a NOWA brain have a genome.',
    gTip: '{d}\n{k} = {v} (range {a}…{b}, default {c})',
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
// NOWA genome: modules and gene descriptions (the server sends them in English)
const MOD_RU = { neuromodulators: 'Нейромодуляторы', affective_space: 'Аффективное пространство', wakefulness: 'Бодрствование', autonomous: 'Побуждения',
  swarm: 'Стая', value_layer: 'Ценность и награда', hippocampus: 'Гиппокамп', sleep: 'Сон', imagination: 'Воображение', mortality: 'Смертность' };
const MOD_EN = { neuromodulators: 'Neuromodulators', affective_space: 'Affective space', wakefulness: 'Wakefulness', autonomous: 'Drives', swarm: 'Swarm',
  value_layer: 'Value and reward', hippocampus: 'Hippocampus', sleep: 'Sleep', imagination: 'Imagination', mortality: 'Mortality' };
const GENE_RU = { nm_da_ne_weight: 'торможение NE дофамином', nm_ne_da_weight: 'возбуждение DA норадреналином', nm_da_ach_weight: 'торможение ACh дофамином',
  nm_ach_da_weight: 'торможение DA ацетилхолином', nm_acc_k_ne: 'чувствительность ППК к NE', nm_acc_k_cort: 'чувствительность ППК к кортизолу',
  nm_acc_k_ht: 'торможение ППК серотонином', nm_decay_half_life: 'полураспад нейромодуляторов, с', af_decay_valence: 'инерция настроения',
  af_decay_arousal: 'скорость успокоения', af_decay_dominance: 'устойчивость доминантности', af_decay_stress: 'скорость снятия стресса',
  af_decay_curiosity: 'угасание любопытства', af_decay_trust: 'инерция доверия', af_decay_attachment: 'инерция привязанности',
  af_lambda_reg: 'сила возврата к норме', af_baseline_adapt_rate: 'скорость аллостаза, 1/с', wk_circadian_amplitude: 'амплитуда суточного ритма',
  wk_circadian_phase: 'сдвиг хронотипа', wk_accumulation_factor: 'накопление усталости', wk_recovery_factor: 'восстановление',
  dr_curiosity_baseline: 'базовое любопытство', dr_social_drive_baseline: 'базовая тяга к обществу', dr_exploration_baseline: 'базовая тяга к исследованию',
  dr_energy_recovery_rate: 'восстановление энергии', dr_cognitive_cost: 'энергозатраты мышления', dr_curiosity_threshold: 'порог любопытства',
  dr_social_threshold: 'порог общения', dr_perception_radius_factor: 'радиус восприятия в стае, множитель', lr_gamma: 'дисконт будущей награды',
  lr_alpha_online: 'скорость онлайн-обучения', lr_tonic_slow_rate: 'инерция тонического дофамина', lr_similarity_threshold: 'порог активации памяти',
  lr_consolidation_threshold: 'порог консолидации', im_goal_bias: 'целенаправленность воображения', im_confidence_decay: 'падение уверенности с глубиной',
  im_novelty_weight: 'вес новизны', im_value_blend: 'смесь памяти и воображения', lt_max_lifespan_factor: 'предельный срок жизни, множитель' };
const CAUSE_IC = { eaten: '🦷', starvation: '🍂', old_age: '⌛', removed: '✖' };
const MODE_RU = { habitual: 'привычка', deliberative: 'обдумывание', deliberate: 'обдумывание', exploratory: 'исследование', reflex: 'рефлекс', stub: 'заглушка' };
const SPEEDS = [0, 1, 2, 5, 10, 'turbo'];
const HS = { el: {}, stats: null, ins: null, vision: false, tool: '', toolSp: '', saves: [], turbo: false, spdSet: 1, logN: 0, sndT: 0, bst: new Map(),
  linId: 0, linT: 0, gKey: '', gOpen: new Set() };
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
    '<div id=hlog></div><div id=htoast></div><div id=hhint></div><div id=hturbo></div><div id=hlrn class=hpan></div><div id=hobs class=hpan></div><div id=hcap></div><div id=herr></div><div id=hmod><div class="box hpan"></div></div>';
  for (const id of ['hov', 'hbar', 'hpop', 'hins', 'hlog', 'htoast', 'hhint', 'hturbo', 'hmod', 'hlrn', 'hobs', 'hcap', 'herr']) HS.el[id] = document.getElementById(id);
  HS.ov = HS.el.hov.getContext('2d');
  try { if (localStorage['nowasea.popmin'] === '1') HS.el.hpop.classList.add('min'); if (localStorage['nowasea.keys'] === '0') $('k').classList.add('khide'); } catch {}
  const fit = () => { const d = devicePixelRatio || 1; HS.el.hov.width = max(1, round(innerWidth * d)); HS.el.hov.height = max(1, round(innerHeight * d)); HS.ovW = innerWidth; HS.ovH = innerHeight; HS.ov.setTransform(d, 0, 0, d, 0, 0); };
  addEventListener('resize', fit); fit();
  nowa.onJson(onMsg);
  nowa.onState(onFrame);
  nowa.debug.captureHud = captureHud;
  addEventListener('keydown', (e) => { if (e.code === 'Escape') { if (HS.tool) setTool(''); else if (HS.el.hmod.classList.contains('show')) HS.el.hmod.classList.remove('show'); } });
  hudLang();
}
// (re)builds every static text for the current language
function hudLang() {
  if (!HS.el.hbar) return;
  const t = TL();
  const spOpts = (nowaSpecies() || []).map((s) => `<option value="${esc(s.id)}"${s.id === HS.toolSp ? ' selected' : ''}>${esc(spName(s.id))}</option>`).join('');
  HS.el.hbar.innerHTML = `<span id=hclk><i>☀</i><span></span></span>` +
    `<span class=g id=hspd>${SPEEDS.map((v) => `<button data-v="${v}">${v === 0 ? `⏸<span class=lbl> ${t.pause}</span>` : v === 'turbo' ? `⏩<span class=lbl> ${t.turbo}</span>` : v + '×'}</button>`).join('')}<span id=hach></span></span>` +
    `<button id=hmenu title="${t.menu}">☰</button>` +
    `<span class="g opt" id=hcam>${t.cam.map((n, i) => `<button data-m="${i}">${n}</button>`).join('')}</span>` +
    `<span class="g opt"><button id=hfeed>🍤 ${t.feed}</button><select id=hsp>${spOpts}</select><button id=hspawn>✚ ${t.spawn}</button><button id=hrnd title="${t.random}">🎲</button></span>` +
    `<span class="g opt"><button id=hlrnb>📈 ${t.learn}</button><button id=hobsb>🔭 ${ITL().title}</button><button id=hsav>💾 ${t.saves}</button><button id=hsnd title="${t.snd} (M)">🔊</button><input id=hvol type=range min=0 max=100 value=${round(uVol * 100)} title="${t.vol}"><button id=hkeys title="${t.keys}">?</button><button id=hlang>${LANG === 'ru' ? 'EN' : 'RU'}</button></span>`;
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
  q('#hlrnb').onclick = () => toggleLearn();
  q('#hobsb').onclick = () => toggleObs();
  q('#hmenu').onclick = () => HS.el.hbar.classList.toggle('open');
  // the first click turns the sound on (it may have been remembered as muted); later ones toggle it
  q('#hsnd').onclick = () => { const had = !!AC; sound(); if (had || muted) mute(); markSound(); };
  q('#hvol').oninput = (e) => { sound(); setVol(e.target.value / 100); };
  q('#hkeys').onclick = () => { const k = $('k'), hide = !k.classList.contains('khide') && (k.classList.contains('kshow') || innerWidth > 900); k.classList.toggle('khide', hide); k.classList.toggle('kshow', !hide); keep('nowasea.keys', hide ? '0' : '1'); };
  q('#hlang').onclick = () => setLang(LANG === 'ru' ? 'en' : 'ru');
  markSpeed(); markSound(); hudMode(); setTool(HS.tool);
  buildPop(); if (HS.stats) onStats(HS.stats);
  buildIns(); if (HS.ins) onInspect(HS.ins);
  buildLearn(); toggleLearn(!!HS.lrn); buildObs(); buildMini();
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
    case 'lineage': renderFam(m); break;
    case 'insights': onInsights(m); break;
    case 'heatmap': onHeat(m); break;
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
      if (d < 20) { HS.sndT = now; sfxAt('burst', 1, s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]); }
    }
    if (f !== was) HS.bst.set(id, f);
  }
}
function onStats(m) {
  HS.stats = m;
  if (followId && camMode !== 2 && snN && trackOf(followId) < 0) select(0); // the selected creature is gone
  markSound();
  const er = m.error ? fmt(TL().simErr, { e: m.error }) : '';
  if (HS.el.herr.textContent !== er) { HS.el.herr.textContent = er; HS.el.herr.style.display = er ? 'block' : 'none'; }
  if (m.resumed_from && m.resumed_from !== HS.resumed) { HS.resumed = m.resumed_from; toast(fmt(TL().resumed, { slot: m.resumed_from })); }
  renderLearn(m);
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
  const bk = m.settings && m.settings.brain, cs = m.settings && m.settings.control_share;
  const bkn = (bk ? `${t.bKind[bk] || bk} · ` : '') + (typeof cs === 'number' && cs > 0 ? `${t.ctl} ${round(cs * 100)} % · ` : '');
  HS.el.foot.textContent = `${t.births} ${m.births || 0} · ${t.deaths} ${deaths}\n${t.brains}: ${bkn}${b.workers ?? '–'} ${t.proc} · ${b.brains ?? 0} · p95 ${(+(b.p95_ms || 0)).toFixed(1)} ${t.ms} · ${t.lag} ${b.lag_waits ?? 0}` +
    (m.particles !== undefined ? `\n${t.food} ${m.particles} · ${t.plank} ${m.plankton}` : '');
  drawChart(m.history || []);
  if (m.settings) renderSettings(m.settings, true);
}
const clock = (s) => { s = max(0, round(s || 0)); return `${floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- population panel
function buildPop() {
  const t = TL(), p = HS.el.hpop;
  p.innerHTML = `<h3>${t.pop}<span>${p.classList.contains('min') ? '▸' : '▾'}</span></h3><div class=body><div class=rows></div><canvas width=480 height=184></canvas><div class=foot style="white-space:pre-line"></div></div>`;
  p.querySelector('h3').onclick = () => { const mn = p.classList.toggle('min'); keep('nowasea.popmin', mn ? '1' : '0'); p.querySelector('h3 span').textContent = mn ? '▸' : '▾'; };
  const rows = p.querySelector('.rows'); HS.el.rows = {};
  for (const s of nowaSpecies() || []) {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = `<i class=chip style="background:${rgb(s.color)};box-shadow:0 0 0 2px ${rgb(s.glow, 0.8)}"></i><span>${esc(spName(s.id))}</span><span class=cnt></span><span class=gen></span><span class=ext style="display:none"></span>`;
    rows.appendChild(d);
    HS.el.rows[s.id] = { cnt: d.querySelector('.cnt'), gen: d.querySelector('.gen'), ext: d.querySelector('.ext') };
  }
  HS.el.chart = p.querySelector('canvas'); HS.el.foot = p.querySelector('.foot');
  HS.el.chart.title = `${t.share}; ${t.strip}`;
}
// lines of count / cap per species over the history the server keeps
// below them, on the same time axis, a strip with the plankton mean (green) and the nutrient pool (amber, 0..2);
// extinctions (orange) and repopulations (violet) from the insights chronicle as ticks
function drawChart(hist) {
  const c = HS.el.chart; if (!c || HS.el.hpop.classList.contains('min')) return;
  const g = c.getContext('2d'), w = c.width, H = c.height, h = 140, sp = nowaSpecies() || [];
  g.clearRect(0, 0, w, H);
  g.strokeStyle = '#ffffff22'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 8.5); g.lineTo(w, 8.5); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.moveTo(0, H - 0.5); g.lineTo(w, H - 0.5); g.stroke();
  if (hist.length < 2) return;
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0], span = max(t1 - t0, 1e-6), X = (tt) => (tt - t0) / span * (w - 2) + 1;
  g.lineWidth = 2.5;
  sp.forEach((s, k) => {
    const cap = capOf(s);
    g.strokeStyle = rgb(s.glow, 0.95); g.beginPath();
    hist.forEach((e, i) => { const x = X(e[0]), y = h - 2 - min(1.05, (e[1][k] || 0) / cap) * (h - 12); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  });
  const sy0 = h + 6, sh = H - sy0 - 3;
  for (const [j, col, top] of [[2, '#9fe9a8', 1], [3, '#ffc46b', 2]]) {
    g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath(); let on = false;
    for (const e of hist) { const v = e[j]; if (typeof v !== 'number') { on = false; continue; } const x = X(e[0]), y = sy0 + sh - min(1, v / top) * sh; on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; }
    g.stroke();
  }
  const ch = IS.m && IS.m.chronicle;
  if (ch) for (const e of ch) {
    if ((e.kind !== 'extinct' && e.kind !== 'repopulate') || e.t < t0 || e.t > t1) continue;
    const x = round(X(e.t)) + 0.5; g.strokeStyle = e.kind === 'extinct' ? '#ffb36b' : '#c9a7ff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 14); g.moveTo(x, h - 10); g.lineTo(x, h); g.stroke();
  }
}

// ---------------------------------------------------------------- inspector
function buildIns() {
  const t = TL(), p = HS.el.hins;
  p.innerHTML = `<h3><span class=nm></span><button class=x title="${t.close}">✕</button></h3><div class=sub></div>` +
    `<div class=kv><span>${t.energy}</span><div class=bar><i class=en></i></div><span>${t.stamina}</span><div class=bar><i class=st></i></div>` +
    `<span>${t.intent}</span><b class=it></b><span>${t.mode}</span><span class=md></span></div><div class=tags></div>` +
    `<div class=sec>${t.told}</div><div class="toks told"></div><div class=sec>${t.senses}</div><div class="toks sns"></div>` +
    `<div class=brain><div class=sec>${t.affect}</div><div class="kv af"></div><div class=sec>${t.neuro}</div><div class="kv nm2"></div><div class=lost></div></div><div class=bno></div>` +
    `<div class=sec>${t.family}</div><div class=fam></div><div class=ftree></div><div class=sec>${t.genes}</div><div class=gn></div><div class=dc style="margin-top:.35em;color:#9fcbd5"></div>` +
    `<div class=sec>${t.genome}</div><div class=gsub></div><div class=gmods></div>` +
    `<label style="display:block;margin-top:.5em;cursor:pointer"><input type=checkbox class=vis${HS.vision ? ' checked' : ''}> ${t.showVision}</label>`;
  const q = (s) => p.querySelector(s);
  HS.el.ins = { nm: q('.nm'), sub: q('.sub'), en: q('.en'), st: q('.st'), it: q('.it'), md: q('.md'), tags: q('.tags'), toks: q('.told'), sns: q('.sns'), brain: q('.brain'),
    af: q('.af'), nm2: q('.nm2'), lost: q('.lost'), bno: q('.bno'), fam: q('.fam'), ftree: q('.ftree'), gn: q('.gn'), dc: q('.dc'), gsub: q('.gsub'), gmods: q('.gmods') };
  q('.x').onclick = () => select(0);
  // a living relative: follow it
  HS.el.ins.ftree.onclick = (ev) => { const b = ev.target.closest('.fn'); if (b && !b.classList.contains('dead') && +b.dataset.id !== followId) select(+b.dataset.id); };
  HS.el.ins.gmods.addEventListener('toggle', (ev) => { const d = ev.target; if (d.dataset && d.dataset.m) { if (d.open) HS.gOpen.add(d.dataset.m); else HS.gOpen.delete(d.dataset.m); } }, true);
  HS.gKey = ''; HS.linId = 0;
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
  e.tags.innerHTML = (m.caste === 'frozen' ? `<span class=fz title="${esc(t.fzTip)}">${t.fz}</span>` : m.caste === 'plastic' ? `<span class=pl>${t.pl}</span>` : '') +
    (m.sleeping ? `<span class=w>${t.sleeping}</span>` : '') + (m.in_cover ? `<span>${t.cover}</span>` : '');
  // the few salient tokens the brain receives, then everything the body perceives
  e.toks.innerHTML = (m.tokens || []).map((k) => `<span>${esc(tokName(k))}</span>`).join('') || t.none;
  e.sns.innerHTML = (m.senses || m.tokens || []).map((k) => `<span>${esc(tokName(k))}</span>`).join('') || t.none;
  const br = m.brain;
  const hasB = br && !br.sleeping && (Object.keys(br.affect || {}).length || Object.keys(br.neuromodulators || {}).length);
  e.brain.style.display = hasB ? '' : 'none';
  e.bno.style.display = hasB ? 'none' : '';
  e.bno.textContent = br && br.sleeping ? t.brainSleep : spOf(m.species) && spOf(m.species).brain === 'nowa' ? (br ? t.brainStub : '') : t.brainNo;
  if (hasB) {
    e.af.innerHTML = bars(br.affect || {}, AXIS_RU, true); e.nm2.innerHTML = bars(br.neuromodulators || {}, NM_RU, false);
    const lu = br.lost_unconsolidated;
    e.lost.textContent = typeof lu === 'number' ? `${t.lost}: ${lu}` : '';
  }
  const par = (m.parents || []).filter((x) => x);
  e.fam.textContent = `${t.parents}: ${par.length ? par.map((x) => '#' + x).join(', ') : t.none} · ${t.children}: ${m.children ?? 0}`;
  const g = m.body || {};
  e.gn.textContent = `${t.speed} ${(+g.speed || 0).toFixed(2)} · ${t.vision} ${(+g.vision || 0).toFixed(2)} · ${t.metab} ${(+g.metabolism || 0).toFixed(2)}`;
  e.dc.textContent = `${t.decisions} ${(br && br.decisions) ?? m.decisions ?? 0}` + (br && br.episodes !== undefined ? ` · ${t.episodes} ${br.episodes} · ${t.sleeps} ${br.sleeps}` : '');
  // the family tree: asked for when the selection changes and every 8 s while it stays (new children)
  const now = performance.now();
  if (m.id !== HS.linId || now - HS.linT > 8000) {
    if (m.id !== HS.linId) e.ftree.innerHTML = '';
    HS.linId = m.id; HS.linT = now; send({ t: 'lineage', id: m.id, up: 4, down: 3 });
  }
  renderGenome(m);
}
// the genome does not change during a life: drawn once per creature (and language)
function renderGenome(m) {
  const t = TL(), e = HS.el.ins, reg = (helloMsg && helloMsg.genes) || [], gg = m.genome && m.genome.genes;
  const key = `${m.id}:${LANG}:${gg ? 1 : 0}:${m.epigenome_size ?? ''}`;
  if (key === HS.gKey) return;
  HS.gKey = key;
  if (!reg.length || !gg) { e.gsub.textContent = t.gNo; e.gmods.innerHTML = ''; return; }
  e.gsub.textContent = fmt(t.gHead, { n: reg.length, e: m.epigenome_size ?? 0 });
  const mods = new Map();
  for (const d of reg) { if (!mods.has(d.module)) mods.set(d.module, []); mods.get(d.module).push(d); }
  const MN = LANG === 'ru' ? MOD_RU : MOD_EN, f3 = (x) => (Math.abs(x) >= 10 ? (+x).toFixed(1) : (+x).toFixed(3));
  let h = '';
  for (const [mod, ds] of mods) {
    h += `<details data-m="${esc(mod)}"${HS.gOpen.has(mod) ? ' open' : ''}><summary>${esc(MN[mod] || mod)} <small>${ds.length}</small></summary><div class=gk>`;
    for (const d of ds) {
      const v = gg[d.key], has = v !== undefined && v !== null, span = d.max - d.min || 1;
      const x = has ? clamp((v - d.min) / span, 0, 1) : 0, x0 = clamp((d.default - d.min) / span, 0, 1);
      const lab = LANG === 'ru' ? GENE_RU[d.key] || d.description : d.description;
      const tip = fmt(t.gTip, { d: lab, k: d.key, v: has ? f3(v) : '—', a: f3(d.min), b: f3(d.max), c: f3(d.default) });
      h += `<span title="${esc(tip)}">${esc(lab)}</span><div class="bar g" title="${esc(tip)}"><i style="width:${(x * 100).toFixed(1)}%"></i><b style="left:${(x0 * 100).toFixed(1)}%"></b></div>`;
    }
    h += '</div></details>';
  }
  e.gmods.innerHTML = h;
}
// ancestors above (up to 4 generations), the creature, descendants below (3): living ones in their species colour
// (click to follow), the dead greyed with what killed them
function renderFam(m) {
  const e = HS.el.ins;
  if (e && m.id === followId) e.ftree.innerHTML = famHtml(m);
  if (m.id === IS.linId) obsLineage(m);
}
function famHtml(m) {
  const t = TL(), by = new Map();
  for (const n of m.nodes || []) by.set(n.id, n);
  if (!by.has(m.id)) return `<div class=fno>${t.famNo}</div>`;
  const lv = new Map([[m.id, 0]]);
  for (const [dir, key, nmax] of [[-1, 'parents', 4], [1, 'children', 3]]) {
    let fr = [m.id];
    for (let k = 1; k <= nmax && fr.length; k++) {
      const nx = [];
      for (const i of fr) for (const j of by.get(i)[key] || []) if (by.has(j) && !lv.has(j)) { lv.set(j, dir * k); nx.push(j); }
      fr = nx;
    }
  }
  const rows = new Map();
  for (const [id, k] of lv) { if (!rows.has(k)) rows.set(k, []); rows.get(k).push(by.get(id)); }
  const day = (s) => `${TL().day} ${floor((s || 0) / ((helloMsg && helloMsg.day_s) || 1200)) + 1}`;
  let h = '';
  for (let k = -4; k <= 3; k++) {
    const r = rows.get(k); if (!r) continue;
    r.sort((a, b) => (b.alive - a.alive) || (a.id - b.id));
    const lab = k < 0 ? t.famUp[-k - 1] : k > 0 ? t.famDown[k - 1] : t.famMe;
    h += `<div class=fr><span class=fl>${esc(lab)}</span><span class=fc>`;
    for (let i = 0; i < r.length && i < 14; i++) {
      const n = r[i], sp = spOf(n.species), col = sp ? rgb(sp.glow || sp.color || [1, 1, 1], 1) : '#fff';
      const tip = fmt(t.famTip, { sp: spName(n.species), id: n.id, gen: n.gen, born: day(n.born) }) + '\n' +
        (n.alive ? t.famAlive : fmt(t.famDied, { c: (t.cause[n.cause] || n.cause || '?') + (n.died !== null && n.died !== undefined ? ', ' + day(n.died) : '') }));
      h += `<button class="fn${n.alive ? '' : ' dead'}${n.id === m.id ? ' me' : ''}" data-id="${esc(n.id)}" title="${esc(tip)}"><i style="background:${n.alive ? col : '#667'}"></i>#${esc(n.id)}${n.alive ? '' : `<em>${CAUSE_IC[n.cause] || '✝'}</em>`}</button>`;
    }
    if (r.length > 14) h += `<span class=fmore>${fmt(t.famMore, { n: r.length - 14 })}</span>`;
    h += '</span></div>';
  }
  return h;
}
// hide the inspector as soon as nothing is followed (checked on every inspect / stats and when selection changes)
function hudSel() { if (!followId && HS.el.hins) { HS.el.hins.classList.remove('show'); HS.ins = null; } }
// Esc belongs to the HUD while a tool or the dialog is open
const hudBusy = () => !!(HS.tool || (HS.el.hmod && HS.el.hmod.classList.contains('show')));

// ---------------------------------------------------------------- events: log + sounds
function onEvent(m) {
  const t = TL(); let txt = '', col = '#7ff3ff';
  if (m.kind === 'catch') { txt = `<b>${t.evCatch}</b>: ${esc(spName(m.species))} → ${esc(spName(m.prey))}`; col = '#ff8a7a'; if (m.pos) sfxAt('catch', 0.8, m.pos[0], m.pos[1], m.pos[2]); }
  else if (m.kind === 'birth') { txt = `<b>${t.evBirth}</b>: ${esc(spName(m.species))}${m.generation !== undefined ? ` (${t.gen} ${esc(m.generation)})` : ''}`; col = '#9fe9a8'; if (m.pos) sfxAt('birth', 0.7, m.pos[0], m.pos[1], m.pos[2]); }
  else if (m.kind === 'extinct') { txt = `<b>${t.evExtinct}</b>: ${esc(spName(m.species))}`; col = '#ffb36b'; }
  else if (m.kind === 'repopulate') { txt = `<b>${t.evRepop}</b>: ${esc(spName(m.species))} ×${esc(m.n ?? '')} (${m.mode === 'archive' ? t.archive : t.fresh})`; col = '#c9a7ff'; }
  else return;
  const d = document.createElement('div'); d.innerHTML = txt; d.style.borderLeft = `3px solid ${col}`;
  const log = HS.el.hlog; log.appendChild(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0'; }, 9000); setTimeout(() => d.remove(), 10000);
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
// a point in the water for a click at (sx, sy): from the room, where the ray crosses the layer y = -1, moved to the
// nearest point of that layer inside the tank; from inside, 3 m along the ray. null if the ray never comes down to it.
function waterPoint(sx, sy, w, h) {
  const nx = (sx / w) * 2 - 1, ny = 1 - (sy / h) * 2, ax = TANH * w / h;
  let dx = F[FX] + F[RX] * nx * ax + F[UX] * ny * TANH, dy = F[FY] + F[UY] * ny * TANH, dz = F[FZ] + F[RZ] * nx * ax + F[UZ] * ny * TANH;
  const l = hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const cx = F[DX], cy = F[DY], cz = F[DZ], m = 0.6;
  const inside = abs(cx) < tHx && abs(cz) < tHz && cy < 0 && cy > -tDep;
  let p;
  if (inside) p = [cx + dx * 3, cy + dy * 3, cz + dz * 3];
  else {
    if (dy < -1e-4 && cy > -1) { const tt = (-1 - cy) / dy; p = [cx + dx * tt, -1, cz + dz * tt]; }
    else {
      // looking up or level from below the layer: the point of the ray nearest the tank's centre line, lifted to it
      const tt = max(0, -(cx * dx + cz * dz) / max(dx * dx + dz * dz, 1e-9)); p = [cx + dx * tt, -1, cz + dz * tt];
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
  HS.el.mod = { st: q('.st'), ls: q('.ls'), re: q('.re'), dl: q('.dl'), fm: q('.fm'), as: q('.as'), st2: q('.st2'), wi: q('.wi'), dirty: new Set() };
  for (const k of ['re', 'dl', 'fm', 'as']) { const el = HS.el.mod[k]; el.addEventListener('input', () => HS.el.mod.dirty.add(el)); el.addEventListener('change', () => HS.el.mod.dirty.add(el)); }
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
  m.ls.innerHTML = HS.saves.map((s, i) => `<tr><td class=n>${esc(s.slot)}<div class=m>${esc((s.saved_at || '').replace('T', ' '))} · ${t.simDay} ${((+s.sim_time || 0) / ((helloMsg && helloMsg.day_s) || 1200) + 1).toFixed(1)} · ${esc(s.creatures ?? 0)} ${t.crt} · ${fsz(+s.size || 0)}</div></td>` +
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
  // the server's reply to Apply (not from stats) resets the form; the 1 Hz stats leave edited fields alone
  if (!fromStats) m.dirty.clear();
  const free = (el) => !m.dirty.has(el) && el !== act;
  if (free(m.re)) m.re.checked = !!rp.enabled;
  if (free(m.dl)) m.dl.value = rp.delay_s !== undefined ? +(rp.delay_s / 60).toFixed(2) : '';
  if (rp.mode && free(m.fm)) m.fm.value = rp.mode;
  if (free(m.as)) { const as = +s.autosave_s || 0; if (![...m.as.options].some((o) => +o.value === as)) m.as.add(new Option(`${(as / 60).toFixed(1)}`, as)); m.as.value = String(as); }
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
  const vis = HS.vision && followId && HS.ins && HS.ins.id === followId;
  if (!vis && !IS.heatOn) { if (HS.visOn) { HS.visOn = false; $('hud').classList.remove('vis'); } return; }
  if (!HS.visOn) { HS.visOn = true; $('hud').classList.add('vis'); }
  const t = vis ? trackOf(followId) : -1;
  ovDirty = true; drawMini(g, t);
  if (t < 0) return;
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

// ---------------------------------------------------------------- learning across generations (stats.learning)
function buildLearn() {
  const t = TL(), p = HS.el.hlrn;
  p.innerHTML = `<h3>${t.lrnT}<button class=x title="${t.close}">✕</button></h3><div class=tabs></div><div class=lt></div><div class=cap>${t.lCap}</div>`;
  p.querySelector('.x').onclick = () => toggleLearn(false);
  HS.el.ltabs = p.querySelector('.tabs'); HS.el.lt = p.querySelector('.lt');
  if (HS.stats) renderLearn(HS.stats);
}
function toggleLearn(on) {
  HS.lrn = on === undefined ? !HS.lrn : on;
  HS.el.hlrn.classList.toggle('show', HS.lrn);
  const b = HS.el.hbar.querySelector('#hlrnb'); if (b) b.classList.toggle('on', HS.lrn);
  if (HS.lrn && HS.stats) renderLearn(HS.stats);
}
const pct = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : `${round(v * 100)} %`);
function renderLearn(m) {
  if (!HS.lrn || !HS.el.lt) return;
  const t = TL(), L = m.learning || {}, ids = Object.keys(L);
  if (!ids.length) { HS.el.ltabs.innerHTML = ''; HS.el.lt.textContent = t.none; return; }
  if (!L[HS.lrnSp]) HS.lrnSp = ids.reduce((a, b) => (L[b].length > L[a].length ? b : a), ids[0]);
  HS.el.ltabs.innerHTML = ids.map((id) => { const s = spOf(id); return `<button data-s="${esc(id)}" class="${id === HS.lrnSp ? 'on' : ''}"><i class=chip style="background:${s ? rgb(s.color) : '#888'};box-shadow:0 0 0 2px ${s ? rgb(s.glow, 0.8) : '#aaa'}"></i> ${esc(spName(id))}</button>`; }).join('');
  HS.el.ltabs.querySelectorAll('button').forEach((b) => { b.onclick = () => { HS.lrnSp = b.dataset.s; renderLearn(HS.stats); }; });
  const rows = L[HS.lrnSp] || [], s = spOf(HS.lrnSp), si = s ? s.index : -1;
  // choice quality first (evade for prey, hunt for hunters, feed where measured), then the outcomes: lifespan and
  // reward for all, catch for hunters, escape for prey (a hunted hunter shows both); only the first ones get bars
  const has = (k) => rows.some((r) => r[k] !== null && r[k] !== undefined);
  const cols = [];
  if ((si < 0 || spPrey[si]) && has('evade')) cols.push(['evade', t.lEvade, 'rate', 1]);
  if (si >= 0 && spHunt[si] && has('hunt')) cols.push(['hunt', t.lHunt, 'rate', 1]);
  if (has('feed')) cols.push(['feed', t.lFeed, 'rate', 1]);
  cols.push(['age_days', t.lAge, 'abs'], ['reward', t.lRew, 'sym']);
  if (si >= 0 && spHunt[si]) cols.push(['catch', t.lCatch, 'rate']);
  if (si < 0 || spPrey[si]) cols.push(['escape', t.lEsc, 'rate']);
  const scale = cols.map(([k, , kind]) => { let mx = 0; for (const r of rows) if (r[k] !== null && r[k] !== undefined) mx = max(mx, abs(r[k])); return kind === 'rate' ? 1 : kind === 'sym' ? max(mx, 0.05) : max(mx, 0.01); });
  const cell = (r, c, i) => {
    const v = r[c[0]], kind = c[2];
    if (v === null || v === undefined) return `<td><span class=v>${c[0] === 'age_days' && r.alive ? t.lAlive : '—'}</span></td>`;
    const f = clamp(v / scale[i], -1, 1), bar = !c[3] ? '' : kind === 'sym' ? `<div class="b c"><i style="${f < 0 ? `left:${50 + f * 50}%;width:${-f * 50}%;background:#ff9b8a` : `left:50%;width:${f * 50}%`}"></i></div>` : `<div class=b><i style="left:0;width:${max(0, f) * 100}%"></i></div>`;
    const txt = kind === 'rate' ? pct(+v) : kind === 'sym' ? (v > 0 ? '+' : '') + (+v).toFixed(3) : (+v).toFixed(2);
    return `<td${c[3] ? ' class=pri' : ''}>${bar}<span class=v>${txt}</span></td>`;
  };
  if (rows.length <= 1) HS.el.lt.dataset.few = '1'; else delete HS.el.lt.dataset.few;
  HS.el.lt.innerHTML = `<table><thead><tr><th>${t.lGen}</th><th>${t.lN}</th>${cols.map((c) => `<th${c[3] ? ' class=pri' : ''}>${c[1]}<canvas width=128 height=36></canvas></th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => { const n = (r.dead || 0) + (r.alive || 0); return `<tr class="${n < 3 ? 'low' : ''}" title="${esc(fmt(t.lTip, { dead: r.dead, alive: r.alive, eaten: pct(r.eaten), dec: r.decisions }))}"><td>${esc(r.gen)}</td><td>${esc(n)}</td>${cols.map((c, i) => cell(r, c, i)).join('')}</tr>`; }).join('') +
    `</tbody></table>` + (rows.length <= 1 ? `<div class=few>${t.lFew}</div>` : '');
  // sparklines: the same values per generation, no smoothing; low-n points hollow
  HS.el.lt.querySelectorAll('th canvas').forEach((cv, i) => {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, k = cols[i][0], kind = cols[i][2], n = rows.length;
    g.clearRect(0, 0, w, h); if (n < 2) return;
    const lo = kind === 'sym' ? -scale[i] : 0, hi = scale[i], X = (j) => 4 + j * (w - 8) / (n - 1), Y = (v) => h - 4 - (v - lo) / (hi - lo || 1) * (h - 8);
    if (kind === 'sym') { g.strokeStyle = '#ffffff30'; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke(); }
    const lc = cols[i][3] ? '#9fe9a8' : '#7ff3ff';
    g.strokeStyle = lc; g.lineWidth = 2; g.beginPath(); let on = false;
    rows.forEach((r, j) => { const v = r[k]; if (v === null || v === undefined) { on = false; return; } on ? g.lineTo(X(j), Y(v)) : g.moveTo(X(j), Y(v)); on = true; });
    g.stroke();
    rows.forEach((r, j) => { const v = r[k]; if (v === null || v === undefined) return; const low = (r.dead || 0) + (r.alive || 0) < 3; g.beginPath(); g.arc(X(j), Y(v), 3, 0, TAU); if (low) { g.strokeStyle = lc; g.lineWidth = 1; g.stroke(); } else { g.fillStyle = lc; g.fill(); } });
  });
}
// director's caption (bottom centre); written only when it changes
function hudCaption(text) {
  const c = HS.el.hcap; if (!c || c.textContent === text) return;
  c.textContent = text; c.style.display = text ? 'block' : 'none';
}
// top-down map of the tank with the creatures and the selected one's field of view (drawn into the overlay canvas)
const MINI_W = 230;
let miniBg = null, miniH = 0;
const SPCOL = [];
function buildMini() {
  const tk = helloMsg && helloMsg.tank; if (!tk) return;
  SPCOL.length = 0; for (const s of nowaSpecies() || []) SPCOL[s.index] = rgb(s.glow, 1);
  miniH = round(MINI_W * tk.half_z / tk.half_x);
  const c = document.createElement('canvas'), d = devicePixelRatio || 1; c.width = MINI_W * d; c.height = miniH * d;
  const g = c.getContext('2d'); g.scale(d, d);
  const sx = MINI_W / (2 * tk.half_x), X = (x) => (x + tk.half_x) * sx, Z = (z) => (z + tk.half_z) * sx;
  g.fillStyle = 'rgba(3,19,28,0.82)'; g.fillRect(0, 0, MINI_W, miniH);
  g.fillStyle = 'rgba(60,140,80,0.35)'; for (const k of tk.kelp || []) { g.beginPath(); g.arc(X(k.c[0]), Z(k.c[1]), k.r * sx, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(170,185,190,0.38)';
  for (const p of tk.positives || []) {
    g.save();
    if (p.type === 'capsule') { g.lineCap = 'round'; g.lineWidth = 2 * p.r * sx; g.strokeStyle = g.fillStyle; g.beginPath(); g.moveTo(X(p.a[0]), Z(p.a[2])); g.lineTo(X(p.b[0]), Z(p.b[2])); g.stroke(); }
    else { g.translate(X(p.c[0]), Z(p.c[2])); g.rotate(-(p.yaw || 0)); const e = p.type === 'box' ? p.h : p.r; g.beginPath(); if (p.type === 'box') g.rect(-e[0] * sx, -e[2] * sx, 2 * e[0] * sx, 2 * e[2] * sx); else g.ellipse(0, 0, e[0] * sx, e[2] * sx, 0, 0, TAU); g.fill(); }
    g.restore();
  }
  g.strokeStyle = 'rgba(127,243,255,0.7)'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, MINI_W - 1.5, miniH - 1.5);
  miniBg = c;
}
function drawMini(g, t) {
  if (!miniBg) return;
  const x0 = HS.ovW - MINI_W - 10, y0 = HS.ovH - miniH - 10, sx = MINI_W / (2 * tHx);
  g.drawImage(miniBg, x0, y0, MINI_W, miniH);
  if (IS.heatOn) drawHeat(g, x0, y0, MINI_W, miniH, sx);
  for (let li = 0; li < tkN; li++) {
    const u = tkList[li]; if (!tkHas[u] || tkVis[u] < 0.3) continue;
    g.fillStyle = SPCOL[tkSp[u]] || '#fff'; g.fillRect(x0 + (tkP[u * 3] + tHx) * sx - 1.5, y0 + (tkP[u * 3 + 2] + tHz) * sx - 1.5, 3, 3);
  }
  // the selected creature's view: its vision radius and field of view, seen from above
  if (t >= 0) {
    const o = t * 3, cx = x0 + (tkP[o] + tHx) * sx, cy = y0 + (tkP[o + 2] + tHz) * sx, hd = atan2(tkF[o + 2], tkF[o]), R = (+HS.ins.vision || 0) * sx, half = min(+HS.ins.fov_deg || 0, 360) * PI / 360;
    g.save(); g.beginPath(); g.rect(x0, y0, MINI_W, miniH); g.clip();
    g.fillStyle = 'rgba(127,243,255,0.16)'; g.strokeStyle = 'rgba(127,243,255,0.8)'; g.lineWidth = 1.2;
    g.beginPath(); if (half < PI - 1e-3) g.moveTo(cx, cy); g.arc(cx, cy, R, hd - half, hd + half); if (half < PI - 1e-3) g.closePath(); g.fill(); g.stroke();
    const tg = HS.ins.target ? trackOf(HS.ins.target) : -1;
    if (tg >= 0) { g.strokeStyle = 'rgba(255,140,120,0.95)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(x0 + (tkP[tg * 3] + tHx) * sx, y0 + (tkP[tg * 3 + 2] + tHz) * sx); g.stroke(); }
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 3.5, 0, TAU); g.fill();
    g.restore();
  }
  // the camera: a small wedge pointing where it looks
  const kx = x0 + (clamp(F[DX], -tHx, tHx) + tHx) * sx, ky = y0 + (clamp(F[DZ], -tHz, tHz) + tHz) * sx, a = atan2(F[FZ], F[FX]);
  g.fillStyle = 'rgba(255,220,120,0.95)'; g.beginPath(); g.moveTo(kx + cos(a) * 8, ky + sin(a) * 8); g.lineTo(kx + cos(a + 2.5) * 5, ky + sin(a + 2.5) * 5); g.lineTo(kx + cos(a - 2.5) * 5, ky + sin(a - 2.5) * 5); g.fill();
}
// test helper: the frame plus the HUD (and the key legend) as one JPEG Blob of w x h, for documentation screenshots.
// The HTML is copied with its computed styles into an SVG foreignObject; canvases go in as images.
async function captureHud(w = 1600, h = 900, q = 0.88) {
  render(); hudFrame();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(canvas, 0, 0, w, h);
  const copy = (el) => {
    if (el.nodeType !== 1) return el.cloneNode(false);
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return document.createTextNode('');
    let cl;
    if (el.tagName === 'CANVAS') { cl = document.createElement('img'); cl.src = el.toDataURL(); } else cl = el.cloneNode(false);
    for (let i = 0; i < cs.length; i++) cl.style.setProperty(cs[i], cs.getPropertyValue(cs[i]));
    if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) cl.style.overflow = 'hidden'; // no scroll bars in the picture
    if (el.tagName === 'INPUT' && el.checked) cl.setAttribute('checked', '');
    if (el.tagName !== 'CANVAS') {
      // a scrolled panel keeps its scroll position: its content moves up inside the clipped clone
      const to = el.scrollTop > 0 ? cl.appendChild(document.createElement('div')) : cl;
      if (to !== cl) to.style.marginTop = `${-el.scrollTop}px`;
      for (const ch of el.childNodes) to.appendChild(copy(ch));
    }
    return cl;
  };
  const box = document.createElement('div');
  box.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  box.style.cssText = `position:relative;width:${innerWidth}px;height:${innerHeight}px;font:600 13px/1.4 system-ui,sans-serif`;
  box.appendChild(copy($('hud'))); box.appendChild(copy($('k')));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(box)}</foreignObject></svg>`;
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  g.drawImage(img, 0, 0, w, h);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
}
