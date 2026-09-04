-- Location Adaptive Module Selection -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for a
-- multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-migration state
-- before 20260904140000_location_adaptive_module_selection.sql is approved for apply: the
-- base_profile-modules migration already applied, this migration absent from history, current row
-- counts, that list_owned_locations()/import_local_project_content() currently have the exact
-- pre-migration signatures this migration's CREATE OR REPLACE expects to extend, that the new RPC
-- name is not already taken, and that no existing project_locations row already carries a
-- metadata.locationProfile (or bare metadata.moduleSelection) key this migration would collide
-- with.
select 'base_profile_modules_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260904130000')::text as value
union all
select 'adaptive_module_selection_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260904140000')::text
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'update_project_location_module_selection_already_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_project_location_module_selection')::text
union all
select 'list_owned_locations_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_owned_locations')
union all
select 'list_owned_locations_body_has_participation_count', (select prosrc like '%participation_count%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_owned_locations')::text
union all
select 'import_local_project_content_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
select 'import_local_project_content_body_has_module_selection', (select prosrc like '%module_selection%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')::text
union all
select 'private_location_thematic_module_keys_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='location_thematic_module_keys')::text
union all
select 'private_location_thematic_module_keys_value', (select private.location_thematic_module_keys()::text)
union all
select 'private_normalize_location_module_keys_already_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='normalize_location_module_keys')::text
union all
select 'private_sanitize_imported_module_selection_already_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='sanitize_imported_module_selection')::text
union all
select 'project_locations_metadata_object_constraint_present', exists(select 1 from pg_constraint where conname='project_locations_metadata_object')::text
union all
select 'project_locations_with_locationProfile_key_already', count(*)::text from public.project_locations where metadata ? 'locationProfile'
union all
select 'project_locations_with_bare_moduleSelection_key_already', count(*)::text from public.project_locations where metadata ? 'moduleSelection'
union all
select 'project_locations_with_any_metadata_already', count(*)::text from public.project_locations where metadata<>'{}'::jsonb
union all
select 'scenes_project_location_fkey_target', c2.relname
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey'
union all
select 'orphan_scene_location_refs', count(*)::text from public.scenes s where s.location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id)
union all
select 'most_recent_project_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.project_locations
order by 1;
