# Supabase production workflow

Operational reference for taking a migration from a feature branch to production
without hand-copying SQL into the Supabase SQL Editor. Read this before any
database-heavy task; it does not duplicate the app-behavior rules in
[AGENTS.md](../AGENTS.md) or the production-safety rules in
[CLAUDE.md](../CLAUDE.md) — those still apply and take precedence.

## Connection method: Session pooler only

- **Use:** Session pooler — `aws-0-ap-southeast-2.pooler.supabase.com:5432`,
  database `postgres`, user `postgres.crchibwumcuuqhkabmfj` (project ref
  `crchibwumcuuqhkabmfj`, region `ap-southeast-2`).
- **Do not use:** the Direct connection host. In this repo's Windows/CI
  environments it resolves to an IPv6 address and fails with
  `LegacyDbConfigIpv6Error`. There is no override for this — see
  [`supabase/scripts/production-target.mjs`](../supabase/scripts/production-target.mjs),
  which hardcodes the pooler host and has no code path to any other host.
- **Do not use:** the Supabase Management API / `SUPABASE_ACCESS_TOKEN` as a
  migration path. The existing token returns 403 and nothing here depends on it.
- **TLS note:** the pooler connection is TLS-encrypted but the runner does not
  pin/verify the server certificate (`rejectUnauthorized: false`) — the
  certificate chain does not validate against Node's bundled CA store in every
  environment this runs in, while the Go-based Supabase CLI connects to the
  same host without issue. The password is the actual security boundary here.

## Secret: `SUPABASE_DB_PASSWORD`

- Lives only in the user-scoped Windows environment variable
  `SUPABASE_DB_PASSWORD`. Nothing in this repo reads it from a file, a `.env`,
  or a CLI argument.
- **Never** print it, log it, commit it, or put it in a documentation example —
  including a full `postgres://...` URL with the real password inlined. Every
  helper in `supabase/scripts/` either reads it only from `process.env` and
  keeps it out of stdout/stderr (redacting any captured child-process output as
  defense-in-depth), or fails closed if it's missing.
- If a future session needs to prove connectivity, run the harmless
  `supabase/scripts/sql/select-1.sql` through the read-only runner (below) — do
  not construct or paste a raw connection string anywhere, including in chat.

## The tools

All of this lives under `supabase/scripts/` and is invoked through npm scripts
so the exact command is always the same:

| Command | What it does |
| --- | --- |
| `npm run db:production:readonly -- <sql-file>` | Runs a SQL file against production inside a Postgres `SET TRANSACTION READ ONLY` transaction, then rolls back. Postgres itself rejects any mutating statement — this is not a regex guess at what looks like a SELECT. Use for pre-flight and post-flight checks. |
| `npm run db:production:migration-list` | Read-only: shows local-vs-remote migration status (`supabase migration list --output-format json`). |
| `npm run db:production:migration-apply -- --version <14-digit-version>` | The **only** write path. Applies exactly one named, already-approved migration. See the approval gate below — this refuses to run without an explicit version. |

There is deliberately no "run arbitrary SQL with write access against
production" command and no "apply everything pending" command. If you need
either, that's a sign the task needs a human decision, not more tooling.

## The workflow

```
FEATURE MIGRATION
  -> DISPOSABLE CI                  (.github/workflows/*, supabase start on a throwaway DB)
  -> PRODUCTION READ-ONLY PRE-FLIGHT (npm run db:production:readonly)
  -> ONE EXPLICIT USER APPROVAL     (for this exact migration version, in chat)
  -> APPLY EXACT APPROVED MIGRATION (npm run db:production:migration-apply -- --version <v>)
  -> AUTOMATED POST-FLIGHT          (npm run db:production:readonly)
  -> TARGETED PRODUCTION REGRESSION (relevant supabase/tests/*.sql, read-only where possible)
  -> REPORT
```

1. **Feature migration.** Write the migration under `supabase/migrations/`,
   plus its `supabase/tests/*.sql` coverage, on a feature branch — same as any
   other change in this repo (see the Git workflow rules in CLAUDE.md).
2. **Disposable CI.** A GitHub Actions workflow (see
   `.github/workflows/location-foundation-ci.yml` for the pattern) runs
   `supabase start` on the runner — a throwaway local Postgres — applies the
   full migration chain, and runs the SQL test suite. It never links to a
   remote project and never reads `SUPABASE_ACCESS_TOKEN`, so it structurally
   cannot reach production. This must pass before anything below.
