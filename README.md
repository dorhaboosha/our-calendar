# OurCalendar

A private shared calendar for two people (Dor and Maayan), in Hebrew and right-to-left.
Each of us sees both calendars in one place, and events are exported automatically to a
dedicated "Our Calendar" calendar in each person's Google account, so they show up on
our phones.

> **Status:** Phase 4 (the export to Google Calendar) is done, on top of the repeating
> events of Phase 3 and the calendar, events and filters of Phase 2. Next: hardening and
> release (Phase 5: home-screen install, refresh on return, touch targets). See
> [`Project Spec.md`](Project%20Spec.md) for the full spec and decision log (Hebrew),
> and [`docs/discovery.md`](docs/discovery.md) for the Phase 0 discovery report.

## What it does

- **Month, week and day views**, in Hebrew and right to left. A computer opens in
  month view, a phone in day view. The view and date are kept in the URL, and a date
  picker jumps to any date (outlined in the month and week views).
- **Events** have a title, an owner (Dor, Maayan, or shared), a category, a time or
  "all day" (one day or several), and an optional location and description. Both users
  create, edit and delete any event. New events start from where you clicked.
- **Repeating events:** every day, week, two weeks (on chosen weekdays), month or year,
  with no end, until a date, or a number of times. Editing or deleting one occurrence
  asks whether the change is for this occurrence, this one and the following ones, or
  all of them. The details show how the event repeats, in Hebrew.
- **Clicking an event** (or Enter on it) shows its details and who created and last
  edited it, with "edit" and "delete" (which asks first).
- **No lost edits:** if the other person changed or deleted an event while you were
  editing it, your save is refused with a message, instead of overwriting their change.
- **Colors** belong to owners: each user picks their own in settings, and either can
  change the shared events' color. Colors must stand out on white and differ clearly
  from each other.
- **Filters** by owner and by category, kept in the URL. The owner chips are also the
  color legend.
- **Export to Google Calendar:** each of us connects our own Google account in settings.
  The app creates a calendar named "Our Calendar" there and keeps every event in it up
  to date (personal ones titled "Dor: ..." or "Maayan: ...", and colored by owner),
  repeating events and their changed occurrences too. Settings show the export's state;
  "export again" repairs the calendar (also one deleted in Google), and disconnecting
  asks whether to keep the calendar or delete it.

## How it works

- **The app is the source of truth.** Events live in the app's PostgreSQL database.
  Changes are exported one way to Google Calendar; nothing is imported back.
- **Only two people can sign in**, with their Google accounts. The allowed emails are
  environment variables; there is no sign-up.
- **Sign-in asks Google only for name and email.** Calendar permission is requested
  separately, when a user connects the export, and only for
  `calendar.app.created`: the app can reach only the calendar it creates, never the
  user's other calendars.
