-- Location History -- HYBRID IMPLEMENTATION -- production read-only post-apply verification for
-- 20260908090000_location_history_base_profile_module.sql and
-- 20260908100000_location_history_events_foundation.sql. Pure SELECT, single statement.
select 'migration_20260908090000_in_history' as check, exists(select 1 from supabase_migrations.schema_migrations where version='20260908090000')::text as value
union all
select 'migration_20260908100000_in_history', exists(select 1 from supabase_migrations.schema_migrations where version='20260908100000')::text
union all
select 'location_thematic_module_keys', (select array_to_string(private.location_thematic_module_keys(),','))
union all
select 'location_history_events_columns', (select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='location_history_events')
union all
select 'location_history_events_no_project_location_id', (not exists(select 1 from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='project_location_id'))::text
union all
select 'location_history_events_no_sort_key', (not exists(select 1 from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='sort_key'))::text
union all
select 'location_history_events_no_event_type', (not exists(select 1 from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='event_type'))::text
union all
select 'location_history_events_location_id_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='location_id')
union all
select 'location_history_events_title_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='title')
union all
select 'location_history_events_revision_default', (select column_default from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='revision')
union all
select 'location_history_events_sort_order_type', (select numeric_precision::text||','||numeric_scale::text from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='sort_order')
union all
select 'location_history_events_pk_exists', exists(select 1 from pg_constraint where conrelid='public.location_history_events'::regclass and contype='p')::text
union all
select 'location_history_events_location_fk_deletetype', (select confdeltype::text from pg_constraint where conrelid='public.location_history_events'::regclass and contype='f' and confrelid='public.locations'::regclass)
union all
select 'location_history_events_check_constraints', (select string_agg(conname,',' order by conname) from pg_constraint where conrelid='public.location_history_events'::regclass and contype='c')
union all
select 'location_history_events_location_idx_exists', exists(select 1 from pg_indexes where schemaname='public' and tablename='location_history_events' and indexname='location_history_events_location_idx')::text
union all
select 'location_history_events_order_idx_exists', exists(select 1 from pg_indexes where schemaname='public' and tablename='location_history_events' and indexname='location_history_events_order_idx')::text
union all
select 'location_history_events_rls_enabled', (select relrowsecurity::text from pg_class where relnamespace='public'::regnamespace and relname='location_history_events')
union all
select 'location_history_events_policy_count', (select count(*)::text from pg_policies where schemaname='public' and tablename='location_history_events')
union all
select 'location_history_events_policy_names', (select string_agg(policyname,',' order by policyname) from pg_policies where schemaname='public' and tablename='location_history_events')
union all
select 'location_history_events_anon_grants', (select count(*)::text from information_schema.role_table_grants where table_schema='public' and table_name='location_history_events' and grantee='anon')
union all
select 'location_history_events_rpc_signatures', (select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',E'\n' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('list_location_history_events','create_location_history_event','update_location_history_event','delete_location_history_event'))
union all
select 'location_history_events_rpc_overload_counts', (select string_agg(proname||'='||cnt::text,',' order by proname) from (select proname,count(*) cnt from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_history_events','create_location_history_event','update_location_history_event','delete_location_history_event') group by proname) x)
union all
select 'location_history_events_rpc_secdef_any', exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_history_events','create_location_history_event','update_location_history_event','delete_location_history_event') and prosecdef)::text
union all
select 'location_history_events_row_count', count(*)::text from public.location_history_events
union all
select 'update_location_canonical_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='update_location_canonical')
union all
select 'import_local_project_content_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='import_local_project_content')
union all
select 'get_local_project_import_snapshot_signature', (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname='get_local_project_import_snapshot')
union all
select 'location_media_columns_unchanged', (select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='location_media')
union all
select 'location_media_rpc_signatures_unchanged', (select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',E'\n' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('list_location_media','create_location_media','update_location_media','delete_location_media'))
union all
select 'location_media_row_count_unchanged', count(*)::text from public.location_media
union all
select 'locations_row_count', count(*)::text from public.locations
union all
select 'project_locations_row_count', count(*)::text from public.project_locations
union all
select 'projects_row_count', count(*)::text from public.projects
union all
select 'scenes_row_count', count(*)::text from public.scenes
union all
select 'orphan_scene_location_refs', count(*)::text from public.scenes s where s.location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id)
order by 1;
