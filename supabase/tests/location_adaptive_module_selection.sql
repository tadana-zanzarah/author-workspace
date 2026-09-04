-- Location Adaptive Module Selection -- Phase 1 backend contract
-- (20260904140000_location_adaptive_module_selection.sql). Runs in the standard convention for
-- this directory: applied after the full migration chain, everything wrapped and rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-adaptive-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000002','authenticated','authenticated','loc-adaptive-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Adaptive Project 1',0),
('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','Adaptive Project 2',0),
('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','Adaptive Project B (owner B)',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);

-- ===========================================================================
-- Blocks A/B/C: correct namespaced path, unrelated metadata root key preserved, unrelated
-- metadata.locationProfile sibling preserved. Also seeds a scene binding reused by Block V.
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; canonical_id uuid; scene_result jsonb; scene_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Lighthouse Point');
  pl_id:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid; rev:=(r->>'revision')::bigint;

  -- Seed pre-existing, unrelated metadata state directly (simulating a row that already carries
  -- other bookkeeping this RPC must never touch).
  update public.project_locations set metadata=jsonb_build_object('unrelatedRoot','keepme','locationProfile',jsonb_build_object('futureSibling','keepme2')) where id=pl_id;

  scene_result:=public.create_scene(proj,rev,null,pl_id,'Signal Fire','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'setup create_scene failed: %', scene_result; end if;
  scene_id:=(scene_result->'data'->>'id')::uuid;
  rev:=(scene_result->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('appearanceAtmosphere')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>true then raise exception 'A: module selection write failed: %', r; end if;
  rev:=(r->>'revision')::bigint;

  -- A: correct namespaced path.
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id)<>'["appearanceAtmosphere"]'::jsonb then
    raise exception 'A: module selection not stored at metadata.locationProfile.moduleSelection.shown';
  end if;
  -- Never written at the bare root-level key.
  if (select metadata ? 'moduleSelection' from public.project_locations where id=pl_id) then
    raise exception 'A: module selection incorrectly written at bare metadata.moduleSelection (must be namespaced under locationProfile)';
  end if;

  -- B: unrelated metadata root key preserved.
  if (select metadata->>'unrelatedRoot' from public.project_locations where id=pl_id)<>'keepme' then
    raise exception 'B: unrelated metadata root key was not preserved';
  end if;

  -- C: unrelated metadata.locationProfile sibling preserved.
  if (select metadata->'locationProfile'->>'futureSibling' from public.project_locations where id=pl_id)<>'keepme2' then
    raise exception 'C: unrelated metadata.locationProfile sibling key was not preserved';
  end if;

  -- V (seed half): scene binding must still resolve to the participation id, unaffected by a
  -- module-selection-only mutation.
  if not exists(select 1 from public.scenes where id=scene_id and location_id=pl_id) then
    raise exception 'V: module-selection mutation altered scene.location_id (must always stay the participation id)';
  end if;

  -- J (continued below in this same block, reusing this fixture): clear the selection back to
  -- empty -- locationProfile.futureSibling and metadata.unrelatedRoot must both survive, because
  -- locationProfile is NOT actually empty afterward (it still holds futureSibling), so it must
  -- not itself be removed even though moduleSelection is.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown','[]'::jsonb,'hidden','[]'::jsonb));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>true then raise exception 'J: clearing selection failed: %', r; end if;
  if (select metadata->'locationProfile' ? 'moduleSelection' from public.project_locations where id=pl_id) then
    raise exception 'J: moduleSelection key still present after clearing to empty';
  end if;
  if (select metadata->'locationProfile'->>'futureSibling' from public.project_locations where id=pl_id)<>'keepme2' then
    raise exception 'J: unrelated locationProfile sibling was removed even though locationProfile was not actually empty';
  end if;
  if (select metadata->>'unrelatedRoot' from public.project_locations where id=pl_id)<>'keepme' then
    raise exception 'J: unrelated metadata root key was removed by empty-selection cleanup';
  end if;
end $$;

-- ===========================================================================
-- Block I: empty selection removes moduleSelection entirely, AND removes locationProfile too when
-- it has no other sibling key left (contrast with Block J above, where a sibling survives).
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Empty Selection Cottage');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('hidden',jsonb_build_array('geography')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'I: setup selection write failed: %', r; end if;
  rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object());
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>true then raise exception 'I: empty-selection clear failed: %', r; end if;
  if (select metadata ? 'locationProfile' from public.project_locations where id=pl_id) then
    raise exception 'I: locationProfile key survived even though it held nothing but the now-cleared moduleSelection';
  end if;
