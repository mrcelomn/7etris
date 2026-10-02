import * as audio from './audio.js';
import { initPad, placePad, editPad } from './pad.js';
import { SKINS, drawBlock } from './skins.js';
import { COLS, ROWS, HID, VIS, SHAPES, rotCW, newBoard, spawnX, bag, seeded, collides as hits, stamp, clearLines, exchange, solidRowsAt, addSolid, packBoard, unpackBoard } from './rules.js';
import { Bot } from './ai.js';
import { Duel, newCode } from './duel.js';

const $ = id => document.getElementById(id);

// Bump on every deploy so the menu shows which version the phone is running
const VERSION = 32;

// ---------- rules ----------
const PREVIEW = 5;
// SRS clockwise wall kicks, indexed by the rotation state we leave (y is flipped: + is down)
const KICKS = [
  [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
];
const KICKS_I = [
  [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
];
// Side moves: first repeat after DAS ms, then one cell every ARR ms while held
const DAS = 130, ARR = 22, SOFT = 25, LOCK = 500, MAX_RESETS = 15;

// ---------- saved data ----------
function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; } catch (_) { return { ...fallback }; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}
// Best marathon time in ms keyed by line goal ('20'…), and battle wins keyed by mode ('ai-easy'…)
const records = load('7etris-records', {});
const sound = load('7etris-audio', { music: true, musicVol: 60, sfx: true, sfxVol: 80 });
const look = load('7etris-look', { skin: 'classic', theme: 'dark' });
audio.configure(sound);

// ---------- game state ----------
let state = 'menu'; // menu | play | pause | done | edit
// '20' | '40' | '100' marathon line goal, 'free', a battle against the AI
// ('ai-easy' | 'ai-medium' | 'ai-hard'), or 'duel' against a friend online
let mode = '40';
let board, cur, queue, hold, canHold, lines, pieces, elapsed;
let dropAcc = 0, lockT = 0, lockResets = 0;
let rand = Math.random; // piece order; seeded in a duel so both players get the same pieces
// Battles only: the opponent ({ board, dead, receive(n) }: the AI or the friend's mirror),
// garbage it sent that hasn't landed yet, and solid garbage rows risen so far
let foe = null, incoming = 0, solidRows = 0;
let duel = null; // the open connection to a friend, while in a duel

const isMarathon = () => /^\d+$/.test(mode);
const isBattle = () => mode.startsWith('ai-') || mode === 'duel';
const goal = () => (isMarathon() ? Number(mode) : Infinity);
// Marathon and battle keep 1 row/second like Jstris; free play speeds up 15% every 10 lines
const gravity = () => (mode === 'free' ? Math.max(80, 1000 * 0.85 ** Math.floor(lines / 10)) : 1000);

function pull() { if (queue.length <= PREVIEW) queue.push(...bag(rand)); return queue.shift(); }
const collides = (m, px, py) => hits(board, m, px, py);

function spawn(t) {
  const m = SHAPES[t].map(r => r.slice());
  cur = { t, m, r: 0, x: spawnX(m), y: HID - 1 };
  dropAcc = 0; lockT = 0; lockResets = 0;
  if (collides(cur.m, cur.x, cur.y)) finish(false);
}

function bumpLock() { if (lockT > 0 && lockResets < MAX_RESETS) { lockT = 0; lockResets++; } }
function tryMove(dx, dy) {
  if (collides(cur.m, cur.x + dx, cur.y + dy)) return false;
  cur.x += dx; cur.y += dy; bumpLock(); return true;
}
function rotate() {
  if (cur.t === 'O') return false;
  const m = rotCW(cur.m);
  for (const [kx, ky] of (cur.t === 'I' ? KICKS_I : KICKS)[cur.r]) {
    if (!collides(m, cur.x + kx, cur.y + ky)) { cur.m = m; cur.x += kx; cur.y += ky; cur.r = (cur.r + 1) % 4; bumpLock(); return true; }
  }
  return false;
}
function holdPiece() {
  if (!canHold) return;
  const t = cur.t;
  audio.sfx('hold');
  spawn(hold || pull());
  hold = t; canHold = false;
  drawSide();
}
function ghostY() { let y = cur.y; while (!collides(cur.m, cur.x, y + 1)) y++; return y; }
function hardDrop() { cur.y = ghostY(); audio.sfx('drop'); lock(true); }

function lock(hard = false) {
  pieces++;
  if (!stamp(board, cur.m, cur.x, cur.y, cur.t)) return finish(false);
  const cleared = clearLines(board);
  lines += cleared;
  if (cleared) audio.sfx('clear', cleared); else if (!hard) audio.sfx('lock');
  if (lines >= goal()) return finish(true);
  if (foe) {
    const [sent, left] = exchange(board, cleared, incoming);
    incoming = left;
    if (sent) foe.receive(sent);
    if (duel) duel.send({ t: 'board', b: packBoard(board) });
  }
  canHold = true;
  spawn(pull());
  drawSide();
}

// Battle hurry-up: solid rows rise on their schedule. One that lifts the stack into the falling
// piece nudges the piece up a row; one that pushes blocks off the top ends the game.
function raiseSolids() {
  for (const due = solidRowsAt(elapsed); solidRows < due; solidRows++) {
    if (!addSolid(board)) return finish(false);
    if (collides(cur.m, cur.x, cur.y)) {
      cur.y--;
      if (collides(cur.m, cur.x, cur.y)) return finish(false);
    }
  }
}

// ---------- flow ----------
const SCREENS = ['menu', 'soundScr', 'skinScr', 'duelScr', 'pauseScr', 'result'];
function show(id) {
  SCREENS.forEach(s => { $(s).hidden = s !== id; });
  // Coming back to the menu always finds MARATONA, DUELOS and IA folded up
  if (id === 'menu') document.querySelectorAll('[aria-controls]').forEach(btn => {
    btn.setAttribute('aria-expanded', false);
    $(btn.getAttribute('aria-controls')).hidden = true;
  });
}
const on = (id, fn) => $(id).addEventListener('click', fn);

function clearBoard() {
  board = newBoard(); queue = []; hold = null; canHold = true; cur = null;
  lines = 0; pieces = 0; elapsed = 0;
  foe = null; incoming = 0; solidRows = 0;
  $('foeBox').hidden = true;
  drawSide();
}

// `seed` is given in a duel, so both phones deal the same pieces
function startGame(m, seed) {
  mode = m;
  rand = seed ? seeded(seed) : Math.random;
  clearBoard();
  if (mode === 'duel') {
    foe = { board: newBoard(), dead: false, receive: n => duel && duel.send({ t: 'atk', n }) };
  } else if (isBattle()) {
    foe = new Bot(mode.slice(3), n => { incoming += n; });
  }
  if (foe) {
    $('foeLabel').textContent = mode === 'duel' ? 'AMIGO' : 'IA';
    $('foeBox').hidden = false;
  }
  state = 'play';
  show(null);
  spawn(pull());
  drawSide();
  stats();
  audio.musicPlay(true);
}

function releaseAll() { Object.keys(held).forEach(k => delete held[k]); }

function pause() {
  if (state !== 'play') return;
  state = 'pause';
  releaseAll();
  audio.musicStop();
  show('pauseScr');
}
function resume() {
  state = 'play';
  show(null);
  audio.musicPlay(false);
}

function finish(win) {
  state = 'done';
  cur = null;
  releaseAll();
  audio.musicStop();
  audio.sfx(win ? 'win' : 'over');
  if (isBattle()) {
    if (!win && duel) duel.send({ t: 'over' });
    if (win) { records[mode] = (records[mode] || 0) + 1; save('7etris-records', records); }
    result(win ? 'VITÓRIA!' : 'DERROTA', LEVEL_NAMES[mode], winsText(mode, mode === 'duel' ? 'contra amigos' : 'neste nível'));
  } else if (win) {
    const best = records[mode], isRecord = !best || elapsed < best;
    if (isRecord) { records[mode] = elapsed; save('7etris-records', records); }
    result(`${mode} LINHAS`, fmt(elapsed, 2), isRecord ? 'NOVO RECORDE!' : `Recorde: ${fmt(best, 2)}`);
  } else {
    const marathon = isMarathon();
    result('FIM DE JOGO', marathon ? `Faltaram ${goal() - lines}` : `${lines} linhas`, fmt(elapsed, marathon ? 2 : 0));
  }
}
// Short enough to fit the result screen's big type on one line
const LEVEL_NAMES = { 'ai-easy': 'IA FÁCIL', 'ai-medium': 'IA MÉDIO', 'ai-hard': 'IA DIFÍCIL', duel: 'ONLINE' };
const winsText = (key, where = '') => {
  const n = records[key] || 0;
  return `${n} ${n === 1 ? 'vitória' : 'vitórias'}${where && ' ' + where}`;
};
function result(title, main, sub) {
  $('again').hidden = false;
  $('resTitle').textContent = title;
  $('resMain').textContent = main;
  $('resSub').textContent = sub;
  const pps = elapsed > 0 ? pieces / (elapsed / 1000) : 0;
  $('resStats').textContent = `${pieces} peças · ${pps.toFixed(2)} por segundo`;
  show('result');
}

function openMenu() {
  state = 'menu';
  audio.musicStop();
  leaveDuel();
  clearBoard();
  document.querySelectorAll('[data-rec]').forEach(el => {
    const best = records[el.dataset.rec];
    el.textContent = best ? fmt(best, 2) : '—';
  });
  document.querySelectorAll('[data-wins]').forEach(el => {
    el.textContent = records[el.dataset.wins] ? winsText(el.dataset.wins) : '—';
  });
  show('menu');
}

// Play again: in a duel this starts a new round on both phones
function again() {
  if (mode === 'duel') duelRound(); else startGame(mode);
}
// Deals a duel round: the same random seed goes to the friend, so both get the same pieces
function duelRound() {
  const seed = 1 + Math.floor(Math.random() * 2 ** 31);
  duel.send({ t: 'start', seed });
  startGame('duel', seed);
}

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.mode)));
// MARATONA, DUELOS and IA open their list of options underneath
document.querySelectorAll('[aria-controls]').forEach(btn => btn.addEventListener('click', () => {
  const list = $(btn.getAttribute('aria-controls')), open = list.hidden;
  list.hidden = !open;
  btn.setAttribute('aria-expanded', open);
}));
on('pauseBtn', pause);
on('resume', resume);
on('restart', again);
on('pauseMenu', openMenu);
on('again', again);
on('resMenu', openMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- online duel ----------
// The duel screen shows either the create/join choices or, once in a room, its code
function duelStatus(text, room = '') {
  $('duelHome').hidden = !!room;
  $('duelWait').hidden = !room;
  $('duelRoom').textContent = room;
  $('duelMsg').textContent = text;
}
function leaveDuel() {
  if (duel) duel.close();
  duel = null;
}
function openDuel(how, code) {
  leaveDuel();
  duel = new Duel({
    // The host deals the first round as soon as the friend arrives
    ready: isHost => { if (isHost) duelRound(); else duelStatus('Conectado! Esperando o jogo começar…', code); },
    start: seed => startGame('duel', seed),
    attack: n => { if (mode === 'duel') incoming += n; },
    board: b => { if (foe && mode === 'duel') foe.board = unpackBoard(b); },
    over: () => { if (state === 'play' || state === 'pause') finish(true); },
    closed: () => {
      duel = null;
      if (mode === 'duel' && (state === 'play' || state === 'pause' || state === 'done')) {
        state = 'done'; cur = null; audio.musicStop();
        result('CONEXÃO PERDIDA', 'O duelo acabou', 'Seu amigo saiu ou ficou sem internet.');
        $('again').hidden = true;
      } else duelStatus('A conexão caiu. Tente de novo.');
    },
    error: text => { leaveDuel(); duelStatus(text); },
  });
  if (how === 'host') { duelStatus('Esperando seu amigo entrar…', code); duel.host(code); }
  else { duelStatus('Conectando…', code); duel.join(code); }
}
on('openDuel', () => { duelStatus(''); $('duelCode').value = ''; show('duelScr'); });
on('duelCreate', () => openDuel('host', newCode()));
on('duelJoin', () => {
  const code = $('duelCode').value.trim().toUpperCase();
  if (code.length !== 5) return duelStatus('O código tem 5 letras ou números.');
  openDuel('join', code);
});
on('duelBack', () => { leaveDuel(); duelStatus(''); show('menu'); });

// ---------- sound settings ----------
function renderSound() {
  $('musicOn').setAttribute('aria-pressed', sound.music);
  $('sfxOn').setAttribute('aria-pressed', sound.sfx);
  $('musicVol').value = sound.musicVol;
  $('sfxVol').value = sound.sfxVol;
}
function setSound(patch) {
  Object.assign(sound, patch);
  audio.configure(sound);
  save('7etris-audio', sound);
  renderSound();
}
// The music plays while this screen is open, so volume changes can be heard
on('openSound', () => { renderSound(); show('soundScr'); audio.musicPlay(true); });
on('soundBack', () => { audio.musicStop(); show('menu'); });
on('musicOn', () => setSound({ music: !sound.music }));
on('sfxOn', () => { setSound({ sfx: !sound.sfx }); audio.sfx('rotate'); });
$('musicVol').addEventListener('input', e => setSound({ musicVol: +e.target.value }));
$('sfxVol').addEventListener('input', e => setSound({ sfxVol: +e.target.value }));
$('sfxVol').addEventListener('change', () => audio.sfx('lock'));

// ---------- look: skins and light/dark ----------
function setLook(patch) {
  Object.assign(look, patch);
  save('7etris-look', look);
  applyLook();
  resize(); // the Game Boy skin frames the playfield, which changes the board's size
}
// The Game Boy skin restyles the whole app (console body, green LCD) through data-skin
function applyLook() {
  document.documentElement.dataset.theme = look.theme;
  document.documentElement.dataset.skin = look.skin;
  readPalette();
  document.querySelector('meta[name="theme-color"]').content = css().getPropertyValue('--bg').trim();
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === look.theme));
  document.querySelectorAll('[data-skin]').forEach(b => b.classList.toggle('on', b.dataset.skin === look.skin));
  drawSide();
}
document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => setLook({ theme: b.dataset.themeSet })));

