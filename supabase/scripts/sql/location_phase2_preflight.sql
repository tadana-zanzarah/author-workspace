-- Location Architecture V2 Phase 2 -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for
-- a multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-cutover state
-- before 20260903120000_location_phase2_cutover.sql is approved for apply.
select 'legacy_location_rows' as check, count(*)::text as value from public.location_projects_legacy_v1
union all
select 'new_locations_rows', count(*)::text from public.locations
union all
select 'new_project_locations_rows', count(*)::text from public.project_locations
union all
select 'scenes_with_location', count(*)::text from public.scenes where location_id is not null and deleted_at is null
union all
select 'orphan_legacy_scene_refs', count(*)::text
  from public.scenes s
  where s.location_id is not null and s.deleted_at is null
    and not exists (select 1 from public.location_projects_legacy_v1 l where l.id=s.location_id and l.project_id=s.project_id)
union all
select 'scenes_location_fk_target', c2.relname
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey'
union all
select 'legacy_table_authenticated_has_write_privilege',
  (has_table_privilege('authenticated','public.location_projects_legacy_v1','INSERT')
   or has_table_privilege('authenticated','public.location_projects_legacy_v1','UPDATE')
   or has_table_privilege('authenticated','public.location_projects_legacy_v1','DELETE'))::text
union all
select 'phase2_migration_already_in_history',
  exists(select 1 from supabase_migrations.schema_migrations where version='20260903120000')::text
union all
select 'phase1_migration_in_history',
  exists(select 1 from supabase_migrations.schema_migrations where version='20260902120000')::text
union all
select 'most_recent_legacy_location_updated_at', coalesce(max(updated_at)::text,'(none)') from public.location_projects_legacy_v1
order by 1;
