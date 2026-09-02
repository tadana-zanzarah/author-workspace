import assert from "node:assert/strict";
import {
  resolveTarget,
  loadProductionPassword,
  buildConnectionConfig,
  buildCliDbUrl,
  redactSecret,
} from "../supabase/scripts/production-target.mjs";
import { runReadOnlySql } from "../supabase/scripts/db-runner.mjs";
import {
  planMigrationApply,
  parsePendingFromMigrationList,
} from "../supabase/scripts/migration-apply-plan.mjs";

// -- resolveTarget: only "production" is known; everything else fails closed. --
{
  const target = resolveTarget("production");
  assert.equal(target.host, "aws-0-ap-southeast-2.pooler.supabase.com");
  assert.equal(target.port, 5432);
  assert.equal(target.user, "postgres.crchibwumcuuqhkabmfj");

  for (const bad of ["direct", "staging", "", undefined, null, "production ", "PRODUCTION"]) {
    assert.throws(() => resolveTarget(bad), /Unknown production target/);
  }
}

// -- loadProductionPassword: fail closed when missing, never invents a default. --
{
  assert.throws(() => loadProductionPassword({}), /SUPABASE_DB_PASSWORD is not set/);
  assert.throws(() => loadProductionPassword({ SUPABASE_DB_PASSWORD: "" }), /SUPABASE_DB_PASSWORD is not set/);
  assert.equal(loadProductionPassword({ SUPABASE_DB_PASSWORD: "s3cret" }), "s3cret");
}

// -- buildConnectionConfig: fail closed without a password; uses the Session pooler, not Direct. --
{
  assert.throws(() => buildConnectionConfig({}), /SUPABASE_DB_PASSWORD is not set/);

  const config = buildConnectionConfig({ SUPABASE_DB_PASSWORD: "s3cret" });
  assert.equal(config.host, "aws-0-ap-southeast-2.pooler.supabase.com");
  assert.equal(config.user, "postgres.crchibwumcuuqhkabmfj");
  assert.equal(config.password, "s3cret");
  assert.ok(config.ssl, "connection must use TLS");
  // Guard against ever landing on the known-bad Direct/IPv6 host.
  assert.equal(/^db\./.test(config.host), false);
}

// -- buildCliDbUrl: only used for child-process argv, never for logging. --
{
  assert.throws(() => buildCliDbUrl({}), /SUPABASE_DB_PASSWORD is not set/);
  const url = buildCliDbUrl({ SUPABASE_DB_PASSWORD: "s3cret" });
  assert.match(url, /^postgresql:\/\/postgres\.crchibwumcuuqhkabmfj:s3cret@aws-0-ap-southeast-2\.pooler\.supabase\.com:5432\/postgres$/);
}

// -- redactSecret: defense-in-depth scrubbing of captured child-process output. --
{
  assert.equal(redactSecret("hello s3cret world", "s3cret"), "hello ***REDACTED*** world");
  assert.equal(redactSecret("no secret here", "s3cret"), "no secret here");
  assert.equal(redactSecret("unchanged", ""), "unchanged");
  assert.equal(redactSecret("unchanged", undefined), "unchanged");
}

// -- runReadOnlySql: proves the guardrail is wired correctly without a live DB. --
{
  const calls = [];
  const fakeClient = {
    connect: async () => {
      calls.push("connect");
    },
    query: async (text) => {
      calls.push(text);
      if (text === "INSERT INTO forbidden VALUES (1)") {
        throw new Error("cannot execute INSERT in a read-only transaction");
      }
      return { rows: [{ ok: 1 }] };
    },
    end: async () => {
      calls.push("end");
    },
  };

  const result = await runReadOnlySql("select 1", {}, { clientFactory: () => fakeClient });
  assert.deepEqual(result.rows, [{ ok: 1 }]);
  assert.deepEqual(calls, ["connect", "BEGIN", "SET TRANSACTION READ ONLY", "select 1", "ROLLBACK", "end"]);
}
{
  // A mutating statement must fail (simulating Postgres's own read-only rejection),
  // and the runner must still roll back and close the connection rather than leaving
  // a dangling transaction.
  const calls = [];
  const fakeClient = {
    connect: async () => {
      calls.push("connect");
    },
    query: async (text) => {
      calls.push(text);
      if (text === "INSERT INTO forbidden VALUES (1)") {
        throw new Error("cannot execute INSERT in a read-only transaction");
      }
      return { rows: [] };
    },
    end: async () => {
      calls.push("end");
    },
  };

  await assert.rejects(
    () =>
      runReadOnlySql("INSERT INTO forbidden VALUES (1)", {}, { clientFactory: () => fakeClient }),
    /cannot execute INSERT in a read-only transaction/,
  );
  assert.deepEqual(calls, [
    "connect",
    "BEGIN",
    "SET TRANSACTION READ ONLY",
    "INSERT INTO forbidden VALUES (1)",
    "ROLLBACK",
    "end",
  ]);
}

// -- planMigrationApply: the only production write path; must fail closed on anything ambiguous. --
{
  const localMigrationFiles = [
    "20260902120000_location_foundation_schema.sql",
    "20260903090000_next_step.sql",
  ];

  assert.throws(
    () => planMigrationApply({ version: undefined, localMigrationFiles, remotePendingVersions: ["20260903090000"] }),
    /requires an explicit --version/,
  );
  assert.throws(
    () => planMigrationApply({ version: "not-a-version", localMigrationFiles, remotePendingVersions: [] }),
    /requires an explicit --version/,
  );
  assert.throws(
    () => planMigrationApply({ version: "20260909999999", localMigrationFiles, remotePendingVersions: ["20260909999999"] }),
    /No local migration file/,
  );
  assert.throws(
    () => planMigrationApply({ version: "20260903090000", localMigrationFiles, remotePendingVersions: [] }),
    /no pending migrations/,
  );
  assert.throws(
    () =>
      planMigrationApply({
        version: "20260903090000",
        localMigrationFiles,
        remotePendingVersions: ["20260902120000", "20260903090000"],
      }),
    /do not match exactly the approved version/,
  );
  assert.throws(
    () =>
      planMigrationApply({
        version: "20260903090000",
        localMigrationFiles,
        remotePendingVersions: ["20260902120000"],
      }),
    /do not match exactly the approved version/,
  );

  const plan = planMigrationApply({
    version: "20260903090000",
    localMigrationFiles,
    remotePendingVersions: ["20260903090000"],
  });
  assert.equal(plan.migrationFile, "20260903090000_next_step.sql");
}

// -- parsePendingFromMigrationList: matches the real `supabase migration list --output-format json` shape. --
{
  const sample = JSON.stringify({
    migrations: [
      { local: "20260821133800", remote: "", time: "2026-08-21 13:38:00" },
      { local: "", remote: "20260821134028", time: "2026-08-21 13:40:28" },
      { local: "20260829122450", remote: "20260829122450", time: "2026-08-29 12:24:50" },
      { local: "20260903090000", remote: "", time: "2026-09-03 09:00:00" },
    ],
    message: "Migrations listed",
  });
  assert.deepEqual(parsePendingFromMigrationList(sample), ["20260821133800", "20260903090000"]);
  assert.deepEqual(parsePendingFromMigrationList(JSON.stringify({ migrations: [] })), []);
}

console.log("production-db-guardrails: OK");
