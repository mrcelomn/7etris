// All sound is synthesized with Web Audio, no audio files: the soundtracks (the Tetris theme,
// Korobeiniki, a traditional folk song, and an original piece for the Obra Dinn look) and
// packs of short effects in the style of Jstris's sound skins.
// iOS only lets audio start inside a tap, so main.js calls unlock() on every touch.

let ctx = null, musicOut, sfxOut, noise, pulse25, pulse12, pianoWave;
let silentSince = 0; // when a tap first found the sound not running (0: it's fine)
const opts = { music: true, musicVol: 60, sfx: true, sfxVol: 80, silentOk: false, pack: 'classic' };

export function configure(o) {
  Object.assign(opts, o);
  applySession();
  applyVolumes();
}

// iOS gives web pages two choices, and neither does both: 'ambient' mixes with other apps'
// audio (Spotify keeps playing) but obeys the silent switch; 'playback' plays through the
// silent switch but pauses other apps' audio. The player picks with "tocar no silencioso".
function applySession() {
  try { navigator.audioSession.type = opts.silentOk ? 'playback' : 'ambient'; } catch (_) {}
}

function applyVolumes() {
  if (!ctx) return;
  musicOut.gain.value = opts.music ? (opts.musicVol / 100) * 0.3 : 0;
  sfxOut.gain.value = opts.sfx ? (opts.sfxVol / 100) * 0.8 : 0;
}

// iOS suspends or "interrupts" the audio when a notification, a call, the lock screen or
// leaving the app gets in the way, and resume() sometimes never comes back. So each tap
// resumes it, and a tap that finds it still silent a second later rebuilds the sound.
export function unlock() {
  if (!ctx || ctx.state === 'closed') return build();
  if (ctx.state === 'running') { silentSince = 0; return; }
  if (!silentSince) silentSince = performance.now();
  else if (performance.now() - silentSince > 1000) return build();
  ctx.resume().catch(() => {});
}

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (ctx) ctx.close().catch(() => {});
  silentSince = 0;
  applySession();
  ctx = new AC();
  musicOut = ctx.createGain();
  sfxOut = ctx.createGain();
  musicOut.connect(ctx.destination);
  sfxOut.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  pulse25 = pulseWave(0.25);
  pulse12 = pulseWave(0.125);
  // A struck string: strong fundamental, then fading overtones
  const harmonics = [0, 1, 0.6, 0.35, 0.25, 0.15, 0.1, 0.06, 0.04];
  pianoWave = ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));
  applyVolumes();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  nextAt = ctx.currentTime + 0.06; // a rebuilt clock starts at zero; music carries on from here
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

// A burst of filtered noise: clicks for the effects, drums for the music
function hiss(out, t, dur, freq, vol, type = 'bandpass') {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise;
  f.type = type;
  f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
}

// Pulse wave with the given duty cycle, the Game Boy's lead sound (Fourier series of a pulse)
function pulseWave(duty) {
  const n = 32, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (4 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

// ---------- effects ----------
// Sound packs, like Jstris' sound skins: each one plays every game event its own way.
// Every pack's 'clear' climbs a major scale from C5, one step per consecutive clearing piece
// (the combo), and starts again at the bottom when a piece locks without clearing.
const COMBO_SCALE = [0, 2, 4, 5, 7, 9, 11];
const comboHz = combo => {
  const step = Math.min(combo, 20);
  return 523.25 * 2 ** ((COMBO_SCALE[step % 7] + 12 * Math.floor(step / 7)) / 12);
};
const notes = (fs, step, dur, type, vol, t) => fs.forEach((f, i) => tone(sfxOut, f, t + i * step, dur, type, vol));

// A piano-like note: instant attack, a quick drop, then a long fade, through a filter that
// closes as the note dies (bright hammer strike, mellow tail)
function piano(f, t, dur, vol) {
  const o = ctx.createOscillator(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
  o.setPeriodicWave(pianoWave);
  o.frequency.setValueAtTime(f, t);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(f * 8, 9000), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 400), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.09);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(filter);
  filter.connect(g);
  g.connect(sfxOut);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const keys = (fs, step, dur, vol, t) => fs.forEach((f, i) => piano(f, t + i * step, dur, vol));

// Bowed string: two slightly detuned saws, softened, swelling in and fading out
function strings(out, f, t, dur, vol) {
  const filter = ctx.createBiquadFilter(), g = ctx.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(f * 5, 2200);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.08, dur / 3));
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.15);
  filter.connect(g);
  g.connect(out);
  for (const cents of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.detune.value = cents;
    o.connect(filter);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
}

