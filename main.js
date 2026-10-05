import * as audio from './audio.js';
import * as account from './account.js';
import * as live from './live.js';
import { initPad, placePad, editPad } from './pad.js';
import { SKINS, drawBlock, setInk } from './skins.js';
import { AVATARS, DEFAULT_AVATAR, drawAvatar } from './avatars.js';
import { COLS, ROWS, HID, VIS, SHAPES, newBoard, seeded, packBoard, unpackBoard } from './rules.js';
import { Game, PREVIEW, isMarathon, isBattle } from './engine.js';
import { Bot } from './ai.js';
import { Duel, newCode } from './duel.js';

const $ = id => document.getElementById(id);

// Bump on every deploy so the menu shows which version the phone is running
const VERSION = 57;

// Modes with a ranking: games played signed in are checked by the server (see account.js)
const RANKED = ['20', '40', '100', 'survival'];

// ---------- saved data ----------
function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; } catch (_) { return { ...fallback }; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}
// Best marathon time in ms keyed by line goal ('20'…), highest survival level ('survival') and
// battle wins keyed by mode ('ai-easy'…). Signed in, the first two are the server's checked ones.
let records = load('7etris-records', {});
const sound = load('7etris-audio', { music: true, musicVol: 60, sfx: true, sfxVol: 80, silentOk: false, pack: 'classic' });
// avatar: the profile picture's id (avatars.js); unset shows the default
const look = load('7etris-look', { skin: 'classic', theme: 'dark' });
// v15 changed the default controls back to the Game Boy layout; drop layouts saved for the old shapes
try { localStorage.removeItem('7etris-pad'); } catch (_) {}
// No saved layout means the default one, fitted to this screen
let savedPad = null;
try { savedPad = JSON.parse(localStorage.getItem('7etris-pad-2')); } catch (_) {}

// What follows the account from phone to phone: settings and battle wins
const WINS = ['ai-easy', 'ai-medium', 'ai-hard', 'duel'];
function accountData() {
  return { sound, look, pad: savedPad, wins: Object.fromEntries(WINS.filter(k => records[k]).map(k => [k, records[k]])) };
}
const sync = () => account.saveData(accountData());
function saveRecords() { save('7etris-records', records); }
// The account's records: battle wins from its data, checked scores from the server
// (survival comes as lines cleared and shows as the level reached)
function useAccountRecords(me) {
  const checked = { ...me.records };
  if ('survival' in checked) checked.survival = 1 + Math.floor(checked.survival / 10);
  records = { ...(me.data && me.data.wins), ...checked };
  saveRecords();
}

// CLÁSSICO means "the look's own sound": the Game Boy and Obra Dinn skins have their own music
// and effects, every other skin the game's default. Any other pack plays its effects over the
// default music, whatever the look.
const SKIN_SOUND = { gameboy: { pack: 'bit', song: 'gameboy' }, obra: { pack: 'obra', song: 'obra' } };
function syncAudio() {
  if (!audio.SOUND_PACKS.some(p => p.id === sound.pack)) sound.pack = 'classic'; // e.g. a pack since removed
  const own = sound.pack === 'classic' && SKIN_SOUND[look.skin];
  audio.configure({ ...sound, pack: own ? own.pack : sound.pack });
  audio.setSong(own ? own.song : 'modern');
}
syncAudio();

// ---------- game state ----------
let state = 'menu'; // menu | play | pause | done | edit
// '20' | '40' | '100' marathon line goal, 'survival', 'practice', a battle against the AI
// ('ai-easy' | 'ai-medium' | 'ai-hard'), or 'duel' against a friend online
let mode = '40';
let game = null; // the player's game (engine.js); null on the menu
let ranked = null; // the seed of this game's pieces, when it counts for the ranking
// Battles only: the opponent ({ board, dead, receive(n) }: the AI or the friend's mirror)
let foe = null;
let duel = null; // the open connection to a friend, while in a duel
let duelRoom = ''; // its room code

const goal = () => (isMarathon(mode) ? Number(mode) : Infinity);

// ---------- flow ----------
const SCREENS = ['menu', 'settingsScr', 'soundScr', 'skinScr', 'duelScr', 'accountScr', 'avatarScr', 'rankScr', 'pauseScr', 'result'];
function show(id) {
  SCREENS.forEach(s => { $(s).hidden = s !== id; });
  // Coming back to the menu always finds MARATONA, DUELOS and IA folded up
  if (id === 'menu') document.querySelectorAll('[aria-controls]').forEach(btn => {
    btn.setAttribute('aria-expanded', false);
    $(btn.getAttribute('aria-controls')).hidden = true;
  });
}
const on = (id, fn) => $(id).addEventListener('click', fn);

