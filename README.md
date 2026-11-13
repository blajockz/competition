# Unified Competition Platform

RoboPath + The Locked Phone + the 1v1 Huruf showdown, merged into one live event app
with a unified scoreboard, team management and real-time sync between three screens:

| Screen | URL | Access |
|---|---|---|
| Public event page | `https://YOUR-DOMAIN/` | open to everyone: presents the event, live status and standings, "Join your team" |
| Admin control panel | `https://YOUR-DOMAIN/admin` | `ADMIN_ACCESS_CODE` |
| Big screen (projector) | `https://YOUR-DOMAIN/host` | `HOST_ACCESS_CODE` |
| Team devices | `https://YOUR-DOMAIN/play` (or scan the team QR code) | the team's join code |

---

## Deploy for free on Koyeb (no domain needed)

See **[DEPLOY-KOYEB.md](DEPLOY-KOYEB.md)**: push to GitHub, connect the repo in
Koyeb, paste the environment variables, deploy. You get `https://<app>.koyeb.app`.

## Deploy on your own domain (Docker)

**You need:** a Linux server with Docker + Docker Compose, ports 80 and 443 open,
and a domain (or sub-domain) whose DNS `A` record points to the server.

### 1. Configure

A ready `.env` is included with strong generated secrets and your Supabase project.
Open it and set your domain:

```
DOMAIN=competition.your-club.ma
ACME_EMAIL=you@example.com
```

Your access codes are in `.env` (`ADMIN_ACCESS_CODE`, `HOST_ACCESS_CODE`). Keep `.env` private.
`EVENT_NAME` sets the name shown on the public page and the login screens.
The public page never links to `/admin` or `/host`: organisers open those addresses directly.

### 2. Create the database tables (once)

In the Supabase dashboard → **SQL Editor** → New query → paste the whole content of
**`supabase/schema.local.sql`** → **Run**.

`schema.local.sql` is `schema.sql` with your `APP_SYNC_SECRET` already inserted.
(If you change `APP_SYNC_SECRET` in `.env`, run the file again with the new value.)
Running it again later is safe: it never deletes data.

Check: `select public.cp_ping('<APP_SYNC_SECRET>');` should return `{"ok": true, ...}`.

### 3. Start

```bash
docker compose up -d --build
docker compose logs -f app      # "State loaded from supabase …" then "listening"
```

Caddy gets the HTTPS certificate for `DOMAIN` automatically (give it a minute the first time).
Open `https://YOUR-DOMAIN/admin`.

**Update after a change:** `docker compose up -d --build`
**Stop:** `docker compose down` (data stays in Supabase and in the `app-data` volume)

#### Already running nginx / Traefik on the server?
Use `deploy/docker-compose.no-caddy.yml` (app on `127.0.0.1:8080`) and the example
`deploy/nginx.conf`. Important: no buffering on `/api/stream` (live updates).

---

## Event day

1. **Admin → Participants**: add people one by one, or paste/import a CSV
   (`Full Name, Filière, Year` — year 1, 2 or 3).
2. **Admin → Event → Generate teams.** Teams are balanced automatically:
   T = ⌈N/4⌉ teams (at least 2), sizes as even as possible (1–4 members:
   6 → 3+3, 5 → 3+2, 2 → 1+1), 3rd- then 2nd-year students are dealt first so every
   team gets a senior when possible. Each team gets a unique name (`Cyber Falcons`…),
   a distinct colour and a join code. You can move members, rename or regenerate in the lobby.
3. **Big screen**: open `/host`, enter the host code, tap “Enter full screen”.
   It shows every team with its join code and QR code.
4. **Teams** open `/play` (or scan their QR), log in, keep or change their team name
   (updates live on the big screen). Their screen stays locked.
5. **Begin competition** → synchronised 3-2-1-GO on every screen.
6. Teams play **RoboPath**, then **The Locked Phone**, on their own device. Points
   are added to their profile automatically; the big screen leaderboard moves live.
7. **Open challenge phase** (choose the minutes). Mini-games stop for everyone
   (points earned are kept).