3. **Production read-only pre-flight.** Run
   `npm run db:production:readonly -- <diagnostic.sql>` for whatever
   introspection the migration needs to confirm about current production state
   (e.g. confirm the target table/column doesn't already exist, confirm row
   counts, confirm no conflicting data). Nothing here can write.
4. **One explicit user approval.** State the exact migration file/version and
   ask the user to approve applying it to production. **Approval covers that
   one migration only** — it does not carry over to the next migration, even
   in the same session or the same PR. See the approval contract in
   [CLAUDE.md](../CLAUDE.md#supabase-production-safety).
5. **Apply.** `npm run db:production:migration-apply -- --version <version>`.
   Internally this:
   - requires `--version` (no default/latest/all mode);
   - confirms a local migration file for that version exists;
   - runs `supabase migration list` against production and requires the
     pending set to be **exactly** `{version}` — if production has zero
     pending migrations, or more than the approved one, it refuses and prints
     what's pending instead of guessing;
   - only then runs `supabase migration up --db-url <pooler>`.
6. **Automated post-flight.** Re-run the read-only runner with a verification
   SQL file appropriate to the migration (new objects exist, expected
   constraints/indexes are present, row counts unaffected, etc.).
7. **Targeted production regression.** Run the specific `supabase/tests/*.sql`
   files relevant to the change against production in read-only mode where the
   test is read-only in nature; anything that needs write coverage stays in
   disposable CI against the throwaway database, not production.
8. **Report.** Summarize what was applied, what pre/post-flight showed, and the
   current `supabase migration list` state.

## Migration-history contract

- After apply, verify with `npm run db:production:migration-list` that the
  version now shows as both `local` and `remote`, i.e. it is present in
  `supabase_migrations.schema_migrations` on production.
- **Do not run `supabase migration repair` as part of this workflow.** If a
  migration's SQL was actually applied but the history table doesn't reflect
  it (or vice versa), that is a distinct, deliberate migration-repair task —
  stop and handle it separately, with the same explicit-approval discipline.
  Do not silently repair history as a side effect of an apply.
- The three prior manual-application gaps
  (`20260830120000`, `20260901120000`, `20260902120000`) were already
  reconciled via `supabase migration repair <version> --status applied` before
  this workflow existed. Do not repeat that repair. A handful of older
  migration pairs have a cosmetic local-timestamp vs. remote-timestamp
  mismatch that resolves correctly by name/order — leave that history alone.

## Recovery rules

- If `migration-apply` fails partway (e.g. the CLI reports a partial apply),
  do not retry blindly. Run `npm run db:production:migration-list` to see the
  actual history state, read-only-inspect the schema for what actually landed,
  and report the discrepancy for a human decision rather than re-running the
  apply or a repair automatically.
- If the read-only pre-flight or post-flight query itself fails because it
  looks like it might mutate something, that's the guardrail working as
  intended — rewrite the diagnostic to be genuinely read-only rather than
  loosening the runner.

## Guardrails, and how they're enforced

- **Missing password → fail closed.** `production-target.mjs` throws before
  any connection attempt if `SUPABASE_DB_PASSWORD` is unset.
- **Unknown target → fail closed.** `resolveTarget()` only recognizes the
  literal string `"production"`; there is no parameter or config file that
  can point it at a different host.
- **Read-only enforcement is a real Postgres transaction, not a regex.**
  `db-runner.mjs` wraps every read-only invocation in
  `BEGIN; SET TRANSACTION READ ONLY; ...; ROLLBACK`. A mutating statement
  fails with a Postgres error regardless of how it's phrased or disguised.
- **Migration apply requires an explicit version.** `migration-apply-plan.mjs`
  refuses without `--version`, refuses if no matching local file exists, and
  refuses unless that version is the *only* migration pending on production
  (see step 5 above) — this is what stands in for "apply exactly this
  migration" given the Supabase CLI's `migration up` has no per-version mode.
- **Secrets never hit stdout/stderr.** Every code path that shells out to the
  Supabase CLI redacts the password from captured output before printing it,
  even though the CLI shouldn't echo it in normal operation.
- Guardrail behavior is covered by
  [`tools/production-db-guardrails.test.mjs`](../tools/production-db-guardrails.test.mjs),
  run as part of `npm test`. Those tests use injected fakes and never open a
  real network connection — the live read-only probe is a separate, manual,
  explicitly-approved step, not part of the automated suite.
