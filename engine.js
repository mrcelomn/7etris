// One player's game, with no screen or sound: the pieces, the board and the timing. It only
// moves forward through press(), release() and step(), so a ranked game can be recorded as that
// sequence and played again, move for move, by the server to check its result (server/worker.js).
import { HID, SHAPES, rotCW, newBoard, spawnX, bag, collides, stamp, clearLines, exchange, solidRowsAt, addSolid } from './rules.js';

export const PREVIEW = 5;
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
// Survival's ms per row by level: the Tetris Guideline curve, (0.8 - (level - 1) * 0.007)^(level - 1)
// seconds, written out rounded so the phone and the server always agree; 1 ms from level 18 on
const SURVIVAL = [1000, 793, 618, 473, 355, 262, 190, 135, 94, 64, 43, 28, 18, 11, 7, 4, 3];

// Replay codes: a number is a step of that many ms, a capital letter a press, a small one a release
const PRESS = { left: 'L', right: 'R', down: 'D', up: 'U', a: 'A', b: 'B' };
const KEY = Object.fromEntries(Object.entries(PRESS).map(([k, c]) => [c, k]));

export const isMarathon = mode => /^\d+$/.test(mode);
export const isBattle = mode => mode.startsWith('ai-') || mode === 'duel';

export class Game {
  // mode: '20' | '40' | '100' (marathon line goal), 'survival', 'practice', 'ai-…' or 'duel'.
  // hooks: sfx(name, combo), end(win), and in battles sent(lines) and locked(). With record,
  // the game keeps its log of steps and presses for the server (see replay)
  constructor(mode, rand, hooks = {}, record = false) {
    this.mode = mode; this.rand = rand; this.hooks = hooks;
    this.goal = isMarathon(mode) ? Number(mode) : Infinity;
    this.battle = isBattle(mode);
    this.board = newBoard(); this.queue = []; this.hold = null; this.canHold = true;
    this.lines = 0; this.pieces = 0; this.elapsed = 0;
    this.combo = 0; // pieces in a row that cleared lines; drives the rising combo sound
    this.incoming = 0; this.solidRows = 0; // battles: garbage on its way, solid rows risen
    this.held = {};
    this.over = false; this.won = false;
    this.log = record ? [] : null;
    this.spawn(this.pull());
  }

  // Survival: a level every 10 lines, starting at 1
  get level() { return 1 + Math.floor(this.lines / 10); }
  // Marathon, battles and practice keep 1 row/second like Jstris; survival speeds up
  get gravity() { return this.mode === 'survival' ? SURVIVAL[this.level - 1] || 1 : 1000; }
  // The log as text: "16,17L16l…", numbers split by a comma only when two come in a row
  get replay() {
    let s = '', num = false;
    for (const v of this.log) { const n = typeof v === 'number'; s += (n && num ? ',' : '') + v; num = n; }
    return s;
  }

  rec(v) { if (this.log) this.log.push(v); }
  sfx(name, combo) { if (this.hooks.sfx) this.hooks.sfx(name, combo); }
  pull() { if (this.queue.length <= PREVIEW) this.queue.push(...bag(this.rand)); return this.queue.shift(); }
  hits(m, x, y) { return collides(this.board, m, x, y); }

  spawn(t) {
    const m = SHAPES[t].map(r => r.slice());
    this.cur = { t, m, r: 0, x: spawnX(m), y: HID - 1 };
    this.dropAcc = 0; this.lockT = 0; this.lockResets = 0;
    if (this.hits(m, this.cur.x, this.cur.y)) this.end(false);
  }
  end(win) {
    if (this.over) return;
    this.over = true; this.won = win; this.cur = null; this.held = {};
    if (this.hooks.end) this.hooks.end(win);
  }

  bumpLock() { if (this.lockT > 0 && this.lockResets < MAX_RESETS) { this.lockT = 0; this.lockResets++; } }
  tryMove(dx, dy) {
    const c = this.cur;
    if (this.hits(c.m, c.x + dx, c.y + dy)) return false;
    c.x += dx; c.y += dy; this.bumpLock(); return true;
  }
  rotate() {
    const c = this.cur;
    if (c.t === 'O') return false;
    const m = rotCW(c.m);
    for (const [kx, ky] of (c.t === 'I' ? KICKS_I : KICKS)[c.r]) {
      if (!this.hits(m, c.x + kx, c.y + ky)) { c.m = m; c.x += kx; c.y += ky; c.r = (c.r + 1) % 4; this.bumpLock(); return true; }
    }
    return false;
  }
  holdPiece() {
    if (!this.canHold) return;
    const t = this.cur.t;
    this.sfx('hold');
    this.spawn(this.hold || this.pull());
    this.hold = t; this.canHold = false;
  }
  ghostY() { const c = this.cur; let y = c.y; while (!this.hits(c.m, c.x, y + 1)) y++; return y; }

