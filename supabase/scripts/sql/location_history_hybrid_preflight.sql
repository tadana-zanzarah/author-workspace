-- Location History -- HYBRID IMPLEMENTATION -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for a
-- multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-migration state
-- before 20260908090000_location_history_base_profile_module.sql and
-- 20260908100000_location_history_events_foundation.sql are approved for apply: Location Media
-- (the last-applied migration) already applied, both new migrations absent from history, no
-- location_history_events table/RPC surface already exists under the proposed names, the current
-- base_profile allowlist is still exactly the five pre-History modules, existing Location/Media RPC
-- surfaces are unchanged, and current row counts (incl. orphan scene->location references) for the
-- post-apply integrity comparison.
select 'location_media_foundation_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260907090000')::text as value
union all
select 'location_history_base_profile_module_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260908090000')::text
union all
select 'location_history_events_foundation_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260908100000')::text
union all
select 'location_history_events_table_already_exists', exists(select 1 from information_schema.tables where table_schema='public' and table_name='location_history_events')::text
union all
select 'location_history_events_rpcs_already_exist', exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_history_events','create_location_history_event','update_location_history_event','delete_location_history_event'))::text
union all
select 'current_location_thematic_module_keys', (select array_to_string(private.location_thematic_module_keys(),','))
union all
select 'location_media_table_columns_count', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='location_media')
union all
select 'location_media_rpcs_present', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_media','create_location_media','update_location_media','delete_location_media'))
union all
select 'location_media_row_count', count(*)::text from public.location_media
union all
select 'location_canonical_rpcs_present', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in ('create_location_canonical','update_location_canonical','set_location_parent','list_owned_locations'))
union all
select 'update_location_canonical_arg_count', (select pronargs::text from pg_proc where pronamespace='public'::regnamespace and proname='update_location_canonical')
union all
select 'import_local_project_content_arg_count', (select pronargs::text from pg_proc where pronamespace='public'::regnamespace and proname='import_local_project_content')
union all
select 'get_local_project_import_snapshot_present', exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='get_local_project_import_snapshot')::text
union all
select 'get_project_content_arg_count', (select pronargs::text from pg_proc where pronamespace='public'::regnamespace and proname='get_project_content')
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'projects_row_count', count(*)::text from public.projects
union all
select 'scenes_row_count', count(*)::text from public.scenes
union all
-- scenes.location_id is a composite FK to project_locations(project_id,id) (Phase 2 cutover,
-- 20260903120000_location_phase2_cutover.sql), not a direct reference to public.locations(id) --
-- the FK itself already prevents a genuine orphan; this is a defensive regression check, not a
-- gap this migration could introduce.
select 'orphan_scene_location_refs', count(*)::text from public.scenes s where s.location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id)
union all
select 'most_recent_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
order by 1;