end $$;

-- ===========================================================================
-- Blocks D/E: shown/hidden normalization -- dedupe + canonical allowlist order, not insertion
-- order, and the no-op comparison (Block K) must key off the NORMALIZED value.
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; rev_after_first bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Dedupe Hollow');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  -- D: shown sent reverse-order with a duplicate -> stored canonically ordered and deduped.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('geography','appearanceAtmosphere','geography')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'D: normalization write failed: %', r; end if;
  rev:=(r->>'revision')::bigint; rev_after_first:=rev;
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id)<>jsonb_build_array('appearanceAtmosphere','geography') then
    raise exception 'D: shown was not deduped/canonically ordered: %', (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id);
  end if;

  -- K (part 1): resubmitting semantically-identical-but-differently-ordered/duplicated input is a
  -- true no-op -- changed:false, revision NOT bumped.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('appearanceAtmosphere','geography','appearanceAtmosphere')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'K: differently-ordered/duplicated but semantically-identical resubmit was not detected as a no-op: %', r; end if;
  if (r->>'revision')::bigint<>rev_after_first then raise exception 'K: no-op resubmit incorrectly bumped project revision'; end if;

  -- E: hidden sent with a duplicate on its own (shown cleared this time, no overlap).
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('hidden',jsonb_build_array('appearanceAtmosphere','appearanceAtmosphere')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'E: hidden normalization write failed: %', r; end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id=pl_id)<>jsonb_build_array('appearanceAtmosphere') then
    raise exception 'E: hidden was not deduped: %', (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id=pl_id);
  end if;
  -- shown must have been cleared by this call (it was omitted from the payload, meaning "empty",
  -- not "untouched" -- this RPC always sends the FULL new value, never a partial patch).
  if (select metadata->'locationProfile'->'moduleSelection' ? 'shown' from public.project_locations where id=pl_id) then
    raise exception 'E: shown key survived even though the new selection omitted it (whole-value replace expected)';
  end if;
end $$;

-- ===========================================================================
-- Block L: a real change bumps project revision exactly once (companion to K above, using a
-- fresh location so the "exactly once" delta is unambiguous).
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; rev_before bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Revision Counting Yard');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint; rev_before:=rev;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('geography')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>true then raise exception 'L: real change did not report changed:true: %', r; end if;
  if (r->>'revision')::bigint<>rev_before+1 then raise exception 'L: real change did not bump project revision by exactly 1: before=%, after=%', rev_before, (r->>'revision')::bigint; end if;
end $$;

-- ===========================================================================
-- Block F: live shown/hidden overlap is rejected -- never silently resolved (contrast Block S,
-- which is the untrusted-import path where overlap resolves hidden-wins instead of rejecting).
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Overlap Ridge');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('geography'),'hidden',jsonb_build_array('geography')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'F: live shown/hidden overlap was not rejected: %', r; end if;
  if (select metadata ? 'locationProfile' from public.project_locations where id=pl_id) then raise exception 'F: rejected overlap call still wrote metadata'; end if;
end $$;

-- ===========================================================================
-- Block G: unknown module key (not on the allowlist) is rejected. Uses 'populationCulture' --
-- NOT 'economy', which B3B (20260905090000_location_government_economy_modules.sql) allowlisted
-- after this test was originally written; a still-unallowlisted key is what this block actually
-- needs to prove the point, not that specific key.
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Forbidden Wing');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('populationCulture')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'G: unknown module key was not rejected: %', r; end if;
  if (select metadata ? 'locationProfile' from public.project_locations where id=pl_id) then raise exception 'G: rejected unknown-key call still wrote metadata'; end if;
end $$;

-- ===========================================================================
-- Block H: malformed selection shapes are rejected -- non-object top level, non-array shown/
-- hidden, non-string entries, unknown top-level key.
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Malformed Manor');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,'"not-an-object"'::jsonb);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'H1: non-object module_selection was not rejected: %', r; end if;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown','not-an-array'));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'H2: non-array shown was not rejected: %', r; end if;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array(123)));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'H3: non-string shown entry was not rejected: %', r; end if;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('extraKey','x'));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'H4: unknown top-level key was not rejected: %', r; end if;

  if (select metadata ? 'locationProfile' from public.project_locations where id=pl_id) then raise exception 'H: a rejected malformed call still wrote metadata'; end if;
