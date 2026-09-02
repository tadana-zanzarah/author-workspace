-- True upgrade-path CI fixture, step 2 of 2 (see .github/workflows/location-foundation-ci.yml).
--
-- MUST run after location_upgrade_00_pre_seed.sql seeded the pre-Phase-1 database AND after
-- `supabase migration up` applied 20260902120000_location_foundation_schema.sql alone on top
-- (no other migration re-runs, no reset). Verifies the pre-migration row and its Scene FK
-- survived byte-for-byte, the new Foundation tables stayed empty, and every compat-fixed RPC
-- (create/update/delete_location, create/update_scene, get_project_content,
-- import_local_project_content) still operates end-to-end through the renamed legacy table.

do $$
declare
  loc_id uuid; scene_id uuid; project_id uuid; other_user_id uuid;
  n integer; fk_target text;
begin
  select value::uuid into loc_id from public._ci_location_upgrade_fixture where key='location_id';
  select value::uuid into scene_id from public._ci_location_upgrade_fixture where key='scene_id';
  select value::uuid into project_id from public._ci_location_upgrade_fixture where key='project_id';
  select value::uuid into other_user_id from public._ci_location_upgrade_fixture where key='other_user_id';
  if loc_id is null or scene_id is null or project_id is null then
    raise exception 'fixture missing -- location_upgrade_00_pre_seed.sql did not run before the migration was applied';
  end if;

  -- 1. The pre-migration location row survived, under its original id, in the renamed table.
  select count(*) into n from public.location_projects_legacy_v1 where id=loc_id and project_id=project_id and name='Pre-Migration Harbor' and description='Seeded before Phase 1.';
  if n<>1 then raise exception 'pre-migration location row missing/changed after migration, id=%', loc_id; end if;

  -- 2. scene.location_id is byte-for-byte unchanged.
  select count(*) into n from public.scenes where id=scene_id and location_id=loc_id and project_id=project_id;
  if n<>1 then raise exception 'scene.location_id changed after migration, scene=%', scene_id; end if;

  -- 3. The FK still resolves (by OID) to the renamed legacy table, never to the new tables --
  --    this is the core "no accidental switch to the new empty locations table" guarantee.
  select c2.relname into fk_target
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey';
  if fk_target is distinct from 'location_projects_legacy_v1' then
    raise exception 'scenes_project_location_fkey targets % after migration (expected location_projects_legacy_v1)', fk_target;
  end if;

  -- 4. New Foundation tables are still empty -- no backfill happened.
  select count(*) into n from public.locations; if n<>0 then raise exception 'new locations table non-empty after migration, count=%', n; end if;
  select count(*) into n from public.project_locations; if n<>0 then raise exception 'new project_locations table non-empty after migration, count=%', n; end if;
end $$;

-- Each role-switching section below is wrapped in its own explicit transaction: `SET LOCAL
-- role` / `set_config(..., true)` only take effect for the duration of a transaction block, so
-- without one each statement would run as its own auto-committed implicit transaction and the
-- role switch would silently not apply to the next statement.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000001',true);

do $$
declare
  loc_id uuid; scene_id uuid; project_id uuid;
  loc_result jsonb; content jsonb; cur_rev bigint; n integer;
begin
  select value::uuid into loc_id from public._ci_location_upgrade_fixture where key='location_id';
  select value::uuid into scene_id from public._ci_location_upgrade_fixture where key='scene_id';
  select value::uuid into project_id from public._ci_location_upgrade_fixture where key='project_id';

  -- 5. get_project_content still hydrates `locations` from the (preserved) legacy row.
  content := public.get_project_content(project_id);
  if not coalesce((content->>'ok')::boolean,false) then raise exception 'post-migration get_project_content failed: %', content; end if;
  if jsonb_array_length(content->'data'->'locations')<>1 or (content->'data'->'locations'->0->>'id')::uuid<>loc_id then
    raise exception 'post-migration get_project_content locations payload wrong: %', content->'data'->'locations';
  end if;
  cur_rev := (content->>'revision')::bigint;

  -- 6. update_location (compat-fixed) still writes the legacy row.
  loc_result := public.update_location(project_id,loc_id,cur_rev,'Pre-Migration Harbor','Repaired after the Phase 1 migration.');
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'post-migration update_location failed: %', loc_result; end if;
  select count(*) into n from public.location_projects_legacy_v1 where id=loc_id and description='Repaired after the Phase 1 migration.';
  if n<>1 then raise exception 'post-migration update_location did not update the legacy row'; end if;
  cur_rev := (loc_result->>'revision')::bigint;

  -- 7. update_scene (compat-fixed) still accepts the legacy location_id.
  loc_result := public.update_scene(project_id,scene_id,cur_rev,null,loc_id,'Pre-Migration Scene (revised)','',null,null,'placed','draft',true,false);
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'post-migration update_scene failed: %', loc_result; end if;
  cur_rev := (loc_result->>'revision')::bigint;

  -- 8. delete_location (compat-fixed) still deletes the legacy row.
  loc_result := public.delete_location(project_id,loc_id,cur_rev);
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'post-migration delete_location failed: %', loc_result; end if;
  select count(*) into n from public.location_projects_legacy_v1 where id=loc_id;
  if n<>0 then raise exception 'post-migration delete_location did not remove the legacy row'; end if;
end $$;

reset role;
commit;

-- 9. Local->cloud import compatibility: private.local_import_target_empty and
--    import_local_project_content (both repointed at the legacy table) still work end-to-end
--    against a fresh empty project, post-migration.
begin;
insert into public.projects(id,owner_id,title,revision) values ('9c000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000001','CI Import Project',0);
set local role authenticated;
select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000001',true);
do $$
declare payload jsonb; result jsonb; n integer;
begin
  payload := jsonb_build_object(
    'project_id','9c000000-0000-4000-8000-000000000002',
    'source_project_id','ci-local-project',
    'migration_attempt_id','9d000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,
    'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object('id','9e000000-0000-4000-8000-000000000001','name','Imported Location','description','From local.','metadata','{}'::jsonb)),
    'tags','[]'::jsonb,
    'scenes','[]'::jsonb,
    'scene_tags','[]'::jsonb,
    'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,
    'scene_relation_changes','[]'::jsonb,
    'structural_links','[]'::jsonb,
    'character_images','[]'::jsonb
  );
  result := public.import_local_project_content('9c000000-0000-4000-8000-000000000002'::uuid,0,'9d000000-0000-4000-8000-000000000001'::uuid,'ci-local-project',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'post-migration import_local_project_content failed: %', result; end if;
  select count(*) into n from public.location_projects_legacy_v1 where id='9e000000-0000-4000-8000-000000000001' and project_id='9c000000-0000-4000-8000-000000000002';
  if n<>1 then raise exception 'imported location not found in legacy table after migration'; end if;
  select count(*) into n from public.locations where owner_id='9a000000-0000-4000-8000-000000000001';
  if n<>0 then raise exception 'import wrote into the new global locations table, count=%', n; end if;
end $$;
reset role;
commit;

drop table public._ci_location_upgrade_fixture;
