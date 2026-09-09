-- Scene Rich Text (T1) -- production read-only post-apply verification for
-- 20260909120000_scene_rich_text.sql. Pure SELECT, single statement.
select 'migration_20260909120000_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260909120000')::text as value
union all
select 'update_scene_text_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='update_scene_text')
union all
select 'update_scene_text_overload_count', (select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname='update_scene_text')
union all
select 'update_scene_text_secdef', (select prosecdef::text from pg_proc where pronamespace='public'::regnamespace and proname='update_scene_text')
union all
select 'update_scene_text_anon_grant', exists(select 1 from information_schema.role_routine_grants where routine_schema='public' and routine_name='update_scene_text' and grantee='anon')::text
union all
select 'update_scene_text_authenticated_grant', exists(select 1 from information_schema.role_routine_grants where routine_schema='public' and routine_name='update_scene_text' and grantee='authenticated')::text
union all
select 'scenes_metadata_column_unchanged', (select data_type||','||column_default||','||is_nullable from information_schema.columns where table_schema='public' and table_name='scenes' and column_name='metadata')
union all
select 'scenes_columns_unchanged', (select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='scenes')
union all
select 'update_scene_signature_unchanged', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='update_scene')
union all
select 'create_scene_signature_unchanged', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='create_scene')
union all
select 'scenes_rows_with_nonempty_metadata_after_apply', count(*)::text from public.scenes where metadata<>'{}'::jsonb
union all
select 'scenes_row_count_unchanged', count(*)::text from public.scenes
union all
select 'projects_row_count_unchanged', count(*)::text from public.projects
order by 1;