// Ship's bell: inharmonic partials that ring and die away
function bell(out, f, t, dur, vol) {
  [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]].forEach(([ratio, amp]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * ratio;
    g.gain.setValueAtTime(vol * amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / ratio ** 0.5);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur);
  });
}
// The Obra Dinn pack's combo climbs the darker D natural minor scale instead
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const minorHz = combo => {
  const step = Math.min(combo, 20);
  return 293.66 * 2 ** ((MINOR_SCALE[step % 7] + 12 * Math.floor(step / 7)) / 12);
};

const PACKS = {
  classic: {
    name: 'CLÁSSICO',
    move: t => hiss(sfxOut, t, 0.03, 3200, 0.5),
    rotate: t => { hiss(sfxOut, t, 0.03, 4500, 0.35); tone(sfxOut, 900, t, 0.05, 'triangle', 0.18, 1400); },
    hold: t => { tone(sfxOut, 600, t, 0.07, 'sine', 0.25, 900); tone(sfxOut, 900, t + 0.06, 0.08, 'sine', 0.2, 1200); },
    lock: t => { tone(sfxOut, 240, t, 0.07, 'sine', 0.4, 120); hiss(sfxOut, t, 0.04, 1500, 0.25); },
    drop: t => { tone(sfxOut, 180, t, 0.14, 'sine', 0.7, 45); hiss(sfxOut, t, 0.09, 900, 0.5, 'lowpass'); },
    clear: (t, f) => { tone(sfxOut, f, t, 0.16, 'square', 0.12); tone(sfxOut, f * 1.5, t + 0.03, 0.14, 'triangle', 0.14); hiss(sfxOut, t, 0.12, 6000, 0.1, 'highpass'); },
    over: t => notes([392, 330, 262, 196], 0.13, 0.22, 'square', 0.12, t),
    win: t => { notes([523, 659, 784, 1047], 0.09, 0.25, 'square', 0.12, t); notes([523, 659, 784], 0, 0.6, 'triangle', 0.18, t + 0.4); },
  },
  bit: {
    name: '8-BIT',
    move: t => tone(sfxOut, 880, t, 0.025, 'square', 0.07),
    rotate: t => tone(sfxOut, 1320, t, 0.04, 'square', 0.07, 1760),
    hold: t => notes([660, 990], 0.04, 0.04, 'square', 0.07, t),
    lock: t => tone(sfxOut, 220, t, 0.05, 'square', 0.1),
    drop: t => { tone(sfxOut, 330, t, 0.09, 'square', 0.1, 110); hiss(sfxOut, t, 0.06, 1200, 0.25, 'lowpass'); },
    clear: (t, f) => notes([f, f * 1.25, f * 1.5, f * 2], 0.03, 0.05, 'square', 0.08, t),
    over: t => notes([494, 466, 440, 415, 392, 370, 349, 330], 0.08, 0.1, 'square', 0.09, t),
    win: t => notes([523, 659, 784, 1047, 784, 1047], 0.08, 0.12, 'square', 0.09, t),
  },
  soft: {
    name: 'SUAVE',
    move: t => tone(sfxOut, 600, t, 0.05, 'sine', 0.12),
    rotate: t => tone(sfxOut, 880, t, 0.08, 'sine', 0.14, 1100),
    hold: t => notes([523, 784], 0.06, 0.12, 'sine', 0.14, t),
    lock: t => tone(sfxOut, 196, t, 0.12, 'sine', 0.3),
    drop: t => tone(sfxOut, 140, t, 0.2, 'sine', 0.45, 60),
    clear: (t, f) => { tone(sfxOut, f, t, 0.45, 'sine', 0.2); tone(sfxOut, f * 2, t, 0.3, 'sine', 0.08); },
    over: t => notes([440, 349, 294, 220], 0.18, 0.4, 'sine', 0.18, t),
    win: t => notes([523, 659, 784, 1047], 0.12, 0.6, 'sine', 0.16, t),
  },
  wood: {
    name: 'MADEIRA',
    move: t => { tone(sfxOut, 1200, t, 0.015, 'triangle', 0.25); hiss(sfxOut, t, 0.015, 2500, 0.3); },
    rotate: t => { tone(sfxOut, 1800, t, 0.02, 'triangle', 0.25); hiss(sfxOut, t, 0.02, 4000, 0.2); },
    hold: t => { tone(sfxOut, 900, t, 0.03, 'triangle', 0.3); tone(sfxOut, 1350, t + 0.05, 0.03, 'triangle', 0.3); },
    lock: t => { tone(sfxOut, 400, t, 0.03, 'triangle', 0.45); hiss(sfxOut, t, 0.03, 900, 0.3); },
    drop: t => { tone(sfxOut, 160, t, 0.06, 'triangle', 0.6); hiss(sfxOut, t, 0.05, 600, 0.45, 'lowpass'); },
    clear: (t, f) => { tone(sfxOut, f, t, 0.12, 'triangle', 0.35); tone(sfxOut, f * 4, t, 0.04, 'sine', 0.08); },
    over: t => notes([300, 250, 200, 150], 0.12, 0.06, 'triangle', 0.4, t),
    win: t => notes([523, 659, 784, 1047, 1319], 0.07, 0.12, 'triangle', 0.32, t),
  },
  piano: {
    name: 'PIANO',
    move: t => piano(1568, t, 0.12, 0.05),
    rotate: t => piano(1319, t, 0.2, 0.08),
    hold: t => keys([523, 784], 0.07, 0.4, 0.12, t),
    lock: t => piano(131, t, 0.35, 0.25),
    drop: t => keys([65, 98, 131], 0, 0.6, 0.22, t),
    clear: (t, f) => { piano(f, t, 0.9, 0.22); piano(f * 2, t, 0.6, 0.07); },
    over: t => keys([440, 349, 294, 220, 147], 0.16, 1.2, 0.2, t),
    win: t => { keys([523, 659, 784, 1047], 0.1, 1, 0.18, t); keys([262, 330, 392], 0, 1.6, 0.14, t + 0.4); },
  },
  obra: {
    name: 'OBRA DINN',
    move: t => hiss(sfxOut, t, 0.04, 900, 0.35),
    rotate: t => { hiss(sfxOut, t, 0.05, 1600, 0.3); tone(sfxOut, 220, t, 0.05, 'triangle', 0.15, 180); },
    hold: t => bell(sfxOut, 880, t, 1, 0.07),
    lock: t => { tone(sfxOut, 90, t, 0.22, 'sine', 0.4, 55); hiss(sfxOut, t, 0.08, 400, 0.3, 'lowpass'); },
    drop: t => { tone(sfxOut, 70, t, 0.6, 'sine', 0.6, 32); hiss(sfxOut, t, 0.5, 300, 0.55, 'lowpass'); },
    clear: (t, f, combo) => { const m = minorHz(combo); strings(sfxOut, m / 2, t, 0.35, 0.12); bell(sfxOut, m * 2, t, 1.2, 0.06); },
    over: t => [147, 175, 220].forEach(f => strings(sfxOut, f, t, 1.6, 0.08)),
    win: t => [0, 0.45, 0.9].forEach(d => bell(sfxOut, 784, t + d, 1.4, 0.08)),
  },
  space: {
    name: 'ESPACIAL',
    move: t => tone(sfxOut, 1500, t, 0.03, 'sine', 0.1, 1200),
    rotate: t => tone(sfxOut, 400, t, 0.07, 'sawtooth', 0.05, 800),
    hold: t => tone(sfxOut, 300, t, 0.15, 'sine', 0.15, 1200),
    lock: t => tone(sfxOut, 300, t, 0.08, 'sine', 0.25, 150),
    drop: t => tone(sfxOut, 200, t, 0.22, 'sawtooth', 0.08, 40),
    clear: (t, f) => { tone(sfxOut, f / 2, t, 0.14, 'sine', 0.2, f); tone(sfxOut, f * 2, t + 0.05, 0.2, 'sine', 0.06); },
    over: t => tone(sfxOut, 600, t, 0.9, 'sawtooth', 0.07, 60),
    win: t => [523, 659, 784].forEach(f => tone(sfxOut, f / 2, t, 0.7, 'sine', 0.12, f)),
  },
};
export const SOUND_PACKS = Object.entries(PACKS).map(([id, p]) => ({ id, name: p.name }));

