// Local test runner: automates the setup CI's smoke job does by hand, against your local Supabase.
// Zero dependencies on purpose, like smoke.mjs. LOCAL ONLY.
//
//   npm run smoke:local                  reset the local DB, start the dev server, run the smoke test, reset again
//   npm run smoke:local -- --serve       reset the DB and start the dev server for manual testing (Ctrl+C to stop)
//   npm run smoke:local -- --dry-run     read Supabase status and print what would happen; changes nothing
//   npm run smoke:local -- --restore     stop the dev server and put .env / .dev.vars back after an interrupted run
//                                        (runs `astro dev stop`, so it stops ANY running Astro dev server, including one
//                                        you started yourself)
//
// Options: --yes (no confirmation prompt), --skip-check (skip the `astro check` Vite cache warm-up),
//          --keep-data (do not reset the DB again after the smoke run).
//
// What it changes, and puts back: `npx supabase db reset` (wipes the local DB), and .env / .dev.vars, which are
// backed up to *.smoke-bak and restored at the end so the app runs with Cloudflare's dummy Turnstile keys and no
// closed-registration flag. Needs `npx supabase start` to be running already.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = "http://localhost:4321";
const ENV_FILES = [".env", ".dev.vars"];
const BACKUP_SUFFIX = ".smoke-bak";
const ABSENT_MARKER = "__file did not exist before the smoke run__";
const SERVER_LOG = join(tmpdir(), "smoke-local-dev-server.log");
// Cloudflare's documented dummy Turnstile keys: they always pass and accept the dummy token (same as CI).
const DUMMY_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
const DUMMY_TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const serveOnly = flags.has("--serve");
const skipCheck = flags.has("--skip-check");
const keepData = flags.has("--keep-data");

const npx = (args, options = {}) => spawnSync("npx", args, { shell: true, stdio: "inherit", ...options });

function fail(message) {
  console.error(`\nsmoke-local: ${message}`);
  process.exit(1);
}