end $$;

-- ===========================================================================
-- Block M: stale project revision -- existing REVISION_CONFLICT shape, unchanged.
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Stale Revision Keep');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev-1,jsonb_build_object('shown',jsonb_build_array('geography')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'REVISION_CONFLICT' then raise exception 'M: stale project revision was not rejected with REVISION_CONFLICT: %', r; end if;
  if (r->>'expectedRevision')::bigint<>rev-1 or (r->>'actualRevision')::bigint<>rev then raise exception 'M: REVISION_CONFLICT payload shape changed: %', r; end if;
end $$;

-- ===========================================================================
-- Block N: cross-project/foreign participation rejected -- both the same-owner project/
-- participation mismatch, and a genuine cross-owner attempt (RLS-level isolation).
-- ===========================================================================
do $$
declare
  proj1 uuid:='f2000000-0000-4000-8000-000000000001';
  proj2 uuid:='f2000000-0000-4000-8000-000000000002';
  rev1 bigint; rev2 bigint; r jsonb; pl_in_proj2 uuid;
begin
  select revision into rev2 from public.projects where id=proj2;
  r:=public.create_location_canonical(proj2,rev2,'Neighbor Project Room');
  pl_in_proj2:=(r->'data'->>'id')::uuid;

  select revision into rev1 from public.projects where id=proj1;
  -- target_project_id says proj1, but target_location_id is a participation that actually belongs
  -- to proj2 -- must NOT resolve (same-owner mismatch).
  r:=public.update_project_location_module_selection(proj1,pl_in_proj2,rev1,jsonb_build_object('shown',jsonb_build_array('geography')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'N1: mismatched project/participation pair was not rejected: %', r; end if;
end $$;

do $$
declare
  proj_b uuid:='f2000000-0000-4000-8000-000000000003';
  rev_b bigint; r jsonb; pl_b uuid;
begin
  -- Switch to owner B to create a fixture in their own project.
  perform set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
  select revision into rev_b from public.projects where id=proj_b;
  r:=public.create_location_canonical(proj_b,rev_b,'Owner B Study');
  pl_b:=(r->'data'->>'id')::uuid; rev_b:=(r->>'revision')::bigint;

  -- Switch back to owner A and attempt to mutate owner B's project participation.
  perform set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
  r:=public.update_project_location_module_selection(proj_b,pl_b,rev_b,jsonb_build_object('shown',jsonb_build_array('geography')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'N2: cross-owner attempt was not rejected (RLS/ownership isolation broken): %', r; end if;
end $$;

-- ===========================================================================
-- Block O: a removed (soft-deleted) participation is rejected the same way an absent one is.
-- ===========================================================================
do $$
declare
  proj uuid:='f2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Soon Removed Shed');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  update public.project_locations set removed_at=now() where id=pl_id;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('geography')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'O: removed participation was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block P: list_owned_locations().participation_count -- current participation counted, multiple
-- active participations counted, removed participation excluded.
-- ===========================================================================
do $$
declare
  proj1 uuid:='f2000000-0000-4000-8000-000000000001';
  proj2 uuid:='f2000000-0000-4000-8000-000000000002';
  rev1 bigint; rev2 bigint; r jsonb; canonical_id uuid; pl1 uuid; pl2 uuid; rows jsonb; count_now integer;
begin
  select revision into rev1 from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev1,'Shared Plaza');
  pl1:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid;

  rows:=(public.list_owned_locations())->'data';
  select (x->>'participation_count')::int into count_now from jsonb_array_elements(rows) x where (x->>'id')=canonical_id::text;
  if count_now<>1 then raise exception 'P1: fresh location with one participation should count 1, got %', count_now; end if;

  select revision into rev2 from public.projects where id=proj2;
  r:=public.attach_project_location(proj2,canonical_id,rev2);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'P: attach_project_location setup failed: %', r; end if;
  pl2:=(r->'data'->>'id')::uuid;

  rows:=(public.list_owned_locations())->'data';
  select (x->>'participation_count')::int into count_now from jsonb_array_elements(rows) x where (x->>'id')=canonical_id::text;
  if count_now<>2 then raise exception 'P2: location attached to two projects should count 2, got %', count_now; end if;

  update public.project_locations set removed_at=now() where id=pl2;

  rows:=(public.list_owned_locations())->'data';
  select (x->>'participation_count')::int into count_now from jsonb_array_elements(rows) x where (x->>'id')=canonical_id::text;
  if count_now<>1 then raise exception 'P3: removed participation must not count -- expected 1, got %', count_now; end if;
end $$;

-- ===========================================================================
-- Blocks Q/R/S/T: local->cloud import of module_selection -- backward compatibility, valid
-- sanitized import, untrusted overlap resolves hidden-wins, malformed/unknown entries degrade
-- safely. Each case gets its own fresh project (import_local_project_content requires an empty
-- target project).
-- ===========================================================================
do $$
declare
  import_project_q uuid:='f2000000-0000-4000-8000-000000000004';
  import_project_r uuid:='f2000000-0000-4000-8000-000000000005';
  import_project_s uuid:='f2000000-0000-4000-8000-000000000006';
  import_project_t uuid:='f2000000-0000-4000-8000-000000000007';
  import_project_u uuid:='f2000000-0000-4000-8000-000000000008';
  payload jsonb; result jsonb; canonical_id uuid; pl_id uuid; scene_result jsonb;
begin
  insert into public.projects(id,owner_id,title,revision) values
    (import_project_q,'f1000000-0000-4000-8000-000000000001','Import Q',0),
    (import_project_r,'f1000000-0000-4000-8000-000000000001','Import R',0),
    (import_project_s,'f1000000-0000-4000-8000-000000000001','Import S',0),
    (import_project_t,'f1000000-0000-4000-8000-000000000001','Import T',0),
    (import_project_u,'f1000000-0000-4000-8000-000000000001','Import U',0);

  -- Q: old snapshot -- no module_selection field at all on the location item. Must import
  -- cleanly with no locationProfile/moduleSelection key at all.
  payload:=jsonb_build_object(
    'project_id',import_project_q::text,'source_project_id','adaptive-old-snapshot','migration_attempt_id','f3000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object('id','f4000000-0000-4000-8000-000000000001','name','Legacy Barn','description','No selection metadata at all.')),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project_q,0,'f3000000-0000-4000-8000-000000000001'::uuid,'adaptive-old-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'Q: old-snapshot import (no module_selection) failed: %', result; end if;
  if (select metadata ? 'locationProfile' from public.project_locations where id='f4000000-0000-4000-8000-000000000001') then
    raise exception 'Q: import fabricated a locationProfile key for a snapshot that never had module_selection';
  end if;

  -- R: valid, non-overlapping module_selection -- must survive sanitized and normalized.
  payload:=jsonb_build_object(
    'project_id',import_project_r::text,'source_project_id','adaptive-valid-snapshot','migration_attempt_id','f3000000-0000-4000-8000-000000000002',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','f4000000-0000-4000-8000-000000000002','name','Valid Selection House','description','',
      'module_selection',jsonb_build_object('shown',jsonb_build_array('appearanceAtmosphere'),'hidden',jsonb_build_array('geography'))
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project_r,0,'f3000000-0000-4000-8000-000000000002'::uuid,'adaptive-valid-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'R: valid module_selection import failed: %', result; end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id='f4000000-0000-4000-8000-000000000002')<>jsonb_build_array('appearanceAtmosphere') then
    raise exception 'R: shown did not survive import correctly';
  end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id='f4000000-0000-4000-8000-000000000002')<>jsonb_build_array('geography') then
    raise exception 'R: hidden did not survive import correctly';
  end if;

  -- S: untrusted shown/hidden overlap -- hidden wins (contrast live-call Block F, which rejects
  -- the same shape outright).
  payload:=jsonb_build_object(
    'project_id',import_project_s::text,'source_project_id','adaptive-overlap-snapshot','migration_attempt_id','f3000000-0000-4000-8000-000000000003',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','f4000000-0000-4000-8000-000000000003','name','Overlap Snapshot Nook','description','',
      'module_selection',jsonb_build_object('shown',jsonb_build_array('geography'),'hidden',jsonb_build_array('geography'))
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project_s,0,'f3000000-0000-4000-8000-000000000003'::uuid,'adaptive-overlap-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'S: overlap-snapshot import unexpectedly failed instead of sanitizing: %', result; end if;
  if (select metadata->'locationProfile'->'moduleSelection' ? 'shown' from public.project_locations where id='f4000000-0000-4000-8000-000000000003') then
    raise exception 'S: shown survived an untrusted overlap -- hidden must win, shown key must be absent';
  end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id='f4000000-0000-4000-8000-000000000003')<>jsonb_build_array('geography') then
    raise exception 'S: hidden did not survive the overlap resolution';
  end if;

  -- T: malformed/unknown entries -- non-array hidden, unknown module key, non-string entry,
  -- unexpected top-level key -- degrade safely rather than crash the import or leak invalid data.
  -- Uses 'populationCulture' as the unknown key (NOT 'economy', which B3B allowlisted after this
  -- test was originally written -- see Block G's comment above for the same reasoning).
  payload:=jsonb_build_object(
    'project_id',import_project_t::text,'source_project_id','adaptive-malformed-snapshot','migration_attempt_id','f3000000-0000-4000-8000-000000000004',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(
      jsonb_build_object(
        'id','f4000000-0000-4000-8000-000000000004','name','Malformed Snapshot Loft','description','',
        'module_selection',jsonb_build_object('shown',jsonb_build_array('populationCulture','appearanceAtmosphere',42),'hidden','not-an-array','extra','key')
      ),
      jsonb_build_object(
        'id','f4000000-0000-4000-8000-000000000005','name','Wrong Type Snapshot Cellar','description','',
        'module_selection','"not-an-object"'::jsonb
      )
    ),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project_t,0,'f3000000-0000-4000-8000-000000000004'::uuid,'adaptive-malformed-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'T: malformed-selection import unexpectedly failed instead of sanitizing: %', result; end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id='f4000000-0000-4000-8000-000000000004')<>jsonb_build_array('appearanceAtmosphere') then
    raise exception 'T: valid entry was not preserved alongside the invalid ones being dropped: %', (select metadata->'locationProfile'->'moduleSelection' from public.project_locations where id='f4000000-0000-4000-8000-000000000004');
  end if;
  if (select metadata->'locationProfile'->'moduleSelection' ? 'hidden' from public.project_locations where id='f4000000-0000-4000-8000-000000000004') then
    raise exception 'T: non-array hidden should have been treated as absent, not partially trusted';
  end if;
  if (select metadata ? 'locationProfile' from public.project_locations where id='f4000000-0000-4000-8000-000000000005') then
    raise exception 'T: a wholly non-object module_selection should leave no locationProfile key at all';
  end if;

  -- U: existing B3A base_profile import behavior unaffected by the new module_selection handling
  -- -- description/shortSummary/appearanceAtmosphere/geography all still survive together with a
  -- module_selection on the SAME location item.
  payload:=jsonb_build_object(
    'project_id',import_project_u::text,'source_project_id','adaptive-full-snapshot','migration_attempt_id','f3000000-0000-4000-8000-000000000005',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','f4000000-0000-4000-8000-000000000006','name','Full Snapshot Tower','description','Below the clouds.','short_summary','Watches the valley.',
      'base_profile',jsonb_build_object('appearanceAtmosphere',jsonb_build_object('visualDescription','Weathered stone'),'geography',jsonb_build_object('terrain','Highlands')),
      'module_selection',jsonb_build_object('shown',jsonb_build_array('appearanceAtmosphere'))
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project_u,0,'f3000000-0000-4000-8000-000000000005'::uuid,'adaptive-full-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'U: full B3A+selection snapshot import failed: %', result; end if;
  select location_id, id into canonical_id, pl_id from public.project_locations where id='f4000000-0000-4000-8000-000000000006';
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Below the clouds.' then raise exception 'U: description did not survive'; end if;
  if (select base_profile->>'shortSummary' from public.locations where id=canonical_id)<>'Watches the valley.' then raise exception 'U: shortSummary did not survive'; end if;
  if (select base_profile->'appearanceAtmosphere'->>'visualDescription' from public.locations where id=canonical_id)<>'Weathered stone' then raise exception 'U: appearanceAtmosphere did not survive'; end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Highlands' then raise exception 'U: geography did not survive'; end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id)<>jsonb_build_array('appearanceAtmosphere') then raise exception 'U: module_selection did not survive alongside base_profile data'; end if;

  -- V (continued): an imported location's scene binding stays participation-id based.
  scene_result:=public.create_scene(import_project_u,(select revision from public.projects where id=import_project_u),null,pl_id,'Watch','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'V: create_scene against an imported location failed: %', scene_result; end if;
  if not exists(select 1 from public.scenes where id=(scene_result->'data'->>'id')::uuid and location_id=pl_id) then
    raise exception 'V: imported-location scene binding did not stay on the participation id';
  end if;
end $$;

reset role;
rollback;