// `seed` is given in a duel, so both phones deal the same pieces. Signed in, a ranked mode deals
// from a seed too, which goes to the server with the recording so it can replay the game.
function startGame(m, seed) {
  mode = m;
  ranked = !seed && RANKED.includes(m) && account.signedIn() ? crypto.getRandomValues(new Uint32Array(1))[0] | 1 : null;
  if (ranked) seed = ranked;
  const rand = seed ? seeded(seed) : Math.random;
  game = new Game(m, rand, {
    sfx: audio.sfx,
    end: finish,
    sent: n => foe.receive(n),
    locked: () => { if (duel) duel.send({ t: 'board', b: packBoard(game.board) }); },
  }, !!ranked);
  foe = null;
  if (mode === 'duel') {
    foe = { board: newBoard(), dead: false, receive: n => duel && duel.send({ t: 'atk', n }) };
  } else if (isBattle(mode)) {
    foe = new Bot(mode.slice(3), n => { game.incoming += n; });
  }
  $('foeBox').hidden = !foe;
  if (foe) $('foeLabel').textContent = mode === 'duel' ? 'AMIGO' : 'IA';
  stepAcc = 0;
  live.start(account.signedIn() && account.session.code);
  state = 'play';
  show(null);
  stats();
  audio.musicPlay(true);
}

function releaseAll() { if (game) Object.keys(game.held).forEach(k => game.release(k)); }

function pause() {
  if (state !== 'play') return;
  state = 'pause';
  releaseAll();
  audio.musicStop();
  show('pauseScr');
}
function resume() {
  state = 'play';
  show(null);
  audio.musicPlay(false);
}

function finish(win) {
  state = 'done';
  audio.musicStop();
  audio.sfx(win ? 'win' : 'over');
  const level = game.level, elapsed = game.elapsed;
  if (isBattle(mode)) {
    if (!win && duel) duel.send({ t: 'over' });
    if (win) { records[mode] = (records[mode] || 0) + 1; saveRecords(); sync(); }
    result(win ? 'VITÓRIA!' : 'DERROTA', LEVEL_NAMES[mode], winsText(mode, mode === 'duel' ? 'contra amigos' : 'neste nível'));
  } else if (mode === 'survival' || win) {
    const main = win ? fmt(elapsed, 2) : `NÍVEL ${level}`;
    result(win ? `${mode} LINHAS` : 'FIM DE JOGO', main, '');
    if (ranked) checkGame(ranked, game.replay, win ? elapsed : level);
    else localRecord(win, elapsed, level);
  } else {
    const marathon = isMarathon(mode);
    result('FIM DE JOGO', marathon ? `Faltaram ${goal() - game.lines}` : `${game.lines} linhas`, fmt(elapsed, marathon ? 2 : 0));
  }
}
// A visitor's records stay on this phone
function localRecord(win, elapsed, level) {
  if (win) {
    const best = records[mode], isRecord = !best || elapsed < best;
    if (isRecord) { records[mode] = elapsed; saveRecords(); }
    $('resSub').textContent = isRecord ? 'NOVO RECORDE!' : `Recorde: ${fmt(best, 2)}`;
  } else {
    const best = records.survival || 0, isRecord = level > best;
    if (isRecord) { records.survival = level; saveRecords(); }
    $('resSub').textContent = isRecord ? 'NOVO RECORDE!' : `Recorde: nível ${best}`;
  }
}
// Signed in, the server replays the game and answers with the checked score and the ranking place.
// Without internet the game is kept and sent once there's a connection again.
const scoreText = (m, score) => (m === 'survival' ? `nível ${1 + Math.floor(score / 10)}` : fmt(score, 2));
// `value` is this game's time (marathon) or level (survival), shown until the server's answer comes
async function checkGame(seed, replay, value) {
  const m = mode, sub = $('resSub');
  sub.textContent = 'Conferindo…';
  const res = await account.sendGame({ mode: m, seed, replay });
  if (res.best !== undefined) {
    records[m] = m === 'survival' ? 1 + Math.floor(res.best / 10) : res.best;
    saveRecords();
  } else if (res.offline && !(records[m] && (m === 'survival' ? value <= records[m] : value >= records[m]))) {
    records[m] = value; // the menu shows it right away; the server confirms it later
    saveRecords();
  }
  if (res.gone) accountGone();
  if (game && game.mode !== m) return; // already playing something else
  if (res.gone) sub.textContent = GONE;
  else if (res.offline) sub.textContent = 'Sem internet: a partida fica salva e vai para o ranking quando a conexão voltar';
  else if (res.error) sub.textContent = res.error;
  else sub.textContent = `${res.record ? 'NOVO RECORDE!' : `Recorde: ${scoreText(m, res.best)}`} · ${res.rank}º no ranking`;
}
// Short enough to fit the result screen's big type on one line
const LEVEL_NAMES = { 'ai-easy': 'IA FÁCIL', 'ai-medium': 'IA MÉDIO', 'ai-hard': 'IA DIFÍCIL', duel: 'ONLINE' };
const winsText = (key, where = '') => {
  const n = records[key] || 0;
  return `${n} ${n === 1 ? 'vitória' : 'vitórias'}${where && ' ' + where}`;
};
function result(title, main, sub) {
  $('again').hidden = false;
  $('resTitle').textContent = title;
  $('resMain').textContent = main;
  $('resSub').textContent = sub;
  const pps = game.elapsed > 0 ? game.pieces / (game.elapsed / 1000) : 0;
  $('resStats').textContent = `${game.pieces} peças · ${pps.toFixed(2)} por segundo`;
  show('result');
}