// `combo` (for 'clear'): how many clearing pieces in a row came before this one
export function sfx(name, combo = 0) {
  if (!ctx || ctx.state !== 'running') return;
  const pack = PACKS[opts.pack] || PACKS.classic;
  pack[name](ctx.currentTime, comboHz(combo), combo);
}
// ---------- music ----------
// Three soundtracks, picked by the look (main.js calls setSong):
//  · gameboy: Korobeiniki as a Game Boy track, in the console's four kinds of voice: lead on a
//    25% pulse (vibrato on long notes), harmony on a thin 12.5% pulse, triangle bass, noise drums.
//  · modern (every other skin): the same arrangement on rounder, softer synths.
//  · obra: an original sea-shanty-style piece in D minor and 6/8 for the Obra Dinn look,
//    on bowed strings over a held drone, with a ship's bell and a low drum.
// Each song is built up front as one list of events per eighth note, which the scheduler plays
// slightly ahead so the timing stays steady.

// Note + length in eighths; R is a rest
const parse = s => s.trim().split(/\s+/).reduce((a, v, i, all) => (i % 2 ? a : [...a, [v, +all[i + 1]]]), []);
// Root, third and fifth of each chord used
const TONES = {
  Em: ['E', 'G', 'B'], Am: ['A', 'C', 'E'], E: ['E', 'G#', 'B'], Dm: ['D', 'F', 'A'], C: ['C', 'E', 'G'],
  Gm: ['G', 'Bb', 'D'], Bb: ['Bb', 'D', 'F'], F: ['F', 'A', 'C'], A: ['A', 'C#', 'E'],
};

