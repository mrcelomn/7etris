// The player's account on the 7etris server (server/worker.js): a name and a secret code.
// Without one the player is a visitor, whose data stays on this phone and out of the ranking.

const API = 'https://7etris.7etris-jogo.workers.dev';
const KEY = '7etris-account'; // { name, code } signed in, { guest: true } visitor, absent: not chosen yet
const PENDING = '7etris-pending'; // finished ranked games still to send: [{ id, replay, tries }]
// Ranked games dealt ahead of time, so one played without internet still counts: { mode: [{ id, seed }] }
const TICKETS = '7etris-tickets', STOCK = 2;

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } };
const write = (key, v) => { try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} };

export let session = read(KEY, null);
export const signedIn = () => !!(session && session.code);

// Answers come back as { ok, status, body }; status 0 means no connection
async function call(method, path, body, timeout = 8000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (signedIn()) headers.Authorization = `Bearer ${session.code}`;
    const res = await fetch(API + path, { method, headers, body: body && JSON.stringify(body), signal: ctl.signal });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (_) {
    return { ok: false, status: 0, body: { error: 'Sem conexão com a internet.' } };
  } finally {
    clearTimeout(timer);
  }
}

export function playAsGuest() { session = { guest: true }; write(KEY, session); }
// Games dealt to or played by another account don't belong to the new one
const forget = () => { write(PENDING, null); write(TICKETS, null); };
export function signOut() { playAsGuest(); forget(); }

// Both return { error } or the account: { name, data, records }
export async function signUp(name, data) {
  const res = await call('POST', '/signup', { name, data });
  if (!res.ok) return { error: res.body.error || 'Não deu para criar a conta.' };
  session = { name: res.body.name, code: res.body.code };
  write(KEY, session);
  forget();
  return { name: session.name, data, records: {} };
}
export async function signIn(code) {
  const prev = session;
  session = { code: code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^(.{4})(.+)$/, '$1-$2') };
  const res = await call('GET', '/me');
  if (!res.ok) {
    session = prev;
    return { error: res.status === 401 ? 'Código não encontrado.' : res.body.error || 'Não deu para entrar.' };
  }
  session.name = res.body.name;
  write(KEY, session);
  forget();
  return res.body;
}
export async function fetchMe() {
  const res = await call('GET', '/me');
  return res.ok ? res.body : null;
}

// Settings and battle wins follow the account; changes are sent a moment later, together
let saveTimer = 0;
export function saveData(data) {
  if (!signedIn()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call('PUT', '/me', { data }), 1500);
}

// A ranked game: pieces the server dealt ahead of time, or asked for now if none are left.
// null means play it unranked (no connection, nothing in stock).
export async function startRun(mode) {
  if (!signedIn()) return null;
  const stock = read(TICKETS, {}), ticket = (stock[mode] || []).shift();
  write(TICKETS, stock);
  if (ticket) return ticket;
  const res = await call('POST', '/runs', { mode }, 3000);
  return res.ok ? res.body : null;
}
// Keeps STOCK games dealt per ranked mode, ready for when there's no connection
let stocking = false;
export async function stockRuns(modes) {
  if (!signedIn() || stocking) return;
  stocking = true;
  try {
    for (const mode of modes) {
      while (true) {
        const stock = read(TICKETS, {});
        if ((stock[mode] || []).length >= STOCK) break;
        const res = await call('POST', '/runs', { mode });
        if (!res.ok) return;
        const now = read(TICKETS, {});
        write(TICKETS, { ...now, [mode]: [...(now[mode] || []), res.body] });
      }
    }
  } finally {
    stocking = false;
  }
}
// Sends a finished ranked game for the server to check: { score, best, record, rank }, { error },
// or { offline: true } when it's kept to send again later
export async function finishRun(id, replay) {
  const res = await call('POST', `/runs/${id}`, { replay }, 15000);
  if (res.ok) return res.body;
  if (res.status === 0 || res.status >= 500) {
    write(PENDING, [...read(PENDING, []), { id, replay, tries: 1 }]);
    return { offline: true };
  }
  return { error: res.body.error || 'A partida não foi aceita.' };
}
// Retries the games that couldn't be sent; true if any went through
export async function sendPending() {
  const list = read(PENDING, []);
  if (!list.length || !signedIn()) return false;
  const left = [];
  let sent = false;
  for (const run of list) {
    const res = await call('POST', `/runs/${run.id}`, { replay: run.replay }, 15000);
    if (res.ok) sent = true;
    else if (res.status === 0 || (res.status >= 500 && run.tries < 5)) left.push({ ...run, tries: run.tries + (res.status ? 1 : 0) });
  }
  write(PENDING, left);
  return sent;
}

export async function ranking(mode) {
  const res = await call('GET', `/ranking/${mode}`);
  return res.ok ? res.body : { error: res.body.error };
}
