# Unified Competition Platform

RoboPath + The Locked Phone + the N7 Quiz + the 1v1 Huruf showdown, merged into one live
event app with registration and check-in, a unified scoreboard, team management and
real-time sync between the screens:

| Screen | URL | Access |
|---|---|---|
| Public event page | `https://YOUR-DOMAIN/` | open to everyone: presents the event, live status and standings |
| Registration | `https://YOUR-DOMAIN/register` | open: full name, phone, field, year |
| Check-in | `https://YOUR-DOMAIN/checkin` (scan the QR on the big screen) | the QR code changes every minute |
| Admin control panel | `https://YOUR-DOMAIN/admin` | `ADMIN_ACCESS_CODE` |
| Big screen (projector) | `https://YOUR-DOMAIN/host` | `HOST_ACCESS_CODE` |
| Team devices | `https://YOUR-DOMAIN/play` (or scan the team QR code) | the team's join code |

---

## Deploy for free on Render (no domain needed)

See **[DEPLOY-RENDER.md](DEPLOY-RENDER.md)**: push to GitHub, create a Blueprint
from the repo in Render (it reads `render.yaml`), paste 5 values, deploy.
You get `https://<service>.onrender.com`.

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
Running it again later is safe: it never deletes data. **After an update of the app,
run it again**: it adds the new columns (phone, check-in, quiz) to an existing database.

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

1. **Registration** (before and on the day): students open `/register` (or scan the
   “Register” QR on the big screen) and give their full name, phone number, field and
   year. Every registration appears live in **Admin → Participants** (phone numbers are
   shown to the admin only). **Export Excel** downloads everyone (+ teams once drawn).
   The admin can also add people at the desk (confirmed at once) or import a CSV
   (`Full Name, Phone, Field, Year` — the phone is optional).
2. **Check-in**: Admin → Event → turn on **Check-in**. The big screen shows a QR code
   that changes every minute (a code stays valid 2–3 minutes, so a photo of it shared
   outside the room soon stops working). Registered students scan it: the phone they
   registered with confirms them in one tap; another phone asks for their number;
   someone who never registered can register there and is confirmed at once.
   The admin can also tick people present by hand, or “Mark all present”.
3. **Admin → Event → Generate teams** — only **confirmed** players are placed in teams
   (check-in closes). Teams are balanced automatically:
   T = ⌈N/4⌉ teams (at least 2), sizes as even as possible (1–4 members:
   6 → 3+3, 5 → 3+2, 2 → 1+1), 3rd- then 2nd-year students are dealt first so every
   team gets a senior when possible. Each team gets a unique name (`Cyber Falcons`…),
   a distinct colour and a join code. You can move members, rename or regenerate in the lobby.
4. **Big screen**: open `/host`, enter the host code, tap “Enter full screen”.
   During registration it shows the Register / Check-in QR codes and live counts;
   after the draw, every team with its join code and QR code.
5. **Teams** open `/play` (or scan their QR), log in, keep or change their team name
   (updates live on the big screen). Their screen stays locked.
6. **Begin competition** → synchronised 3-2-1-GO on every screen, and a **1:30:00**
   clock starts on the big screen (setting “Minutes before the challenge phase opens”).
7. Teams play **RoboPath**, then **The Locked Phone**, then the **N7 Quiz**, on their own
   device. Points are added automatically; the big screen leaderboard moves live.
8. When the clock reaches zero the **challenge phase opens by itself** (mini-games stop
   for everyone, points earned are kept). The admin can add/remove time (±5/±15 min)
   or open it earlier.
9. Lower-ranked teams challenge higher-ranked ones. Accepted matches play one at a
   time (queue shown everywhere). Run each match from **Admin → Challenges**
   (presenter console: tap the letter the team names, judge answers, confirm the winner).
10. **End competition** → podium on the big screen.

### Scoring

| Game | Points |
|---|---|
| RoboPath | 6 levels: 10 + 12 + 15 + 18 + 20 + 25 = 100. The server replays every program before giving points. |
| The Locked Phone | 20 per lock opened (80) + battery bonus when the last lock opens (battery % ÷ 5, max 20). |
| N7 Quiz | The original quiz scoring: 20 questions (gaming + security, 4 easy / 4 medium / 2 hard each), 20 s each. A correct answer earns 10 × difficulty (×1, ×1.5, ×2) × 40–100 % (faster = more). Max 280. Counted when the team finishes (the score is revealed at the end, like the original). Unanswered questions time out on the server. Leaving the quiz tab is recorded (Admin → Scores, ⇄). |
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
- The Huruf screens keep the original huroof-challenge look (Arabic, RTL): the big
  screen board, the presenter console (Admin → Challenges) and each team's answer
  button. If the answering team lets the answer clock run out, the question passes
  to the other team automatically (or the letter stays open if both missed).

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
  games/             server rules: RoboPath, Locked Phone, N7 Quiz, Huruf (+ question banks)
  ratelimit.js auth.js db.js config.js
shared/              code used by server and browser (RoboPath engine, hex board)
web/                 React app (landing, register/check-in, admin, host, play) + the four game UIs
supabase/schema.sql  database (schema.local.sql = with your secret, do not share)
deploy/              Caddyfile, nginx example, compose without Caddy
Dockerfile docker-compose.yml .env.example
```
