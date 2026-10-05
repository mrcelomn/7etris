// 7etris accounts and ranking, on Cloudflare Workers with a D1 database (schema.sql).
// An account is a name and a secret code, nothing else; the code is all it takes to sign in,
// so only its hash is stored. Ranked games are checked by replaying them: the phone sends the
// seed its pieces came from and every step and press, and the server plays them again.
// /dev is the developer's page (dev.html), open only with the ADMIN_ID account's code: it watches
// every game being played online, live, through the Live object below.
import DEV_PAGE from './dev.html';
import { DurableObject } from 'cloudflare:workers';
import { replay } from '../engine.js';
import { seeded } from '../rules.js';

const RANKED = ['20', '40', '100', 'survival'];
// Marathon ranks by time (lower is better), survival by lines cleared (higher is better)
const better = mode => (mode === 'survival' ? 'DESC' : 'ASC');
const beats = (mode, a, b) => (mode === 'survival' ? a > b : a < b);
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O or 1/I/L to mix up

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
  return byCode(db, auth.slice(7));
}
const byCode = async (db, code) => db.prepare('SELECT id, name, data FROM users WHERE code_hash = ?').bind(await hash(code)).first();
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
  // A finished ranked game, { mode, seed, replay }: played again here from its seed, and only
  // what it really scores counts. The phone deals its own pieces, so games played offline count too.
  async 'POST /games'(req, db, me) {
    const { mode, seed, replay: code } = await req.json();
    if (!RANKED.includes(mode)) return fail(400, 'Modo sem ranking.');
    if (!Number.isInteger(seed) || typeof code !== 'string' || code.length > 3e6) return fail(400, 'Partida inválida.');
    const game = replay(mode, seeded(seed), code);
    if (!(mode === 'survival' ? game.over : game.won)) return fail(422, 'A partida não confere.');
    const score = mode === 'survival' ? game.lines : game.elapsed;
    const old = await db.prepare('SELECT score FROM records WHERE user_id = ? AND mode = ?').bind(me.id, mode).first();
    const record = !old || beats(mode, score, old.score);
    if (record) {
      await db.prepare('INSERT INTO records (user_id, mode, score, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, mode) DO UPDATE SET score = excluded.score, at = excluded.at')
        .bind(me.id, mode, score, Date.now()).run();
    }
    const best = record ? score : old.score;
    return json({ score, best, record, rank: await rank(db, mode, best) });
  },
  // Top 50 (with when each record was set), plus the player's own place when signed in
  async 'GET /ranking/:mode'(req, db, me, mode) {
    if (!RANKED.includes(mode)) return fail(404, 'Modo sem ranking.');
    const { results } = await db.prepare(`SELECT u.name, r.score, r.at, json_extract(u.data, '$.look.avatar') AS avatar FROM records r JOIN users u ON u.id = r.user_id WHERE r.mode = ? ORDER BY r.score ${better(mode)}, r.at LIMIT 50`).bind(mode).all();
    let mine = null;
    if (me) {
      const row = await db.prepare('SELECT score FROM records WHERE user_id = ? AND mode = ?').bind(me.id, mode).first();
      if (row) mine = { name: me.name, score: row.score, rank: await rank(db, mode, row.score) };
    }
    return json({ top: results, me: mine });
  },
};
const PUBLIC = ['POST /signup', 'GET /ranking/:mode'];

// A live game as phones report it, rebuilt field by field so nothing else reaches the page
const LIVE_MODES = ['20', '40', '100', 'survival', 'practice', 'ai-easy', 'ai-medium', 'ai-hard', 'duel'];
function liveGame(g) {
  if (!g || !LIVE_MODES.includes(g.mode) || !/^[.IOTSZJLGX]{220}$/.test(g.b)) return null;
  const int = v => Math.max(0, Math.min(1e9, Math.floor(Number(v)) || 0));
  return {
    mode: g.mode, room: /^[A-Z0-9]{5}$/.test(g.room) ? g.room : '', b: g.b,
    hold: /^[IOTSZJL]?$/.test(g.hold) ? g.hold : '', next: /^[IOTSZJL]{0,5}$/.test(g.next) ? g.next : '',
    lines: int(g.lines), pieces: int(g.pieces), level: int(g.level), incoming: int(g.incoming), time: int(g.time),
    paused: g.paused === true, over: g.over === true, won: g.won === true,
  };
}

