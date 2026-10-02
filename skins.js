// Block skins: each one draws a single s×s cell. Colors follow the modern guideline palette;
// the Game Boy skin swaps them for four LCD greens with a texture per piece, like the 1989 game.

// G is garbage sent by the opponent in battle; X is the darker, unclearable solid garbage
export const COLORS = { I: '#0f9bd7', O: '#e39f02', T: '#af298a', S: '#59b101', Z: '#d70f37', J: '#2141c6', L: '#e35b02', G: '#7a7f89', X: '#474b53' };

// Mix a #rrggbb color toward white (amt > 0) or black (amt < 0)
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16), to = amt > 0 ? 255 : 0, k = Math.abs(amt);
  const ch = v => Math.round(v + (to - v) * k);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function classic(ctx, x, y, s, c) {
  const e = Math.max(2, s * 0.14);
  ctx.fillStyle = c; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, y, s, e);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x, y + s - e, s, e);
}

function flat(ctx, x, y, s, c) {
  ctx.fillStyle = c; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
}

function glossy(ctx, x, y, s, c) {
  const g = ctx.createLinearGradient(0, y, 0, y + s);
  g.addColorStop(0, shade(c, 0.35)); g.addColorStop(0.5, c); g.addColorStop(1, shade(c, -0.3));
  ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x + s * 0.12, y + s * 0.1, s * 0.76, s * 0.32);
}

function outline(ctx, x, y, s, c) {
  const a = ctx.globalAlpha, w = Math.max(2, Math.round(s * 0.12));
  ctx.fillStyle = c;
  ctx.globalAlpha = a * 0.3; ctx.fillRect(x, y, s, s);
  ctx.globalAlpha = a;
  ctx.fillRect(x, y, s, w); ctx.fillRect(x, y + s - w, s, w);
  ctx.fillRect(x, y, w, s); ctx.fillRect(x + s - w, y, w, s);
}

function bevel(ctx, x, y, s, c) {
  const e = Math.max(2, s * 0.16);
  ctx.fillStyle = c; ctx.fillRect(x, y, s, s);
  const poly = (color, pts) => {
    ctx.fillStyle = color; ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.fill();
  };
  poly(shade(c, 0.4), [[x, y], [x + s, y], [x + s - e, y + e], [x + e, y + e], [x + e, y + s - e], [x, y + s]]);
  poly(shade(c, -0.4), [[x + s, y], [x + s, y + s], [x, y + s], [x + e, y + s - e], [x + s - e, y + s - e], [x + s - e, y + e]]);
}

const LCD = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
// Per piece: [inset in pixel units, LCD shade] layers, drawn outside in
const LCD_TEXTURE = {
  I: [[0, 0], [1, 1], [3, 3]],
  O: [[0, 0], [1, 3], [3, 0]],
  T: [[0, 0], [1, 2]],
  S: [[0, 0], [2, 1]],
  Z: [[0, 1], [1, 3], [3, 1]],
  J: [[0, 0], [1, 3], [2, 2]],
  L: [[0, 0], [1, 1], [2, 2], [3, 1]],
  G: [[0, 1], [2, 2]],
  X: [[0, 0], [2, 1]],
};
function gameboy(ctx, x, y, s, c, t) {
  if (!t) { ctx.fillStyle = c; ctx.fillRect(x, y, s, s); return; }
  const u = Math.max(1, Math.round(s / 9));
  for (const [inset, i] of LCD_TEXTURE[t]) {
    const d = inset * u;
    if (s - 2 * d <= 0) break;
    ctx.fillStyle = LCD[i]; ctx.fillRect(x + d, y + d, s - 2 * d, s - 2 * d);
  }
}

// Rounded rectangle path (arcTo works on every iOS version that runs the game)
function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Every piece in the app's red; `t` is null for the grey board after a loss
const MONO = '#a3245a';
function mono(ctx, x, y, s, c, t) { classic(ctx, x, y, s, t ? MONO : c); }

// A different grey per piece with a black rim, readable on both the dark and the light theme
const GREYS = { I: '#f2f2f2', O: '#c4c4c4', T: '#8f8f8f', S: '#dadada', Z: '#6e6e6e', J: '#adadad', L: '#7f7f7f', G: '#5a5a5a', X: '#333333' };
function greys(ctx, x, y, s, c, t) {
  const w = Math.max(1, Math.round(s * 0.08));
  ctx.fillStyle = '#111111'; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = t ? GREYS[t] : c; ctx.fillRect(x + w, y + w, s - 2 * w, s - 2 * w);
}