function hz(name, octave) {
  const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0);
  return 440 * 2 ** ((12 * (octave + 1) + semi - 69) / 12);
}
const noteHz = n => hz(n.slice(0, -1), +n.slice(-1));

// One step per eighth: `i` is its place in the bar, `bar` the bar's number, `chord` its tones.
// harmony: 'quarters' (third and fifth on each beat), 'arpeggio' (chord tones on each eighth)
// or 'pad' (the chord held for the bar); lift: 2 plays the lead an octave up; groove 'b'
// marks the busier B section
function section(melody, chords, { harmony = null, lift = 1, groove = 'a', bar = 8 } = {}) {
  const steps = Array.from({ length: chords.length * bar }, (_, k) => ({
    i: k % bar, bar: Math.floor(k / bar), chord: TONES[chords[Math.floor(k / bar)]], groove,
  }));
  let pos = 0;
  for (const [n, d] of melody) {
    if (n !== 'R') steps[pos].lead = [noteHz(n) * lift, d];
    pos += d;
  }
  for (const s of steps) {
    const [root, third, fifth] = s.chord;
    if (harmony === 'quarters' && s.i % 2 === 0) s.harm = [[hz(s.i % 4 ? fifth : third, 4)], 2];
    if (harmony === 'arpeggio') s.harm = [[hz([root, third, fifth, third][s.i % 4], 4)], 1];
    if (harmony === 'pad' && s.i === 0) s.harm = [[hz(root, 3), hz(third, 3), hz(fifth, 3)], bar];
  }
  return steps;
}

