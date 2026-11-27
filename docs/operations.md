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

Measured use is recorded in the spec's decision log when checked.

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
- **Restoring:** first into a new database to check it (a new Neon branch, or the local
  Docker database), then into production only if needed. Set `RESTORE_DATABASE_URL` in
  the shell to the target's direct connection string, then:

  ```sh
  docker run --rm -e RESTORE_DATABASE_URL -v "$PWD/backups:/backups" postgres:16 \
    sh -c 'pg_restore --no-owner --no-privileges --clean --if-exists \
           --dbname="$RESTORE_DATABASE_URL" /backups/our-calendar-<date>.dump'
  ```

  `--clean --if-exists` replaces what is in the target. Tested on 2026-11-27: a backup
  of the local database restored into an empty one with the same row counts.
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
