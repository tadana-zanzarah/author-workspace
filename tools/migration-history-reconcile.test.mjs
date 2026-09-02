import assert from "node:assert/strict";
import {
  parseMigrationFilename,
  reconcileMigrationHistory,
  MigrationHistoryConflictError,
} from "../supabase/scripts/migration-history-reconcile.mjs";

// -- parseMigrationFilename --
{
  assert.deepEqual(parseMigrationFilename("20260903120000_location_phase2_cutover.sql"), {
    version: "20260903120000",
    name: "location_phase2_cutover",
  });
  assert.throws(() => parseMigrationFilename("not-a-migration.sql"), /does not match/);
  assert.throws(() => parseMigrationFilename("2026090312_short.sql"), /does not match/);
}

// -- 1. exact version matched -> APPLIED (exact) --
{
  const { exact, legacyMatched, pending } = reconcileMigrationHistory({
    localMigrations: [{ version: "20260902120000", name: "location_foundation_schema" }],
    remoteMigrations: [{ version: "20260902120000", name: "location_foundation_schema" }],
  });
  assert.deepEqual(exact, [{ localVersion: "20260902120000", name: "location_foundation_schema", remoteVersion: "20260902120000" }]);
  assert.deepEqual(legacyMatched, []);
  assert.deepEqual(pending, []);
}

// -- 2. version differs but exact unique name match -> APPLIED_LEGACY --
{
  const { exact, legacyMatched, pending } = reconcileMigrationHistory({
    localMigrations: [{ version: "20260812193655", name: "cloud_foundation" }],
    remoteMigrations: [{ version: "20260813140832", name: "cloud_foundation" }],
  });
  assert.deepEqual(exact, []);
  assert.deepEqual(legacyMatched, [{ localVersion: "20260812193655", name: "cloud_foundation", remoteVersion: "20260813140832" }]);
  assert.deepEqual(pending, []);
}

// -- 3. no version/name match -> PENDING (remote history fully accounted for except the new one) --
{
  const { exact, legacyMatched, pending } = reconcileMigrationHistory({
    localMigrations: [
      { version: "20260902120000", name: "location_foundation_schema" },
      { version: "20260903120000", name: "location_phase2_cutover" },
    ],
    remoteMigrations: [{ version: "20260902120000", name: "location_foundation_schema" }],
  });
  assert.deepEqual(exact, [{ localVersion: "20260902120000", name: "location_foundation_schema", remoteVersion: "20260902120000" }]);
  assert.deepEqual(legacyMatched, []);
  assert.deepEqual(pending, [{ localVersion: "20260903120000", name: "location_phase2_cutover" }]);
}

// -- 4. duplicate remote name (two remote rows, same name, no exact version to disambiguate) -> FAIL --
{
  assert.throws(
    () =>
      reconcileMigrationHistory({
        localMigrations: [{ version: "20260812193655", name: "cloud_foundation" }],
        remoteMigrations: [
          { version: "20260813140832", name: "cloud_foundation" },
          { version: "20260813150000", name: "cloud_foundation" },
        ],
      }),
    (err) => err instanceof MigrationHistoryConflictError && /matches 2 remote rows by name/.test(err.message),
  );
}

// -- 5. duplicate local name/version (malformed local input) -> FAIL --
{
  assert.throws(
    () =>
      reconcileMigrationHistory({
        localMigrations: [
          { version: "20260812193655", name: "a" },
          { version: "20260812193655", name: "b" },
        ],
        remoteMigrations: [],
      }),
    /Malformed local history/,
  );
}

// -- 6. conflicting ordering (matched remote versions contradict local order) -> FAIL --
{
  assert.throws(
    () =>
      reconcileMigrationHistory({
        localMigrations: [
          { version: "20260812193655", name: "first" },
          { version: "20260813000000", name: "second" },
        ],
        remoteMigrations: [
          // "first" (earlier local) matched to a LATER remote timestamp than "second" (later local).
          { version: "20260901000000", name: "first" },
          { version: "20260820000000", name: "second" },
        ],
      }),
    (err) => err instanceof MigrationHistoryConflictError && /Order conflict/.test(err.message),
  );
}

