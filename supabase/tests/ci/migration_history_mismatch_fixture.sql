-- Disposable-environment reproduction of the REAL production migration-history mismatch
-- pattern, for auditing whether the actual Supabase CLI apply mechanism (`supabase migration
-- up`) would try to re-apply already-executed migrations that only differ from their local file
-- by timestamp (name-matched, historically applied under a different version label).
--
-- MUST run against a disposable local database where `supabase start` has already applied the
-- full local migration chain EXCLUDING 20260903120000_location_phase2_cutover.sql (moved out
-- first, same technique as the true-upgrade-path job). At that point every one of the 14
-- remaining local migrations is registered in supabase_migrations.schema_migrations under its
-- own local version (a normal, unmismatched fresh apply).
--
-- This script rewrites the `version` column of exactly the 10 rows production is known (via a
-- read-only production query, see the Phase 2 apply investigation) to actually carry a
-- different-but-real historical version, to reproduce that exact shape here. `name` is left
-- untouched -- it is what makes the rows identifiable as "the same migration" despite the
-- version mismatch. The other 4 local migrations (20260829122450 onward) already exact-match
-- production and are left alone.
--
-- This never touches production; `supabase_migrations.schema_migrations` here belongs to the
-- disposable database the CI runner destroys afterward.

update supabase_migrations.schema_migrations set version='20260813140832' where version='20260812193655' and name='cloud_foundation';
update supabase_migrations.schema_migrations set version='20260813141018' where version='20260813144500' and name='harden_rls_auto_enable';
update supabase_migrations.schema_migrations set version='20260821134028' where version='20260821133800' and name='cloud_content_schema_foundation';
update supabase_migrations.schema_migrations set version='20260821134320' where version='20260821134302' and name='harden_cloud_content_indexes';
update supabase_migrations.schema_migrations set version='20260821161901' where version='20260821161410' and name='cloud_content_transaction_rpc';
update supabase_migrations.schema_migrations set version='20260822061725' where version='20260822120000' and name='cloud_character_transaction_rpc';
update supabase_migrations.schema_migrations set version='20260827122857' where version='20260827122152' and name='cloud_character_image_storage';
update supabase_migrations.schema_migrations set version='20260827122955' where version='20260827122921' and name='fix_character_image_create_rpc';
update supabase_migrations.schema_migrations set version='20260829052830' where version='20260829045658' and name='transactional_local_cloud_import';
update supabase_migrations.schema_migrations set version='20260829053118' where version='20260829053102' and name='index_local_project_import_attempt_project';

do $$
declare n integer;
begin
  select count(*) into n from supabase_migrations.schema_migrations
  where version in ('20260813140832','20260813141018','20260821134028','20260821134320','20260821161901','20260822061725','20260827122857','20260827122955','20260829052830','20260829053118');
  if n<>10 then raise exception 'fixture rewrite did not land exactly 10 rows, got %', n; end if;
end $$;
