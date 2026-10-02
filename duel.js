// Online duel against a friend. The two phones talk directly to each other over WebRTC; the
// free public PeerJS server is only used so they can find each other. A room is a short code,
// and the host's peer id is "7etris-" + that code. PeerJS is loaded only when a duel starts.
//
// Messages: { t: 'start', seed } begins a round, { t: 'atk', n } is garbage sent,
// { t: 'board', b } is the sender's board after each lock, { t: 'over' } means the sender lost,
// and { t: 'ping' } is a heartbeat: WebRTC often never reports a phone that simply vanished
// (app closed, signal lost), so silence for longer than TIMEOUT counts as a dropped connection.
const PING_EVERY = 2000, TIMEOUT = 8000;

const PEERJS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = '7etris-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, which are easy to mix up

let loading = null;
function loadPeer() {
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => { loading = null; reject(new Error('load')); };
    document.head.append(s);
  });
  return loading;
}

export const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

// What went wrong, in words for the player
const ERRORS = {
  load: 'Não deu para carregar o modo online. Confira a internet e tente de novo.',
  'peer-unavailable': 'Nenhuma sala com esse código. Confira as letras com o seu amigo.',
  'unavailable-id': 'Esse código já está em uso. Crie a sala de novo.',
  network: 'Sem conexão com a internet.',
  'server-error': 'O serviço de conexão não respondeu. Tente de novo em instantes.',
};
const describe = e => ERRORS[e.type || e.message] || 'Algo deu errado na conexão. Tente de novo.';

export class Duel {
  // on: { ready(isHost), start(seed), attack(n), board(packed), over(), closed(), error(text) }
  constructor(on) {
    this.on = on;
    this.peer = this.conn = null;
    this.ended = false;
  }

  async host(code) {
    this.isHost = true;
    const Peer = await this.lib();
    if (!Peer) return;
    this.peer = new Peer(PREFIX + code);
    this.peer.on('connection', c => (this.conn ? c.close() : this.bind(c)));
    this.peer.on('error', e => this.fail(e));
  }

  async join(code) {
    this.isHost = false;
    const Peer = await this.lib();
    if (!Peer) return;
    this.peer = new Peer();
    this.peer.on('open', () => this.bind(this.peer.connect(PREFIX + code, { reliable: true })));
    this.peer.on('error', e => this.fail(e));
  }

  async lib() {
    try { return await loadPeer(); } catch (e) { this.fail(e); return null; }
  }

  bind(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.seen = Date.now();
      this.beat = setInterval(() => {
        if (Date.now() - this.seen > TIMEOUT) this.drop();
        else this.send({ t: 'ping' });
      }, PING_EVERY);
      this.on.ready(this.isHost);
    });
    conn.on('data', m => this.receive(m));
    conn.on('close', () => this.drop());
  }

  // The friend is gone: tell the game once, then tidy up
  drop() {
    if (this.ended) return;
    this.close();
    this.on.closed();
  }

  receive(m) {
    this.seen = Date.now();
    switch (m && m.t) {
      case 'start': this.on.start(m.seed); break;
      case 'atk': this.on.attack(m.n); break;
      case 'board': this.on.board(m.b); break;
      case 'over': this.on.over(); break;
    }
  }

  send(m) { if (this.conn && this.conn.open) this.conn.send(m); }

  fail(e) {
    if (this.ended) return;
    this.on.error(describe(e));
  }

  // Leaving on purpose: no "connection lost" message for ourselves
  close() {
    this.ended = true;
    clearInterval(this.beat);
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }
}
