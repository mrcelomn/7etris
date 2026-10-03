// 7etris accounts and ranking, on Cloudflare Workers with a D1 database (schema.sql).
// An account is a name and a secret code, nothing else; the code is all it takes to sign in,
// so only its hash is stored. Ranked games are checked by replaying them: the server deals the
// pieces (the seed), the phone sends back every step and press, and the server plays them again.
import { replay } from '../engine.js';
import { seeded } from '../rules.js';

const RANKED = ['20', '40', '100', 'survival'];
// Marathon ranks by time (lower is better), survival by lines cleared (higher is better)
const better = mode => (mode === 'survival' ? 'DESC' : 'ASC');
const beats = (mode, a, b) => (mode === 'survival' ? a > b : a < b);
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O or 1/I/L to mix up
const GRACE = 5000; // ms of clock difference allowed between the phone and the server

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json' } });
const fail = (status, error) => json({ error }, status);

async function hash(code) {
  const clean = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
async function user(req, db) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  return db.prepare('SELECT id, name, data FROM users WHERE code_hash = ?').bind(await hash(auth.slice(7))).first();
}
async function records(db, id) {
  const { results } = await db.prepare('SELECT mode, score FROM records WHERE user_id = ?').bind(id).all();
  return Object.fromEntries(results.map(r => [r.mode, r.score]));
}
async function rank(db, mode, score) {
  const sign = mode === 'survival' ? '>' : '<';
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM records WHERE mode = ? AND score ${sign} ?`).bind(mode, score).first();
  return row.n + 1;
}

const routes = {
  // { name, data } → { name, code }
  async 'POST /signup'(req, db) {
    const { name, data } = await req.json();
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N} _.-]{3,12}$/u.test(clean)) return fail(400, 'O nome precisa ter de 3 a 12 letras ou números.');
    if (await db.prepare('SELECT 1 FROM users WHERE name = ?').bind(clean).first()) return fail(409, 'Esse nome já está em uso.');
    const code = newCode();
    await db.prepare('INSERT INTO users (code_hash, name, data, created) VALUES (?, ?, ?, ?)')
      .bind(await hash(code), clean, JSON.stringify(data || {}).slice(0, 8000), Date.now()).run();
    return json({ name: clean, code });
  },
  async 'GET /me'(req, db, me) {
    return json({ name: me.name, data: JSON.parse(me.data || '{}'), records: await records(db, me.id) });
  },
  // Settings and battle wins: the player's own, unchecked
  async 'PUT /me'(req, db, me) {
    const { data } = await req.json();
    const text = JSON.stringify(data || {});
    if (text.length > 8000) return fail(413, 'Dados grandes demais.');
    await db.prepare('UPDATE users SET data = ? WHERE id = ?').bind(text, me.id).run();
    return json({ ok: true });
  },
  // A ranked game starts: the server picks its pieces and notes the time
  async 'POST /runs'(req, db, me) {
    const { mode } = await req.json();
    if (!RANKED.includes(mode)) return fail(400, 'Modo sem ranking.');
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 1;
    await db.batch([
      // Games are dealt ahead for offline play; keep a player's 20 newest, for up to 30 days
      db.prepare('DELETE FROM runs WHERE user_id = ? AND (started < ? OR id NOT IN (SELECT id FROM runs WHERE user_id = ? ORDER BY started DESC LIMIT 19))').bind(me.id, Date.now() - 30 * 864e5, me.id),
      db.prepare('INSERT INTO runs (id, user_id, mode, seed, started) VALUES (?, ?, ?, ?, ?)').bind(id, me.id, mode, seed, Date.now()),
    ]);
    return json({ id, seed });
  },
  // …and ends: { replay } is played again here; only what it really scores counts
  async 'POST /runs/:id'(req, db, me, id) {
    const run = await db.prepare('SELECT mode, seed, started FROM runs WHERE id = ? AND user_id = ?').bind(id, me.id).first();
    if (!run) return fail(404, 'Partida não encontrada.');
    const { replay: code } = await req.json();
    if (typeof code !== 'string' || code.length > 3e6) return fail(400, 'Replay inválido.');
    const game = replay(run.mode, seeded(run.seed), code);
    await db.prepare('DELETE FROM runs WHERE id = ?').bind(id).run(); // each game counts once
    const finished = run.mode === 'survival' ? game.over : game.won;
    if (!finished) return fail(422, 'A partida não confere.');
    if (game.elapsed > Date.now() - run.started + GRACE) return fail(422, 'O tempo da partida não confere.');
    const score = run.mode === 'survival' ? game.lines : game.elapsed;
    const old = await db.prepare('SELECT score FROM records WHERE user_id = ? AND mode = ?').bind(me.id, run.mode).first();
    const record = !old || beats(run.mode, score, old.score);
    if (record) {
      await db.prepare('INSERT INTO records (user_id, mode, score, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, mode) DO UPDATE SET score = excluded.score, at = excluded.at')
        .bind(me.id, run.mode, score, Date.now()).run();
    }
    const best = record ? score : old.score;
    return json({ score, best, record, rank: await rank(db, run.mode, best) });
  },
  // Top 50, plus the player's own place when signed in
  async 'GET /ranking/:mode'(req, db, me, mode) {
    if (!RANKED.includes(mode)) return fail(404, 'Modo sem ranking.');
    const { results } = await db.prepare(`SELECT u.name, r.score FROM records r JOIN users u ON u.id = r.user_id WHERE r.mode = ? ORDER BY r.score ${better(mode)}, r.at LIMIT 50`).bind(mode).all();
    let mine = null;
    if (me) {
      const row = await db.prepare('SELECT score FROM records WHERE user_id = ? AND mode = ?').bind(me.id, mode).first();
      if (row) mine = { name: me.name, score: row.score, rank: await rank(db, mode, row.score) };
    }
    return json({ top: results, me: mine });
  },
};
const PUBLIC = ['POST /signup', 'GET /ranking/:mode'];

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    const route = `${req.method} /${parts[0] || ''}${parts[1] ? '/:' + (parts[0] === 'runs' ? 'id' : 'mode') : ''}`;
    if (!routes[route]) return fail(404, 'Não encontrado.');
    try {
      const me = await user(req, env.DB);
      if (!me && !PUBLIC.includes(route)) return fail(401, 'Código não encontrado.');
      return await routes[route](req, env.DB, me, parts[1]);
    } catch (e) {
      return fail(500, 'Erro no servidor.');
    }
  },
};
