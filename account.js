// The player's account on the 7etris server (server/worker.js): a name and a secret code.
// Without one the player is a visitor, whose data stays on this phone and out of the ranking.

const API = 'https://7etris.7etris-jogo.workers.dev';
// { name, code, saved } signed in (saved: kept in this phone's passwords), { guest: true } visitor,
// absent: not chosen yet
const KEY = '7etris-account';
const PENDING = '7etris-pending'; // finished ranked games still to send: [{ mode, seed, replay, tries }]

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
// Games played by another account don't belong to the new one
const forget = () => write(PENDING, null);
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
export async function signIn(code, saved = false) {
  const prev = session;
  session = { code: code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^(.{4})(.+)$/, '$1-$2') };
  const res = await call('GET', '/me');
  if (!res.ok) {
    session = prev;
    return { error: res.status === 401 ? 'Código não encontrado.' : res.body.error || 'Não deu para entrar.' };
  }
  session.name = res.body.name;
  session.saved = saved;
  write(KEY, session);
  forget();
  return res.body;
}
// The account kept in the phone's password manager (iCloud Keychain on iPhone, Google Password
// Manager on Android) as a passkey whose user id is the code itself: it survives removing the
// home-screen shortcut, and Face ID or a fingerprint brings it back from a list of the saved accounts
export const canSaveOnDevice = () => !!window.PublicKeyCredential;
const challenge = () => crypto.getRandomValues(new Uint8Array(32));
export async function saveOnDevice() {
  await navigator.credentials.create({ publicKey: {
    rp: { name: '7etris' },
    user: { id: new TextEncoder().encode(session.code), name: session.name, displayName: session.name },
    challenge: challenge(),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none',
  } });
  session.saved = true;
  write(KEY, session);
}
// The code of the account picked from the phone's list; throws if the player cancels
export async function codeFromDevice() {
  const cred = await navigator.credentials.get({ publicKey: { challenge: challenge(), userVerification: 'required' } });
  return new TextDecoder().decode(cred.response.userHandle);
}

// The account, null without a connection, or { gone: true } when the server no longer has it
export async function fetchMe() {
  const res = await call('GET', '/me');
  if (res.status === 401) return { gone: true };
  return res.ok ? res.body : null;
}

// Settings and battle wins follow the account; changes are sent a moment later, together
let saveTimer = 0;
export function saveData(data) {
  if (!signedIn()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call('PUT', '/me', { data }), 1500);
}

// Sends a finished ranked game ({ mode, seed, replay }) for the server to play again and check:
// { score, best, record, rank }, { error }, { offline: true } when it's kept to send later, or
// { gone: true } when the server no longer has the account
export async function sendGame(game) {
  const res = await call('POST', '/games', game, 15000);
  if (res.ok) return res.body;
  if (res.status === 401) return { gone: true };
  if (res.status === 0 || res.status >= 500) {
    write(PENDING, [...read(PENDING, []), { ...game, tries: 1 }]);
    return { offline: true };
  }
  return { error: res.body.error || 'A partida não foi aceita.' };
}
// Retries the games that couldn't be sent
export async function sendPending() {
  const list = read(PENDING, []);
  if (!list.length || !signedIn()) return;
  const left = [];
  for (const { tries, ...game } of list) {
    const res = await call('POST', '/games', game, 15000);
    if (res.status === 0 || (res.status >= 500 && tries < 5)) left.push({ ...game, tries: tries + (res.status ? 1 : 0) });
  }
  write(PENDING, left);
}

export async function ranking(mode) {
  const res = await call('GET', `/ranking/${mode}`);
  return res.ok ? res.body : { error: res.body.error };
}