// One row per skin, each with a strip of sample blocks drawn in that skin
const SAMPLE = ['T', 'S', 'L', 'I', 'O'];
for (const skin of SKINS) {
  const b = document.createElement('button');
  b.className = 'row skin';
  b.dataset.skin = skin.id;
  b.textContent = skin.name;
  const cv = document.createElement('canvas');
  b.append(cv);
  $('skinList').append(b);
  const ctx = sizeCanvas(cv, SAMPLE.length * 20, 20);
  SAMPLE.forEach((t, i) => drawBlock(ctx, skin.id, i * 20, 0, 20, t));
  b.addEventListener('click', () => setLook({ skin: skin.id }));
}
on('openSkins', () => show('skinScr'));
on('skinBack', () => show('menu'));

// ---------- controls ----------
const held = {};
// Only the auto-repeating directions track "held"; A, B and hard drop act on every press,
// so a release iOS never reports can't leave them stuck and swallow the next tap.
const REPEATS = ['left', 'right', 'down'];
function press(k) {
  if (state !== 'play') return;
  if (REPEATS.includes(k)) held[k] = { next: performance.now() + DAS };
  switch (k) {
    case 'left': case 'right': if (tryMove(k === 'left' ? -1 : 1, 0)) audio.sfx('move'); break;
    case 'down': tryMove(0, 1); dropAcc = 0; break;
    case 'up': hardDrop(); break;
    case 'a': if (rotate()) audio.sfx('rotate'); break;
    case 'b': holdPiece(); break;
  }
}
function release(k) { delete held[k]; }

