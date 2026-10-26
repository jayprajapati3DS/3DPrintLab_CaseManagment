import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";

/**
 * A PostgreSQL server for development, with nothing to install.
 *
 *   npm run db:start        (leave it running; Ctrl+C stops it)
 *
 * The `embedded-postgres` package carries the real PostgreSQL binaries, so this
 * needs no Docker, no virtualization and no administrator rights. Data lives in
 * `.pgdata/` in the project folder and survives restarts.
 *
 * It listens on localhost only, with the user, password, port and database
 * named in DATABASE_URL — so that one setting stays the single source of truth.
 * Production does not use this: point DATABASE_URL at a real PostgreSQL server.
 */

if (process.env.NODE_ENV === "production") {
  console.error("The development database does not run with NODE_ENV=production.");
  process.exit(1);
}

let url;
try {
  url = new URL(process.env.DATABASE_URL ?? "");
} catch {
  console.error("DATABASE_URL is missing or not a URL. Copy .env.example to .env first.");
  process.exit(1);
}

if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error(
    `DATABASE_URL points at ${url.hostname}, not this machine, so there is nothing to start here.`,
  );
  process.exit(1);
}

const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const port = Number(url.port || 5432);
const database = url.pathname.replace(/^\//, "");
const dataDir = path.resolve(".pgdata");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  // UTF-8, whatever the machine's locale. Left to itself on Windows, initdb
  // picks the system code page (WIN1252), which cannot store a name written in
  // Devanagari or even a subscript in "O₂".
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (error) => console.error(String(error)),
});

const firstRun = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
if (firstRun) {
  console.log("Creating the development database in .pgdata/ …");
  await pg.initialise();
}

try {
  await pg.start();
} catch (error) {
  console.error(
    `Could not start PostgreSQL on port ${port}. If it is already running, this is fine — ` +
      `otherwise something else is using that port.\n${String(error)}`,
  );
  process.exit(1);
}

// The database is created here rather than with the package's helper, which
// would copy the cluster's default encoding. An older data directory may have
// been initialised in WIN1252; stating the encoding makes the database UTF-8
// either way. ICU gives language-aware sorting and case-insensitive search.
const admin = pg.getPgClient();
await admin.connect();
const existing = await admin.query(
  "SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1",
  [database],
);
if (existing.rowCount === 0) {
  const name = '"' + database.replace(/"/g, '""') + '"';
  await admin.query(
    `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LC_COLLATE 'C' LC_CTYPE 'C'`,
  );
} else if (existing.rows[0].encoding !== "UTF8") {
  console.warn(
    `Warning: database "${database}" is ${existing.rows[0].encoding}, not UTF-8. Text outside that code page will be rejected.`,
  );
}
await admin.end();

console.log(`PostgreSQL is running on localhost:${port} (database "${database}").`);
if (firstRun) {
  console.log("First run: in another terminal, run  npm run db:deploy  then  npm run db:seed");
}
console.log("Leave this window open. Press Ctrl+C to stop the database.");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping PostgreSQL …");
  await pg.stop().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGBREAK", stop);

// Keep the process alive; PostgreSQL runs as its child.
setInterval(() => {}, 1 << 30);
