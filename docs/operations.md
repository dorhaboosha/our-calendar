# Operations: free-tier limits, backups and monitoring

OurCalendar runs on free plans only: Render (the web service), Neon (Postgres), GitHub
Actions (CI and the scheduled export run) and the Google Calendar API. This page lists
their limits, how far we are from them, what happens if one is reached, and how to back
up the database and notice problems (spec 9).

The figures were read from the official pages on **2026-11-27**. Free plans change; the
links are where to check again.

## Limits and our use

### Render: the web service (Hobby workspace, free instance)

Sources: [Render free instances](https://render.com/docs/free),
[Render pricing](https://render.com/pricing),
[health checks](https://render.com/docs/health-checks).

| Limit                                                                    | Our use                                                                                                                                                                                                                                                                                                                                                                 | If reached                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **750 free instance hours a month, per workspace** (shared by every free service in it; a sleeping service uses none) | The service sleeps after 15 minutes without traffic. The export run every 30 minutes wakes it, so it is up about 16 of every 30 minutes: about 13 hours a day, **about 400 hours a month**, plus the time we use it. Fine as long as no other free web service in the same workspace is awake much. | Render suspends **all** free web services of the workspace until the start of the next month. |
| **5 GB outbound bandwidth a month** (Hobby workspace)                    | The app's static files are about 2 MB and cached by the browser; event data is a few KB a request. Far below.                                                                                                                                                                                                                                                         | Without a payment method, free services are suspended for the rest of the month.                                                             |
| **500 build pipeline minutes a month**                                   | One build per merge to `main` (`npm ci`, `next build`, migrations), a few minutes each.                                                                                                                                                                                                                                                                                 | New builds are disabled for the rest of the month; the running service keeps running.                                                         |
| Sleeps after 15 minutes idle; waking takes about a minute; Render may restart it at any time; no disk | Nothing is kept on the server's disk.                                                                                                                                                                                                                                                                                                                                  | The first visit after a sleep is slow.                                                                                                          |

Render calls the health check (`/api/health`) **every few seconds** while the service is
awake. It therefore doesn't touch the database: a query each time would keep Neon's
compute awake as long as Render is (see below).

### Neon: the database (Free plan)

Sources: [Neon plans](https://neon.com/docs/introduction/plans),
[history window](https://neon.com/docs/introduction/restore-window).

| Limit                                                                 | Our use                                                                                                                                                                                                                                         | If reached                                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **100 CU-hours of compute a month, per project**; compute scales to zero after 5 minutes idle (can't be turned off) | Compute wakes only for real requests and for each export run (48 a day, about 5 minutes each: about 4 hours a day). At the smallest size (0.25 CU) that is **about 30 CU-hours a month**, plus the time we use the app. | Compute is suspended until the next month (or an upgrade): the app can't reach its database. Data isn't lost. |
| **1 GB storage per project**                                          | A few MB: two users, events and their exports.                                                                                                                                                                                                  | Inserts, updates and deletes fail.                                                                           |
| **5 GB public network transfer a month, per project**                 | Small queries from Render; far below.                                                                                                                                                                                                           | Compute is suspended until the next month.                                                                  |
| **6 hours of history** (instant restore), 1 manual snapshot, 1 day of monitoring history | See [Backups](#backups-and-restore).                                                                                                                                                                                                            |                                                                                                              |

### GitHub Actions: CI and the scheduled export run

Sources: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

- The repository is public, so the standard runners are **free and unlimited**: CI on
  every push and pull request, and [`export-jobs.yml`](../.github/workflows/export-jobs.yml)
  48 times a day.
- Scheduled runs can be **delayed, or dropped, at busy times**, the start of every hour
  most of all. The export runs at 7 and 37 minutes past.
- **After 60 days without activity in the repository, GitHub turns scheduled workflows
  off.** Exports still run right after every change; only the retries of failed ones
  then wait until someone opens the app. Turn it on again under Actions > Export jobs.

### Google Calendar API

Sources: [Calendar API quotas](https://developers.google.com/workspace/calendar/api/guides/quotas),
[Calendar use limits](https://support.google.com/a/answer/2905486).

- **600 requests a minute per user** and 10,000 a minute per project, in a sliding
  window. The export runs up to four jobs at once, so a large full export could pass
  the per-user limit; the client keeps each user under **500 a minute**
  ([`rate-limit.ts`](../src/modules/google-export/rate-limit.ts)). A request Google
  refuses for its rate (403 or 429, `usageLimits`) is a temporary failure, tried again
  later.
- No daily request limit on the Standard Tier, which is free and on by default. From
  2027-04-01 every project is held to the Standard Tier unless enrolled in the paid
  Scaled Tier; we need nothing more. (The requirement from 2027-02-01 to use Google's
  MCP servers is for AI agents, not for this app.)
- Calendar's use limits block, for a few hours, someone who creates very many events or
  calendars in a short time (for example more than 60 calendars). The app creates one
  calendar per connection.

## Checking actual use

All read-only:

- **Render:** Workspace > Billing (or Usage): free instance hours used this month,
  outbound bandwidth, pipeline minutes; and the list of services in the workspace.
- **Neon:** the project's Billing / Usage page: compute (CU-hours), storage, network
  transfer. Settings > Compute: the compute size range.
- **GitHub:** Actions > Export jobs: recent runs, and whether the workflow is enabled.
- **Google Cloud:** APIs & Services > Google Calendar API > Metrics and Quotas.

Measured use is recorded below and in the spec's decision log when checked.

### Measured use

**2026-11-28** (the month so far; the export to Google has run since 2026-11-25):

| Service        | Used                                                                          | Limit                        |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| Render         | 43.22 free instance hours (the whole workspace); 68 MB bandwidth; 14 build minutes; $0 | 750 hours; 5 GB; 500 minutes |
| Neon           | 5.41 CU-hours; 32.12 MB storage; 2.28 MB network transfer; compute 0.25–2 CU, scales to zero after 5 minutes | 100 CU-hours; 1 GB; 5 GB     |
| GitHub Actions | Export jobs: 8 runs since 2026-11-26 (one by hand), 6 succeeded; the 2 failures were before the `CRON_SECRET` repository secret was set | free                         |
| Google         | 39 Calendar API requests in 7 days; 1 error (410: deleting an event already gone, which counts as done) | 600 a minute per user        |

- **The Render workspace is shared:** three other free web services of the same owner
  run in it and share the 750 hours. So far all of them together used 43 hours.
- **GitHub ran the schedule far less often than asked:** `*/30` should be 48 runs a day,
  but it ran about every 8 hours (7 scheduled runs from 26 to 28 November). That is why Render used so
  few hours: the estimate above assumes a wake-up every 30 minutes. Exports after
  changes don't depend on it, and every page view runs what is due; only retries of
  failed exports wait longer when nobody opens the app. The schedule moves to 7 and 37
  minutes past with Phase 5; check again a few days later. If it still runs only a few
  times a day, a free external scheduler (such as cron-job.org) calling the same
  endpoint with the same secret is the fallback.

## Backups and restore

- **The last six hours:** Neon's instant restore rolls the database back to any moment
  in its six-hour history window (Neon Console > the project > Restore). Use it right
  after a mistake.
- **Anything older:** a full backup with `npm run db:backup`
  ([`scripts/backup-db.mjs`](../scripts/backup-db.mjs)). It runs `pg_dump` in Docker,
  so only Docker is needed.
  1. In `.env`, set `BACKUP_DATABASE_URL` to the production `DIRECT_URL` (Neon's
     direct, not pooled, connection string). It is never printed.
  2. `npm run db:backup` writes `backups/our-calendar-<date>.dump`. `backups/` is
     git-ignored.
  - Back up once a month, and before a risky migration.
  - **A backup is secret:** it holds the users' emails, their sessions and the export's
    refresh tokens (encrypted with `TOKEN_ENCRYPTION_KEY`). Keep it on your own
    computer only.
- **Restoring:** always into a new, empty database, never over the one the app uses.
  Check it, and only then switch the app to it.
  1. Create an empty database: Neon Console > the project > the production branch >
     Databases > New database (for example `restore_20261128`). To try a backup out,
     the local Docker database works too.
  2. Restore into it. `read -rs` takes its **direct** connection string without showing
     it or keeping it in the shell's history; `export` passes it on to Docker:

     ```sh
     read -rs RESTORE_DATABASE_URL && export RESTORE_DATABASE_URL
     docker run --rm -e RESTORE_DATABASE_URL -v "$PWD/backups:/backups" postgres:16 \
       sh -c 'pg_restore --no-owner --no-privileges --single-transaction \
              --dbname="$RESTORE_DATABASE_URL" /backups/our-calendar-<date>.dump'
     unset RESTORE_DATABASE_URL
     ```

     `--single-transaction`: the first error rolls the whole restore back, so the
     database is either fully restored or left as it was.
  3. Check it: the tables and their row counts (`user`, `event`, `event_exception`,
     `google_export_target`), and the latest events.
  4. Switch production to it. First stop everything that writes to the old database:
     disable Actions > Export jobs, and suspend the service in Render. Then, in Render >
     the service > Environment, point `DATABASE_URL` (pooled) and `DIRECT_URL` (direct)
     at the new database, and resume the service; its build runs the migrations, which
     are already applied. Check the app, then enable Export jobs again. Keep the old
     database until you are sure.

  Tested on 2026-11-28 with the local database: a backup restored into an empty
  database with the same row counts, and restoring it again into the now full database
  failed at the first object and changed nothing.
- The image is `postgres:16` because the Neon project runs Postgres 16; `pg_dump` must be
  at least as new as the server. If Neon's version is raised, raise the image too (here
  and in the script).

## Monitoring

- **The export run:** a failed run of Actions > Export jobs means the app (or its
  database) didn't answer, or the secret doesn't match. GitHub can email failed
  workflow runs (Settings > Notifications > Actions).
- **The app:** the settings page shows each user's export state, and the header links
  to it when the export needs the user. Failed exports are retried on their own.
- **Render:** deploys, events and logs in the dashboard (logs kept 7 days on Hobby).
  Render restarts the service if the health check fails for a minute.
- **Neon:** the Monitoring page (1 day of history) and the usage page above.