8. Lower-ranked teams challenge higher-ranked ones. Accepted matches play one at a
   time (queue shown everywhere). Run each match from **Admin → Challenges**
   (presenter console: tap the letter the team names, judge answers, confirm the winner).
9. **End competition** → podium on the big screen.

### Scoring (every mini-game is worth 0–100)

| Game | Points |
|---|---|
| RoboPath | 6 levels: 10 + 12 + 15 + 18 + 20 + 25 = 100. The server replays every program before giving points. |
| The Locked Phone | 20 per lock opened (80) + battery bonus when the last lock opens (battery % ÷ 5, max 20). |
| Huruf challenge | Stake = base stake (50) × rank difference, locked when accepted. Winner +stake, loser −stake. |
| Admin override | Any ± adjustment with a reason (Admin → Scores), can be undone. |

**Skip:** on every RoboPath level and every Locked Phone lock, a team that is stuck can
press **Skip**: 0 points for that stage and the next one opens (a skipped RoboPath level
can still be solved later for its points; skipping the last lock gives no battery bonus).

### Challenge rules
- Only upward: rank #5 can challenge #1–#4, never the reverse. Each pair plays once.
- 2 denials per team (setting). With none left, challenges are accepted automatically.
  An unanswered request is accepted automatically after 45 s (setting).
- One match at a time, FIFO queue. Admin can extend the window, cancel a match,
  force a winner, undo a board move or fix a cell.

---

## How it works

```
 browsers ──HTTPS──> Caddy ──> app (Node.js, single process)
                                 │  validates every action, rate-limits,
                                 │  pushes live state (Server-Sent Events)
                                 └──> Supabase Postgres (cp_* functions)
                                      + local copy in the app-data volume
```

- **One authority**: the server holds the live state, checks every answer
  (Locked Phone answers never reach the browser, RoboPath runs are re-simulated),
  and sends each screen only what it may see (players never see Huruf answers).
- **Database** (`supabase/schema.sql`): `competition`, `participants`, `teams`,
  `game_progress`, `challenges`, `score_adjustments`, `event_log`, and the
  `v_leaderboard` view. RLS is on with no policies: the publishable key cannot read
  or write any table. The server writes through `SECURITY DEFINER` functions that
  require `APP_SYNC_SECRET`.
- **Resilience**: every change is saved to Supabase (and to `/data/snapshot.json`).
  If Supabase is unreachable, the event continues and syncs when it is back.
  A restart reloads the newest state.
- **Rate limiting** (in `server/ratelimit.js`): per address, per team and per admin
  session token buckets, stricter limits on answers, hints, skips, buzzer and
  challenges; wrong join/access codes block an address for a while (a correct code
  always works, so nobody can lock the organisers out). Exceeding a limit returns
  HTTP 429 with `Retry-After`.
- **Sessions**: signed tokens. Changing an access code, a join code or regenerating
  teams logs the old sessions out.
- **Screens**: forced full screen on host and team devices (a prompt comes back if
  they leave it; iPhone: “Add to Home Screen”), both club logos on every screen,
  synthesized sound effects for every game (mute button top right).

## Development

```bash
npm install
npm test                 # game rules, team generator, challenges, security
npm run build            # web app → web/dist
npm run start:local      # server on :8080 with .env
# or, with hot reload for the web app:
npm run dev:server  &  npm run dev:web   # http://localhost:5173
```

Set `STORAGE=local` in `.env` to run without Supabase (state in `data/`).

## Files

```
server/              Node.js server (no npm dependencies)
  index.js           HTTP API, live stream, static files
  competition.js     state machine, scoring, challenges, views per screen
  teams.js           balanced team generator, names, colours, codes
  games/             server rules: RoboPath, Locked Phone, Huruf (+ question bank)
  ratelimit.js auth.js db.js config.js
shared/              code used by server and browser (RoboPath engine, hex board)
web/                 React app (admin, host, play) + the three game UIs
supabase/schema.sql  database (schema.local.sql = with your secret, do not share)
deploy/              Caddyfile, nginx example, compose without Caddy
Dockerfile docker-compose.yml .env.example
```
