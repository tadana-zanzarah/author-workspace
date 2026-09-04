-- Location base_profile thematic-module contract -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for a
-- multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-migration state
-- before 20260904130000_location_base_profile_modules.sql is approved for apply: Phase 3 already
-- applied, this migration absent from history, current row counts, and that
-- update_location_canonical / import_local_project_content currently have the exact
-- pre-migration signatures this migration's CREATE OR REPLACE expects to extend (so the apply is a
-- pure function-body change, never an accidental new-overload or drop-and-recreate surprise).
select 'phase3_core_identity_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260904120000')::text as value
union all
select 'base_profile_modules_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260904130000')::text
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'update_location_canonical_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'update_location_canonical_arg_types', (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'update_location_canonical_has_base_profile_patch_param', (select pg_get_function_arguments(p.oid) like '%location_base_profile_patch%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')::text
union all
select 'import_local_project_content_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
select 'name_collision_private_location_thematic_module_keys', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='location_thematic_module_keys')::text
union all
select 'locations_with_base_profile_module_keys_already', count(*)::text from public.locations where (base_profile ? 'appearanceAtmosphere') or (base_profile ? 'geography')
union all
select 'locations_base_profile_object_constraint_present', exists(select 1 from pg_constraint where conname='locations_base_profile_object')::text
union all
select 'most_recent_location_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
order by 1;
