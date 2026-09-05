-- Location Media B4A -- production read-only pre-flight.
-- Pure SELECT, single statement (db-runner.mjs prints only the last statement's result set for a
-- multi-statement string, so everything needed lives in one query). Run inside a READ ONLY
-- transaction by db-runner.mjs. Confirms production is in the exact expected pre-migration state
-- before 20260907090000_location_media_foundation.sql is approved for apply: the B3C migration
-- already applied, this migration absent from history, no location_media table/bucket/RPC surface
-- already exists under the proposed names, the prerequisite composite unique constraint this
-- migration's FK depends on is present, existing Character-image and Location RPC surfaces are
-- unchanged, and current row counts for the post-apply integrity comparison.
select 'population_culture_module_migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260906090000')::text as value
union all
select 'location_media_foundation_migration_already_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260907090000')::text
union all
select 'location_media_table_already_exists', exists(select 1 from information_schema.tables where table_schema='public' and table_name='location_media')::text
union all
select 'location_media_bucket_already_exists', exists(select 1 from storage.buckets where id='location-media')::text
union all
select 'location_media_rpcs_already_exist', exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_media','create_location_media','update_location_media','delete_location_media'))::text
union all
select 'location_media_path_valid_already_exists', exists(select 1 from pg_proc where pronamespace='private'::regnamespace and proname='location_media_path_valid')::text
union all
select 'project_locations_location_id_id_key_prerequisite_exists', exists(select 1 from pg_constraint where conrelid='public.project_locations'::regclass and conname='project_locations_location_id_id_key')::text
union all
select 'character_images_bucket_unchanged', (select public::text||'|'||file_size_limit::text||'|'||array_to_string(allowed_mime_types,',') from storage.buckets where id='character-images')
union all
select 'character_images_table_exists', exists(select 1 from information_schema.tables where table_schema='public' and table_name='character_images')::text
union all
select 'character_images_rls_enabled', (select relrowsecurity::text from pg_class where relnamespace='public'::regnamespace and relname='character_images')
union all
select 'character_image_rpcs_present', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in ('list_character_images','create_character_image','update_character_image','delete_character_image'))
union all
select 'location_canonical_rpcs_present', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname in ('create_location_canonical','update_location_canonical','set_location_parent','list_owned_locations','create_location','update_location','delete_location'))
union all
select 'get_project_content_arg_count', (select pronargs::text from pg_proc where pronamespace='public'::regnamespace and proname='get_project_content')
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'projects_row_count', count(*)::text from public.projects
union all
select 'character_images_row_count', count(*)::text from public.character_images
union all
select 'most_recent_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
union all
select 'most_recent_project_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.project_locations
order by 1;