// v15 changed the default controls back to the Game Boy layout; drop layouts saved for the old shapes
try { localStorage.removeItem('7etris-pad'); } catch (_) {}
// No saved layout means the default one, fitted to this screen
let savedPad = null;
try { savedPad = JSON.parse(localStorage.getItem('7etris-pad-2')); } catch (_) {}
initPad({ press, release }, savedPad);
on('openPad', () => {
  state = 'edit';
  show(null);
  editPad(layout => { save('7etris-pad-2', layout); openMenu(); });
});

const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up', ' ': 'up', x: 'a', X: 'a', c: 'b', C: 'b', Shift: 'b' };
addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.key === 'p') { if (state === 'play') pause(); else if (state === 'pause') resume(); return; }
  const k = KEYMAP[e.key];
  if (!k || state !== 'play') return;
  e.preventDefault();
  if (!e.repeat) press(k);
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) release(k); });

// Cancelling touch defaults stops iOS from scrolling, zooming or showing the text magnifier
// while playing. Menus (.ui) keep them, so their buttons and sliders work normally.
const blockTouch = e => { if (!e.target.closest('.ui')) e.preventDefault(); };
document.addEventListener('touchstart', blockTouch, { passive: false });
document.addEventListener('touchmove', blockTouch, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
// iOS only lets sound start inside a tap
['touchend', 'pointerup', 'keydown'].forEach(t => addEventListener(t, audio.unlock));

// ---------- drawing ----------
const css = () => getComputedStyle(document.documentElement);
// Canvas colors come from the current theme's CSS tokens
let PANEL, GRID, DEAD;
function readPalette() {
  const s = css(), v = name => s.getPropertyValue(name).trim();
  PANEL = v('--panel'); GRID = v('--grid'); DEAD = v('--dead');
}
let cell = 18, bctx, hctx, nctx, fctx;

function sizeCanvas(cv, w, h) {
  const d = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
  return c;
}
function resize() {
  const f = $('field'), lcd = getComputedStyle($('lcd')), brand = $('brand');
  // Room taken by the LCD's frame and the name under it (only the Game Boy look has them)
  const chrome = sides => sides.reduce((n, k) => n + parseFloat(lcd[`border${k}Width`]) + parseFloat(lcd[`padding${k}`]), 0);
  const below = brand.offsetHeight && brand.offsetHeight + parseFloat(getComputedStyle(brand).marginTop);
  const w = f.clientWidth - 4 - chrome(['Left', 'Right']), h = f.clientHeight - 1 - chrome(['Top', 'Bottom']) - below;
  cell = Math.max(10, Math.floor(Math.min(h / VIS, w / 14.4)));
  f.style.setProperty('--c', cell + 'px');
  const sw = Math.round(cell * 1.9) - 2;
  bctx = sizeCanvas($('board'), cell * COLS, cell * VIS);
  hctx = sizeCanvas($('hold'), sw, Math.round(cell * 1.5));
  nctx = sizeCanvas($('next'), sw, Math.round(cell * 1.5) * PREVIEW);
  fctx = sizeCanvas($('foe'), sw, sw * 2); // the AI's board, 10×20 tiny cells
  drawSide();
  placePad();
}

const block = (ctx, x, y, s, t, kind) => drawBlock(ctx, look.skin, x, y, s, t, kind, DEAD);

function drawBoard() {
  const c = cell, ctx = bctx;
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, c * COLS, c * VIS);
  ctx.fillStyle = GRID;
  for (let x = 1; x < COLS; x++) ctx.fillRect(x * c, 0, 1, c * VIS);
  for (let y = 1; y < VIS; y++) ctx.fillRect(0, y * c, c * COLS, 1);
  for (let y = HID; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = board[y][x];
    if (t) block(ctx, x * c, (y - HID) * c, c, t, state === 'done' ? 'dead' : 'solid');
  }
  if (!cur) return;
  const gy = ghostY();
  cur.m.forEach((r, y) => r.forEach((v, x) => { if (v && gy + y >= HID) block(ctx, (cur.x + x) * c, (gy + y - HID) * c, c, cur.t, 'ghost'); }));
  cur.m.forEach((r, y) => r.forEach((v, x) => { if (v && cur.y + y >= HID) block(ctx, (cur.x + x) * c, (cur.y + y - HID) * c, c, cur.t, 'solid'); }));
}

