-- Read-only pre-flight for 20260909120000_scene_rich_text.sql.
-- Confirms: scenes.metadata already exists with the expected shape/default,
-- no metadata rows already carry a conflicting "richText" key, update_scene_text
-- does not already exist (no collision), and update_scene's current live
-- signature matches what this migration assumes it must not touch.

select 'scenes_metadata_column' as check_name,
  column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema='public' and table_name='scenes' and column_name='metadata';

select 'existing_metadata_richtext_usage' as check_name, count(*) as rows_with_richtext_key
from public.scenes where metadata ? 'richText';

select 'existing_nonempty_metadata_rows' as check_name, count(*) as rows_with_nonempty_metadata
from public.scenes where metadata <> '{}'::jsonb;

select 'update_scene_text_collision_check' as check_name,
  p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='update_scene_text';

select 'update_scene_current_signature' as check_name,
  p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='update_scene';

select 'create_scene_current_signature' as check_name,
  p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='create_scene';

select 'scenes_row_count' as check_name, count(*) as total_scenes from public.scenes;
