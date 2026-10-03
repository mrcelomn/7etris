// On-screen controls. The d-pad and the A/B buttons float above the game; where they sit and
// how big they are is a saved layout the player edits by dragging (move) and pinching (size).
// Controls never cover the playfield (board, hold, next queue, stats), the pause button or each other.

// A layout gives each control's centre (x as a fraction of the game's width, y of the screen's
// height) and scale. Width and height at scale 1, as a fraction of the game's width:
const BASE = { dpad: [0.44, 0.44], a: [0.21, 0.21], b: [0.21, 0.21] };
const DEFAULT_SCALE = { dpad: 1.08, a: 1, b: 1 };
const MIN_SCALE = 0.6, MAX_SCALE = 1.8, GAP = 6;
const OBSTACLES = '.lcd, .pause-btn';
const NUDGES = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

const $ = id => document.getElementById(id);
const app = document.querySelector('.app');
const els = { dpad: $('dpad'), a: $('btnA'), b: $('btnB') };
const clone = l => JSON.parse(JSON.stringify(l));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// The body spans the real screen (see --screen-h in style.css); innerHeight can come up short on iOS
const screenH = () => document.body.clientHeight;

// `custom` is false until the player saves a layout; until then the default is recomputed
// for whatever screen the game is on
let layout, custom, game, editing = false, selected = 'dpad', onDone;

export function initPad(handlers, saved) {
  game = handlers;
  custom = !!saved;
  layout = saved && clone(saved);
}

// Game Boy arrangement in the space between the playfield and the pause button:
// d-pad on the left, A high and B low on the right
function defaultLayout() {
  const a = app.getBoundingClientRect(), H = screenH();
  const top = $('lcd').getBoundingClientRect().bottom + 14;
  const bottom = $('pauseBtn').getBoundingClientRect().top - 12;
  const zone = Math.max(bottom - top, 0), mid = top + zone / 2;
  const dp = BASE.dpad[0] * a.width * DEFAULT_SCALE.dpad, btn = BASE.a[0] * a.width;
  const ax = a.right - 12 - btn / 2, rise = Math.max(0, Math.min(btn * 0.4, (zone - btn) / 2));
  const at = (px, py, id) => ({ x: (px - a.left) / a.width, y: py / H, s: DEFAULT_SCALE[id] });
  return {
    dpad: at(a.left + 12 + dp / 2, mid, 'dpad'),
    a: at(ax, mid - rise, 'a'),
    b: at(ax - btn * 1.1, mid + rise, 'b'),
  };
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
    top: clamp(p.y * screenH() - h / 2, parseFloat(safe.paddingTop), screenH() - parseFloat(safe.paddingBottom) - h),
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
  p.y = (r.top + r.h / 2) / screenH();
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
  if (!custom) layout = defaultLayout();
  const a = app.getBoundingClientRect();
  for (const id in els) {
    const p = layout[id];
    let r = rectFor(id, p);
    search: for (let d = 8; !fits(id, r) && d < screenH(); d += 8) {
      for (const [dx, dy] of NUDGES) {
        const c = rectFor(id, { ...p, x: p.x + (dx * d) / a.width, y: p.y + (dy * d) / screenH() });
        if (fits(id, c)) { r = c; break search; }
      }
    }
    apply(id, r, p.s);
  }
}

// ---------- playing ----------
const dpad = els.dpad;
let dpDir = null, dpPointer = null, dpSpent = false;
const armAt = e => {
  const arm = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-arrow]');
  return arm && dpad.contains(arm) ? arm.dataset.arrow : null;
};
// A touch on an arm is that arm's arrow, wherever on the arm it lands. Elsewhere (the centre
// square, the corners, the invisible margin) it picks the nearest arrow by angle, with up (hard
// drop, which can't be undone) needing a clearly upward touch.
function dirFrom(e) {
  const arm = armAt(e);
  if (arm) return arm;
  const r = dpad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
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
  // A new touch always starts fresh: iOS sometimes never reports the previous release, and
  // a direction left "held" would make tapping that same arrow again do nothing
  setDir(null);
  dpPointer = e.pointerId;
  try { dpad.setPointerCapture(e.pointerId); } catch (_) {}
  const d = dirFrom(e);
  dpSpent = d === 'up';
  setDir(d);
});
// Sliding the thumb changes arrow only once it's on another arm, so a wobble into the centre or
// the margin keeps the current one. After a hard drop the touch is done until the thumb lifts:
// a slip sideways would otherwise move the next piece.
dpad.addEventListener('pointermove', e => {
  if (e.pointerId !== dpPointer || dpSpent) return;
  const arm = armAt(e);
  if (arm) { dpSpent = arm === 'up'; setDir(arm); }
});
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
    const x = (e.clientX - drag.ox - a.left) / a.width, y = (e.clientY - drag.oy) / screenH();
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

$('padReset').addEventListener('click', () => { custom = false; placePad(); });
$('padDone').addEventListener('click', () => {
  editing = false;
  custom = true;
  touches.clear(); drag = pinch = null;
  document.body.classList.remove('editing');
  $('editbar').hidden = true;
  select(selected);
  onDone(clone(layout));
});
