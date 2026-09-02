// Pure, unit-testable migration-history reconciliation. No network, no file I/O, no CLI output
// parsing -- callers hand this authoritative {version, name} pairs (local filenames; remote rows
// read directly from `supabase_migrations.schema_migrations`) and it classifies every local
// migration into exactly one bucket:
//
//   EXACT           local.version === a remote row's version (and its name must also match --
//                   a version collision with a different name is a conflict, not a match).
//   APPLIED_LEGACY  no exact-version match, but there is EXACTLY ONE not-yet-claimed remote row
//                   with the same `name` (a historical migration applied under a different
//                   version timestamp than the current local file -- the documented "cosmetic
//                   mismatch that resolves correctly by name/order" case).
//   PENDING         no exact-version match and no unique name match anywhere in remote history.
//
// Anything else -- a duplicate name on either side, a version match with a differing name, a
// remote row that no local file claims, or matched pairs whose relative order contradicts each
// other -- throws MigrationHistoryConflictError instead of guessing. This module never decides
// whether it's SAFE to run `supabase migration up`; that is a separate, empirical question (see
// the migration-apply-semantics-check CI job). It only answers "what, authoritatively, is
// pending" from version/name identity.

export class MigrationHistoryConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationHistoryConflictError";
  }
}

const FILENAME_PATTERN = /^(\d{14})_(.+)\.sql$/;

/**
 * @param {string} filename - e.g. "20260903120000_location_phase2_cutover.sql"
 * @returns {{version: string, name: string}}
 */
export function parseMigrationFilename(filename) {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    throw new MigrationHistoryConflictError(
      `Local migration filename "${filename}" does not match the required <14-digit-version>_<name>.sql pattern.`,
    );
  }
  return { version: match[1], name: match[2] };
}

function assertNoDuplicates(entries, label) {
  const seenVersions = new Map();
  for (const entry of entries) {
    if (seenVersions.has(entry.version)) {
      throw new MigrationHistoryConflictError(
        `Malformed ${label} history: version "${entry.version}" appears more than once ` +
          `(names: "${seenVersions.get(entry.version)}" and "${entry.name}"). Refusing to reconcile.`,
      );
    }
    seenVersions.set(entry.version, entry.name);
  }
}

/**
 * @param {{localMigrations: {version:string,name:string}[], remoteMigrations: {version:string,name:string}[]}} args
 * @returns {{
 *   exact: {localVersion:string,name:string,remoteVersion:string}[],
 *   legacyMatched: {localVersion:string,name:string,remoteVersion:string}[],
 *   pending: {localVersion:string,name:string}[]
 * }}
 * @throws {MigrationHistoryConflictError} on any duplicate, cross-name version collision,
 *   ambiguous (one-to-many/many-to-one) name match, unclaimed remote row, or order conflict.
 */
export function reconcileMigrationHistory({ localMigrations, remoteMigrations }) {
  const local = localMigrations || [];
  const remote = remoteMigrations || [];
  assertNoDuplicates(local, "local");
  assertNoDuplicates(remote, "remote");

  const remoteByVersion = new Map(remote.map((r) => [r.version, r]));
  // name -> remote entries not yet claimed by an exact-version match or a legacy match.
  const remoteByNameRemaining = new Map();
  for (const r of remote) {
    if (!remoteByNameRemaining.has(r.name)) remoteByNameRemaining.set(r.name, []);
    remoteByNameRemaining.get(r.name).push(r);
  }
  const claimedRemoteVersions = new Set();

  const localSorted = [...local].sort((a, b) => a.version.localeCompare(b.version));

  const exact = [];
  const legacyMatched = [];
  const pending = [];

  for (const entry of localSorted) {
    const exactRemote = remoteByVersion.get(entry.version);
    if (exactRemote) {
      if (exactRemote.name !== entry.name) {
        throw new MigrationHistoryConflictError(
          `Version "${entry.version}" exists in both local ("${entry.name}") and remote history ` +
            `("${exactRemote.name}") but the names differ. Refusing to reconcile.`,
        );
      }
      exact.push({ localVersion: entry.version, name: entry.name, remoteVersion: exactRemote.version });
      claimedRemoteVersions.add(exactRemote.version);
      const bucket = remoteByNameRemaining.get(entry.name) || [];
      remoteByNameRemaining.set(
        entry.name,
        bucket.filter((r) => r.version !== exactRemote.version),
      );
      continue;
    }

    const candidates = remoteByNameRemaining.get(entry.name) || [];
    if (candidates.length === 0) {
      pending.push({ localVersion: entry.version, name: entry.name });
      continue;
    }
    if (candidates.length > 1) {
      throw new MigrationHistoryConflictError(
        `Local migration "${entry.name}" (version ${entry.version}) matches ${candidates.length} ` +
          `remote rows by name ([${candidates.map((c) => c.version).join(", ")}]) with no exact ` +
          `version match to disambiguate. Refusing to reconcile.`,
      );
    }
    const [legacyRemote] = candidates;
    legacyMatched.push({ localVersion: entry.version, name: entry.name, remoteVersion: legacyRemote.version });
    claimedRemoteVersions.add(legacyRemote.version);
    remoteByNameRemaining.set(entry.name, []);
  }

  const unclaimed = remote.filter((r) => !claimedRemoteVersions.has(r.version));
  if (unclaimed.length > 0) {
    throw new MigrationHistoryConflictError(
      `${unclaimed.length} remote migration row(s) match no local file by version or name: ` +
        `[${unclaimed.map((r) => `${r.version} (${r.name})`).join(", ")}]. Refusing to reconcile ` +
        "an untracked remote history change.",
    );
  }

  const matchedInLocalOrder = [...exact, ...legacyMatched].sort((a, b) =>
    a.localVersion.localeCompare(b.localVersion),
  );
  for (let i = 1; i < matchedInLocalOrder.length; i++) {
    const prev = matchedInLocalOrder[i - 1];
    const cur = matchedInLocalOrder[i];
    if (cur.remoteVersion.localeCompare(prev.remoteVersion) < 0) {
      throw new MigrationHistoryConflictError(
        `Order conflict: local "${prev.name}" (${prev.localVersion} -> remote ${prev.remoteVersion}) ` +
          `precedes local "${cur.name}" (${cur.localVersion}), but their matched remote versions are ` +
          `in the opposite order (${prev.remoteVersion} > ${cur.remoteVersion}). Refusing to reconcile.`,
      );
    }
  }

  return { exact, legacyMatched, pending };
}
