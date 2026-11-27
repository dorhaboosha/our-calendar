// Backs up the database to backups/our-calendar-<date>.dump (pg_dump's custom format),
// with pg_dump in Docker, so nothing has to be installed. Neon's free plan keeps only
// six hours of history, so this is the way back from an older mistake.
//
//   1. In .env, set BACKUP_DATABASE_URL to the production DIRECT_URL (Neon, not the
//      pooled one). Never paste it anywhere else.
//   2. npm run db:backup
//
// Restoring is in docs/operations.md. The URL is passed to Docker by name only, so it
// never shows in a command line or in the output.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";

// pg_dump must be at least as new as the server: the Neon project runs Postgres 16, like
// the local database (docker-compose.yml). Raise both if Neon's version is raised.
const IMAGE = "postgres:16";

if (!process.env.BACKUP_DATABASE_URL) {
  console.error("BACKUP_DATABASE_URL is not set (see the top of scripts/backup-db.mjs).");
  process.exit(1);
}

const directory = "backups";
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const file = join(directory, `our-calendar-${stamp}.dump`);

const dump = spawn(
  "docker",
  [
    "run",
    "--rm",
    "-e",
    "BACKUP_DATABASE_URL",
    IMAGE,
    "sh",
    "-c",
    'pg_dump --format=custom --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL"',
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
dump.stdout.pipe(createWriteStream(file));
dump.on("close", (code) => {
  if (code !== 0) {
    // A partial dump would look like a backup; don't keep it.
    rmSync(file, { force: true });
    console.error(`pg_dump failed (exit code ${code}); no backup was written.`);
    process.exit(1);
  }
  console.log(`Backed up to ${file} (${Math.round(statSync(file).size / 1024)} KB).`);
});