function renderRecords() {
  document.querySelectorAll('[data-rec]').forEach(el => {
    const best = records[el.dataset.rec];
    el.textContent = best ? fmt(best, 2) : '—';
  });
  document.querySelectorAll('[data-wins]').forEach(el => {
    el.textContent = records[el.dataset.wins] ? winsText(el.dataset.wins) : '—';
  });
  $('survivalRec').textContent = records.survival ? `nível ${records.survival}` : '—';
  $('profileName').textContent = account.signedIn() ? account.session.name : 'VISITANTE';
  drawAvatar($('profileAvatar'), look.avatar, 32);
}
function openMenu() {
  state = 'menu';
  audio.musicStop();
  leaveDuel();
  live.stop();
  game = null; foe = null; ranked = null;
  $('foeBox').hidden = true;
  renderRecords();
  show('menu');
}

// Play again: in a duel this starts a new round on both phones
function again() {
  if (mode === 'duel') duelRound(); else startGame(mode);
}
// Deals a duel round: the same random seed goes to the friend, so both get the same pieces
function duelRound() {
  const seed = 1 + Math.floor(Math.random() * 2 ** 31);
  duel.send({ t: 'start', seed });
  startGame('duel', seed);
}

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.mode)));
// MARATONA, DUELOS and IA open their list of options underneath
document.querySelectorAll('[aria-controls]').forEach(btn => btn.addEventListener('click', () => {
  const list = $(btn.getAttribute('aria-controls')), open = list.hidden;
  list.hidden = !open;
  btn.setAttribute('aria-expanded', open);
}));
on('pauseBtn', pause);
on('resume', resume);
on('restart', again);
on('pauseMenu', openMenu);
on('again', again);
on('resMenu', openMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
// A phone turned sideways can't play (style.css covers the game with a notice), so it pauses
const sideways = matchMedia('(orientation: landscape) and (max-height: 500px)');
sideways.addEventListener('change', () => { if (sideways.matches) pause(); });

// ---------- account ----------
// First opening: the account screen, where the player signs up, signs in or plays as a visitor
function openAccount(firstTime = false) {
  const signed = account.signedIn();
  $('accGuest').hidden = signed;
  $('accUser').hidden = !signed;
  if (signed) { $('accUserName').textContent = account.session.name; $('accUserCode').textContent = account.session.code; }
  $('accDevice').hidden = !account.canSaveOnDevice();
  $('accSave').hidden = !account.canSaveOnDevice() || !!account.session?.saved;
  $('accName').value = ''; $('accCode').value = ''; $('accMsg').textContent = '';
  $('accBack').textContent = firstTime ? 'JOGAR COMO VISITANTE' : 'VOLTAR';
  drawAvatar($('accAvatarImg'), look.avatar, 88);
  show('accountScr');
}

// Profile picture: picked from the drawn ones, kept with the look (and so with the account)
for (const group of new Set(AVATARS.map(a => a.group))) {
  const label = document.createElement('div'), grid = document.createElement('div');
  label.className = 'glabel'; label.textContent = group;
  grid.className = 'avatar-grid';
  for (const a of AVATARS.filter(x => x.group === group)) {
    const b = document.createElement('button'), cv = document.createElement('canvas');
    b.dataset.avatar = a.id;
    b.setAttribute('aria-label', 'Foto ' + a.id);
    cv.className = 'avatar';
    b.append(cv);
    grid.append(b);
    drawAvatar(cv, a.id, 56);
    b.addEventListener('click', () => {
      look.avatar = a.id;
      save('7etris-look', look);
      sync();
      renderAvatars();
    });
  }
  $('avatarGroups').append(label, grid);
}
function renderAvatars() {
  const id = look.avatar || DEFAULT_AVATAR;
  document.querySelectorAll('[data-avatar]').forEach(b => b.classList.toggle('on', b.dataset.avatar === id));
  drawAvatar($('accAvatarImg'), id, 88);
  drawAvatar($('profileAvatar'), id, 32);
}
on('accAvatar', () => { renderAvatars(); show('avatarScr'); });
on('avatarBack', () => openAccount());
// Brings in a signed-in account's settings (a reload applies them everywhere at once)
function useAccount(me) {
  useAccountRecords(me);
  const d = me.data || {};
  if (d.sound) save('7etris-audio', d.sound);
  if (d.look) save('7etris-look', d.look);
  if (d.pad) save('7etris-pad-2', d.pad); else try { localStorage.removeItem('7etris-pad-2'); } catch (_) {}
  location.reload();
}
async function busy(btn, task) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await task(); } finally { btn.disabled = false; }
}
// The server no longer has this account: back to playing as a visitor, to sign up again
const GONE = 'Sua conta não existe mais no servidor. Crie uma nova em CONTA, no canto de cima do menu.';
function accountGone() {
  account.signOut();
  records = {};
  saveRecords();
  renderRecords();
}
on('openAccount', () => openAccount());
on('accCreate', () => busy($('accCreate'), async () => {
  $('accMsg').textContent = 'Criando…';
  // A visitor keeps their settings and battle wins; their records weren't checked, so they stay out
  const res = await account.signUp($('accName').value, accountData());
  if (res.error) { $('accMsg').textContent = res.error; return; }
  useAccountRecords(res);
  renderRecords();
  openAccount();
  $('accMsg').textContent = 'Conta criada! Anote o código ou salve a conta no celular.';
}));
on('accEnter', () => busy($('accEnter'), async () => {
  $('accMsg').textContent = 'Entrando…';
  const res = await account.signIn($('accCode').value);
  if (res.error) { $('accMsg').textContent = res.error; return; }
  useAccount(res);
}));
// Signing in from the accounts saved in the phone's passwords
on('accDevice', () => busy($('accDevice'), async () => {
  let code;
  try { code = await account.codeFromDevice(); } catch (_) { $('accMsg').textContent = 'Nenhuma conta escolhida.'; return; }
  $('accMsg').textContent = 'Entrando…';
  const res = await account.signIn(code, true);
  if (res.error) { $('accMsg').textContent = res.error; return; }
  useAccount(res);
}));
on('accSave', () => busy($('accSave'), async () => {
  try { await account.saveOnDevice(); } catch (_) { $('accMsg').textContent = 'A conta não foi salva.'; return; }
  $('accSave').hidden = true;
  $('accMsg').textContent = 'Conta salva! Para entrar de novo, toque em CONTAS SALVAS NO CELULAR.';
}));
on('accCopy', async () => {
  try { await navigator.clipboard.writeText(account.session.code); $('accMsg').textContent = 'Código copiado.'; } catch (_) {}
});
on('accOut', () => {
  if (!confirm('Sair da conta? Você volta a jogar como visitante. Para entrar de novo, use o seu código.')) return;
  account.signOut();
  records = {};
  saveRecords();
  openMenu();
});
on('accBack', () => {
  if (!account.session) account.playAsGuest();
  openMenu();
});

