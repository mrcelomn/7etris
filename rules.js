// Playfield rules shared by the player's game (main.js) and the AI opponent (ai.js).
// Boards are ROWS arrays of COLS cells holding a piece letter, 'G' for garbage, 'X' for solid
// garbage, or null; the top HID rows sit above the visible field, where pieces spawn.

export const COLS = 10, ROWS = 22, HID = 2, VIS = ROWS - HID;

export const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};

// Lines sent to the opponent for clearing 1, 2, 3 or 4 lines at once (Jstris' basic table)
export const ATTACK = [0, 0, 1, 2, 4];

export const rotCW = m => m.map((r, y) => r.map((_, x) => m[m.length - 1 - x][y]));
export const newBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
export const spawnX = m => Math.floor((COLS - m.length) / 2);

// One of each piece, shuffled with `rand` (a seeded one gives both duel players the same pieces)
export function bag(rand = Math.random) {
  const b = Object.keys(SHAPES);
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

// Small seeded random generator (mulberry32): the same seed always gives the same sequence
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Boards travel between duel players as one character per cell, '.' for empty
export const packBoard = board => board.map(r => r.map(c => c || '.').join('')).join('');
export const unpackBoard = s => Array.from({ length: ROWS }, (_, y) => [...s.slice(y * COLS, (y + 1) * COLS)].map(c => (c === '.' ? null : c)));

export function collides(board, m, px, py) {
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) {
    if (!m[y][x]) continue;
    const bx = px + x, by = py + y;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && board[by][bx]) return true;
  }
  return false;
}

// Writes piece `t` into the board; returns false when none of it landed in the visible field
export function stamp(board, m, px, py, t) {
  let visible = false;
  m.forEach((r, y) => r.forEach((v, x) => {
    if (!v) return;
    if (py + y >= 0) board[py + y][px + x] = t;
    if (py + y >= HID) visible = true;
  }));
  return visible;
}

// Removes full rows (solid garbage never clears) and returns how many there were
export function clearLines(board) {
  let n = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y][0] !== 'X' && board[y].every(Boolean)) { board.splice(y, 1); board.unshift(Array(COLS).fill(null)); n++; y++; }
  }
  return n;
}

// Rows of solid garbage at the bottom of the board
const solidCount = board => {
  let k = 0;
  while (k < board.length && board[board.length - 1 - k][0] === 'X') k++;
  return k;
};

// Pushes `n` garbage rows up from the bottom (resting on any solid garbage), all with their
// hole in the same random column
export function addGarbage(board, n) {
  const hole = Math.floor(Math.random() * COLS);
  for (let i = 0; i < n; i++) {
    board.shift();
    const row = Array(COLS).fill('G');
    row[hole] = null;
    board.splice(board.length - solidCount(board), 0, row);
  }
}

// Solid "hurry-up" garbage, as in Jstris: unclearable rows that rise from the bottom of both
// boards once a battle runs long. The first comes at SOLID_START, then they come faster and
// faster up to 12 rows, pause for 30 s (a window to finish the opponent), then climb one per
// second to the top. Returns how many solid rows a board should have `ms` into a battle.
const SOLID_START = 120000;
export function solidRowsAt(ms) {
  let t = ms - SOLID_START;
  if (t < 0) return 0;
  let rows = 1;
  for (let gap = 7000; rows < 12; gap -= 400, rows++) {
    if (t < gap) return rows;
    t -= gap;
  }
  t -= 30000;
  return t < 0 ? rows : Math.min(VIS, rows + 1 + Math.floor(t / 1000));
}

// Adds one solid row at the very bottom; false means it pushed blocks off the top (top-out)
export function addSolid(board) {
  const toppedOut = board[0].some(Boolean);
  board.shift();
  board.push(Array(COLS).fill('X'));
  return !toppedOut;
}

// Settles a lock: cleared lines first cancel garbage waiting to arrive, the rest is sent;
// with no clear, everything waiting rises into the board. Returns [sent, stillPending].
export function exchange(board, cleared, pending) {
  if (!cleared) {
    if (pending) addGarbage(board, pending);
    return [0, 0];
  }
  const attack = ATTACK[Math.min(cleared, 4)], cancel = Math.min(attack, pending);
  return [attack - cancel, pending - cancel];
}
