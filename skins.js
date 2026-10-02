// Block skins: each one draws a single s×s cell. Colors follow the modern guideline palette;
// the Game Boy skin swaps them for four LCD greens with a texture per piece, like the 1989 game.

export const COLORS = { I: '#0f9bd7', O: '#e39f02', T: '#af298a', S: '#59b101', Z: '#d70f37', J: '#2141c6', L: '#e35b02' };

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

export const SKINS = [
  { id: 'classic', name: 'CLÁSSICA', draw: classic },
  { id: 'flat', name: 'PLANA', draw: flat },
  { id: 'glossy', name: 'BRILHO', draw: glossy },
  { id: 'bevel', name: 'RELEVO', draw: bevel },
  { id: 'outline', name: 'CONTORNO', draw: outline },
  { id: 'gameboy', name: 'GAME BOY', draw: gameboy, ghost: LCD[1] },
];
const BY_ID = Object.fromEntries(SKINS.map(k => [k.id, k]));

// look: 'solid' | 'ghost' (landing preview) | 'dead' (board after a loss, drawn in `dead`)
export function drawBlock(ctx, skinId, x, y, s, t, look = 'solid', dead = '#4a4f59') {
  const skin = BY_ID[skinId] || BY_ID.classic;
  if (look === 'ghost') {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = skin.ghost || COLORS[t];
    ctx.fillRect(x, y, s, s);
    ctx.globalAlpha = 1;
    return;
  }
  if (look === 'dead') skin.draw(ctx, x, y, s, dead, null);
  else skin.draw(ctx, x, y, s, COLORS[t], t);
}