// ---------- ranking ----------
let rankMode = '40';
async function showRanking(m) {
  rankMode = m;
  document.querySelectorAll('[data-rank]').forEach(b => b.classList.toggle('on', b.dataset.rank === m));
  $('rankList').replaceChildren();
  $('rankMsg').textContent = 'Carregando…';
  const res = await account.ranking(m);
  if (rankMode !== m) return;
  if (res.error) { $('rankMsg').textContent = res.error; return; }
  const row = (pos, r, me) => {
    const li = document.createElement('li'), cv = document.createElement('canvas');
    if (me) li.className = 'me';
    cv.className = 'avatar';
    drawAvatar(cv, me ? look.avatar : r.avatar, 26);
    for (const [cls, text] of [['pos', `${pos}º`], ['avatar'], ['who', r.name], ['score', scoreText(m, r.score)]]) {
      if (cls === 'avatar') { li.append(cv); continue; }
      const span = document.createElement('span');
      span.className = cls; span.textContent = text;
      li.append(span);
    }
    return li;
  };
  const mine = res.me && res.me.name;
  const items = res.top.map((r, i) => row(i + 1, r, r.name === mine));
  // The player's own place, when it's below the list
  if (res.me && res.me.rank > res.top.length) {
    const gap = document.createElement('li');
    gap.className = 'gap'; gap.textContent = '…';
    items.push(gap, row(res.me.rank, res.me, true));
  }
  $('rankList').replaceChildren(...items);
  $('rankMsg').textContent = res.top.length ? '' : 'Ninguém no ranking ainda. Seja o primeiro!';
  if (!account.signedIn()) $('rankMsg').textContent += (res.top.length ? '' : ' ') + 'Crie uma conta para entrar no ranking.';
}
on('openRanking', () => { show('rankScr'); showRanking(rankMode); });
document.querySelectorAll('[data-rank]').forEach(b => b.addEventListener('click', () => showRanking(b.dataset.rank)));
on('rankBack', openMenu);