// Bright rim on a dark core, like lit tubes
function neon(ctx, x, y, s, c) {
  const a = ctx.globalAlpha, w = Math.max(2, Math.round(s * 0.12));
  ctx.fillStyle = c;
  ctx.globalAlpha = a * 0.18; ctx.fillRect(x, y, s, s);
  ctx.globalAlpha = a;
  ctx.fillRect(x + 1, y + 1, s - 2, w); ctx.fillRect(x + 1, y + s - 1 - w, s - 2, w);
  ctx.fillRect(x + 1, y + 1, w, s - 2); ctx.fillRect(x + s - 1 - w, y + 1, w, s - 2);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.fillRect(x + w + 1, y + w + 1, Math.max(1, s * 0.12), Math.max(1, s * 0.12));
}

// Soft colours, slightly rounded, with a gap between blocks
function pastel(ctx, x, y, s, c) {
  ctx.fillStyle = shade(c, 0.45);
  rounded(ctx, x + 1, y + 1, s - 2, s - 2, s * 0.18);
  ctx.fill();
}

// Very round blocks with a shine on top
function jelly(ctx, x, y, s, c) {
  ctx.fillStyle = c;
  rounded(ctx, x + 1, y + 1, s - 2, s - 2, s * 0.32);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  rounded(ctx, x + s * 0.2, y + s * 0.14, s * 0.6, s * 0.26, s * 0.13);
  ctx.fill();
}

// Obra Dinn: 1-bit ink on paper, each piece told apart by its dither pattern, like the game's
// old-Macintosh look. Patterns are drawn once per piece and size, then reused, because painting
// them pixel by pixel every frame would be slow. Ink and paper follow the theme (see setInk).
const DITHER = {
  I: (x, y) => y % 2 === 0,
  O: (x, y) => (x + y) % 2 === 0,
  T: (x, y) => !(x % 2 === 0 && y % 2 === 0),
  S: (x, y) => (x + y) % 3 === 0,
  Z: (x, y) => (x - y + 99) % 3 === 0,
  J: (x, y) => x % 2 === 0 && y % 2 === 0,
  L: (x, y) => x % 2 === 0,
  G: (x, y) => x % 3 === 0 || y % 3 === 0,
  X: () => true,
  dead: (x, y) => (x + y) % 4 === 0,
};
let ink = '#1b1a17', paper = '#e3dcc6';
const tiles = new Map();
export function setInk(i, p) {
  if (i === ink && p === paper) return;
  ink = i; paper = p;
  tiles.clear();
}
function obra(ctx, x, y, s, c, t) {
  const scale = ctx.getTransform().a, key = `${t || 'dead'}:${s}:${scale}`;
  let tile = tiles.get(key);
  if (!tile) {
    const px = Math.round(s * scale), dot = Math.max(1, Math.round(px / 10)), pattern = DITHER[t || 'dead'];
    tile = document.createElement('canvas');
    tile.width = tile.height = px;
    const g = tile.getContext('2d');
    g.fillStyle = paper; g.fillRect(0, 0, px, px);
    g.fillStyle = ink;
    for (let gy = dot * 2; gy < px - dot * 2; gy += dot) for (let gx = dot * 2; gx < px - dot * 2; gx += dot) {
      if (pattern(gx / dot, gy / dot)) g.fillRect(gx, gy, dot, dot);
    }
    g.lineWidth = dot;
    g.strokeStyle = ink;
    g.strokeRect(dot / 2, dot / 2, px - dot, px - dot);
    tiles.set(key, tile);
  }
  ctx.drawImage(tile, x, y, s, s);
}

export const SKINS = [
  { id: 'classic', name: 'CLÁSSICA', draw: classic },
  { id: 'flat', name: 'PLANA', draw: flat },
  { id: 'glossy', name: 'BRILHO', draw: glossy },
  { id: 'bevel', name: 'RELEVO', draw: bevel },
  { id: 'outline', name: 'CONTORNO', draw: outline },
  { id: 'mono', name: 'MONOCROMÁTICA', draw: mono },
  { id: 'greys', name: 'PRETO E BRANCO', draw: greys },
  { id: 'neon', name: 'NEON', draw: neon },
  { id: 'pastel', name: 'PASTEL', draw: pastel },
  { id: 'jelly', name: 'GELATINA', draw: jelly },
  { id: 'gameboy', name: 'GAME BOY', draw: gameboy },
  { id: 'obra', name: 'OBRA DINN', draw: obra },
];
const BY_ID = Object.fromEntries(SKINS.map(k => [k.id, k]));

// look: 'solid' | 'ghost' (landing preview, the same skin see-through) | 'dead' (board after a loss, drawn in `dead`)
export function drawBlock(ctx, skinId, x, y, s, t, look = 'solid', dead = '#4a4f59') {
  const skin = BY_ID[skinId] || BY_ID.classic;
  if (look === 'dead') return skin.draw(ctx, x, y, s, dead, null);
  if (look === 'ghost') ctx.globalAlpha = 0.3;
  skin.draw(ctx, x, y, s, COLORS[t], t);
  ctx.globalAlpha = 1;
}
