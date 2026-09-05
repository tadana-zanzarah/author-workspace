-- Location Media B4A -- production read-only post-apply verification for
-- 20260907090000_location_media_foundation.sql. Pure SELECT, single statement.
select 'migration_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260907090000')::text as value
union all
select 'location_media_columns', (select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='location_media')
union all
select 'location_media_location_id_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='location_id')
union all
select 'location_media_project_location_id_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='project_location_id')
union all
select 'location_media_revision_default', (select column_default from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='revision')
union all
select 'location_media_storage_cleanup_required_default', (select column_default from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='storage_cleanup_required')
union all
select 'location_media_pk_exists', exists(select 1 from pg_constraint where conrelid='public.location_media'::regclass and contype='p')::text
union all
select 'location_media_location_fk_deletetype', (select confdeltype::text from pg_constraint where conrelid='public.location_media'::regclass and contype='f' and confrelid='public.locations'::regclass and conname<>'location_media_context_fkey')
union all
select 'location_media_context_fkey_deletetype', (select confdeltype::text from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_context_fkey')
union all
select 'location_media_context_fkey_def', (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_context_fkey')
union all
select 'location_media_kind_check_def', (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_kind_check')
union all
select 'location_media_storage_path_unique_idx_exists', exists(select 1 from pg_indexes where schemaname='public' and tablename='location_media' and indexname='location_media_storage_path_unique_idx')::text
union all
select 'location_media_location_idx_exists', exists(select 1 from pg_indexes where schemaname='public' and tablename='location_media' and indexname='location_media_location_idx')::text
union all
select 'location_media_project_location_idx_exists', exists(select 1 from pg_indexes where schemaname='public' and tablename='location_media' and indexname='location_media_project_location_idx')::text
union all
select 'location_media_identity_primary_idx_partial_unique', exists(select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid where ic.relname='location_media_identity_primary_idx' and i.indisunique and i.indpred is not null)::text
union all
select 'location_media_project_primary_idx_partial_unique', exists(select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid where ic.relname='location_media_project_primary_idx' and i.indisunique and i.indpred is not null)::text
union all
select 'location_media_rls_enabled', (select relrowsecurity::text from pg_class where relnamespace='public'::regnamespace and relname='location_media')
union all
select 'location_media_policy_count', (select count(*)::text from pg_policies where schemaname='public' and tablename='location_media')
union all
select 'location_media_policy_names', (select string_agg(policyname,',' order by policyname) from pg_policies where schemaname='public' and tablename='location_media')
union all
select 'location_media_storage_policy_count', (select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'location_media_storage_%')
union all
select 'location_media_path_valid_exists', exists(select 1 from pg_proc where pronamespace='private'::regnamespace and proname='location_media_path_valid')::text
union all
select 'location_media_path_valid_secdef', (select prosecdef::text from pg_proc where pronamespace='private'::regnamespace and proname='location_media_path_valid')
union all
select 'location_media_rpc_signatures', (select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',E'\n' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('list_location_media','create_location_media','update_location_media','delete_location_media'))
union all
select 'location_media_rpc_secdef_any', exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_media','create_location_media','update_location_media','delete_location_media') and prosecdef)::text
union all
select 'bucket_location_media_config', (select public::text||'|'||file_size_limit::text||'|'||array_to_string(allowed_mime_types,',') from storage.buckets where id='location-media')
union all
select 'bucket_character_images_config_unchanged', (select public::text||'|'||file_size_limit::text||'|'||array_to_string(allowed_mime_types,',') from storage.buckets where id='character-images')
union all
select 'character_images_table_exists', exists(select 1 from information_schema.tables where table_schema='public' and table_name='character_images')::text
union all
select 'character_images_rls_enabled', (select relrowsecurity::text from pg_class where relnamespace='public'::regnamespace and relname='character_images')
union all
select 'character_image_rpc_signatures', (select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',E'\n' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('list_character_images','create_character_image','update_character_image','delete_character_image'))
union all
select 'location_canonical_rpc_signatures', (select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',E'\n' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('create_location_canonical','update_location_canonical','set_location_parent','list_owned_locations','create_location','update_location','delete_location'))
union all
select 'get_project_content_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='get_project_content')
union all
select 'location_media_row_count', count(*)::text from public.location_media
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'projects_row_count', count(*)::text from public.projects
union all
select 'scenes_row_count', count(*)::text from public.scenes
union all
select 'character_images_row_count', count(*)::text from public.character_images
union all
select 'orphan_scene_location_refs', count(*)::text from public.scenes s where s.location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id)
union all
select 'most_recent_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.locations
union all
select 'most_recent_project_locations_updated_at', coalesce(max(updated_at)::text,'(none)') from public.project_locations
order by 1;
