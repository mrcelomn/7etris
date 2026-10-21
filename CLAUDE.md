# 7etris

Tetris-style game for phones, played as a home-screen web app. Plain HTML/CSS/JS modules, no build step.

## How to work here

- Reply to the user in Portuguese (Brazil).
- Keep the code clean: remove whatever a change makes obsolete; no leftover files or test scripts in the repo.
- Bump `VERSION` in `main.js` on every change to the game, so the player can check the menu ("vN") to confirm the update reached their phone.
- Never commit anything personal; the repo is public.

## Deploying

- Game: every push to `main` is published by GitHub Pages at https://mrcelomn.github.io/7etris/.
- Server (`server/`, Cloudflare Worker + D1 database + live Durable Object): `.github/workflows/server.yml` deploys it on pushes that touch `server/`, `engine.js` or `rules.js` (ranked games are replayed on the server with the same rules). It uses the `CLOUDFLARE_API_TOKEN` repository secret.
- The server lives at `https://7etris.mrcelomn.workers.dev`. That address appears in `account.js`, `live.js`, `sw.js` and `server/dev.html`; change all four together if it moves again.
- Cloud sessions work straight on `main`: there's no local wrangler login, so the server is only updated by pushing. The cloud proxy blocks `*.workers.dev` and `github.io`, so neither the server nor the live site can be checked from a session; use `gh run list` to confirm a deploy succeeded.

## Current state

Latest version: v60. Recent changes:

- v58: every battle (against the AI and online) opens with a 3-2-1 countdown with a beep (`count`/`go` sounds in `audio.js`), also on "play again"; pausing during it restarts it from 3.
- v59: on Android the pause button fell off the bottom of the screen. The `100lvh` screen height (a fix for iOS 26 home-screen apps) now applies only on iOS (`@supports (-webkit-touch-callout: none)`); Android uses `100dvh`.
- v60: the Worker's subdomain changed to `7etris.mrcelomn.workers.dev`.

Waiting on the player to confirm:

- That the pause button now shows on Android (v59).
- That v60 reached the phone and the ranking and accounts work on the new server address. If a phone is stuck on an old version, closing the app completely and reopening it usually fixes it: `sw.js` is network-first but serves the cached copy when the network takes over 3 seconds.

## The database is live

The D1 database `7etris` holds real players' accounts and records. Never run blanket deletes on it. When testing, create a clearly named test account and delete only that account's rows afterwards (check `SELECT id, name FROM users` first). The developer page (`/dev`) is open only to the account whose id is `ADMIN_ID` in `server/wrangler.jsonc`.