const KORO_A = parse(`
  E5 2 B4 1 C5 1 D5 2 C5 1 B4 1 A4 2 A4 1 C5 1 E5 2 D5 1 C5 1 B4 3 C5 1 D5 2 E5 2 C5 2 A4 2 A4 2 R 2
  R 1 D5 2 F5 1 A5 2 G5 1 F5 1 E5 3 C5 1 E5 2 D5 1 C5 1 B4 2 B4 1 C5 1 D5 2 E5 2 C5 2 A4 2 A4 2 R 2`);
const KORO_B = parse(`
  E5 4 C5 4 D5 4 B4 4 C5 4 A4 4 G#4 4 B4 2 R 2
  E5 4 C5 4 D5 4 B4 4 C5 2 E5 2 A5 4 G#5 6 R 2`);
const KORO_CHORDS_A = 'Em Am E Am Dm C E Am'.split(' ');
const KORO_CHORDS_B = 'Am E Am E Am E Am E'.split(' ');
// The loop: A, A with harmony, B, then B again with arpeggios and the lead an octave up
const KOROBEINIKI = [
  ...section(KORO_A, KORO_CHORDS_A),
  ...section(KORO_A, KORO_CHORDS_A, { harmony: 'quarters' }),
  ...section(KORO_B, KORO_CHORDS_B, { groove: 'b' }),
  ...section(KORO_B, KORO_CHORDS_B, { harmony: 'arpeggio', lift: 2, groove: 'b' }),
];

// Original tune, six eighths to the bar
const OBRA_A = parse(`
  D4 3 F4 1 A4 2  G4 2 F4 1 E4 3  D4 3 A4 2 C5 1  A4 6
  Bb4 3 A4 1 G4 2  F4 2 E4 1 D4 3  E4 2 F4 1 G4 2 E4 1  D4 6`);
const OBRA_B = parse(`
  A4 3 D5 2 C5 1  Bb4 3 A4 3  G4 2 A4 1 Bb4 3  A4 6
  D5 3 C5 1 Bb4 2  A4 2 G4 1 F4 3  E4 3 C#5 3  D5 6`);
const OBRA_CHORDS_A = 'Dm C Dm A Gm Dm A Dm'.split(' ');
const OBRA_CHORDS_B = 'Dm Gm Gm A Bb F A Dm'.split(' ');
const OBRA = [
  ...section(OBRA_A, OBRA_CHORDS_A, { bar: 6 }),
  ...section(OBRA_B, OBRA_CHORDS_B, { bar: 6, groove: 'b' }),
  ...section(OBRA_A, OBRA_CHORDS_A, { bar: 6, harmony: 'pad' }),
  ...section(OBRA_B, OBRA_CHORDS_B, { bar: 6, harmony: 'pad', groove: 'b' }),
];