// ---------- online duel ----------
// The duel screen shows either the create/join choices or, once in a room, its code
function duelStatus(text, room = '') {
  $('duelHome').hidden = !!room;
  $('duelWait').hidden = !room;
  $('duelRoom').textContent = room;
  $('duelMsg').textContent = text;
}
function leaveDuel() {
  if (duel) duel.close();
  duel = null;
}
function openDuel(how, code) {
  leaveDuel();
  duelRoom = code;
  duel = new Duel({
    // The host deals the first round as soon as the friend arrives
    ready: isHost => { if (isHost) duelRound(); else duelStatus('Conectado! Esperando o jogo começar…', code); },
    start: seed => startGame('duel', seed),
    attack: n => { if (mode === 'duel' && game) game.incoming += n; },
    board: b => { if (foe && mode === 'duel') foe.board = unpackBoard(b); },
    over: () => { if (state === 'play' || state === 'pause') game.end(true); },
    closed: () => {
      duel = null;
      if (mode === 'duel' && (state === 'play' || state === 'pause' || state === 'done')) {
        state = 'done'; game.over = true; game.cur = null; audio.musicStop();
        result('CONEXÃO PERDIDA', 'O duelo acabou', 'Seu amigo saiu ou ficou sem internet.');
        $('again').hidden = true;
      } else duelStatus('A conexão caiu. Tente de novo.');
    },
    error: text => { leaveDuel(); duelStatus(text); },
  });
  if (how === 'host') { duelStatus('Esperando seu amigo entrar…', code); duel.host(code); }
  else { duelStatus('Conectando…', code); duel.join(code); }
}
on('openDuel', () => { duelStatus(''); $('duelCode').value = ''; show('duelScr'); });
on('duelCreate', () => openDuel('host', newCode()));
on('duelJoin', () => {
  const code = $('duelCode').value.trim().toUpperCase();
  if (code.length !== 5) return duelStatus('O código tem 5 letras ou números.');
  openDuel('join', code);
});
on('duelBack', () => { leaveDuel(); duelStatus(''); show('menu'); });

