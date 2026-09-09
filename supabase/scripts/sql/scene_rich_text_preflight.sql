-- Scene Rich Text (T1) -- production read-only pre-flight for
-- 20260909120000_scene_rich_text.sql. Pure SELECT, single statement. Confirms
-- the migration is absent from history, update_scene_text does not already
-- exist under this or a conflicting signature, scenes.metadata has the
-- expected shape/default and no row already uses a "richText" key or any
-- non-empty value, and the existing update_scene/create_scene signatures this
-- migration must not disturb are exactly as expected.
select 'scene_rich_text_migration_already_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260909120000')::text as value
union all
select 'update_scene_text_already_exists', exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='update_scene_text')::text
union all
select 'scenes_metadata_column_type', (select data_type from information_schema.columns where table_schema='public' and table_name='scenes' and column_name='metadata')
union all
select 'scenes_metadata_column_default', (select column_default from information_schema.columns where table_schema='public' and table_name='scenes' and column_name='metadata')
union all
select 'scenes_metadata_column_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='scenes' and column_name='metadata')
union all
select 'scenes_rows_with_richtext_key', count(*)::text from public.scenes where metadata ? 'richText'
union all
select 'scenes_rows_with_nonempty_metadata', count(*)::text from public.scenes where metadata<>'{}'::jsonb
union all
select 'update_scene_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='update_scene')
union all
select 'create_scene_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='create_scene')
union all
select 'scenes_row_count', count(*)::text from public.scenes
union all
select 'projects_row_count', count(*)::text from public.projects
order by 1;