- **The export runs through a queue.** Saving a change also queues its export, in the
  same database transaction; the job runs right after the response, and a failure is
  tried again later (see [Google export jobs](#google-export-jobs)). Google event ids
  come from the app's ids, so a retry never makes a copy. Refresh tokens are encrypted
  (AES-256-GCM) with `TOKEN_ENCRYPTION_KEY`. Edits made in Google are overwritten by the
  next export.

## Installing on a phone

OurCalendar installs as an app (a PWA, spec 8.1): it gets its own icon on the home screen
and opens in its own window, without the browser's bar.

- **Android (Chrome):** open the site, then the menu (⋮) → "Install app" (or "Add to home
  screen"). Chrome may also offer it in a banner.
- **iPhone (Safari):** open the site, then Share (the square with an arrow) → "Add to Home
  Screen" → "Add". The iPhone never offers it by itself.

It still needs the internet: there is no offline mode.

**The logo:** [`public/logo.svg`](public/logo.svg) is the only source: a white month page
on the brand color, with three days marked in Dor's, Maayan's and the shared events'
colors, in the same style as OurBasket's logo. The favicon is the SVG itself; every PNG
(the 32×32 favicon, 192 and 512, the maskable 192 and 512 that Android crops to its own
shape, and the iPhone's 180) is made from it by
[`src/app/icons/[name]/route.tsx`](src/app/icons/[name]/route.tsx), at build time. To
change the logo, replace the SVG: keep its background the brand color
(`appConfig.themeColor`), and the drawing within the middle 80% circle. The manifest is
[`src/app/manifest.ts`](src/app/manifest.ts).

## Tech stack

| Area | Choice |
| --- | --- |
| App | [Next.js 16](https://nextjs.org) (App Router, Cache Components), React 19, TypeScript |
| UI | [Chakra UI 3](https://chakra-ui.com), Hebrew text via [next-intl](https://next-intl.dev) |
| Calendar | [FullCalendar 7](https://fullcalendar.io) (MIT), [Temporal](https://tc39.es/proposal-temporal/) via `temporal-polyfill` for dates and time zones, [rrule-temporal](https://github.com/ggaabe/rrule-temporal) for repeating events |
| Auth | [Better Auth](https://www.better-auth.com) with Google |
| Database | PostgreSQL 16 with [Prisma 7](https://www.prisma.io) |
| Tests | [Vitest](https://vitest.dev) (unit + integration), [Playwright](https://playwright.dev) (end-to-end), [axe-core](https://github.com/dequelabs/axe-core) (accessibility) |
| Hosting | [Render](https://render.com) (web service) + [Neon](https://neon.tech) (database), both in Frankfurt |

## Running locally

**Requirements:** Node.js 24, npm, Docker Desktop, and Google Chrome (for the
end-to-end tests).

```bash
npm install                # also generates the Prisma client
cp .env.example .env       # then fill in the values, see below
npm run db:up              # Postgres 16 in Docker, on host port 5436
npm run db:migrate         # apply migrations, and regenerate the Prisma client
npm run dev                # http://localhost:3000
```

`npm run db:studio` opens Prisma Studio, to look at or clean up local data.

In `.env`, fill in:

- `BETTER_AUTH_SECRET`: any random string of 32+ characters:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `USER_EMAIL_DOR`, `USER_EMAIL_MAAYAN`: the two Google accounts allowed to sign in.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: an OAuth client of type "Web application"
  in Google Cloud, with the redirect URIs
  `http://localhost:3000/api/auth/callback/google` (sign-in) and
  `http://localhost:3000/api/integrations/google/callback` (export, the value of
  `GOOGLE_OAUTH_REDIRECT_URI`). While the consent screen is in "Testing", both emails
  must be listed as test users.
- `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) and `CRON_SECRET` (32+ random
  characters): generate each with the same command as `BETTER_AUTH_SECRET`.

The database URLs in `.env.example` already match the Docker database.

## Dates and times

- Everything is shown in the configured time zone (`Asia/Jerusalem`), whatever the
  device's own time zone.
- Timed events are stored as exact instants (`timestamptz`).
- All-day events are stored as dates only. The stored end date is **exclusive** (the day
  after the last day), like Google Calendar; the form shows the last day itself.
- Database CHECK constraints keep every row consistent (one kind of time per event, end
  after start, an owner only for personal events). Deleting is a soft delete
  (`deletedAt`), so the Google export can remove its copy later. Every change raises
  `version`, which is also what detects edits made at the same time.

Repeating events:

- A series is one `event` row with an `rrule` ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545),
  without `DTSTART`: the series starts when the event starts, in its time zone). Weekly
  rules always say `WKST=SU`, so "every two weeks" counts weeks from Sunday.
- Occurrences are worked out on the server for the range being shown; they aren't
  stored. Each occurrence keeps the local times of the first one, also across a clock
  change.
- An occurrence that was changed or deleted on its own is a row in `event_exception`,
  found by its original start. Its columns are null where it is the same as the series,
  so a change to the whole series still reaches it.
- "This and the following ones" splits the series: the original ends before the
  occurrence and a new event (`splitFromEventId`) starts at it, the way Google does it.
- Changing the times, the days or the repeat of a series drops the changes and
  deletions of single occurrences, and the form warns before saving. A change to any
  occurrence raises the series' `version`.

## Configuration

Settings that aren't secret live in [`src/config/app.config.ts`](src/config/app.config.ts):
language and direction (`he`, `rtl`), time zone (`Asia/Jerusalem`), the two users with
their names and default colors, the default shared-events color, categories, and the
preset colors. All UI text is in [`messages/he.json`](messages/he.json).

Secrets and emails are environment variables only: see [`.env.example`](.env.example).

## Tests

```bash
npm run test:unit          # fast, no database
npm run test:integration   # against the our_calendar_test database (npm run db:up first)
npm test                   # both
npm run test:e2e           # production build + Playwright in Chrome, on port 3100
```

Integration and end-to-end tests use a separate `our_calendar_test` database and test
emails, so they never touch development data or real accounts. End-to-end tests sign in
by creating a session directly in the test database, without going through Google, and
fail on any browser console error.
No test calls the real Google: the export runs against an in-memory fake
([`tests/integration/fake-google.ts`](tests/integration/fake-google.ts)) that behaves as
the [Google spike](docs/google-spike.md) found the real API does.

- End-to-end tests fix the browser's clock (5 November 2026, Israel time), so the
  calendar always opens on the same month.
- They run on a desktop browser and on a phone-sized one (Pixel 7); phone-only tests
  are tagged `@mobile`.
- [`tests/e2e/accessibility.spec.ts`](tests/e2e/accessibility.spec.ts) scans every
  screen and dialog with axe-core (WCAG 2.1 A and AA).
- `E2E_SCREENSHOTS=<folder> npm run test:e2e -- calendar repeating-events google-export`
  saves screenshots of the calendar views, the repeat fields and the Google export
  section on a phone, to check them by eye.

Other checks: `npm run lint`, `npm run typecheck`, `npm run format:check`
(`npm run format` fixes formatting).

## CI

[GitHub Actions](.github/workflows/ci.yml) runs formatting, lint, types, the unit and
integration tests (against a Postgres 16 service), the build and the end-to-end tests on
every push and on every Pull Request into `main`.

## Workflow

`main` is protected: changes go through a branch per phase (for example
`phase-3-recurrence`) and a Pull Request.

## Deployment

The service is described in [`render.yaml`](render.yaml) (a Render Blueprint):

- Free plan, region Frankfurt, deploying `main` only after the CI checks pass.
- The build runs `npm ci && npm run build && npx prisma migrate deploy`. Migrations run
  in the build because Render's pre-deploy command is paid-plan only.
- Health check: `GET /api/health` answers `{"status":"ok"}` when the database is
  reachable, and 503 otherwise.

Before the first deploy:

1. Create a Neon project in region `aws-eu-central-1` (Frankfurt) with Postgres 16.
   Copy both connection strings: the pooled one (host contains `-pooler`) for
   `DATABASE_URL` and the direct one for `DIRECT_URL`.
2. In Google Cloud, create a second OAuth client for production with the redirect URIs
   `https://<your-service>.onrender.com/api/auth/callback/google` and
   `https://<your-service>.onrender.com/api/integrations/google/callback`.
3. In Render, create the service from the Blueprint and fill in the variables it asks for.
   `BETTER_AUTH_SECRET` is generated by Render; `BETTER_AUTH_URL` is the service URL, and
   `GOOGLE_OAUTH_REDIRECT_URI` the second redirect URI above.
4. Add the same `CRON_SECRET` as a repository secret on GitHub (see below).

On the free plan the service sleeps after 15 minutes without traffic, so the first visit
after that takes up to a minute. Moving to a paid plan needs no code changes.

### Google export jobs

Exports to Google run in the web server, with no separate worker: right after each
change (once the response is sent), on page views for retries that came due, and every
30 minutes from [`export-jobs.yml`](.github/workflows/export-jobs.yml), which calls
`POST /api/jobs/run` with the shared secret `CRON_SECRET`.

- Set `CRON_SECRET` (at least 32 random characters) both on Render and as a repository
  secret on GitHub (Settings > Secrets and variables > Actions), with the same value.
- GitHub turns scheduled workflows off after 60 days without activity in the
  repository. If that happens, turn it on again under Actions > Export jobs. Until
  then, exports still run after every change; only the retries of failed ones wait for
  someone to open the app.
- Each run wakes the service if it sleeps, so the free plan's 750 hours a month are
  used faster; every 30 minutes stays within them (every 15 would not).

### Production

- App: <https://our-calendar-ay05.onrender.com> (the name `our-calendar` was taken on
  Render, so the URL has a suffix). Health: `/api/health`.
- Database: Neon project `our-calendar`, Frankfurt, Postgres 16, database `our_calendar`.
- Google Cloud project `our-calendar-512817`: OAuth clients "Our Calendar (local dev)"
  and "Our Calendar (production)". The OAuth app is **In production** (not Testing), so
  refresh tokens don't expire after 7 days. Branding: home page `/login`, privacy
  policy `/privacy`. All scopes are non-sensitive, so no Google verification is needed.
- Google Search Console verifies the site with `public/google4e80a75d4e54cc97.html`.
  Don't remove that file.

### Chrome "Dangerous site" warning

Right after the first deploy, Google Safe Browsing flagged the site as "Deceptive pages",
a common false positive for a new site whose whole page is a Google sign-in button.
Done so far: a false-positive report to Safe Browsing, a review request in Search
Console, and a login page that says what the site is and links to the privacy policy.
If it happens again, request a review in Search Console > Security issues. The lasting
fix is a custom domain instead of `onrender.com`.

## Project structure

```
src/
  app/                 routes: (app)/ = signed-in pages and their server actions,
                       login/, privacy/, api/ (auth, events, health, the export's
                       connect and callback, and jobs/run for the scheduled trigger),
                       icons/ (made from the logo), manifest.ts
  components/          providers (Chakra, Emotion), calendar/ (FullCalendar, URL
                       state, filters), events/ (event form, details, delete and
                       "which occurrences" dialogs)
  config/              app.config.ts
  i18n/                next-intl setup (one fixed locale)
  lib/                 Prisma client, Better Auth server and client
  modules/             domain logic: auth/ (allowlist, session), users/ (colors),
                       events/ (time zones, repeat rules, validation, form behavior,
                       descriptions, data access), jobs/ (the export queue),
                       google-export/ (OAuth, token encryption, mapping to Google
                       events, running the jobs, connection state, triggers)
  proxy.ts             redirects to /login when there is no session cookie
public/logo.svg        the logo, source of every icon
messages/he.json       all UI text
prisma/                schema and migrations
tests/integration/     tests against the test database
tests/e2e/             Playwright tests
```
