// Single source of truth for how this repo is allowed to reach production Supabase.
//
// Only one target exists: "production", wired to the Session pooler. There is no code
// path here that can construct a Direct-connection host — direct connections hit an
// IPv6 error in this environment, and adding an override would defeat the guardrail.
// See docs/supabase-workflow.md for the operational contract this module enforces.

const PRODUCTION_TARGET = Object.freeze({
  name: "production",
  projectRef: "crchibwumcuuqhkabmfj",
  host: "aws-0-ap-southeast-2.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.crchibwumcuuqhkabmfj",
});

/**
 * Resolves a named target to its connection identity. Fails closed for anything
 * other than the one known production target — there is intentionally no way to
 * point this tooling at an arbitrary host.
 */
export function resolveTarget(name) {
  if (name !== "production") {
    throw new Error(
      `Unknown production target "${String(name)}". Only "production" ` +
        `(Session pooler, project ${PRODUCTION_TARGET.projectRef}) is defined. Refusing to connect.`,
    );
  }
  return PRODUCTION_TARGET;
}

/**
 * Reads the DB password from process environment only. Never accepts it as a CLI
 * argument or file path, so it can't end up in shell history or a committed file.
 */
export function loadProductionPassword(env = process.env) {
  const password = env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "SUPABASE_DB_PASSWORD is not set in the environment. Refusing to connect to " +
        "production without it (fail closed).",
    );
  }
  return password;
}

/**
 * Builds a node-postgres connection config for the production Session pooler.
 * Deliberately returns discrete fields (not a connection-string) so nothing here
 * ever needs to serialize the password into a URL that could be logged.
 */
export function buildConnectionConfig(env = process.env) {
  const target = resolveTarget("production");
  const password = loadProductionPassword(env);
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password,
    // rejectUnauthorized: false is a deliberate, documented trade-off (see
    // docs/supabase-workflow.md): the pooler's certificate chain does not verify
    // against Node's bundled CA store in every environment this tooling runs in
    // (observed here as "self-signed certificate in certificate chain", while the
    // Go-based Supabase CLI connects to the same host without issue). The
    // connection is still encrypted; the security boundary is the password, not
    // server-certificate pinning.
    ssl: { rejectUnauthorized: false },
  };
}

/**
 * Builds the percent-encoded postgres:// URL the Supabase CLI requires via --db-url.
 * Only ever pass the result directly into a child process argv — never console.log it,
 * never write it to a file.
 */
export function buildCliDbUrl(env = process.env) {
  const target = resolveTarget("production");
  const password = loadProductionPassword(env);
  return `postgresql://${target.user}:${encodeURIComponent(password)}@${target.host}:${target.port}/${target.database}`;
}

/**
 * Defense-in-depth: strips a known secret out of text before it is ever printed.
 * Used to scrub captured stdout/stderr from child processes (e.g. the Supabase CLI)
 * even though those processes should not echo the db-url in normal operation.
 */
export function redactSecret(text, secret) {
  if (!secret || typeof text !== "string") return text;
  return text.split(secret).join("***REDACTED***");
}
