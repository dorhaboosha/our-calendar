# Our Calendar

A private shared calendar for two people (Dor and Maayan), in Hebrew and right-to-left.
Each of us sees both calendars in one place, and events are exported automatically to a
dedicated "Our Calendar" calendar in each person's Google account, so they show up on
our phones.

> **Status:** Phase 1 (foundation). Sign-in, page protection and color settings work.
> The calendar itself comes in Phase 2. See [`Project Spec.md`](Project%20Spec.md) for
> the full spec and decision log (Hebrew), and [`docs/discovery.md`](docs/discovery.md)
> for the Phase 0 discovery report.

## How it works

- **The app is the source of truth.** Events live in the app's PostgreSQL database.
  Changes are exported one way to Google Calendar; nothing is imported back.
- **Only two people can sign in**, with their Google accounts. The allowed emails are
  environment variables; there is no sign-up.
- **Sign-in asks Google only for name and email.** Calendar permission is requested
  separately, when a user connects export (Phase 4).

## Tech stack

| Area | Choice |
| --- | --- |
| App | [Next.js 16](https://nextjs.org) (App Router, Cache Components), React 19, TypeScript |
| UI | [Chakra UI 3](https://chakra-ui.com), Hebrew text via [next-intl](https://next-intl.dev) |
| Auth | [Better Auth](https://www.better-auth.com) with Google |
| Database | PostgreSQL 16 with [Prisma 7](https://www.prisma.io) |
| Tests | [Vitest](https://vitest.dev) (unit + integration), [Playwright](https://playwright.dev) (end-to-end) |
| Hosting | [Render](https://render.com) (web service) + [Neon](https://neon.tech) (database), both in Frankfurt |

## Running locally

**Requirements:** Node.js 24, npm, Docker Desktop, and Google Chrome (for the
end-to-end tests).

```bash
npm install                # also generates the Prisma client
cp .env.example .env       # then fill in the values, see below
npm run db:up              # Postgres 16 in Docker, on host port 5436
npm run db:migrate         # apply migrations to the development database
npm run dev                # http://localhost:3000
```

In `.env`, fill in:

- `BETTER_AUTH_SECRET`: any random string of 32+ characters:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `USER_EMAIL_DOR`, `USER_EMAIL_MAAYAN`: the two Google accounts allowed to sign in.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: an OAuth client of type "Web application"
  in Google Cloud, with the redirect URI
  `http://localhost:3000/api/auth/callback/google`. While the consent screen is in
  "Testing", both emails must be listed as test users.

The database URLs in `.env.example` already match the Docker database.

## Configuration

Settings that aren't secret live in [`src/config/app.config.ts`](src/config/app.config.ts):
language and direction (`he`, `rtl`), time zone (`Asia/Jerusalem`), the two users with
their names and default colors, the shared-events color, categories, and the preset
colors. All UI text is in [`messages/he.json`](messages/he.json).

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

Other checks: `npm run lint`, `npm run typecheck`, `npm run format:check`
(`npm run format` fixes formatting).

## CI

[GitHub Actions](.github/workflows/ci.yml) runs formatting, lint, types, the unit and
integration tests (against a Postgres 16 service), the build and the end-to-end tests on
every push and on every Pull Request into `main`.

## Workflow

`main` is protected: changes go through a branch per phase (for example
`phase-1-foundation`) and a Pull Request.

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
2. In Google Cloud, create a second OAuth client for production with the redirect URI
   `https://<your-service>.onrender.com/api/auth/callback/google`.
3. In Render, create the service from the Blueprint and fill in the variables it asks for.
   `BETTER_AUTH_SECRET` is generated by Render; `BETTER_AUTH_URL` is the service URL.

On the free plan the service sleeps after 15 minutes without traffic, so the first visit
after that takes up to a minute. Moving to a paid plan needs no code changes.

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
  app/                 routes: (app)/ = signed-in pages, login/, api/
  components/          app-wide providers (Chakra, Emotion)
  config/              app.config.ts
  i18n/                next-intl setup (one fixed locale)
  lib/                 Prisma client, Better Auth server and client
  modules/             domain logic: auth/ (allowlist, session), users/ (colors)
  proxy.ts             redirects to /login when there is no session cookie
messages/he.json       all UI text
prisma/                schema and migrations
tests/integration/     tests against the test database
tests/e2e/             Playwright tests
```
