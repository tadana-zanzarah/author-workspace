-- Location Architecture V2 Phase 2 -- RPC/read-model regression against a fully migrated
-- (fresh, post-cutover) database. Runs in the standard convention for this directory: applied
-- after the full migration chain, everything wrapped and rolled back.
--
-- The true backfill/FK-cutover path (legacy data -> new tables, preserved ids, scene refs
-- surviving) is covered separately by the true-upgrade-path CI job
-- (supabase/tests/ci/location_phase2_00_pre_seed.sql / _01_post_verify.sql), the same way
-- Phase 1's upgrade path is covered by location_upgrade_00/01. This file instead proves the new
-- model's day-to-day RPC contract works end-to-end once the cutover has already happened.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-p2-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-p2-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Project A1',0),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','Project A2',0),
('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Project B1',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

do $$
declare
  proj1 uuid:='a2000000-0000-4000-8000-000000000001';
  proj2 uuid:='a2000000-0000-4000-8000-000000000002';
  r jsonb; rev bigint; pl_id uuid; canonical_id uuid; other_pl_id uuid; other_canonical_id uuid;
  scene_result jsonb; scene_id uuid; content jsonb; n integer;
begin
  -- 1. create_location creates a canonical identity AND a project participation row, and the
  --    participation id is what the response/UI treats as "the location id".
  r:=public.create_location(proj1,0,'Old Harbor','A weathered dock.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'create_location failed: %', r; end if;
  pl_id:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid; rev:=(r->>'revision')::bigint;
  if pl_id is null or canonical_id is null or pl_id=canonical_id then
    raise exception 'create_location did not return distinct participation/canonical ids: %', r;
  end if;
  select count(*) into n from public.locations where id=canonical_id and name='Old Harbor' and base_profile->>'description'='A weathered dock.' and owner_id='a1000000-0000-4000-8000-000000000001';
  if n<>1 then raise exception 'canonical locations row missing/wrong after create_location'; end if;
  select count(*) into n from public.project_locations where id=pl_id and project_id=proj1 and location_id=canonical_id and removed_at is null;
  if n<>1 then raise exception 'project_locations row missing/wrong after create_location'; end if;

  -- 2. Same name is allowed for a second, unrelated canonical Location (no dedup by name).
  r:=public.create_location(proj1,rev,'Old Harbor','A second, unrelated dock with the same name.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'second create_location (same name) failed: %', r; end if;
  other_pl_id:=(r->'data'->>'id')::uuid; other_canonical_id:=(r->'data'->>'location_id')::uuid; rev:=(r->>'revision')::bigint;
  if other_canonical_id=canonical_id then raise exception 'same-name create_location incorrectly reused the first canonical identity'; end if;
  select count(*) into n from public.locations where name='Old Harbor' and owner_id='a1000000-0000-4000-8000-000000000001';
  if n<>2 then raise exception 'expected 2 distinct canonical locations named Old Harbor, found %', n; end if;

  -- 3. Scene create/update validate target_location_id against project_locations, scoped to
  --    the SAME project -- a participation id from another project is rejected.
  r:=public.create_location(proj2,0,'Foreign Location','');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'create_location in proj2 failed: %', r; end if;
  declare foreign_pl_id uuid:=(r->'data'->>'id')::uuid; begin
    scene_result:=public.create_scene(proj1,rev,null,foreign_pl_id,'Bad Scene','',null,null,'placed','draft',true,false,null);
    if coalesce((scene_result->>'ok')::boolean,false) or scene_result->>'code'<>'NOT_FOUND' then
      raise exception 'create_scene accepted a cross-project participation id: %', scene_result;
    end if;
  end;

  -- 4. Scene create/update accept a same-project participation id, and scene.location_id is
  --    literally the project_locations.id (not the canonical id).
  scene_result:=public.create_scene(proj1,rev,null,pl_id,'Arrival','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'create_scene failed: %', scene_result; end if;
  scene_id:=(scene_result->'data'->>'id')::uuid; rev:=(scene_result->>'revision')::bigint;
  select count(*) into n from public.scenes where id=scene_id and location_id=pl_id and project_id=proj1;
  if n<>1 then raise exception 'scene did not store the participation id as location_id'; end if;

  -- 5. get_project_content hydrates the current UI-compatible flat shape: id (=participation),
  --    name, description sourced from canonical base_profile, ordered by name.
  content:=public.get_project_content(proj1);
  if not coalesce((content->>'ok')::boolean,false) then raise exception 'get_project_content failed: %', content; end if;
  if jsonb_array_length(content->'data'->'locations')<>2 then raise exception 'get_project_content locations count wrong: %', content->'data'->'locations'; end if;
  if not exists(select 1 from jsonb_array_elements(content->'data'->'locations') x where (x->>'id')::uuid=pl_id and x->>'name'='Old Harbor' and x->>'description'='A weathered dock.' and (x->>'location_id')::uuid=canonical_id) then
    raise exception 'get_project_content did not hydrate the expected location row: %', content->'data'->'locations';
  end if;
  rev:=(content->>'revision')::bigint;

  -- 6. update_location updates the CANONICAL identity (name/description are global, by design
  --    -- see Architecture V2 rule 1), and is a no-op (changed:false, no revision bump) when the
  --    submitted values already match.
  r:=public.update_location(proj1,pl_id,rev,'Old Harbor','A weathered dock.');
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'no-op update_location was not detected: %', r; end if;
  r:=public.update_location(proj1,pl_id,rev,'Old Harbor','Rebuilt after the storm.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'update_location failed: %', r; end if;
  rev:=(r->>'revision')::bigint;
  select count(*) into n from public.locations where id=canonical_id and base_profile->>'description'='Rebuilt after the storm.';
  if n<>1 then raise exception 'update_location did not update the canonical row'; end if;

  -- 7. delete_location (= remove project participation) is refused with a domain error while an
  --    active Scene in this project still references it -- no silent null, no partial state.
  r:=public.delete_location(proj1,pl_id,rev);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'DEPENDENCIES_EXIST' or (r->'dependencies'->>'scenes')::int<>1 then
    raise exception 'delete_location did not refuse with DEPENDENCIES_EXIST while referenced: %', r;
  end if;
  select count(*) into n from public.project_locations where id=pl_id and removed_at is null;
  if n<>1 then raise exception 'delete_location mutated participation despite being refused'; end if;

  -- 8. Once the Scene no longer references it, delete_location succeeds: participation is
  --    soft-removed (removed_at set), but the canonical global identity is NOT deleted.
  scene_result:=public.update_scene(proj1,scene_id,rev,null,null,'Arrival','',null,null,'placed','draft',true,false);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'update_scene (clear location) failed: %', scene_result; end if;
  rev:=(scene_result->>'revision')::bigint;
  r:=public.delete_location(proj1,pl_id,rev);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'delete_location failed once unreferenced: %', r; end if;
  rev:=(r->>'revision')::bigint;
  select count(*) into n from public.project_locations where id=pl_id and removed_at is not null;
  if n<>1 then raise exception 'delete_location did not soft-remove the participation row'; end if;
  select count(*) into n from public.locations where id=canonical_id;
  if n<>1 then raise exception 'delete_location deleted the canonical global Location identity (must never happen)'; end if;
  content:=public.get_project_content(proj1);
  if exists(select 1 from jsonb_array_elements(content->'data'->'locations') x where (x->>'id')::uuid=pl_id) then
    raise exception 'get_project_content still hydrates a removed participation row';
  end if;

  -- 9. attach_project_location reactivates the SAME removed participation row in place --
  --    no duplicate row for the same (project_id, location_id) pair.
  r:=public.attach_project_location(proj1,canonical_id,rev);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'attach_project_location (reactivate) failed: %', r; end if;
  if (r->'data'->>'id')::uuid<>pl_id then raise exception 'attach_project_location created a NEW row instead of reactivating id=%: %', pl_id, r; end if;
  rev:=(r->>'revision')::bigint;
  select count(*) into n from public.project_locations where project_id=proj1 and location_id=canonical_id;
  if n<>1 then raise exception 'attach_project_location left a duplicate (project_id,location_id) row, count=%', n; end if;
  select count(*) into n from public.project_locations where id=pl_id and removed_at is null;
  if n<>1 then raise exception 'attach_project_location did not clear removed_at'; end if;

  -- 10. attach_project_location refuses a second attach while already active (DUPLICATE).
  r:=public.attach_project_location(proj1,canonical_id,rev);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'DUPLICATE' then raise exception 'attach_project_location did not refuse an active duplicate: %', r; end if;

  -- 11. The same canonical Location can participate in a second, different project of the same
  --     owner (no cross-project dedup barrier -- Architecture V2 rule 10 is about NOT deduping
  --     by name, not about forbidding legitimate multi-project participation).
  r:=public.attach_project_location(proj2,canonical_id,(select revision from public.projects where id=proj2));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'attach_project_location into a second project failed: %', r; end if;
  select count(*) into n from public.locations where id=canonical_id;
  if n<>1 then raise exception 'canonical identity was duplicated by multi-project attach, count=%', n; end if;

  -- 12. Cross-user isolation at the RPC layer: user B cannot operate on user A's project via
  --     the new RPCs.
  perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
  r:=public.create_location(proj1,rev,'Intruder','');
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'cross-user create_location was not rejected: %', r; end if;
  r:=public.update_location(proj1,pl_id,rev,'Hacked','');
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'cross-user update_location was not rejected: %', r; end if;
  r:=public.delete_location(proj1,pl_id,rev);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'cross-user delete_location was not rejected: %', r; end if;
  r:=public.attach_project_location(proj1,canonical_id,rev);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'cross-user attach_project_location was not rejected: %', r; end if;
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
end $$;

-- 13. Local->cloud import maps `import_payload.locations` to a fresh canonical identity +
--     participation row (preserving the payload's `id` as the participation id), matching the
--     backfill mapping exactly.
do $$
declare
  import_project uuid:='a2000000-0000-4000-8000-000000000003';
  payload jsonb; result jsonb; n integer; canonical_id uuid;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'a1000000-0000-4000-8000-000000000001','Import Target',0);
  payload:=jsonb_build_object(
    'project_id',import_project::text,
    'source_project_id','phase2-local-project',
    'migration_attempt_id','a3000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object('id','a4000000-0000-4000-8000-000000000001','name','Imported Cottage','description','From local.','metadata',jsonb_build_object('provenance','local'))),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'a3000000-0000-4000-8000-000000000001'::uuid,'phase2-local-project',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'import_local_project_content failed: %', result; end if;

  select location_id into canonical_id from public.project_locations where id='a4000000-0000-4000-8000-000000000001' and project_id=import_project;
  if canonical_id is null then raise exception 'imported location did not create a project_locations row under the payload id'; end if;
  select count(*) into n from public.locations where id=canonical_id and name='Imported Cottage' and base_profile->>'description'='From local.' and owner_id='a1000000-0000-4000-8000-000000000001';
  if n<>1 then raise exception 'imported location did not create the expected canonical row'; end if;
  select count(*) into n from public.project_locations where id='a4000000-0000-4000-8000-000000000001' and metadata->>'provenance'='local';
  if n<>1 then raise exception 'imported location metadata was not preserved on the participation row'; end if;
end $$;

reset role;
rollback;
