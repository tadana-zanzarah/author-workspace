// Pure guardrail logic for production migration apply. No network, no child process —
// this only decides whether an apply is allowed to proceed, so it can be unit tested
// directly.
//
// The Supabase CLI's `migration up` applies *all* pending migrations; it has no
// "apply exactly this one" mode. To honor "no deploy-all magic command" without
// reimplementing migration application, this module requires the caller to name an
// exact version AND verifies that version is the *only* migration currently pending
// against production before allowing the apply to proceed. Any other pending state
// (zero pending, or more than the named one) fails closed.

/**
 * @param {string} version - the exact migration version the user approved, e.g. "20260903120000".
 * @param {string[]} localMigrationFiles - filenames under supabase/migrations/.
 * @param {string[]} remotePendingVersions - versions present locally but not yet applied
 *   on production, as reported by `supabase migration list`.
 * @returns {{ version: string, migrationFile: string }}
 */
export function planMigrationApply({ version, localMigrationFiles, remotePendingVersions }) {
  if (!version || typeof version !== "string" || !/^\d{14}$/.test(version)) {
    throw new Error(
      "migration-apply requires an explicit --version <14-digit-timestamp>. " +
        "There is no default/latest/all mode.",
    );
  }

  const migrationFile = (localMigrationFiles || []).find((f) => f.startsWith(`${version}_`));
  if (!migrationFile) {
    throw new Error(
      `No local migration file starts with "${version}_" under supabase/migrations/. Refusing to apply.`,
    );
  }

  const pending = Array.from(new Set(remotePendingVersions || []));
  if (pending.length === 0) {
    throw new Error(
      `Production reports no pending migrations. "${version}" appears already applied ` +
        "(or history is out of sync) — nothing to do. Refusing to run migration up.",
    );
  }
  if (pending.length > 1 || pending[0] !== version) {
    throw new Error(
      `Production has pending migration(s) [${pending.join(", ")}] that do not match ` +
        `exactly the approved version "${version}". Refusing to apply — resolve/approve ` +
        "each pending migration individually before retrying.",
    );
  }

  return { version, migrationFile };
}

/**
 * Parses the JSON produced by `supabase migration list --output-format json` and
 * returns the versions that are local-only (pending on production).
 */
export function parsePendingFromMigrationList(jsonText) {
  const parsed = JSON.parse(jsonText);
  const migrations = parsed.migrations || [];
  return migrations
    .filter((m) => m.local && !m.remote)
    .map((m) => m.local);
}
