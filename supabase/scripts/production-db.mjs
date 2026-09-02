#!/usr/bin/env node
// Command-line entry point for the production Supabase workflow.
//
// Subcommands:
//   readonly <sql-file>          Run a SQL file against production inside a forced
//                                 read-only transaction (pre-flight / post-flight / regression).
//   migration-list                Show local vs. remote migration status (read-only, informational).
//   migration-apply --version V   Apply exactly one named, already-approved migration.
//
// See docs/supabase-workflow.md for the full operational contract (CI -> pre-flight ->
// approval -> apply -> post-flight -> regression -> report). This file intentionally
// does not expose any "apply everything pending" or "run arbitrary SQL with write
// access" command.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildConnectionConfig, buildCliDbUrl, redactSecret } from "./production-target.mjs";
import { runReadOnlySql } from "./db-runner.mjs";
import { planMigrationApply, parsePendingFromMigrationList } from "./migration-apply-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

async function runSupabaseCli(args, { password }) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["supabase", ...args], { shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: redactSecret(stdout, password),
        stderr: redactSecret(stderr, password),
      });
    });
  });
}

async function cmdReadonly(sqlFilePath) {
  if (!sqlFilePath) {
    fail("readonly requires a SQL file path, e.g. `readonly supabase/scripts/sql/select-1.sql`.");
    return;
  }
  const resolved = path.resolve(process.cwd(), sqlFilePath);
  if (!existsSync(resolved)) {
    fail(`SQL file not found: ${sqlFilePath}`);
    return;
  }
  const sqlText = readFileSync(resolved, "utf8");
  const config = buildConnectionConfig(); // throws (fail closed) if password missing

  const result = await runReadOnlySql(sqlText, config);
  const results = Array.isArray(result) ? result : [result];
  for (const r of results) {
    if (r.rows) {
      console.log(JSON.stringify(r.rows, null, 2));
    }
  }
  console.log(`(read-only, rolled back, ${results.length} statement result(s))`);
}

async function cmdMigrationList() {
  const password = require_password();
  const dbUrl = buildCliDbUrl();
  const { code, stdout, stderr } = await runSupabaseCli(
    ["migration", "list", "--output-format", "json", "--db-url", dbUrl],
    { password },
  );
  if (stdout) console.log(stdout.trim());
  if (stderr) console.error(stderr.trim());
  if (code !== 0) {
    process.exitCode = code;
  }
}

async function cmdMigrationApply(version) {
  const password = require_password();
  if (!version) {
    fail("migration-apply requires --version <14-digit-timestamp> naming exactly one approved migration.");
    return;
  }

  const localMigrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const dbUrl = buildCliDbUrl();

  const listResult = await runSupabaseCli(
    ["migration", "list", "--output-format", "json", "--db-url", dbUrl],
    { password },
  );
  if (listResult.code !== 0) {
    fail(`migration list failed before apply; refusing to proceed.\n${listResult.stderr}`);
    return;
  }

  let pending;
  try {
    pending = parsePendingFromMigrationList(listResult.stdout);
  } catch (e) {
    fail(`could not parse migration list output; refusing to proceed. (${e.message})`);
    return;
  }

  let plan;
  try {
    plan = planMigrationApply({ version, localMigrationFiles, remotePendingVersions: pending });
  } catch (e) {
    fail(e.message);
    return;
  }

  console.log(`Approved migration verified as the only pending migration: ${plan.migrationFile}`);
  console.log("Applying via `supabase migration up`...");

  const applyResult = await runSupabaseCli(["migration", "up", "--db-url", dbUrl], { password });
  if (applyResult.stdout) console.log(applyResult.stdout.trim());
  if (applyResult.stderr) console.error(applyResult.stderr.trim());
  if (applyResult.code !== 0) {
    process.exitCode = applyResult.code;
    return;
  }

  console.log(
    "Apply finished. Run `npm run db:production:migration-list` and the post-flight " +
      "read-only checks to confirm the migration is registered and the schema matches expectations.",
  );
}

function require_password() {
  // buildConnectionConfig() already fails closed on a missing password; reuse it
  // purely for that side effect, then read the password back out for redaction.
  const config = buildConnectionConfig();
  return config.password;
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === "readonly") {
    await cmdReadonly(rest[0]);
  } else if (subcommand === "migration-list") {
    await cmdMigrationList();
  } else if (subcommand === "migration-apply") {
    const versionFlagIndex = rest.indexOf("--version");
    const version = versionFlagIndex >= 0 ? rest[versionFlagIndex + 1] : undefined;
    await cmdMigrationApply(version);
  } else {
    fail(
      "unknown or missing subcommand. Usage:\n" +
        "  node supabase/scripts/production-db.mjs readonly <sql-file>\n" +
        "  node supabase/scripts/production-db.mjs migration-list\n" +
        "  node supabase/scripts/production-db.mjs migration-apply --version <version>",
    );
  }
}

main().catch((e) => {
  fail(e.message || String(e));
  process.exitCode = 1;
});