function supabaseEnv() {
  const result = spawnSync("npx", ["supabase", "status", "-o", "env"], { shell: true, encoding: "utf8" });
  const values = {};
  for (const line of (result.stdout ?? "").split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = values;
  if (result.status !== 0 || !API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    fail("local Supabase is not running. Start it with `npx supabase start`, then run this again.");
  }
  return { API_URL, ANON_KEY, SERVICE_ROLE_KEY };
}

/** Sets `vars` in a dotenv-style file's text, keeps every other line, and removes the keys in `drop`. */
function withVars(text, vars, drop) {
  const kept = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .filter((line) => {
      const key = line.split("=")[0].trim();
      return !(key in vars) && !drop.includes(key);
    });
  return [...kept, ...Object.entries(vars).map(([key, value]) => `${key}=${value}`)].join("\n") + "\n";
}

async function confirm(question) {
  if (flags.has("--yes")) return;
  if (!process.stdin.isTTY) fail("not an interactive terminal; pass --yes to confirm the database reset.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail("cancelled.");
}

async function isServerUp() {
  try {
    await fetch(`${BASE_URL}/`, { redirect: "manual", signal: globalThis.AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Stops the dev server: Astro's background daemon (`astro dev stop`) and the foreground process we spawned. */
function stopDevServer(child) {
  npx(["astro", "dev", "stop"], { stdio: "ignore" });
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else
    try {
      process.kill(-child.pid);
    } catch {
      // already gone
    }
}

/** Puts back .env / .dev.vars from their *.smoke-bak backups, if a run left any. */
function restoreEnvFiles() {
  for (const file of ENV_FILES) {
    const backup = file + BACKUP_SUFFIX;
    if (!existsSync(backup)) continue;
    // The marker means the file did not exist before this run.
    if (readFileSync(backup, "utf8") === ABSENT_MARKER) unlinkSync(file);
    else copyFileSync(backup, file);
    unlinkSync(backup);
  }
}

async function waitForServer(child) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    // Exit code 0 is Astro 7 handing the server to a background daemon (it does that when it detects an agent
    // environment instead of a terminal); keep polling. A non-zero exit is a real crash.
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`the dev server exited early; see ${SERVER_LOG}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/`, {
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(5000),
      });
      if (response.status === 200) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`the dev server did not answer on ${BASE_URL} within 3 minutes; see ${SERVER_LOG}`);
}

if (flags.has("--restore")) {
  stopDevServer(null);
  restoreEnvFiles();
  console.log("smoke-local: dev server stopped and .env / .dev.vars restored (if a run had left backups).");
  process.exit(0);
}

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = supabaseEnv();
const appVars = {
  SUPABASE_URL: API_URL,
  SUPABASE_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  TURNSTILE_SITE_KEY: DUMMY_TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: DUMMY_TURNSTILE_SECRET_KEY,
};

const steps = [
  "npx supabase db reset  (wipes the local database)",
  `back up ${ENV_FILES.join(" and ")} and write local Supabase + dummy Turnstile values into them`,
  ...(skipCheck ? [] : ["npx astro check  (warms Vite's cache so the dev server starts inside its 30s limit)"]),
  `npx astro dev on ${BASE_URL}`,
  serveOnly ? "keep the server running for manual testing until Ctrl+C" : "npm run smoke against it",
  `stop the server, restore ${ENV_FILES.join(" and ")}${serveOnly || keepData ? "" : ", reset the database again"}`,
];
console.log(`Supabase is running at ${API_URL}. Plan:`);
steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
if (dryRun) {
  console.log("\n--dry-run: nothing was changed.");
  process.exit(0);
}

for (const file of ENV_FILES) {
  if (existsSync(file + BACKUP_SUFFIX)) {
    fail(
      `${file + BACKUP_SUFFIX} exists: an earlier run did not finish. Restore it (copy it over ${file}) and delete it.`,
    );
  }
}
if (await isServerUp()) {
  fail(`something is already listening on ${BASE_URL}; stop it first, it would not use the test configuration.`);
}
await confirm("This resets your local Supabase database. Continue?");

let server = null;
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  stopDevServer(server);
  restoreEnvFiles();
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

let exitCode = 0;
try {
  if (npx(["supabase", "db", "reset"]).status !== 0) throw new Error("`npx supabase db reset` failed");

  for (const file of ENV_FILES) {
    const existed = existsSync(file);
    if (existed) copyFileSync(file, file + BACKUP_SUFFIX);
    else writeFileSync(file + BACKUP_SUFFIX, ABSENT_MARKER);
    writeFileSync(file, withVars(existed ? readFileSync(file, "utf8") : "", appVars, ["LINK_CREATION_CLOSED"]));
  }

  if (!skipCheck && npx(["astro", "check"]).status !== 0) throw new Error("`npx astro check` failed");

  const log = openSync(SERVER_LOG, "w");
  server = spawn("npx", ["astro", "dev", "--port", "4321"], {
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  console.log(`\nStarting the dev server (log: ${SERVER_LOG}) ...`);
  await waitForServer(server);

  if (serveOnly) {
    console.log(`\nReady: open ${BASE_URL} and test by hand. The database is fresh. Press Ctrl+C to stop and restore.`);
    await new Promise(() => undefined);
  } else {
    console.log("Dev server is up. Running the smoke test ...\n");
    const smoke = spawnSync("node", ["scripts/smoke.mjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        BASE_URL,
        SMOKE_SUPABASE_URL: API_URL,
        SMOKE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        SMOKE_ANON_KEY: ANON_KEY,
      },
    });
    exitCode = smoke.status ?? 1;
  }
} catch (error) {
  console.error(`\nsmoke-local: ${error.message}`);
  exitCode = 1;
} finally {
  cleanup();
}

if (!serveOnly && !keepData) {
  console.log("\nResetting the database again so it is clean for manual testing ...");
  if (npx(["supabase", "db", "reset"]).status !== 0) console.error("smoke-local: the final reset failed");
}
console.log(exitCode === 0 ? "\nsmoke-local: done, smoke passed." : "\nsmoke-local: finished with failures.");
process.exit(exitCode);
