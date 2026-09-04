-- Location Adaptive Modules B3B (governmentSociety, economy) -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for a
-- multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-migration state
-- before 20260905090000_location_government_economy_modules.sql is approved for apply: the
-- adaptive-module-selection migration already applied, this migration absent from history, the
-- current allowlist is exactly the pre-B3B two-key array, current row counts, and that no existing
-- location already carries a governmentSociety/economy base_profile key this migration's allowlist
-- expansion would suddenly start validating writes against (it wouldn't touch existing data
-- either way -- this is a confirmation, not a precondition for safety).
select 'adaptive_module_selection_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260904140000')::text as value
union all
select 'government_economy_modules_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260905090000')::text
union all
select 'private_location_thematic_module_keys_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='location_thematic_module_keys')::text
union all
select 'private_location_thematic_module_keys_value_before', (select private.location_thematic_module_keys()::text)
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'locations_with_governmentSociety_key_already', count(*)::text from public.locations where base_profile ? 'governmentSociety'
union all
select 'locations_with_economy_key_already', count(*)::text from public.locations where base_profile ? 'economy'
union all
select 'locations_with_populationCulture_key_already', count(*)::text from public.locations where base_profile ? 'populationCulture'
union all
select 'locations_with_historyNotes_key_already', count(*)::text from public.locations where base_profile ? 'historyNotes'
union all
select 'project_locations_with_governmentSociety_in_moduleSelection_already', count(*)::text from public.project_locations where metadata->'locationProfile'->'moduleSelection'->'shown' ? 'governmentSociety' or metadata->'locationProfile'->'moduleSelection'->'hidden' ? 'governmentSociety'
union all
select 'project_locations_with_economy_in_moduleSelection_already', count(*)::text from public.project_locations where metadata->'locationProfile'->'moduleSelection'->'shown' ? 'economy' or metadata->'locationProfile'->'moduleSelection'->'hidden' ? 'economy'
union all
select 'most_recent_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
union all
select 'most_recent_project_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.project_locations
order by 1;
