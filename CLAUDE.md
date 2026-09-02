# Claude Code Instructions — Author Workspace

This is the **existing** Author Workspace repository (vanilla JS/HTML app with a
Supabase cloud backend). Never recreate, reinitialize, clone, or replace it.

## Before any implementation task

1. Read [AGENTS.md](AGENTS.md) — it is the **authoritative** rulebook for
   architecture, data-safety, and application behavior. This file does not
   duplicate it.
2. Read the architecture/docs files relevant to the area being changed (see
   `docs/`, `CLOUD_ARCHITECTURE.md`).
3. If this file and AGENTS.md ever appear to conflict: **stop and report the
   conflict** — do not guess which one wins.

## Git workflow

- Never implement directly on `master`.
- Start from current accepted `master` unless the task explicitly names
  another base.
- Create a dedicated `feature/…` or `fix/…` branch with a descriptive name
  before touching production files.
- Make logical checkpoint commits for large tasks; keep the working tree
  understandable and recoverable.
- No force-push, no rewriting published history.

## Remote actions

- Do not push, merge into `master`, or open a PR unless explicitly
  authorized/requested for that specific task.
- Do not change GitHub Pages configuration unless explicitly requested.

## Supabase production safety

- The production Supabase project is an existing live backend — never
  recreate or replace it.
- No production migration apply / remote schema change without explicit
  approval for that specific operation. Migrations may be prepared and
  tested locally.
- Never expose secrets or service-role credentials. Dedicated test
  credentials must never be printed, committed, or placed in fixtures.
- Never alter real production user content during automated testing; use
  dedicated test fixtures/accounts and clean up only fixtures the test
  created.
- Use the reusable workflow and tooling in
  [docs/supabase-workflow.md](docs/supabase-workflow.md) for any production
  database interaction (connection method, read-only pre/post-flight runner,
  migration apply, migration-history verification) instead of ad hoc
  connection strings or manual Supabase SQL Editor use.
- **Approval contract:** a production migration apply is permitted only after,
  in order: (1) disposable CI passes for that migration, (2) a read-only
  production pre-flight passes, (3) the exact migration file/version is
  identified, (4) the user explicitly approves applying *that* migration.
  Approval for one migration never carries over to another, even later in the
  same session.

## Protected material

- `reference/` and `backup/` are protected. Follow the stronger, detailed
  restrictions in AGENTS.md.

## Testing

- Add regression tests for bugs when practical.
- Run targeted tests while developing.
- Before declaring a normal implementation phase complete, run the relevant
  broader regression suite, `npm test`, and `git diff --check` — unless the
  task explicitly defines a different acceptance procedure.
- Never claim PASS for a test that was not actually run.

## Scope discipline

- Do not silently expand a task into unrelated refactoring or new features.
- Report out-of-scope issues instead of fixing them inline.
- Stop rather than guess if a blocker risks data loss, production impact,
  destructive Git history, or ambiguous architecture.

## Existing architecture (see AGENTS.md / CLOUD_ARCHITECTURE.md for detail)

- Cloud mode is the normal production mode; Supabase is authoritative for
  cloud project data.
- `?local=1` is the explicit legacy/local mode; local caches are never
  authoritative.
- Never silently migrate or delete a user's local project.
- Preserve the revision/concurrency/RPC/data-integrity contracts defined in
  AGENTS.md and the cloud architecture docs.

## Completion reports must include

Branch; HEAD; commits created; important implementation decisions; tests
actually run and results; whether production Supabase was changed; whether
anything was pushed/merged; `reference/`/`backup/` status; working tree
status; remaining blockers.