// -- 7. malformed/untracked remote history -> FAIL --
{
  // Duplicate remote version.
  assert.throws(
    () =>
      reconcileMigrationHistory({
        localMigrations: [{ version: "20260812193655", name: "cloud_foundation" }],
        remoteMigrations: [
          { version: "20260813140832", name: "cloud_foundation" },
          { version: "20260813140832", name: "cloud_foundation_dup" },
        ],
      }),
    /Malformed remote history/,
  );
  // An unclaimed remote row (untracked history change) is also a fail-closed case.
  assert.throws(
    () =>
      reconcileMigrationHistory({
        localMigrations: [{ version: "20260812193655", name: "cloud_foundation" }],
        remoteMigrations: [
          { version: "20260813140832", name: "cloud_foundation" },
          { version: "20260814000000", name: "some_untracked_change" },
        ],
      }),
    /match no local file/,
  );
}

// -- 8. current real historical pattern: 10 timestamp-mismatched + 4 exact + 1 genuinely new --
// pending set is exactly [20260903120000].
{
  const legacyPairs = [
    ["20260812193655", "20260813140832", "cloud_foundation"],
    ["20260813144500", "20260813141018", "harden_rls_auto_enable"],
    ["20260821133800", "20260821134028", "cloud_content_schema_foundation"],
    ["20260821134302", "20260821134320", "harden_cloud_content_indexes"],
    ["20260821161410", "20260821161901", "cloud_content_transaction_rpc"],
    ["20260822120000", "20260822061725", "cloud_character_transaction_rpc"],
    ["20260827122152", "20260827122857", "cloud_character_image_storage"],
    ["20260827122921", "20260827122955", "fix_character_image_create_rpc"],
    ["20260829045658", "20260829052830", "transactional_local_cloud_import"],
    ["20260829053102", "20260829053118", "index_local_project_import_attempt_project"],
  ];
  const exactPairs = [
    ["20260829122450", "cascade_project_character_image_context"],
    ["20260830120000", "fix_project_character_reattach"],
    ["20260901120000", "fix_character_image_update_delete_p_ambiguity"],
    ["20260902120000", "location_foundation_schema"],
  ];
  const localMigrations = [
    ...legacyPairs.map(([localVersion, , name]) => ({ version: localVersion, name })),
    ...exactPairs.map(([version, name]) => ({ version, name })),
    { version: "20260903120000", name: "location_phase2_cutover" },
  ];
  const remoteMigrations = [
    ...legacyPairs.map(([, remoteVersion, name]) => ({ version: remoteVersion, name })),
    ...exactPairs.map(([version, name]) => ({ version, name })),
  ];

  const { exact, legacyMatched, pending } = reconcileMigrationHistory({ localMigrations, remoteMigrations });
  assert.equal(exact.length, 4, "the 4 already name-and-version-matched migrations");
  assert.equal(legacyMatched.length, 10, "the 10 historically timestamp-mismatched migrations");
  assert.deepEqual(pending, [{ localVersion: "20260903120000", name: "location_phase2_cutover" }]);
}

// -- 9. this module never touches connection details, so it structurally cannot leak one; assert
// its error messages (built only from version/name strings) never happen to contain
// secret-shaped text, as defense-in-depth alongside production-db-guardrails.test.mjs's
// redaction tests (which cover the actual connection layer).
{
  try {
    reconcileMigrationHistory({
      localMigrations: [{ version: "20260812193655", name: "cloud_foundation" }],
      remoteMigrations: [
        { version: "20260813140832", name: "cloud_foundation" },
        { version: "20260813150000", name: "cloud_foundation" },
      ],
    });
    assert.fail("expected reconcileMigrationHistory to throw");
  } catch (err) {
    assert.doesNotMatch(err.message, /postgresql:\/\/|password|SUPABASE_DB_PASSWORD/i);
  }
}

console.log("migration-history-reconcile tests: OK");
