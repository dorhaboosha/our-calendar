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
import { once } from "node:events";
import { createWriteStream, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
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
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const file = join(directory, `our-calendar-${stamp}.dump`);

// "wx": never overwrites an earlier backup; a second run in the same second stops here.
const output = createWriteStream(file, { flags: "wx" });
try {
  await once(output, "open");
} catch (error) {
  console.error(`Couldn't create ${file}: ${error.message}`);
  process.exit(1);
}

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

try {
  // Done only when pg_dump exited and every byte is written to the file.
  const [, [code]] = await Promise.all([pipeline(dump.stdout, output), once(dump, "close")]);
  if (code !== 0) throw new Error(`pg_dump failed (exit code ${code})`);
} catch (error) {
  dump.kill();
  output.destroy();
  // A partial dump would look like a backup; don't keep it.
  rmSync(file, { force: true });
  console.error(`${error.message}; no backup was written.`);
  process.exit(1);
}
console.log(`Backed up to ${file} (${Math.round(statSync(file).size / 1024)} KB).`);
