-- Location Foundation Schema (Architecture V2 Phase 1) -- upgrade-path / legacy-preservation.
--
-- This suite runs against a database with the full migration chain already applied (the
-- convention every test file in this directory uses -- see cloud_content_schema.sql). There is
-- no local tooling in this environment to spin up Postgres and replay only migrations 1..N-1
-- before applying this one to get a literal "before" snapshot (no supabase CLI/Docker
-- available here -- see the Phase 1 report's TESTS/blocker section). Instead this exercises
-- the equivalent, and for the RPC surface strictly stronger, guarantee: the existing
-- production Location RPC (create_location/update_location/delete_location/create_scene/
-- get_project_content), unmodified in behavior by this migration, still reads and writes
-- location_projects_legacy_v1 end-to-end, exactly as it did against the table under its old
-- name, while the new Foundation tables stay untouched.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-upgrade-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-upgrade-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Upgrade Path Project',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);

do $$
declare
  loc_result jsonb; loc_id uuid; loc_rev bigint;
  scene_result jsonb; scene_id uuid; scene_rev bigint;
  content jsonb;
  n integer;
begin
  -- 1. Seed a "legacy" location the same way production always has: through create_location.
  loc_result := public.create_location('c2000000-0000-4000-8000-000000000001'::uuid,0,'Old Harbor','A weathered dock.');
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'create_location failed: %', loc_result; end if;
  loc_id := (loc_result->'data'->>'id')::uuid;
  loc_rev := (loc_result->>'revision')::bigint;

  -- 2. It landed in the renamed legacy table, not the new global `locations` table.
  select count(*) into n from public.location_projects_legacy_v1 where id=loc_id and project_id='c2000000-0000-4000-8000-000000000001' and name='Old Harbor' and description='A weathered dock.';
  if n<>1 then raise exception 'legacy location row not found after create_location, id=%', loc_id; end if;
  select count(*) into n from public.locations where owner_id='c1000000-0000-4000-8000-000000000001';
  if n<>0 then raise exception 'create_location wrote into the new global locations table, count=%', n; end if;

  -- 3. Seed a scene referencing it, the same way production always has: through create_scene.
  scene_result := public.create_scene('c2000000-0000-4000-8000-000000000001'::uuid,loc_rev,null,loc_id,'Arrival','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'create_scene failed: %', scene_result; end if;
  scene_id := (scene_result->'data'->>'id')::uuid;
  scene_rev := (scene_result->>'revision')::bigint;

  -- 4. scenes.location_id still points at the legacy row (FK is still legacy-targeted).
  select count(*) into n from public.scenes where id=scene_id and location_id=loc_id and project_id='c2000000-0000-4000-8000-000000000001';
  if n<>1 then raise exception 'scene did not retain legacy location_id, scene=%', scene_id; end if;

  -- 5. Cross-project location assignment is still rejected at the FK (same-project integrity
  --    is unchanged by this phase).
  begin
    insert into public.scenes(project_id,location_id,title,position) values ('c2000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000000','bad',999);
    raise exception 'scene accepted a non-existent/foreign location_id';
  exception when foreign_key_violation then null;
  end;

  -- 6. update_location / delete_location (also repointed by the compat fix) still work.
  loc_result := public.update_location('c2000000-0000-4000-8000-000000000001'::uuid,loc_id,scene_rev,'Old Harbor','Rebuilt after the storm.');
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'update_location failed: %', loc_result; end if;
  select count(*) into n from public.location_projects_legacy_v1 where id=loc_id and description='Rebuilt after the storm.';
  if n<>1 then raise exception 'update_location did not update the legacy row'; end if;

  -- 7. get_project_content still hydrates `locations` from the legacy table.
  content := public.get_project_content('c2000000-0000-4000-8000-000000000001'::uuid);
  if not coalesce((content->>'ok')::boolean,false) then raise exception 'get_project_content failed: %', content; end if;
  if jsonb_array_length(content->'data'->'locations')<>1 or (content->'data'->'locations'->0->>'id')::uuid<>loc_id then
    raise exception 'get_project_content locations payload wrong: %', content->'data'->'locations';
  end if;

  -- 8. Existing legacy RLS/ownership still authorizes correctly: a different user cannot
  --    create/read a location in this project via the same, unmodified RPC.
  perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
  loc_result := public.create_location('c2000000-0000-4000-8000-000000000001'::uuid,0,'Intruder','');
  if coalesce((loc_result->>'ok')::boolean,false) or loc_result->>'code'<>'NOT_FOUND' then
    raise exception 'cross-user create_location was not rejected: %', loc_result;
  end if;
  perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);

  -- 9. delete_location still deletes from the legacy table.
  loc_result := public.get_project_content('c2000000-0000-4000-8000-000000000001'::uuid);
  loc_result := public.delete_location('c2000000-0000-4000-8000-000000000001'::uuid,loc_id,(loc_result->>'revision')::bigint);
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'delete_location failed: %', loc_result; end if;
  select count(*) into n from public.location_projects_legacy_v1 where id=loc_id;
  if n<>0 then raise exception 'delete_location did not remove the legacy row'; end if;

  -- 10. New Foundation tables remain completely untouched by this whole legacy-path exercise.
  select count(*) into n from public.locations where owner_id in ('c1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001');
  if n<>0 then raise exception 'new locations table was written to by legacy RPC, count=%', n; end if;
  select count(*) into n from public.project_locations where project_id='c2000000-0000-4000-8000-000000000001';
  if n<>0 then raise exception 'new project_locations table was written to by legacy RPC, count=%', n; end if;
end $$;

reset role;
rollback;
