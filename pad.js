// On-screen controls. The d-pad and the A/B buttons float above the game; where they sit and
// how big they are is a saved layout the player can edit (drag to move, − / + to resize).

// Centre of each control: x as a fraction of the game's width, y of the screen's height
export const DEFAULT_LAYOUT = {
  dpad: { x: 0.28, y: 0.84, s: 1 },
  a: { x: 0.75, y: 0.84, s: 1 },
  b: { x: 0.91, y: 0.68, s: 1 },
};
// Width and height at 100%, as a fraction of the game's width
const BASE = { dpad: [0.44, 0.44], a: [0.35, 0.455], b: [0.125, 0.205] };
const MIN_SCALE = 0.6, MAX_SCALE = 1.8;

const $ = id => document.getElementById(id);
const app = document.querySelector('.app');
const els = { dpad: $('dpad'), a: $('btnA'), b: $('btnB') };
const clone = l => JSON.parse(JSON.stringify(l));

let layout, game, editing = false, selected = 'dpad', drag = null, onDone;

export function initPad(handlers, saved) {
  game = handlers;
  layout = clone(saved);
  place();
  addEventListener('resize', place);
}

// Positions every control, keeping it fully on screen
function place() {
  const a = app.getBoundingClientRect(), H = innerHeight;
  for (const id in els) {
    const p = layout[id], [fw, fh] = BASE[id];
    const w = fw * a.width * p.s, h = fh * a.width * p.s;
    const left = Math.min(Math.max(a.left + p.x * a.width - w / 2, a.left), a.right - w);
    const top = Math.min(Math.max(p.y * H - h / 2, 0), H - h);
    p.x = (left + w / 2 - a.left) / a.width;
    p.y = (top + h / 2) / H;
    Object.assign(els[id].style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    els[id].style.setProperty('--u', w + 'px');
  }
}

// ---------- playing ----------
const dpad = els.dpad;
let dpDir = null, dpPointer = null;
// Any touch on the pad (centre and corners included) picks the nearest arrow. While sliding,
// a small centre zone keeps the current arrow so a wobbly thumb doesn't flicker.
// Up is hard drop and can't be undone, so it needs a clearly upward touch.
function dirFrom(e) {
  const r = dpad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  if (dpDir && Math.hypot(dx, dy) < r.width * 0.08) return dpDir;
  if (-dy > Math.abs(dx) * 1.3) return 'up';
  if (dy > Math.abs(dx)) return 'down';
  return dx < 0 ? 'left' : 'right';
}
function setDir(d) {
  if (d === dpDir) return;
  if (dpDir) game.release(dpDir);
  dpDir = d;
  if (d) { game.press(d); dpad.dataset.dir = d; } else delete dpad.dataset.dir;
}
dpad.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (editing) return startDrag(e, 'dpad');
  dpPointer = e.pointerId;
  try { dpad.setPointerCapture(e.pointerId); } catch (_) {}
  setDir(dirFrom(e));
});
dpad.addEventListener('pointermove', e => { if (e.pointerId === dpPointer) setDir(dirFrom(e)); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => dpad.addEventListener(t, e => {
  if (e.pointerId === dpPointer) { dpPointer = null; setDir(null); }
}));

for (const id of ['a', 'b']) {
  const b = els[id];
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (editing) return startDrag(e, id);
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
    b.classList.add('pressed');
    game.press(id);
  });
  const up = () => { b.classList.remove('pressed'); game.release(id); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, up));
}

// ---------- editing ----------
export function editPad(done) {
  editing = true;
  onDone = done;
  document.body.classList.add('editing');
  $('editbar').hidden = false;
  select(selected);
}

function select(id) {
  selected = id;
  for (const k in els) els[k].classList.toggle('sel', editing && k === id);
  $('padSize').textContent = Math.round(layout[id].s * 100) + '%';
}

function startDrag(e, id) {
  select(id);
  const r = els[id].getBoundingClientRect();
  drag = { id, pointer: e.pointerId, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2) };
}
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const a = app.getBoundingClientRect();
  layout[drag.id].x = (e.clientX - drag.ox - a.left) / a.width;
  layout[drag.id].y = (e.clientY - drag.oy) / innerHeight;
  place();
});
['pointerup', 'pointercancel'].forEach(t => addEventListener(t, e => {
  if (drag && e.pointerId === drag.pointer) drag = null;
}));

function resizeSelected(step) {
  const p = layout[selected];
  p.s = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, p.s + step)) * 10) / 10;
  place();
  select(selected);
}
$('padSmaller').addEventListener('click', () => resizeSelected(-0.1));
$('padBigger').addEventListener('click', () => resizeSelected(0.1));
$('padReset').addEventListener('click', () => { layout = clone(DEFAULT_LAYOUT); place(); select(selected); });
$('padDone').addEventListener('click', () => {
  editing = false;
  document.body.classList.remove('editing');
  $('editbar').hidden = true;
  select(selected);
  onDone(clone(layout));
});
