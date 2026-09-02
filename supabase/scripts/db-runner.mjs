// Reusable production DB runner.
//
// This intentionally does NOT expose a generic "run arbitrary SQL against production"
// function. The only SQL-execution primitive here (`runReadOnlySql`) is wrapped in a
// real Postgres `SET TRANSACTION READ ONLY` transaction: the *engine* rejects any
// mutating statement, so this isn't a regex guess at what looks like a SELECT — an
// INSERT/UPDATE/DELETE/DDL statement fails with a Postgres error no matter how it's
// phrased, and the transaction is always rolled back besides.
//
// The only path that can write to production is migration apply, and that goes
// through the Supabase CLI (supabase migration up), never through this file.

import pg from "pg";

const { Client } = pg;

/**
 * Runs `sqlText` against production inside a read-only transaction and returns the
 * query result(s). Always rolls back — this is a diagnostics/pre-flight/post-flight
 * primitive, never a write path.
 *
 * `clientFactory` is injectable so tests can verify the BEGIN / SET TRANSACTION READ
 * ONLY / ROLLBACK sequence without opening a real network connection.
 */
export async function runReadOnlySql(sqlText, connectionConfig, { clientFactory } = {}) {
  const makeClient = clientFactory || ((cfg) => new Client(cfg));
  const client = makeClient(connectionConfig);
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    return await client.query(sqlText);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be broken (e.g. the read-only guard rejected the
      // statement); nothing left to roll back to in that case.
    }
    await client.end();
  }
}
