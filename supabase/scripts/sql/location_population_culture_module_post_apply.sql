-- Location Adaptive Modules B3C (populationCulture) -- post-apply verification.
-- Pure SELECT, single statement, run READ ONLY. Confirms 20260906090000 landed with exactly the
-- intended shape: allowlist extended in canonical order, the three generic RPC signatures
-- untouched, no new tables/columns/indexes, zero data rewritten (row counts, timestamps, and
-- base_profile/metadata contents unchanged from the pre-apply baseline).
select 'population_culture_module_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260906090000')::text as value
union all
select 'government_economy_modules_migration_still_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260905090000')::text
union all
select 'adaptive_module_selection_migration_still_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260904140000')::text
union all
select 'private_location_thematic_module_keys_value_after', (select private.location_thematic_module_keys()::text)
union all
select 'allowlist_is_exact_expected_array', (select private.location_thematic_module_keys()=array['appearanceAtmosphere','geography','governmentSociety','economy','populationCulture'])::text
union all
select 'update_location_canonical_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'update_location_canonical_arguments', (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'update_project_location_module_selection_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_project_location_module_selection')
union all
select 'update_project_location_module_selection_arguments', (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_project_location_module_selection')
union all
select 'import_local_project_content_arg_count', (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
select 'import_local_project_content_arguments', (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
-- No new RPCs introduced by this migration (it CREATE OR REPLACEd exactly one existing function).
select 'public_rpc_count_location_related', count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('update_location_canonical','update_project_location_module_selection','import_local_project_content','create_location_canonical','set_location_parent','list_owned_locations','delete_location','attach_project_location')
union all
-- No new table introduced.
select 'public_table_count_unchanged_marker', count(*)::text from pg_tables where schemaname='public'
union all
-- No new column on locations/project_locations.
select 'locations_column_count', count(*)::text from information_schema.columns where table_schema='public' and table_name='locations'
union all
select 'project_locations_column_count', count(*)::text from information_schema.columns where table_schema='public' and table_name='project_locations'
union all
-- Data integrity: row counts unchanged from preflight baseline (locations=22, project_locations=22).
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
-- No automatic populationCulture key silently added to any existing row.
select 'locations_with_populationCulture_key_after', count(*)::text from public.locations where base_profile ? 'populationCulture'
union all
select 'locations_with_historyNotes_key_after', count(*)::text from public.locations where base_profile ? 'historyNotes'
union all
-- No data rewrite: timestamps byte-identical to the pre-apply preflight baseline (this migration
-- is function-body-only DDL -- CREATE OR REPLACE FUNCTION never touches locations/project_locations
-- rows, so these must match the preflight's recorded values exactly).
select 'most_recent_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
union all
select 'most_recent_project_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.project_locations
union all
select 'project_locations_metadata_object_constraint_present', exists(select 1 from pg_constraint where conname='project_locations_metadata_object')::text
order by 1;
