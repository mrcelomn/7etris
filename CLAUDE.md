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

## The database is live

The D1 database `7etris` holds real players' accounts and records. Never run blanket deletes on it. When testing, create a clearly named test account and delete only that account's rows afterwards (check `SELECT id, name FROM users` first). The developer page (`/dev`) is open only to the account whose id is `ADMIN_ID` in `server/wrangler.jsonc`.
