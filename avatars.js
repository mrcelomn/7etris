// Profile pictures, drawn instead of stored: a piece on a coloured background. First the seven
// plain pieces, then one per skin with its piece drawn in that skin. The developer's page
// (server/dev.html) imports this file from the site too, so both draw them the same way.
import { SHAPES } from './rules.js';
import { SKINS, drawBlock } from './skins.js';

const PIECES = { T: '#caffbf', I: '#ffd6a5', O: '#bde0fe', S: '#ffc6ff', Z: '#9bf6ff', J: '#fdffb6', L: '#ffadad' };
// Per skin: the piece shown and a background that suits the skin
const SKIN_LOOK = {
  classic: ['T', '#2a2f3a'], flat: ['L', '#ffd6a5'], glossy: ['S', '#bde0fe'], bevel: ['J', '#caffbf'],
  outline: ['Z', '#24324a'], mono: ['T', '#f6e3ec'], greys: ['L', '#3a3d44'], neon: ['S', '#2a1748'],
  pastel: ['O', '#fff1e6'], jelly: ['T', '#d8f3ff'], gameboy: ['L', '#9bbc0f'], obra: ['T', '#e3dcc6'],
};

export const AVATARS = [
  ...Object.entries(PIECES).map(([t, bg]) => ({ id: `piece-${t}`, group: 'PEÇAS', t, bg, skin: 'classic' })),
  ...SKINS.map(k => {
    const [t, bg] = SKIN_LOOK[k.id] || ['T', '#2a2f3a'];
    return { id: `skin-${k.id}`, group: 'SKINS', t, bg, skin: k.id };
  }),
];
// What accounts that never picked one show
export const DEFAULT_AVATAR = 'piece-T';
const BY_ID = Object.fromEntries(AVATARS.map(a => [a.id, a]));

// Draws avatar `id` (the default when unknown) into canvas `cv`, `size` CSS pixels square
export function drawAvatar(cv, id, size) {
  const a = BY_ID[id] || BY_ID[DEFAULT_AVATAR];
  const d = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = cv.height = Math.round(size * d);
  cv.style.width = cv.style.height = size + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = a.bg;
  ctx.fillRect(0, 0, size, size);
  // The piece without its empty rows and columns, centred
  const m = SHAPES[a.t].filter(r => r.some(Boolean));
  const cols = m[0].map((_, x) => x).filter(x => m.some(r => r[x]));
  const s = Math.floor((size * 0.6) / Math.max(m.length, cols.length));
  const ox = Math.round((size - cols.length * s) / 2), oy = Math.round((size - m.length * s) / 2);
  m.forEach((r, y) => cols.forEach((x, i) => { if (r[x]) drawBlock(ctx, a.skin, ox + i * s, oy + y * s, s, a.t); }));
}