  lock(hard = false) {
    const c = this.cur;
    this.pieces++;
    if (!stamp(this.board, c.m, c.x, c.y, c.t)) return this.end(false);
    const cleared = clearLines(this.board);
    this.lines += cleared;
    const chain = this.combo; // this clear's place in the combo
    if (cleared) { this.sfx('clear', chain); this.combo++; }
    else { this.combo = 0; if (!hard) this.sfx('lock'); }
    if (this.lines >= this.goal) return this.end(true);
    if (this.battle) {
      const [sent, left] = exchange(this.board, cleared, this.incoming, chain);
      this.incoming = left;
      if (sent && this.hooks.sent) this.hooks.sent(sent);
      if (this.hooks.locked) this.hooks.locked();
    }
    this.canHold = true;
    this.spawn(this.pull());
  }

  // Battle hurry-up: solid rows rise on their schedule. One that lifts the stack into the falling
  // piece nudges the piece up a row; one that pushes blocks off the top ends the game.
  raiseSolids() {
    for (const due = solidRowsAt(this.elapsed); this.solidRows < due; this.solidRows++) {
      if (!addSolid(this.board)) return this.end(false);
      const c = this.cur;
      if (this.hits(c.m, c.x, c.y)) {
        c.y--;
        if (this.hits(c.m, c.x, c.y)) return this.end(false);
      }
    }
  }

  press(k) {
    if (this.over) return;
    this.rec(PRESS[k]);
    if (k === 'left' || k === 'right' || k === 'down') this.held[k] = this.elapsed + DAS;
    switch (k) {
      case 'left': case 'right': if (this.tryMove(k === 'left' ? -1 : 1, 0)) this.sfx('move'); break;
      case 'down': this.tryMove(0, 1); this.dropAcc = 0; break;
      case 'up': this.cur.y = this.ghostY(); this.sfx('drop'); this.lock(true); break;
      case 'a': if (this.rotate()) this.sfx('rotate'); break;
      case 'b': this.holdPiece(); break;
    }
  }
  release(k) {
    if (this.over || !(k in this.held)) return;
    this.rec(PRESS[k].toLowerCase());
    delete this.held[k];
  }

  // `ms` of play. The clock counts all of it so times stay honest; gameplay moves at most 50 ms
  // at once, so a slow frame can't drop a piece several rows in one go.
  step(ms) {
    if (this.over) return;
    this.rec(ms);
    const dt = Math.min(50, ms);
    this.elapsed += ms;
    for (const k of ['left', 'right']) {
      if (k in this.held && this.elapsed >= this.held[k]) {
        if (this.tryMove(k === 'left' ? -1 : 1, 0)) this.sfx('move');
        this.held[k] = this.elapsed + ARR;
      }
    }
    const c = this.cur, iv = 'down' in this.held ? Math.min(this.gravity, SOFT) : this.gravity;
    if (this.hits(c.m, c.x, c.y + 1)) {
      this.dropAcc = 0; this.lockT += dt;
      if (this.lockT >= LOCK) this.lock();
    } else {
      this.lockT = 0; this.dropAcc += dt;
      while (this.dropAcc >= iv) { this.dropAcc -= iv; if (!this.tryMove(0, 1)) { this.dropAcc = 0; break; } }
    }
    if (this.battle && !this.over) this.raiseSolids();
  }
}

// Plays a recorded game again from its seed and returns how it ended
export function replay(mode, rand, code) {
  const game = new Game(mode, rand);
  for (const [, n, c] of code.matchAll(/(\d+)|([A-Za-z])/g)) {
    if (game.over) break;
    if (n) game.step(Number(n));
    else if (KEY[c]) game.press(KEY[c]);
    else if (KEY[c.toUpperCase()]) game.release(KEY[c.toUpperCase()]);
  }
  return game;
}