// A held note that fades a little, then releases; long notes get vibrato.
// `wave` is a built-in oscillator type or a PeriodicWave.
function synth(wave, freq, t, dur, vol, vibrato) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
  o.frequency.setValueAtTime(freq, t);
  if (vibrato) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(freq * 0.006, t + 0.15);
    lfo.connect(depth);
    depth.connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.linearRampToValueAtTime(vol * 0.75, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  o.connect(g);
  g.connect(musicOut);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Bass bounces root, octave, root, octave… with the fifth on the seventh eighth
const bassHz = s => (s.i === 6 ? hz(s.chord[2], 2) : hz(s.chord[0], s.i % 2 ? 3 : 2));

function playGameBoy(s, t, e) {
  if (s.lead) synth(pulse25, s.lead[0], t, s.lead[1] * e * 0.92, 0.2, s.lead[1] >= 3);
  if (s.harm) s.harm[0].forEach(f => synth(pulse12, f, t, s.harm[1] * e * 0.85, 0.07, false));
  tone(musicOut, bassHz(s), t, e * 0.8, 'triangle', 0.5);
  if (s.i === 0 || s.i === 4 || (s.groove === 'b' && s.i === 3)) tone(musicOut, 150, t, 0.12, 'sine', 0.55, 45);
  if (s.i === 2 || s.i === 6) { hiss(musicOut, t, 0.12, 1800, 0.3); tone(musicOut, 190, t, 0.05, 'triangle', 0.18); }
  if (s.groove === 'b' && s.i === 7) hiss(musicOut, t, 0.12, 7500, 0.09, 'highpass');
  else hiss(musicOut, t, 0.03, 7500, 0.06, 'highpass');
}

function playModern(s, t, e) {
  if (s.lead) {
    synth('triangle', s.lead[0], t, s.lead[1] * e * 0.95, 0.3, s.lead[1] >= 3);
    synth('sine', s.lead[0] * 2, t, s.lead[1] * e * 0.8, 0.05, false);
  }
  if (s.harm) s.harm[0].forEach(f => synth('sine', f, t, s.harm[1] * e * 0.9, 0.1, false));
  tone(musicOut, bassHz(s), t, e * 0.85, 'sine', 0.55);
  if (s.i === 0 || s.i === 4) tone(musicOut, 120, t, 0.18, 'sine', 0.45, 45);
  if (s.i === 2 || s.i === 6) hiss(musicOut, t, 0.1, 2500, 0.16);
  if (s.i % 2) hiss(musicOut, t, 0.025, 9000, 0.04, 'highpass');
}

function playObra(s, t, e) {
  const barLen = 6 * e;
  if (s.lead) strings(musicOut, s.lead[0], t, s.lead[1] * e * 0.98, 0.16);
  if (s.harm) s.harm[0].forEach(f => strings(musicOut, f, t, s.harm[1] * e, 0.05));
  if (s.i === 0) {
    strings(musicOut, hz(s.chord[0], 2), t, barLen, 0.14); // the drone under each bar
    if (s.bar % 2 === 0) bell(musicOut, hz(s.chord[0], 5), t, 2.4, 0.05);
  }
  if (s.i === 0 || s.i === 3) tone(musicOut, 70, t, 0.45, 'sine', s.i ? 0.25 : 0.4, 40);
  if (s.groove === 'b' && s.i === 5) hiss(musicOut, t, 0.18, 700, 0.12); // a creak of the hull
}

const SONGS = {
  gameboy: { steps: KOROBEINIKI, eighth: 0.17, play: playGameBoy },
  modern: { steps: KOROBEINIKI, eighth: 0.17, play: playModern },
  obra: { steps: OBRA, eighth: 0.21, play: playObra },
};
let song = SONGS.modern;

export function setSong(id) {
  const next = SONGS[id] || SONGS.modern;
  if (next === song) return;
  song = next;
  step = 0;
}

let playing = false, timer = 0, step = 0, nextAt = 0;

export function musicPlay(fromStart) {
  if (!ctx) return;
  if (fromStart) step = 0;
  if (playing) return;
  playing = true;
  nextAt = ctx.currentTime + 0.06;
  timer = setInterval(schedule, 50);
  schedule();
}

export function musicStop() {
  playing = false;
  clearInterval(timer);
}

function schedule() {
  // Back from a pause in the audio: skip what was missed instead of playing it all at once
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + 0.3) {
    song.play(song.steps[step % song.steps.length], nextAt, song.eighth);
    nextAt += song.eighth;
    step = (step + 1) % song.steps.length;
  }
}