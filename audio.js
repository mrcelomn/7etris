// All sound is synthesized with Web Audio, no audio files: the Tetris theme (Korobeiniki,
// a traditional folk song) as chiptune, and short effects in the style of Jstris's.
// iOS only lets audio start inside a tap, so main.js calls unlock() on every touch.

let ctx = null, musicOut, sfxOut, noise;
const opts = { music: true, musicVol: 60, sfx: true, sfxVol: 80 };

export function configure(o) {
  Object.assign(opts, o);
  applyVolumes();
}

function applyVolumes() {
  if (!ctx) return;
  musicOut.gain.value = opts.music ? (opts.musicVol / 100) * 0.35 : 0;
  sfxOut.gain.value = opts.sfx ? (opts.sfxVol / 100) * 0.8 : 0;
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // 'ambient' mixes with other apps' audio and follows the silent switch, like games do
    try { navigator.audioSession.type = 'ambient'; } catch (_) {}
    ctx = new AC();
    musicOut = ctx.createGain();
    sfxOut = ctx.createGain();
    musicOut.connect(ctx.destination);
    sfxOut.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

function tone(out, freq, t, dur, type, vol, to) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(t, dur, freq, vol, type = 'bandpass') {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise;
  f.type = type;
  f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(sfxOut);
  s.start(t);
  s.stop(t + dur + 0.02);
}

// ---------- effects ----------
export function sfx(name, lines = 0) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  switch (name) {
    case 'move':
      hiss(t, 0.03, 3200, 0.5);
      break;
    case 'rotate':
      hiss(t, 0.03, 4500, 0.35);
      tone(sfxOut, 900, t, 0.05, 'triangle', 0.18, 1400);
      break;
    case 'hold':
      tone(sfxOut, 600, t, 0.07, 'sine', 0.25, 900);
      tone(sfxOut, 900, t + 0.06, 0.08, 'sine', 0.2, 1200);
      break;
    case 'lock':
      tone(sfxOut, 240, t, 0.07, 'sine', 0.4, 120);
      hiss(t, 0.04, 1500, 0.25);
      break;
    case 'drop':
      tone(sfxOut, 180, t, 0.14, 'sine', 0.7, 45);
      hiss(t, 0.09, 900, 0.5, 'lowpass');
      break;
    case 'clear': {
      const tetris = lines >= 4;
      const notes = tetris ? [523, 659, 784, 1047, 1319] : [523, 659, 784].slice(0, lines + 1);
      notes.forEach((f, i) => tone(sfxOut, f, t + i * 0.045, 0.18, tetris ? 'square' : 'triangle', tetris ? 0.12 : 0.25));
      hiss(t, tetris ? 0.35 : 0.2, 6000, 0.15, 'highpass');
      break;
    }
    case 'over':
      [392, 330, 262, 196].forEach((f, i) => tone(sfxOut, f, t + i * 0.13, 0.22, 'square', 0.12));
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(sfxOut, f, t + i * 0.09, 0.25, 'square', 0.12));
      [523, 659, 784].forEach(f => tone(sfxOut, f, t + 0.4, 0.6, 'triangle', 0.18));
      break;
  }
}

// ---------- music ----------
const EIGHTH = 0.18; // seconds
// Note + length in eighths; R is a rest
const parse = s => s.trim().split(/\s+/).reduce((a, v, i, all) => (i % 2 ? a : [...a, [v, +all[i + 1]]]), []);
const PART_A = parse(`
  E5 2 B4 1 C5 1 D5 2 C5 1 B4 1 A4 2 A4 1 C5 1 E5 2 D5 1 C5 1 B4 3 C5 1 D5 2 E5 2 C5 2 A4 2 A4 2 R 2
  R 1 D5 2 F5 1 A5 2 G5 1 F5 1 E5 3 C5 1 E5 2 D5 1 C5 1 B4 2 B4 1 C5 1 D5 2 E5 2 C5 2 A4 2 A4 2 R 2`);
const PART_B = parse(`
  E5 4 C5 4 D5 4 B4 4 C5 4 A4 4 G#4 4 B4 2 R 2
  E5 4 C5 4 D5 4 B4 4 C5 2 E5 2 A5 4 G#5 6 R 2`);
const MELODY = [...PART_A, ...PART_A, ...PART_B];
// One bass root per bar of the melody above, bouncing between the root and its octave
const ROOTS = 'E A E A D C E A  E A E A D C E A  A E A E A E A E'.split(/\s+/);
const ROOT_HZ = { A: 110, C: 65.41, D: 73.42, E: 82.41 };
const BASS = ROOTS.flatMap(r => Array(8).fill(ROOT_HZ[r]));

function noteHz(n) {
  const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n[0]] + (n[1] === '#' ? 1 : 0);
  const midi = 12 * (+n[n.length - 1] + 1) + semi;
  return 440 * 2 ** ((midi - 69) / 12);
}

let playing = false, timer = 0;
let mIdx = 0, mPos = 0, mTime = 0, bIdx = 0, bTime = 0; // mPos: eighth where note mIdx starts

export function musicPlay(fromStart) {
  if (!ctx) return;
  if (fromStart) { mIdx = 0; mPos = 0; }
  if (playing) return;
  playing = true;
  bIdx = mPos % BASS.length; // keep the bass in step with the melody after a pause
  mTime = bTime = ctx.currentTime + 0.06;
  timer = setInterval(schedule, 50);
  schedule();
}

export function musicStop() {
  playing = false;
  clearInterval(timer);
}

function schedule() {
  const until = ctx.currentTime + 0.3;
  while (mTime < until) {
    const [n, d] = MELODY[mIdx];
    if (n !== 'R') tone(musicOut, noteHz(n), mTime, d * EIGHTH * 0.9, 'square', 0.18);
    mTime += d * EIGHTH;
    mPos += d;
    mIdx = (mIdx + 1) % MELODY.length;
    if (mIdx === 0) mPos = 0;
  }
  while (bTime < until) {
    const f = BASS[bIdx];
    tone(musicOut, bIdx % 2 ? f * 2 : f, bTime, EIGHTH * 0.85, 'triangle', 0.5);
    bTime += EIGHTH;
    bIdx = (bIdx + 1) % BASS.length;
  }
}
