// On-screen controls. The d-pad and the A/B buttons float above the game; where they sit and
// how big they are is a saved layout the player edits by dragging (move) and pinching (size).
// Controls never cover the board, hold, next queue, stats, pause button or each other.

// Centre of each control: x as a fraction of the game's width, y of the screen's height.
// Game Boy arrangement: d-pad on the left, B low and A high on the right.
export const DEFAULT_LAYOUT = {
  dpad: { x: 0.27, y: 0.81, s: 1 },
  b: { x: 0.62, y: 0.855, s: 1 },
  a: { x: 0.83, y: 0.77, s: 1 },
};
// Width and height at scale 1, as a fraction of the game's width
const BASE = { dpad: [0.44, 0.44], a: [0.21, 0.21], b: [0.21, 0.21] };
const MIN_SCALE = 0.6, MAX_SCALE = 1.8, GAP = 6;
const OBSTACLES = '.board-wrap, .slot, .stats, .pause-btn';
const NUDGES = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

const $ = id => document.getElementById(id);
const app = document.querySelector('.app');
const els = { dpad: $('dpad'), a: $('btnA'), b: $('btnB') };
const clone = l => JSON.parse(JSON.stringify(l));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

let layout, game, editing = false, selected = 'dpad', onDone;

export function initPad(handlers, saved) {
  game = handlers;
  layout = clone(saved);
}

// ---------- placement ----------
// Where control `id` would sit with position/scale `p`, kept on screen and clear of the
// status bar and home indicator
function rectFor(id, p) {
  const a = app.getBoundingClientRect(), [fw, fh] = BASE[id];
  const w = fw * a.width * p.s, h = fh * a.width * p.s;
  const safe = getComputedStyle($('safeProbe'));
  return {
    left: clamp(a.left + p.x * a.width - w / 2, a.left, a.right - w),
    top: clamp(p.y * innerHeight - h / 2, parseFloat(safe.paddingTop), innerHeight - parseFloat(safe.paddingBottom) - h),
    w, h,
  };
}
const overlaps = (r, o) => r.left < o.right + GAP && r.left + r.w > o.left - GAP && r.top < o.bottom + GAP && r.top + r.h > o.top - GAP;
function fits(id, r) {
  for (const el of document.querySelectorAll(OBSTACLES)) if (overlaps(r, el.getBoundingClientRect())) return false;
  for (const k in els) if (k !== id && overlaps(r, els[k].getBoundingClientRect())) return false;
  return true;
}
function apply(id, r, s) {
  const a = app.getBoundingClientRect(), p = layout[id];
  p.x = (r.left + r.w / 2 - a.left) / a.width;
  p.y = (r.top + r.h / 2) / innerHeight;
  p.s = s;
  Object.assign(els[id].style, { left: r.left + 'px', top: r.top + 'px', width: r.w + 'px', height: r.h + 'px' });
  els[id].style.setProperty('--u', r.w + 'px');
}
function tryPlace(id, p) {
  const r = rectFor(id, p);
  if (!fits(id, r)) return false;
  apply(id, r, p.s);
  return true;
}

// Lays out every control. One that no longer fits (another screen size, the board grew)
// moves to the nearest free spot.
export function placePad() {
  const a = app.getBoundingClientRect();
  for (const id in els) {
    const p = layout[id];
    let r = rectFor(id, p);
    search: for (let d = 8; !fits(id, r) && d < innerHeight; d += 8) {
      for (const [dx, dy] of NUDGES) {
        const c = rectFor(id, { ...p, x: p.x + (dx * d) / a.width, y: p.y + (dy * d) / innerHeight });
        if (fits(id, c)) { r = c; break search; }
      }
    }
    apply(id, r, p.s);
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
  if (editing) return;
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
    if (editing) return;
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
}

// One finger on a control drags it; a second finger anywhere turns it into a pinch that
// resizes the selected control.
const touches = new Map();
let drag = null, pinch = null;
const spread = () => { const [p, q] = [...touches.values()]; return Math.hypot(p.x - q.x, p.y - q.y) || 1; };

addEventListener('pointerdown', e => {
  if (!editing || e.target.closest('.ui')) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const ctl = e.target.closest('.ctl');
  if (touches.size === 1 && ctl) {
    select(ctl.dataset.ctl);
    const r = ctl.getBoundingClientRect();
    drag = { pointer: e.pointerId, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2) };
  } else if (touches.size === 2) {
    drag = null;
    pinch = { d0: spread(), s0: layout[selected].s };
  }
}, true);

addEventListener('pointermove', e => {
  if (!editing || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = layout[selected];
  if (pinch) {
    tryPlace(selected, { ...p, s: clamp((pinch.s0 * spread()) / pinch.d0, MIN_SCALE, MAX_SCALE) });
  } else if (drag && e.pointerId === drag.pointer) {
    const a = app.getBoundingClientRect();
    const x = (e.clientX - drag.ox - a.left) / a.width, y = (e.clientY - drag.oy) / innerHeight;
    // Slide along whichever axis is still free when the full move would hit something
    tryPlace(selected, { ...p, x, y }) || tryPlace(selected, { ...p, x }) || tryPlace(selected, { ...p, y });
  }
});

['pointerup', 'pointercancel'].forEach(t => addEventListener(t, e => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (drag && drag.pointer === e.pointerId) drag = null;
}));

// Mouse wheel resizes too, for editing on a computer
addEventListener('wheel', e => {
  if (!editing) return;
  e.preventDefault();
  const p = layout[selected];
  tryPlace(selected, { ...p, s: clamp(p.s - Math.sign(e.deltaY) * 0.05, MIN_SCALE, MAX_SCALE) });
}, { passive: false });

$('padReset').addEventListener('click', () => { layout = clone(DEFAULT_LAYOUT); placePad(); });
$('padDone').addEventListener('click', () => {
  editing = false;
  touches.clear(); drag = pinch = null;
  document.body.classList.remove('editing');
  $('editbar').hidden = true;
  select(selected);
  onDone(clone(layout));
});