function mini(ctx, t, cx, cy, s, kind) {
  const m = SHAPES[t];
  const rows = m.map((r, y) => r.some(Boolean) ? y : -1).filter(y => y >= 0);
  const cols = m[0].map((_, x) => m.some(r => r[x]) ? x : -1).filter(x => x >= 0);
  const ox = Math.round(cx - cols.length * s / 2), oy = Math.round(cy - rows.length * s / 2);
  rows.forEach((y, ry) => cols.forEach((x, rx) => { if (m[y][x]) block(ctx, ox + rx * s, oy + ry * s, s, t, kind); }));
}
function drawSide() {
  if (!hctx || !board) return;
  const w = parseFloat($('hold').style.width), h = parseFloat($('hold').style.height), s = Math.max(4, Math.floor(cell * 0.42));
  hctx.fillStyle = PANEL; hctx.fillRect(0, 0, w, h);
  if (hold) mini(hctx, hold, w / 2, h / 2, s, canHold ? 'solid' : 'dead');
  const nh = parseFloat($('next').style.height);
  nctx.fillStyle = PANEL; nctx.fillRect(0, 0, w, nh);
  queue.slice(0, PREVIEW).forEach((t, i) => mini(nctx, t, w / 2, h * i + h / 2, s, 'solid'));
}

