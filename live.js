// Live view for the developer's page (server/dev.html): during a game the phone keeps a socket
// open to the server and, only while that page is open (the server says 'watch'), sends what
// the game looks like a few times a second. Without a connection it simply does nothing.

const SOCKET = 'wss://7etris.7etris-jogo.workers.dev/live';
const EVERY = 200; // ms between updates

let ws = null, watching = false, lastSent = 0;

// `code`: the player's account code, so the page shows their name (none for a visitor)
export function start(code) {
  stop();
  try { ws = new WebSocket(code ? `${SOCKET}?as=${encodeURIComponent(code)}` : SOCKET); } catch (_) { return; }
  const me = ws;
  ws.onmessage = e => {
    try { const m = JSON.parse(e.data); if (m.t === 'watch') { watching = m.on; lastSent = 0; } } catch (_) {}
  };
  ws.onclose = () => { if (ws === me) { ws = null; watching = false; } };
}

// `snapshot` builds the game's state; it's only called when it's time to send
export function update(snapshot, now) {
  if (!ws || !watching || ws.readyState !== 1 || now - lastSent < EVERY) return;
  lastSent = now;
  try { ws.send(JSON.stringify(snapshot())); } catch (_) {}
}

export function stop() {
  if (ws) ws.close();
  ws = null;
  watching = false;
}