// ---------- sound settings ----------
function renderSound() {
  $('musicOn').setAttribute('aria-pressed', sound.music);
  $('sfxOn').setAttribute('aria-pressed', sound.sfx);
  $('silentOn').setAttribute('aria-pressed', sound.silentOk);
  $('musicVol').value = sound.musicVol;
  $('sfxVol').value = sound.sfxVol;
  document.querySelectorAll('[data-pack]').forEach(b => b.classList.toggle('on', b.dataset.pack === sound.pack));
}
function setSound(patch) {
  Object.assign(sound, patch);
  syncAudio();
  save('7etris-audio', sound);
  sync();
  renderSound();
}
// The music plays while this screen is open, so volume changes can be heard
on('openSound', () => { renderSound(); show('soundScr'); audio.musicPlay(true); });
on('soundBack', () => { audio.musicStop(); show('settingsScr'); });
on('musicOn', () => setSound({ music: !sound.music }));
on('sfxOn', () => { setSound({ sfx: !sound.sfx }); audio.sfx('rotate'); });
on('silentOn', () => setSound({ silentOk: !sound.silentOk }));
$('musicVol').addEventListener('input', e => setSound({ musicVol: +e.target.value }));
$('sfxVol').addEventListener('input', e => setSound({ sfxVol: +e.target.value }));
$('sfxVol').addEventListener('change', () => audio.sfx('lock'));

// One row per sound pack; picking one plays a short sample of it (a move, a rotate, a combo)
for (const pack of audio.SOUND_PACKS) {
  const b = document.createElement('button');
  b.className = 'row skin';
  b.dataset.pack = pack.id;
  b.textContent = pack.name;
  $('packList').append(b);
  b.addEventListener('click', () => {
    setSound({ pack: pack.id });
    audio.sfx('move');
    setTimeout(() => audio.sfx('rotate'), 120);
    [0, 1, 2].forEach(c => setTimeout(() => audio.sfx('clear', c), 300 + c * 180));
  });
}

// ---------- settings ----------
on('openSettings', () => show('settingsScr'));
on('settingsBack', () => show('menu'));

// ---------- look: skins and light/dark ----------
function setLook(patch) {
  Object.assign(look, patch);
  save('7etris-look', look);
  sync();
  applyLook();
  resize(); // the Game Boy skin frames the playfield, which changes the board's size
}
// The Game Boy and Obra Dinn skins restyle the whole app (see style.css) through data-skin
function applyLook() {
  document.documentElement.dataset.theme = look.theme;
  document.documentElement.dataset.skin = look.skin;
  syncAudio(); // with CLÁSSICO, the Game Boy and Obra Dinn looks bring their own sound
  readPalette();
  document.querySelector('meta[name="theme-color"]').content = css().getPropertyValue('--bg').trim();
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === look.theme));
  document.querySelectorAll('[data-skin]').forEach(b => b.classList.toggle('on', b.dataset.skin === look.skin));
  drawSide();
}
document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => setLook({ theme: b.dataset.themeSet })));

// One row per skin, each with a strip of sample blocks drawn in that skin
const SAMPLE = ['T', 'S', 'L', 'I', 'O'];
for (const skin of SKINS) {
  const b = document.createElement('button');
  b.className = 'row skin';
  b.dataset.skin = skin.id;
  b.textContent = skin.name;
  const cv = document.createElement('canvas');
  b.append(cv);
  $('skinList').append(b);
  const ctx = sizeCanvas(cv, SAMPLE.length * 20, 20);
  SAMPLE.forEach((t, i) => drawBlock(ctx, skin.id, i * 20, 0, 20, t));
  b.addEventListener('click', () => setLook({ skin: skin.id }));
}
on('openSkins', () => show('skinScr'));
on('skinBack', () => show('settingsScr'));

// ---------- controls ----------
// A, B and hard drop act on every press, so a release iOS never reports can't leave them stuck
function press(k) { if (state === 'play') game.press(k); }
function release(k) { if (state === 'play') game.release(k); }
initPad({ press, release }, savedPad);
on('openPad', () => {
  state = 'edit';
  show(null);
  editPad(layout => { savedPad = layout; save('7etris-pad-2', layout); sync(); state = 'menu'; show('settingsScr'); });
});

const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up', ' ': 'up', x: 'a', X: 'a', c: 'b', C: 'b', Shift: 'b' };
addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.key === 'p') { if (state === 'play') pause(); else if (state === 'pause') resume(); return; }
  const k = KEYMAP[e.key];
  if (!k || state !== 'play') return;
  e.preventDefault();
  if (!e.repeat) press(k);
});
addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) release(k); });