// Battle extras: the opponent's board in miniature, and the red bar beside the board showing
// garbage on its way to the player (it lands on the next lock that clears nothing)
function drawBattle() {
  const w = parseFloat($('foe').style.width), s = w / COLS;
  fctx.fillStyle = PANEL; fctx.fillRect(0, 0, w, s * VIS);
  for (let y = HID; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = foe.board[y][x];
    if (t) block(fctx, x * s, (y - HID) * s, s, t, foe.dead ? 'dead' : 'solid');
  }
  $('meter').style.height = `${(Math.min(incoming, VIS) / VIS) * 100}%`;
}

// m:ss with `dp` decimals of a second
function fmt(ms, dp) {
  const s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60;
  const sec = dp ? (Math.floor(r * 10 ** dp) / 10 ** dp).toFixed(dp).padStart(dp + 3, '0') : String(Math.floor(r)).padStart(2, '0');
  return `${m}:${sec}`;
}
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
const statEls = { label: $('linesLbl'), lines: $('lines'), pieces: $('pieces'), time: $('time') };
function stats() {
  const marathon = isMarathon() && (state === 'play' || state === 'pause' || state === 'done');
  setText(statEls.label, marathon ? 'FALTAM' : 'LINHAS');
  setText(statEls.lines, String(marathon ? Math.max(0, goal() - lines) : lines));
  setText(statEls.pieces, String(pieces));
  setText(statEls.time, fmt(elapsed, marathon ? 1 : 0));
}

