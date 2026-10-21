# 7etris

Tetris-style game for phones, played as a home-screen web app. Plain HTML/CSS/JS modules, no build step.

## How to work here

- Reply to the user in Portuguese (Brazil).
- Keep the code clean: remove whatever a change makes obsolete; no leftover files or test scripts in the repo.
- Bump `VERSION` in `main.js` on every change to the game, so the player can check the menu ("vN") to confirm the update reached their phone.
- Never commit anything personal; the repo is public.
- `README.md` (in Portuguese) is the public face of the repo: update it when a change adds, removes or renames something it describes (modes, controls, skins, install steps). Its screenshots live in `.github/screenshots/`.

## Deploying

- Game: every push to `main` is published by GitHub Pages at https://mrcelomn.github.io/7etris/.
- Server (Cloudflare Worker + D1 database + live Durable Object): its code lives in the private repo `mrcelomn/7etris-server`, kept out of this public one along with its Cloudflare IDs and the developer page. To work on it, attach it with add_repo, clone it next to this repo (never inside it) and follow its CLAUDE.md. `.github/workflows/server.yml` checks it out as `server/` and deploys it with the `CLOUDFLARE_API_TOKEN` secret; it runs on pushes that touch `engine.js` or `rules.js` (ranked games are replayed on the server with the same rules) and by hand after a server change.
- That checkout uses the `SERVER_REPO_TOKEN` secret, a token that **expires around 2026-12-20**. When it's close, remind the user to generate a new one (fine-grained, `7etris-server` only, Contents read-only) and replace the secret here; once it expires, server deploys fail but the running server keeps working.
- The server lives at `https://7etris.mrcelomn.workers.dev`. That address appears in `account.js`, `live.js`, `sw.js` and in the server repo; change them all together if it moves again.
- Cloud sessions work straight on `main`: there's no local wrangler login, so the server is only updated by pushing. The cloud proxy blocks `*.workers.dev` and `github.io`, so neither the server nor the live site can be checked from a session; use `gh run list` to confirm a deploy succeeded.

## Current state

Latest version: v61. Recent changes:

- v58: every battle (against the AI and online) opens with a 3-2-1 countdown with a beep (`count`/`go` sounds in `audio.js`), also on "play again"; pausing during it restarts it from 3.
- v59: on Android the pause button fell off the bottom of the screen. The `100lvh` screen height (a fix for iOS 26 home-screen apps) now applies only on iOS (`@supports (-webkit-touch-callout: none)`); Android uses `100dvh`.
- v60: the Worker's subdomain changed to `7etris.mrcelomn.workers.dev`.
- v61: no change for the player; the server code moved to the private repo and the public history was rewritten to drop it.

Waiting on the player to confirm:

- That the pause button now shows on Android (v59).
- That v60 reached the phone and the ranking and accounts work on the new server address. If a phone is stuck on an old version, closing the app completely and reopening it usually fixes it: `sw.js` is network-first but serves the cached copy when the network takes over 3 seconds.

## The database is live

The D1 database `7etris` holds real players' accounts and records; the server repo's CLAUDE.md has the rules for touching it.
