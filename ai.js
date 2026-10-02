import { COLS, ROWS, HID, SHAPES, rotCW, newBoard, spawnX, bag, collides, stamp, clearLines, exchange, ATTACK } from './rules.js';

// Offline opponent for the battle mode. For each piece it tries every rotation and column
// (and the held piece too, above easy), scores the stack each would leave with a classic hand-tuned
// heuristic (stack height, holes, bumpiness, lines cleared) and plays the best one after a
// "thinking" delay. Levels differ in speed, in how much random error they add, and in how
// hard they go for attacks: an attacking bot keeps the right-hand column empty as a well and
// saves line clears for multi-line ones (the ones that send garbage), until its stack gets
// dangerously tall and survival comes first again. Attacking needs hold, to park pieces while
// waiting for the I piece that fills the well.
const LEVELS = {
  easy: { delay: 1400, noise: 1, attack: false, hold: false },
  medium: { delay: 800, noise: 1, attack: true, hold: true },
  hard: { delay: 420, noise: 0, attack: true, hold: true },
};
const WELL = COLS - 1, SAFE_HEIGHT = 13;

export class Bot {
  constructor(level, onAttack) {
    this.cfg = LEVELS[level];
    this.onAttack = onAttack;
    this.board = newBoard();
    this.queue = [];
    this.hold = null;
    this.pending = 0;
    this.dead = false;
    this.wait = this.cfg.delay;
    this.piece = this.pull();
  }

  pull() {
    if (this.queue.length < 7) this.queue.push(...bag());
    return this.queue.shift();
  }

  // Garbage the player sent; it lands on the bot's next lock that clears nothing
  receive(n) { this.pending += n; }

  update(dt) {
    if (this.dead || (this.wait -= dt) > 0) return;
    this.wait = this.cfg.delay * (0.8 + Math.random() * 0.4);
    this.play();
  }

  play() {
    let best = this.bestFor(this.piece);
    if (this.cfg.hold) {
      const alt = this.bestFor(this.hold || this.queue[0]);
      if (alt && (!best || alt.score > best.score)) {
        const cur = this.piece;
        this.piece = this.hold || this.pull();
        this.hold = cur;
        best = alt;
      }
    }
    if (!best || !stamp(this.board, best.m, best.x, best.y, this.piece)) { this.dead = true; return; }
    const [sent, pending] = exchange(this.board, clearLines(this.board), this.pending);
    this.pending = pending;
    if (sent) this.onAttack(sent);
    this.piece = this.pull();
    const m = SHAPES[this.piece];
    if (collides(this.board, m, spawnX(m), HID - 1)) this.dead = true;
  }

  bestFor(t) {
    let best = null, m = SHAPES[t];
    for (let r = 0; r < (t === 'O' ? 1 : 4); r++, m = rotCW(m)) {
      for (let x = -2; x < COLS; x++) {
        if (collides(this.board, m, x, 0)) continue; // has to fit at the top to drop there
        let y = 0;
        while (!collides(this.board, m, x, y + 1)) y++;
        const score = this.evaluate(m, x, y, t) + (Math.random() - 0.5) * this.cfg.noise;
        if (!best || score > best.score) best = { m, x, y, score };
      }
    }
    return best;
  }

  evaluate(m, x, y, t) {
    const b = this.board.map(r => r.slice());
    stamp(b, m, x, y, t);
    const lines = clearLines(b);
    const heights = Array(COLS).fill(0);
    let holes = 0;
    for (let c = 0; c < COLS; c++) {
      let top = false;
      for (let r = 0; r < ROWS; r++) {
        if (b[r][c]) { if (!top) { heights[c] = ROWS - r; top = true; } } else if (top) holes++;
      }
    }
    const tallest = Math.max(...heights);
    const attacking = this.cfg.attack && tallest < SAFE_HEIGHT;
    // While attacking, the well is left out of the stack's shape and must stay empty
    const cols = attacking ? WELL : COLS;
    let bump = 0, height = 0;
    for (let c = 0; c < cols; c++) height += heights[c];
    for (let c = 0; c < cols - 1; c++) bump += Math.abs(heights[c] - heights[c + 1]);
    if (!attacking) return -0.51 * height - 0.36 * holes - 0.18 * bump + 0.76 * lines;
    // Weights tuned by simulation: height barely matters, holes and a filled well matter a lot,
    // and a single (which sends nothing) costs instead of paying
    return -0.05 * height - 1.2 * holes - 0.3 * bump - 4 * heights[WELL] + 6 * ATTACK[lines] - (lines && !ATTACK[lines] ? 4 : 0);
  }
}