// ---------- loop ----------
let last = performance.now();
// The clock adds real time so records stay honest; gameplay steps are capped so a slow frame
// can't drop a piece several rows at once.
function frame(now) {
  const real = now - last, dt = Math.min(50, real); last = now;
  if (state === 'play' && cur) {
    elapsed += real;
    for (const k of ['left', 'right']) {
      const h = held[k];
      if (h && now >= h.next) { if (tryMove(k === 'left' ? -1 : 1, 0)) audio.sfx('move'); h.next = now + ARR; }
    }
    const iv = held.down ? Math.min(gravity(), SOFT) : gravity();
    if (collides(cur.m, cur.x, cur.y + 1)) {
      dropAcc = 0; lockT += dt;
      if (lockT >= LOCK) lock();
    } else {
      lockT = 0; dropAcc += dt;
      while (cur && dropAcc >= iv) { dropAcc -= iv; if (!tryMove(0, 1)) { dropAcc = 0; break; } }
    }
    if (foe && state === 'play') {
      if (foe.update) foe.update(real); // the AI thinks; a friend's moves arrive as messages
      if (foe.dead) finish(true);
    }
    if (foe && state === 'play' && cur) raiseSolids();
  }
  stats();
  if (bctx) drawBoard();
  if (foe) drawBattle();
  requestAnimationFrame(frame);
}

$('ver').textContent = 'v' + VERSION;
applyLook();
resize();
openMenu();
requestAnimationFrame(t => { last = t; frame(t); });
addEventListener('resize', resize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize).catch(() => {});
