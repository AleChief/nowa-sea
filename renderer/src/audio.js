// ============================================================================
// audio: procedural underwater ambience (no sample files)
// ============================================================================
// A fixed Web Audio graph, built on the first click / key / touch and driven by a 10 Hz timer, not the frame loop.
// Layers: rumble, surface wash, water rush (follows camera speed), drone, bubbles, chimes and distant whale calls.
// Event sounds (catch, birth, a burst near the camera) are one-shot voices placed by distance and side (sfx, sfxAt).
let AC, OUT, SFXG, muted = false, uVol = 0.8;
const VOL = 0.78; // master level at full volume: about -18.5 LUFS, peaks near -5.5 dBFS
const SKEY = 'nowasea.snd'; // "volume 0..1,muted 0|1"
try { const v = (localStorage[SKEY] || '').split(','); if (v[0] !== '' && isFinite(+v[0])) uVol = clamp(+v[0], 0, 1); muted = v[1] === '1'; } catch {}
const level = () => (muted ? 0 : VOL * uVol * uVol); // the slider is roughly perceptual
// offline: build the graph in an OfflineAudioContext (the level test); returns the 10 Hz tick
function mkSound(ac, offline) {
  const sr = ac.sampleRate;
  // node of class C with options o, connected to every node / param in `to`; sources start at once
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  // seamless brown noise loop (the end cross-fades into the start)
  const nb = noise(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  // reverb impulse: 5 s of noise that fades out and gets darker
  const ir = noise(5, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.5) * (1 - i / n); } });

  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  const sg = G(1, out);
  ac._wet = wet; ac._sfx = sg; ac._v = new Float64Array(6);
  if (!offline) { OUT = out; SFXG = sg; }
  const src = (playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // rumble
  const rum = G(0.34, out); src(1, BQ('lowpass', 150, 0.7, rum)); lfo(0.07, 0.11, rum.gain); lfo(0.113, 0.08, rum.gain);
  // surface wash + water rush: the same noise played at another speed, so the loops never line up
  const wash = G(0.25, out), wave = G(1, wash), rush = G(0, out), rushF = BQ('bandpass', 300, 0.9, rush);
  src(0.63, BQ('bandpass', 420, 0.5, wave), rushF); lfo(0.09, 0.3, wave.gain); lfo(0.151, 0.25, wave.gain);
  // drone: stacked fifths on D, each note a pair of slightly detuned sines that slowly beat
  const pad = G(1, out, G(1.5, wet));
  [73.42, 110, 164.81, 246.94, 369.99].forEach((f, i) => { const g = G(0.022 - i * 0.003, pad); N(OscillatorNode, { frequency: f }, g); N(OscillatorNode, { frequency: f + rr(0.03, 0.11) }, g); });
  // pooled voices: oscillator -> envelope -> pan -> dry + reverb
  const pool = (n, send, type) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, out, G(send, wet)), g = G(0, p); return { p, g, o: N(OscillatorNode, { type }, g) }; });
  const bub = pool(4, 0.12), chime = pool(3, 1.2), whale = pool(2, 2, 'triangle');
  // one note: pitch glides f0 -> f1 over dur, level rises to vol in att then dies away
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.7, 0.7), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 5);
  };
  const NOTES = [0, 2, 5, 7, 9, 12, 14, 17, 19]; // D major pentatonic, in semitones above A4
  let lt = ac.currentTime, tB = lt + 1.5, tC = lt + 5, tW = lt + 12, lx = F[CX], ly = F[CY], lz = F[CZ];
  out.gain.setTargetAtTime(offline ? VOL : level(), lt, 1);
  return () => {
    const now = ac.currentTime, t = now + 0.05, dt = now - lt;
    if (dt <= 0) return;
    let v = hypot(F[CX] - lx, F[CY] - ly, F[CZ] - lz) / dt; if (v > 60) v = 0; // ignore jumps to a viewpoint
    lt = now; lx = F[CX]; ly = F[CY]; lz = F[CZ];
    rush.gain.setTargetAtTime(0.5 * pow(min(v / 26, 1), 1.2), t, 0.3); rushF.frequency.setTargetAtTime(220 + v * 14, t, 0.3);
    const s = clamp(1 + ly / 30, 0, 1); wash.gain.setTargetAtTime(0.25 + 0.55 * s * s, t, 0.5);
    if (t > tB) { // a burst of 1-6 bubbles: short rising blips, smaller bubbles higher and shorter
      let tt = t;
      for (let n = 1 + rnd() * rnd() * 6 | 0; n--;) { const f = rr(380, 1300); play(bub, tt, f, f * rr(1.4, 2.2), 0.05 + 40 / f, rr(0.03, 0.08), 0.006); tt += rr(0.07, 0.2); }
      tB = tt + rr(0.5, 5);
    }
    if (t > tC) { const f = 440 * pow(2, NOTES[rnd() * 9 | 0] / 12); play(chime, t, f, f, 5, rr(0.02, 0.04), 0.03); tC = t + rr(2.5, 9); }
    if (t > tW) { // a phrase of 2-3 slow glides
      let tt = t;
      for (let n = 2 + rnd() * 2 | 0; n--;) { const f = rr(170, 380), d = rr(1.6, 3.2); play(whale, tt, f, f * rr(0.6, 1.7), d, 0.08, d * 0.4); tt += d * 0.8; }
      tW = tt + rr(20, 50);
    }
  };
}
// called on every click / key / touch: builds the graph once and resumes it when the browser allows
function sound() {
  if (!AC) { AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const keepSnd = () => keep(SKEY, `${uVol.toFixed(2)},${muted ? 1 : 0}`);
const mute = () => { muted = !muted; keepSnd(); if (OUT) OUT.gain.setTargetAtTime(level(), AC.currentTime, 0.08); markSound(); };
function setVol(v) { uVol = clamp(v, 0, 1); if (muted && uVol > 0) muted = false; keepSnd(); if (OUT) OUT.gain.setTargetAtTime(level(), AC.currentTime, 0.05); markSound(); }

// one event sound at time t (default: now) into context ac: vol 0..1 after distance, pan -1..1, lp: low-pass Hz.
// At most 6 voices at once (a seventh is dropped), so a burst of events cannot pile up into clipping.
function sfx(kind, vol, pan = 0, lp = 12000, ac = AC, t) {
  if (!ac || !ac._sfx) return false;
  t = t ?? ac.currentTime + 0.01;
  const dur = kind === 'birth' ? 1.7 : kind === 'catch' ? 0.55 : 0.32, V = ac._v;
  let k = -1; for (let i = 0; i < V.length; i++) if (V[i] <= t) { k = i; break; }
  if (k < 0) return false;
  V[k] = t + dur;
  const g = new GainNode(ac, { gain: 0 }), f = new BiquadFilterNode(ac, { type: 'lowpass', frequency: lp, Q: 0.5 }), p = new StereoPannerNode(ac, { pan });
  g.connect(f); f.connect(p); p.connect(ac._sfx); if (kind !== 'burst') { const w = new GainNode(ac, { gain: 0.35 }); p.connect(w); w.connect(ac._wet); }
  if (kind === 'burst') {
    if (!ac._nb) { const b = ac._nb = new AudioBuffer({ length: ac.sampleRate * 0.3 | 0, numberOfChannels: 1, sampleRate: ac.sampleRate }), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
    const src = new AudioBufferSourceNode(ac, { buffer: ac._nb }), bp = new BiquadFilterNode(ac, { type: 'bandpass', frequency: 700, Q: 1.2 });
    src.connect(bp); bp.connect(g); bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2 * vol, t + 0.03); g.gain.setTargetAtTime(0, t + 0.06, 0.05); src.start(t); src.stop(t + dur);
  } else if (kind === 'catch') {
    // a soft low thump and a short muffled crunch
    const o = new OscillatorNode(ac, { frequency: 140 }); o.connect(g);
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * vol, t + 0.012); g.gain.setTargetAtTime(0, t + 0.03, 0.08);
    o.start(t); o.stop(t + dur);
  } else {
    // birth: two bell partials a fifth apart, slow fade
    for (const fq of [988, 1480]) { const o = new OscillatorNode(ac, { frequency: fq }); o.connect(g); o.start(t); o.stop(t + dur); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045 * vol, t + 0.02); g.gain.setTargetAtTime(0, t + 0.05, 0.35);
  }
  return true;
}
// an event at (x, y, z): quieter and duller with distance, silent past 40 m; panned by its side of the view;
// behind the glass (camera outside the water) a little more muffled
const SFT = new Float64Array(3);
function sfxAt(kind, vol, x, y, z) {
  if (!AC || muted || AC.state !== 'running') return;
  const ki = kind === 'catch' ? 0 : kind === 'birth' ? 1 : 2, now = performance.now();
  if (now - SFT[ki] < 120) return;
  const dx = x - F[DX], dy = y - F[DY], dz = z - F[DZ], d = sqrt(dx * dx + dy * dy + dz * dz);
  if (d >= 40) return;
  const a = 1 - d / 40, wet = F[DY] < 0 && abs(F[DX]) < UB[60] && abs(F[DZ]) < UB[62];
  if (sfx(kind, vol * a * a * (wet ? 1 : 0.7), clamp((dx * F[RX] + dz * F[RZ]) / max(d, 1), -1, 1) * 0.75, (wet ? 9000 : 3500) * exp(-d / 25) + 300)) SFT[ki] = now;
}
// level test: 8 s of the ambience with a burst of `ne` events between 3 and 5 s (half at once, close, on both sides);
// returns the peak and RMS of the mix (linear and dBFS)
async function audioTest(ne = 24) {
  const sr = 44100, ac = new OfflineAudioContext({ numberOfChannels: 2, length: sr * 8, sampleRate: sr });
  mkSound(ac, true);
  const K = ['catch', 'birth', 'burst'];
  let n = 0;
  for (let i = 0; i < ne; i++) if (sfx(K[i % 3], 1, rr(-0.75, 0.75), 12000, ac, 3 + (i < ne / 2 ? i * 0.02 : rr(0, 2)))) n++;
  const b = await ac.startRendering();
  let pk = 0, s2 = 0, m = 0;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = abs(d[i]); if (v > pk) pk = v; if (i > sr * 2) { s2 += d[i] * d[i]; m++; } } }
  const rms = sqrt(s2 / m), db = (v) => +(20 * Math.log10(v)).toFixed(1);
  return { peak: +pk.toFixed(3), peakDb: db(pk), rms: +rms.toFixed(4), rmsDb: db(rms), voicesPlayed: n, voicesAsked: ne };
}
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
