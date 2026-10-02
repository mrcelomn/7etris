// Playfield rules shared by the player's game (main.js) and the AI opponent (ai.js).
// Boards are ROWS arrays of COLS cells holding a piece letter, 'G' for garbage, or null;
// the top HID rows sit above the visible field, where pieces spawn.

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

// Removes full rows and returns how many there were
export function clearLines(board) {
  let n = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every(Boolean)) { board.splice(y, 1); board.unshift(Array(COLS).fill(null)); n++; y++; }
  }
  return n;
}

// Pushes `n` garbage rows up from the bottom, all with their hole in the same random column
export function addGarbage(board, n) {
  const hole = Math.floor(Math.random() * COLS);
  for (let i = 0; i < n; i++) {
    board.shift();
    const row = Array(COLS).fill('G');
    row[hole] = null;
    board.push(row);
  }
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
