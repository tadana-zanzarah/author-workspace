-- Location Architecture V2 Phase 3 -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for a
-- multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-Phase-3 state,
-- and that none of the new function names already exist (no accidental `create or replace`
-- overwrite of something else), before 20260904120000_location_phase3_core_identity.sql is
-- approved for apply.
select 'phase2_cutover_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260903120000')::text as value
union all
select 'phase3_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260904120000')::text
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'type_preset_column_default', coalesce((select column_default from information_schema.columns where table_schema='public' and table_name='locations' and column_name='type_preset'),'(none)')
union all
select 'type_preset_is_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='locations' and column_name='type_preset')
union all
select 'type_preset_distinct_values', coalesce((select string_agg(distinct coalesce(type_preset,'(null)'), ', ') from public.locations),'(none)')
union all
select 'locations_with_official_name', count(*)::text from public.locations where official_name is not null
union all
select 'locations_with_aliases', count(*)::text from public.locations where array_length(aliases,1) > 0
union all
select 'locations_with_parent', count(*)::text from public.locations where parent_id is not null
union all
select 'scenes_project_location_fkey_target', c2.relname
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey'
union all
select 'name_collision_create_location_canonical', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_location_canonical')::text
union all
select 'name_collision_update_location_canonical', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')::text
union all
select 'name_collision_set_location_parent', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='set_location_parent')::text
union all
select 'name_collision_list_owned_locations', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_owned_locations')::text
union all
select 'name_collision_private_normalize_location_aliases', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='normalize_location_aliases')::text
union all
select 'attach_project_location_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='attach_project_location')::text
union all
select 'most_recent_location_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
order by 1;
