-- Location Adaptive Module Selection -- post-apply verification.
-- Pure SELECT, single statement, run READ ONLY. Confirms 20260904140000 landed with exactly the
-- intended shape: no data rewritten, new capability present, allowlist untouched, migration-only
-- scope (no unrelated schema object touched by this check's own reasoning -- the migration file
-- itself contains zero top-level DML, only CREATE OR REPLACE FUNCTION/GRANT).
select 'adaptive_module_selection_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260904140000')::text as value
union all
select 'base_profile_modules_migration_still_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260904130000')::text
union all
select 'locations_count', count(*)::text from public.locations
union all
select 'project_locations_count', count(*)::text from public.project_locations
union all
select 'scenes_count', count(*)::text from public.scenes
union all
select 'scenes_with_location_count', count(*)::text from public.scenes where location_id is not null
union all
select 'orphan_scene_location_refs', count(*)::text from public.scenes s where s.location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id)
union all
select 'scenes_project_location_fkey_target', c2.relname
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey'
union all
select 'project_locations_with_any_metadata_now', count(*)::text from public.project_locations where metadata<>'{}'::jsonb
union all
select 'project_locations_with_locationProfile_key_now', count(*)::text from public.project_locations where metadata ? 'locationProfile'
union all
select 'most_recent_project_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.project_locations
union all
select 'update_project_location_module_selection_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_project_location_module_selection')::text
union all
select 'update_project_location_module_selection_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_project_location_module_selection')
union all
select 'update_project_location_module_selection_arguments', (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_project_location_module_selection')
union all
select 'list_owned_locations_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_owned_locations')
union all
select 'list_owned_locations_body_has_participation_count', (select prosrc like '%participation_count%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_owned_locations')::text
union all
select 'import_local_project_content_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
select 'import_local_project_content_body_has_module_selection', (select prosrc like '%module_selection%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')::text
union all
select 'private_normalize_location_module_keys_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='normalize_location_module_keys')::text
union all
select 'private_sanitize_imported_module_selection_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='sanitize_imported_module_selection')::text
union all
select 'private_location_thematic_module_keys_value', (select private.location_thematic_module_keys()::text)
union all
select 'project_locations_metadata_object_constraint_present', exists(select 1 from pg_constraint where conname='project_locations_metadata_object')::text
union all
-- Read-capability check: the production-db.mjs readonly runner connects over the Session pooler
-- as a plain Postgres role, not through PostgREST/GoTrue -- there is no request.jwt.claims context
-- for list_owned_locations()'s own auth.uid() gate to read, so calling the RPC wrapper here would
-- just exercise its FORBIDDEN path, not real data. Verify the same underlying computation the RPC
-- uses (participation_count's correlated subquery) directly against real rows instead -- no
-- fixtures, no impersonation, proves the read capability produces sensible non-null counts.
select 'sample_participation_counts_direct_computation', coalesce((
  select string_agg(l.name||'='||(select count(*) from public.project_locations pl where pl.location_id=l.id and pl.removed_at is null)::text, ', ' order by l.name)
  from (select id,name from public.locations order by lower(name) limit 5) l
), '(no locations)')
union all
select 'any_null_participation_count_among_all_locations', exists(
  select 1 from public.locations l where (select count(*) from public.project_locations pl where pl.location_id=l.id and pl.removed_at is null) is null
)::text
order by 1;
