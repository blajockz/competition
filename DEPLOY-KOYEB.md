# Deploy on Koyeb (free, no domain needed)

Result: the app runs at `https://<app>-<your-org>.koyeb.app` with HTTPS,
built from your GitHub repository. Every `git push` to `main` redeploys it.

The repository already contains everything Koyeb needs: the `Dockerfile`
(Koyeb builds it), the app listens on port **8080**, the health check is
**`/api/health`**, and it must run as **one single instance**.

---

## 1. Create the database tables (once)

Supabase dashboard → **SQL Editor** → New query → paste the whole content of
`supabase/schema.local.sql` → **Run**.

> `schema.local.sql` contains your secret. It is in `.gitignore`: never push it.

## 2. Put the code on GitHub

Create an **empty private** repository on GitHub (no README), then in the
project folder:

```bash
git init -b main
git add .
git status            # .env and supabase/schema.local.sql must NOT be listed
git commit -m "Competition platform"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

`.env` (your codes and secrets) stays on your computer; you will type its
values into Koyeb in step 3.

## 3. Create the service on Koyeb

1. Sign up at <https://app.koyeb.com> (no credit card for the free instance).
2. **Create service** → **Web service** → **GitHub**.
3. Connect GitHub when asked (install the Koyeb GitHub app, allow it to read
   your repository), then pick your repository, branch `main`.
4. **Builder**: choose **Dockerfile** (leave the Dockerfile path and target empty).
5. **Instance**: **Free**. **Region**: **Frankfurt** (closest to Morocco).
6. **Environment variables**: add each line below. Copy the values from your
   `.env` file. You can mark the secret ones as *Secret*.

   | Name | Value |
   |---|---|
   | `PORT` | `8080` |
   | `TRUST_PROXY` | `true` |
   | `NEXT_PUBLIC_SUPABASE_URL` | from `.env` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from `.env` |
   | `APP_SYNC_SECRET` | from `.env` (secret) |
   | `ADMIN_ACCESS_CODE` | from `.env` (secret) |
   | `HOST_ACCESS_CODE` | from `.env` (secret) |
   | `TOKEN_SECRET` | from `.env` (secret) |
   | `EVENT_NAME` | from `.env` |
   | `EVENT_TIMEZONE` | `Africa/Casablanca` |
   | `LOCKED_PHONE_FLAG` | from `.env` |

   (`DOMAIN` and `ACME_EMAIL` are not needed on Koyeb.)
7. **Exposed ports**: port **8080**, protocol **HTTP**, path **/**
   (remove any other port, such as 8000).
8. **Health checks**: **HTTP**, port **8080**, path **`/api/health`**.
9. **Scaling**: fixed, **1** instance (the free instance cannot scale anyway;
   never run 2 instances: the live game state lives in one process).
10. Name the service (it becomes part of your address), then **Deploy**.

The first build takes a few minutes. In the logs you should see:

```
State loaded from supabase (version …)
Competition platform listening on http://0.0.0.0:8080  (storage: supabase)
```

Open `https://<app>-<your-org>.koyeb.app` → the public page.
Staff: `/admin` (admin code) and `/host` (host code). Teams: `/play`.

### Command line instead (optional)

With the Koyeb CLI installed and `koyeb login` done:

```bash
./deploy/koyeb-deploy.sh github.com/<your-user>/<your-repo> competition
```

It creates the same service, reading the values from your local `.env`.

---

## Good to know

- **Sleep**: the free instance sleeps after **1 hour without requests** and
  wakes in a few seconds on the next visit. Open the site 5 minutes before the
  event. During the event every open screen sends a small keep-alive request
  every 4 minutes, so it stays awake.
- **Nothing is lost** when it sleeps or restarts: every change is saved to
  Supabase and reloaded on start.
- **Supabase free projects pause after a week without activity.** If the app
  logs "Supabase not reachable", open the Supabase dashboard and restore the
  project, then redeploy on Koyeb.
- **Update the app**: `git push` → Koyeb rebuilds and redeploys automatically.
- **Change a code or secret**: Koyeb → service → Settings → Environment
  variables → save (it redeploys). If you change `APP_SYNC_SECRET`, run
  `supabase/schema.sql` again with the new value.
- **Wrong port error / health check failing**: check that the exposed port and
  the health check both use **8080** and that `PORT=8080` is set.