// Cancelling touch defaults stops iOS from scrolling, zooming or showing the text magnifier
// while playing. Menus (.ui) keep them, so their buttons and sliders work normally.
const blockTouch = e => { if (!e.target.closest('.ui')) e.preventDefault(); };
document.addEventListener('touchstart', blockTouch, { passive: false });
document.addEventListener('touchmove', blockTouch, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
// iOS only lets sound start inside a tap
['touchend', 'pointerup', 'keydown'].forEach(t => addEventListener(t, audio.unlock));

// ---------- drawing ----------
const css = () => getComputedStyle(document.documentElement);
// Canvas colors come from the current theme's CSS tokens
let PANEL, GRID, DEAD;
function readPalette() {
  const s = css(), v = name => s.getPropertyValue(name).trim();
  PANEL = v('--panel'); GRID = v('--grid'); DEAD = v('--dead');
  if (look.skin === 'obra') setInk(v('--ink'), v('--paper'));
}
let cell = 18, bctx, hctx, nctx, fctx;

function sizeCanvas(cv, w, h) {
  const d = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
  return c;
}
function resize() {
  const f = $('field'), lcd = getComputedStyle($('lcd')), brand = $('brand');
  // Room taken by the LCD's frame and the name under it (only the Game Boy look has them)
  const chrome = sides => sides.reduce((n, k) => n + parseFloat(lcd[`border${k}Width`]) + parseFloat(lcd[`padding${k}`]), 0);
  const below = brand.offsetHeight && brand.offsetHeight + parseFloat(getComputedStyle(brand).marginTop);
  const w = f.clientWidth - 4 - chrome(['Left', 'Right']), h = f.clientHeight - 1 - chrome(['Top', 'Bottom']) - below;
  cell = Math.max(10, Math.floor(Math.min(h / VIS, w / 14.4)));
  f.style.setProperty('--c', cell + 'px');
  const sw = Math.round(cell * 1.9) - 2;
  bctx = sizeCanvas($('board'), cell * COLS, cell * VIS);
  hctx = sizeCanvas($('hold'), sw, Math.round(cell * 1.5));
  nctx = sizeCanvas($('next'), sw, Math.round(cell * 1.5) * PREVIEW);
  fctx = sizeCanvas($('foe'), sw, sw * 2); // the AI's board, 10×20 tiny cells
  drawSide();
  placePad();
}

const block = (ctx, x, y, s, t, kind) => drawBlock(ctx, look.skin, x, y, s, t, kind, DEAD);

function drawBoard() {
  const c = cell, ctx = bctx;
  ctx.fillStyle = PANEL; ctx.fillRect(0, 0, c * COLS, c * VIS);
  ctx.fillStyle = GRID;
  for (let x = 1; x < COLS; x++) ctx.fillRect(x * c, 0, 1, c * VIS);
  for (let y = 1; y < VIS; y++) ctx.fillRect(0, y * c, c * COLS, 1);
  if (!game) return;
  for (let y = HID; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = game.board[y][x];
    if (t) block(ctx, x * c, (y - HID) * c, c, t, state === 'done' ? 'dead' : 'solid');
  }
  const cur = game.cur;
  if (!cur) return;
  const gy = game.ghostY();
  cur.m.forEach((r, y) => r.forEach((v, x) => { if (v && gy + y >= HID) block(ctx, (cur.x + x) * c, (gy + y - HID) * c, c, cur.t, 'ghost'); }));
  cur.m.forEach((r, y) => r.forEach((v, x) => { if (v && cur.y + y >= HID) block(ctx, (cur.x + x) * c, (cur.y + y - HID) * c, c, cur.t, 'solid'); }));
}

function mini(ctx, t, cx, cy, s, kind) {
  const m = SHAPES[t];
  const rows = m.map((r, y) => r.some(Boolean) ? y : -1).filter(y => y >= 0);
  const cols = m[0].map((_, x) => m.some(r => r[x]) ? x : -1).filter(x => x >= 0);
  const ox = Math.round(cx - cols.length * s / 2), oy = Math.round(cy - rows.length * s / 2);
  rows.forEach((y, ry) => cols.forEach((x, rx) => { if (m[y][x]) block(ctx, ox + rx * s, oy + ry * s, s, t, kind); }));
}
function drawSide() {
  if (!hctx) return;
  const w = parseFloat($('hold').style.width), h = parseFloat($('hold').style.height), s = Math.max(4, Math.floor(cell * 0.42));
  hctx.fillStyle = PANEL; hctx.fillRect(0, 0, w, h);
  const nh = parseFloat($('next').style.height);
  nctx.fillStyle = PANEL; nctx.fillRect(0, 0, w, nh);
  if (!game) return;
  if (game.hold) mini(hctx, game.hold, w / 2, h / 2, s, game.canHold ? 'solid' : 'dead');
  game.queue.slice(0, PREVIEW).forEach((t, i) => mini(nctx, t, w / 2, h * i + h / 2, s, 'solid'));
}

// Battle extras: the opponent's board in miniature, and the red bar beside the board showing
// garbage on its way to the player (it lands on the next lock that clears nothing)
function drawBattle() {
  const w = parseFloat($('foe').style.width), s = w / COLS;
  fctx.fillStyle = PANEL; fctx.fillRect(0, 0, w, s * VIS);
  for (let y = HID; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = foe.board[y][x];
    if (t) block(fctx, x * s, (y - HID) * s, s, t, foe.dead ? 'dead' : 'solid');
  }
  $('meter').style.height = `${(Math.min(game.incoming, VIS) / VIS) * 100}%`;
}

// m:ss with `dp` decimals of a second
function fmt(ms, dp) {
  const s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60;
  const sec = dp ? (Math.floor(r * 10 ** dp) / 10 ** dp).toFixed(dp).padStart(dp + 3, '0') : String(Math.floor(r)).padStart(2, '0');
  return `${m}:${sec}`;
}
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
const statEls = { label: $('linesLbl'), lines: $('lines'), midLabel: $('piecesLbl'), pieces: $('pieces'), time: $('time') };
function stats() {
  const marathon = isMarathon(mode) && game, survival = mode === 'survival' && game;
  const lines = game ? game.lines : 0;
  setText(statEls.label, marathon ? 'FALTAM' : 'LINHAS');
  setText(statEls.lines, String(marathon ? Math.max(0, goal() - lines) : lines));
  setText(statEls.midLabel, survival ? 'NÍVEL' : 'PEÇAS');
  setText(statEls.pieces, String(survival ? game.level : game ? game.pieces : 0));
  setText(statEls.time, fmt(game ? game.elapsed : 0, marathon ? 1 : 0));
}

// What the developer's live page shows of this game: the board with the falling piece in it
function liveState() {
  const b = game.board.map(r => r.slice()), c = game.cur;
  if (c) c.m.forEach((r, y) => r.forEach((v, x) => { if (v && c.y + y >= 0) b[c.y + y][c.x + x] = c.t; }));
  return {
    mode, room: mode === 'duel' ? duelRoom : '',
    b: packBoard(b), hold: game.hold || '', next: game.queue.slice(0, PREVIEW).join(''),
    lines: game.lines, pieces: game.pieces, level: game.level, incoming: game.incoming, time: Math.floor(game.elapsed),
    paused: state === 'pause', over: game.over, won: game.won,
  };
}

// ---------- loop ----------
// The game moves in whole-ms steps of at least 16 ms (60 a second, even on 120 Hz screens):
// that's what a ranked game records, and fewer, steadier steps keep the server's replay quick
let last = Math.floor(performance.now()), stepAcc = 0;
function frame(t) {
  const now = Math.floor(t), real = now - last;
  last = now;
  if (state === 'play' && !game.over) {
    stepAcc += real;
    if (stepAcc >= 16) { game.step(stepAcc); stepAcc = 0; }
    if (foe && state === 'play') {
      if (foe.update) foe.update(real); // the AI thinks; a friend's moves arrive as messages
      if (foe.dead) game.end(true);
    }
  }
  stats();
  if (bctx) drawBoard();
  if (state === 'play' || state === 'pause' || state === 'done') drawSide();
  if (foe && game) drawBattle();
  if (game) live.update(liveState, now);
  requestAnimationFrame(frame);
}

$('ver').textContent = 'v' + VERSION;
applyLook();
resize();
openMenu();
if (!account.session) openAccount(true);
// Signed in, whenever there's a connection: send the games saved offline and bring the records up to date
async function catchUp() {
  if (!account.signedIn()) return;
  await account.sendPending();
  const me = await account.fetchMe();
  if (!me) return;
  if (me.gone) {
    accountGone();
    if (state === 'menu') { openAccount(); $('accMsg').textContent = 'Sua conta não existe mais no servidor. Crie uma nova.'; }
    return;
  }
  useAccountRecords(me);
  if (state === 'menu') renderRecords();
}
catchUp();
addEventListener('online', catchUp);
requestAnimationFrame(t => { last = Math.floor(t); frame(t); });
addEventListener('resize', resize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize).catch(() => {});