// One room for all live games: phones in a game connect as players, the developer's page as the
// viewer. The worker decides which is which and the player's name (from its account code), so
// neither can be faked. Players send their board only while a viewer is connected, so nothing
// runs otherwise (the sockets hibernate). Each player's latest board lives in its socket's attachment.
export class Live extends DurableObject {
  async fetch(req) {
    const viewer = req.headers.get('X-Role') === 'viewer';
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [viewer ? 'viewer' : 'player']);
    if (!viewer) server.serializeAttachment({ id: crypto.randomUUID(), name: req.headers.get('X-Name'), avatar: req.headers.get('X-Avatar') || '' });
    if (viewer) {
      const games = this.ctx.getWebSockets('player').map(ws => ws.deserializeAttachment()).filter(g => g.b);
      server.send(JSON.stringify({ t: 'all', games }));
      this.toPlayers({ t: 'watch', on: true });
    } else if (this.ctx.getWebSockets('viewer').length) {
      server.send(JSON.stringify({ t: 'watch', on: true }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  toPlayers(msg) { for (const ws of this.ctx.getWebSockets('player')) try { ws.send(JSON.stringify(msg)); } catch (_) {} }
  toViewers(msg) { for (const ws of this.ctx.getWebSockets('viewer')) try { ws.send(JSON.stringify(msg)); } catch (_) {} }
  webSocketMessage(ws, msg) {
    if (!this.ctx.getTags(ws).includes('player') || typeof msg !== 'string' || msg.length > 1500) return;
    let game;
    try { game = liveGame(JSON.parse(msg)); } catch (_) { return; }
    if (!game) return;
    const { id, name, avatar } = ws.deserializeAttachment();
    game = { id, name, avatar, ...game };
    ws.serializeAttachment(game);
    this.toViewers({ t: 'game', game });
  }
  webSocketClose(ws) {
    const tags = this.ctx.getTags(ws);
    if (tags.includes('player')) {
      this.toViewers({ t: 'gone', id: ws.deserializeAttachment().id });
    } else if (!this.ctx.getWebSockets('viewer').some(v => v !== ws)) {
      this.toPlayers({ t: 'watch', on: false });
    }
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
    const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'dev') return new Response(DEV_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (parts[0] === 'live') {
      if (req.headers.get('Upgrade') !== 'websocket') return fail(426, 'Só por WebSocket.');
      // ?code= is the developer's page; ?as= a phone in a game, signed in with that code or not
      const fwd = new Request(req), code = url.searchParams.get('code');
      if (code !== null) {
        const me = await byCode(env.DB, code);
        if (!me || me.id !== Number(env.ADMIN_ID)) return fail(403, 'Só o desenvolvedor.');
        fwd.headers.set('X-Role', 'viewer');
      } else {
        const as = url.searchParams.get('as'), me = as && await byCode(env.DB, as);
        fwd.headers.set('X-Role', 'player');
        fwd.headers.set('X-Name', me ? me.name : 'Visitante');
        const avatar = me && (JSON.parse(me.data || '{}').look || {}).avatar;
        if (/^[a-z]+-[A-Za-z]+$/.test(avatar || '')) fwd.headers.set('X-Avatar', avatar);
      }
      return env.LIVE.get(env.LIVE.idFromName('all')).fetch(fwd);
    }
    const route = `${req.method} /${parts[0] || ''}${parts[1] ? '/:mode' : ''}`;
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
