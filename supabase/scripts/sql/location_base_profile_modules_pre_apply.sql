-- Location base_profile thematic-module contract -- immediate PRE-APPLY snapshot.
-- Pure SELECT, single statement, run READ ONLY. Records the exact current production state
-- (counts, signatures, invariants) immediately before applying 20260904130000, per the approval's
-- "use current production truth, not an old hardcoded baseline" instruction.
select 'phase3_core_identity_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260904120000')::text as value
union all
select 'base_profile_modules_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260904130000')::text
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
select 'most_recent_location_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
union all
select 'update_location_canonical_overload_count', (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'update_location_canonical_arg_count', (select string_agg(pronargs::text,', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'update_location_canonical_arg_types', (select string_agg(pg_get_function_arguments(p.oid),' || ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_location_canonical')
union all
select 'import_local_project_content_overload_count', (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
select 'import_local_project_content_arg_count', (select string_agg(pronargs::text,', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='import_local_project_content')
union all
select 'private_location_thematic_module_keys_exists', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='location_thematic_module_keys')::text
union all
select 'locations_with_appearanceAtmosphere', count(*)::text from public.locations where base_profile ? 'appearanceAtmosphere'
union all
select 'locations_with_geography', count(*)::text from public.locations where base_profile ? 'geography'
union all
select 'locations_base_profile_object_constraint_present', exists(select 1 from pg_constraint where conname='locations_base_profile_object')::text
union all
select 'sample_location_ids_checksum', md5((select string_agg(id::text,',' order by id) from public.locations))
union all
select 'sample_participation_ids_checksum', md5((select string_agg(id::text,',' order by id) from public.project_locations))
order by 1;
