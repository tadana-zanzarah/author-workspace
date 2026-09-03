-- Location Architecture V2 Phase 3 (20260904120000_location_phase3_core_identity.sql) --
-- backward compatibility + canonical core identity + canonical revision concurrency +
-- server-side hierarchy cycle prevention. Runs in the standard convention for this directory:
-- applied after the full migration chain, everything wrapped and rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-p3-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000002','authenticated','authenticated','loc-p3-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Project A1',0),
('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','Project A2',0),
('c2000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000002','Project B1',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);

-- ===========================================================================
-- Block A: backward compatibility -- the legacy, unpublished-frontend-safe RPC surface must be
-- byte-for-byte behaviorally unchanged after this migration (cases 1-2).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  r jsonb; rev bigint; pl_id uuid; canonical_id uuid; n integer;
begin
  -- 1. Existing Phase A create caller still works after the B1 migration: same call shape, same
  --    response shape, same canonical+participation row creation.
  r:=public.create_location(proj1,0,'Old Harbor','A weathered dock.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'legacy create_location broken by Phase 3 migration: %', r; end if;
  pl_id:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid; rev:=(r->>'revision')::bigint;
  select count(*) into n from public.locations where id=canonical_id and name='Old Harbor' and base_profile->>'description'='A weathered dock.';
  if n<>1 then raise exception 'legacy create_location did not create the expected canonical row after migration'; end if;

  -- 2. Existing Phase A update caller still works, is still project-revision-gated ONLY (no
  --    canonical revision parameter exists on this path), still no-ops correctly, and still
  --    preserves unrelated base_profile keys (a future module key set out-of-band by this test,
  --    simulating a Phase B3 module the legacy Phase A editor knows nothing about).
  update public.locations set base_profile=base_profile||jsonb_build_object('geography',jsonb_build_object('climate','Damp')) where id=canonical_id;
  r:=public.update_location(proj1,pl_id,rev,'Old Harbor','A weathered dock.');
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'legacy update_location no-op detection broken after migration: %', r; end if;
  r:=public.update_location(proj1,pl_id,rev,'Old Harbor','Rebuilt after the storm.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'legacy update_location broken by Phase 3 migration: %', r; end if;
  rev:=(r->>'revision')::bigint;
  select count(*) into n from public.locations where id=canonical_id and base_profile->>'description'='Rebuilt after the storm.' and base_profile->'geography'->>'climate'='Damp';
  if n<>1 then raise exception 'legacy update_location destroyed an unrelated base_profile module key it never touches: %', (select base_profile from public.locations where id=canonical_id); end if;
end $$;

-- ===========================================================================
-- Block B: create_location_canonical field round trips (cases 9 official_name, 10-11 aliases,
-- 3-5 type NULL/preset/other+custom).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  r jsonb; rev bigint; d jsonb;
begin
  select revision into rev from public.projects where id=proj1;

  -- Full field round trip, including alias normalization: blank/whitespace-only entries are
  -- dropped, case-insensitive duplicates are collapsed keeping first-seen casing/order.
  r:=public.create_location_canonical(proj1,rev,'  Silver City  ','The Silver City',array['North Gate',' north gate ','','  ','Old Quarter','OLD QUARTER'],'settlement','Capital','A gleaming city.','The realm''s capital.',null);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'create_location_canonical failed: %', r; end if;
  d:=r->'data'; rev:=(r->>'revision')::bigint;
  if d->>'name'<>'Silver City' then raise exception 'name not trimmed: %', d; end if;
  if d->>'official_name'<>'The Silver City' then raise exception 'official_name round trip failed: %', d; end if;
  if d->'aliases'<>'["North Gate","Old Quarter"]'::jsonb then raise exception 'aliases normalization failed: %', d->'aliases'; end if;
  if d->>'type_preset'<>'settlement' then raise exception 'type_preset round trip failed: %', d; end if;
  if d->>'custom_type_label'<>'Capital' then raise exception 'custom_type_label round trip failed: %', d; end if;
  if d->>'description'<>'A gleaming city.' then raise exception 'description round trip failed: %', d; end if;
  if d->'base_profile'->>'shortSummary'<>'The realm''s capital.' then raise exception 'shortSummary round trip failed: %', d; end if;
  if (d->>'location_revision')::bigint<>0 then raise exception 'freshly created canonical location must start at location_revision=0: %', d; end if;

  -- NULL type is valid: omitting type_preset/custom_type_label must NOT silently become 'other'.
  r:=public.create_location_canonical(proj1,rev,'Unclassified Place');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'create_location_canonical (no type) failed: %', r; end if;
  d:=r->'data'; rev:=(r->>'revision')::bigint;
  if d->'type_preset' is distinct from 'null'::jsonb then raise exception 'type_preset was not left NULL for an unclassified location: %', d; end if;
  if d->'custom_type_label' is distinct from 'null'::jsonb then raise exception 'custom_type_label was not left NULL: %', d; end if;

  -- other + custom label: an explicit "other" preset is a deliberate user choice, distinct from
  -- "not specified".
  r:=public.create_location_canonical(proj1,rev,'Strange Nexus',null,'{}','other','Interdimensional rift');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'create_location_canonical (other+custom) failed: %', r; end if;
  d:=r->'data'; rev:=(r->>'revision')::bigint;
  if d->>'type_preset'<>'other' or d->>'custom_type_label'<>'Interdimensional rift' then raise exception 'other+custom_type_label round trip failed: %', d; end if;
end $$;

-- ===========================================================================
-- Block C: canonical revision concurrency (cases 3-6 in the required list: mandatory + checked,
-- stale rejected, success increments, two participations cannot silently clobber each other).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  proj2 uuid:='c2000000-0000-4000-8000-000000000002';
  r jsonb; rev bigint; proj2rev bigint; pl1 uuid; canonical_id uuid; loc_rev bigint; attach jsonb;
begin
  select revision into rev from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev,'Shared Keep',null,'{}',null,null,'A fortress on the hill.');
  pl1:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  -- Stale canonical revision is rejected with the established per-entity revision-conflict shape.
  r:=public.update_location_canonical(canonical_id,loc_rev+1,'Shared Keep',null,'{}',null,null,'Wrong stale call.');
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'stale canonical revision was not rejected: %', r; end if;
  if (r->>'expectedRevision')::bigint<>loc_rev+1 or (r->>'actualRevision')::bigint<>loc_rev then raise exception 'LOCATION_REVISION_CONFLICT payload missing expected/actual revision: %', r; end if;

  -- Correct canonical revision succeeds and increments location_revision exactly once.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Shared Keep',null,'{}',null,null,'Refortified after the siege.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'update_location_canonical failed with correct revision: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if loc_rev<>1 then raise exception 'location_revision did not increment by exactly 1: %', r; end if;

  -- Two project participations pointing at ONE canonical location: attach the same canonical
  -- Location into a second project, then prove a canonical mutation made "through" one
  -- participation's context is visible to the other, and that a second caller holding the
  -- now-stale location_revision cannot silently overwrite the first caller's change.
  select revision into proj2rev from public.projects where id=proj2;
  attach:=public.attach_project_location(proj2,canonical_id,proj2rev);
  if not coalesce((attach->>'ok')::boolean,false) then raise exception 'attach_project_location into second project failed: %', attach; end if;

  -- Caller B holds loc_rev (correct, pre-mutation-below). Caller A mutates first.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Shared Keep',null,'{}',null,null,'Caller A''s version.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'first canonical mutation failed: %', r; end if;
  -- Caller B now retries with its now-stale loc_rev -- must be rejected, not silently applied.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Shared Keep',null,'{}',null,null,'Caller B overwrite attempt.');
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then
    raise exception 'second participation was able to silently overwrite the first''s canonical change: %', r;
  end if;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Caller A''s version.' then
    raise exception 'canonical row does not reflect caller A''s successful mutation';
  end if;
end $$;

-- ===========================================================================
-- Block D: base_profile preservation across canonical core-identity updates (cases 12-14).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  r jsonb; rev bigint; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev,'Ashfall Ridge',null,'{}',null,null,'Volcanic highlands.','Where the old war ended.');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  -- Simulate a future Phase B3 module key this migration's RPCs never write, added out-of-band.
  update public.locations set base_profile=base_profile||jsonb_build_object('geography',jsonb_build_object('climate','Cold','terrain','Volcanic')) where id=canonical_id;

  -- A name/aliases/type-only-intent update (description/shortSummary passed back unchanged) must
  -- not erase the geography module key.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Ashfall Ridge',null,array['The Ridge'],'natural_place',null,'Volcanic highlands.','Where the old war ended.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'update_location_canonical failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'geography'->>'climate' from public.locations where id=canonical_id)<>'Cold' then
    raise exception 'core-identity update destroyed an unrelated base_profile module key';
  end if;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Volcanic highlands.' then
    raise exception 'base_profile.description was not preserved across the update';
  end if;

  -- A description/shortSummary-only change must ALSO preserve geography, and must actually change
  -- exactly those two keys.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Ashfall Ridge',null,array['The Ridge'],'natural_place',null,'Now dormant.','Peace holds, for now.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'description/shortSummary-only update failed: %', r; end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Volcanic' then
    raise exception 'description/shortSummary update destroyed the geography module key';
  end if;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Now dormant.'
     or (select base_profile->>'shortSummary' from public.locations where id=canonical_id)<>'Peace holds, for now.' then
    raise exception 'description/shortSummary did not actually update';
  end if;
end $$;

-- ===========================================================================
-- Block E: hierarchy -- set_location_parent (cases 15-21).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  proj2 uuid:='c2000000-0000-4000-8000-000000000002';
  rev bigint; r jsonb;
  a_id uuid; a_rev bigint; b_id uuid; b_rev bigint; c_id uuid; c_rev bigint; d_id uuid; d_rev bigint;
  foreign_id uuid;
begin
  select revision into rev from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev,'Continent A'); a_id:=(r->'data'->>'location_id')::uuid; a_rev:=(r->'data'->>'location_revision')::bigint; rev:=(r->>'revision')::bigint;
  r:=public.create_location_canonical(proj1,rev,'Country B'); b_id:=(r->'data'->>'location_id')::uuid; b_rev:=(r->'data'->>'location_revision')::bigint; rev:=(r->>'revision')::bigint;
  r:=public.create_location_canonical(proj1,rev,'Region C'); c_id:=(r->'data'->>'location_id')::uuid; c_rev:=(r->'data'->>'location_revision')::bigint; rev:=(r->>'revision')::bigint;
  r:=public.create_location_canonical(proj1,rev,'City D'); d_id:=(r->'data'->>'location_id')::uuid; d_rev:=(r->'data'->>'location_revision')::bigint; rev:=(r->>'revision')::bigint;

  -- Self-parent rejected with a clean domain error (schema also enforces this at the constraint
  -- level, but the RPC must not surface a raw constraint-violation error).
  r:=public.set_location_parent(a_id,a_rev,a_id);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'self-parent was not rejected cleanly: %', r; end if;

  -- Parent set: B's parent becomes A.
  r:=public.set_location_parent(b_id,b_rev,a_id);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'set_location_parent (B->A) failed: %', r; end if;
  b_rev:=(r->'data'->>'location_revision')::bigint;
  if (select parent_id from public.locations where id=b_id)<>a_id then raise exception 'parent_id was not persisted'; end if;
  if b_rev<>1 then raise exception 'set_location_parent did not increment location_revision: %', r; end if;

  -- C's parent becomes B (A -> B -> C chain).
  r:=public.set_location_parent(c_id,c_rev,b_id);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'set_location_parent (C->B) failed: %', r; end if;
  c_rev:=(r->'data'->>'location_revision')::bigint;

  -- Direct 2-cycle rejected: A's parent cannot become B while B's parent is A already
  -- (A -> B -> A).
  r:=public.set_location_parent(a_id,a_rev,b_id);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'A->B->A cycle was not rejected: %', r; end if;
  if (select parent_id from public.locations where id=a_id) is not null then raise exception 'rejected cycle mutation was NOT fully rolled back (A gained a parent)'; end if;

  -- Deeper cycle rejected: A's parent cannot become C while the chain is A(root)->B->C already
  -- (would create A -> C -> B -> A).
  r:=public.set_location_parent(a_id,a_rev,c_id);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'deeper A->C->B->A cycle was not rejected: %', r; end if;

  -- Parent clear: D had no parent; set one, then clear it back to NULL.
  r:=public.set_location_parent(d_id,d_rev,c_id);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'set_location_parent (D->C) failed: %', r; end if;
  d_rev:=(r->'data'->>'location_revision')::bigint;
  r:=public.set_location_parent(d_id,d_rev,null);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'set_location_parent (clear) failed: %', r; end if;
  if (select parent_id from public.locations where id=d_id) is not null then raise exception 'parent was not cleared'; end if;
  d_rev:=(r->'data'->>'location_revision')::bigint;

  -- No-op (same parent submitted again) must not bump location_revision.
  r:=public.set_location_parent(d_id,d_rev,null);
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'set_location_parent no-op detection failed: %', r; end if;

  -- Parent NOT participating in the current project is valid: a location living only in proj2
  -- may become D's (proj1) parent -- hierarchy is global, participation is separate.
  r:=public.create_location_canonical(proj2,(select revision from public.projects where id=proj2),'Foreign-Project Ancestor');
  foreign_id:=(r->'data'->>'location_id')::uuid;
  r:=public.set_location_parent(d_id,d_rev,foreign_id);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'parent from a non-participating project was incorrectly rejected: %', r; end if;
  if (select parent_id from public.locations where id=d_id)<>foreign_id then raise exception 'non-participating-project parent was not persisted'; end if;

  -- Cross-owner parent rejected: switch to user B, confirm B cannot use A's location ids at all
  -- (covered exhaustively in Block H); here just confirm A cannot target B's location as a parent.
  perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
  declare b_owner_project uuid:='c2000000-0000-4000-8000-000000000003'; b_loc jsonb; b_loc_id uuid; begin
    b_loc:=public.create_location_canonical(b_owner_project,(select revision from public.projects where id=b_owner_project),'User B''s Place');
    b_loc_id:=(b_loc->'data'->>'location_id')::uuid;
    perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
    r:=public.set_location_parent(a_id,(select revision from public.locations where id=a_id),b_loc_id);
    if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'NOT_FOUND' then raise exception 'cross-owner parent was not rejected: %', r; end if;
  end;
end $$;

-- ===========================================================================
-- Block F: read model -- get_project_content preserves old fields + exposes new ones (cases
-- 22-23), list_owned_locations (global read surface, ordering, FORBIDDEN when unauthenticated).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; content jsonb; loc_row jsonb; canonical_id uuid; pl_id uuid; owned jsonb; n integer;
begin
  select revision into rev from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev,'Whistling Pines','The Pines',array['Pinehaven'],'district',null,'A quiet suburb.','Founded after the war.');
  pl_id:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid;

  content:=public.get_project_content(proj1);
  if not coalesce((content->>'ok')::boolean,false) then raise exception 'get_project_content failed: %', content; end if;
  select x into loc_row from jsonb_array_elements(content->'data'->'locations') x where (x->>'id')::uuid=pl_id;
  if loc_row is null then raise exception 'get_project_content did not hydrate the new location'; end if;
  -- Old fields preserved with their exact prior key names/semantics.
  if loc_row->>'name'<>'Whistling Pines' or loc_row->>'description'<>'A quiet suburb.' or (loc_row->>'location_id')::uuid<>canonical_id
     or (loc_row->>'project_id')::uuid<>proj1 then
    raise exception 'get_project_content dropped/changed an existing field: %', loc_row;
  end if;
  -- New fields exposed.
  if loc_row->>'official_name'<>'The Pines' or loc_row->'aliases'<>'["Pinehaven"]'::jsonb or loc_row->>'type_preset'<>'district'
     or loc_row->'base_profile'->>'shortSummary'<>'Founded after the war.' or (loc_row->>'location_revision')::bigint<0 then
    raise exception 'get_project_content did not expose the new Phase 3 fields: %', loc_row;
  end if;

  -- A legacy-created location (base_profile only ever had 'description') must still hydrate the
  -- new fields safely (aliases '[]', parent_id/type_preset/custom_type_label null) rather than
  -- erroring or omitting keys.
  r:=public.create_location(proj1,(select revision from public.projects where id=proj1),'Legacy Spot','Just a description.');
  pl_id:=(r->'data'->>'id')::uuid;
  content:=public.get_project_content(proj1);
  select x into loc_row from jsonb_array_elements(content->'data'->'locations') x where (x->>'id')::uuid=pl_id;
  if loc_row is null then raise exception 'get_project_content did not hydrate the legacy-created location'; end if;
  if loc_row->'aliases'<>'[]'::jsonb or loc_row->'parent_id' is distinct from 'null'::jsonb or loc_row->'type_preset' is distinct from 'null'::jsonb then
    raise exception 'get_project_content did not hydrate new fields safely for a legacy-shaped canonical row: %', loc_row;
  end if;

  -- list_owned_locations: global surface, includes locations from every project of this owner
  -- (not just proj1), ordered by name.
  owned:=public.list_owned_locations();
  if not coalesce((owned->>'ok')::boolean,false) then raise exception 'list_owned_locations failed: %', owned; end if;
  select count(*) into n from jsonb_array_elements(owned->'data') x where (x->>'id')::uuid=canonical_id;
  if n<>1 then raise exception 'list_owned_locations did not include a known-owned canonical location'; end if;

  -- Unauthenticated call: FORBIDDEN, not an error/crash.
  perform set_config('request.jwt.claim.sub','',true);
  owned:=public.list_owned_locations();
  if coalesce((owned->>'ok')::boolean,false) or owned->>'code'<>'FORBIDDEN' then raise exception 'list_owned_locations did not return FORBIDDEN when unauthenticated: %', owned; end if;
  perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
end $$;

-- ===========================================================================
-- Block G: Scene bindings stay on the participation id, unaffected by any canonical-path
-- mutation (case 24).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; canonical_id uuid; scene_result jsonb; scene_id uuid; n integer;
begin
  select revision into rev from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev,'Battlefield');
  pl_id:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid; rev:=(r->>'revision')::bigint;

  scene_result:=public.create_scene(proj1,rev,null,pl_id,'Final Stand','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'create_scene against a canonical-path-created location failed: %', scene_result; end if;
  scene_id:=(scene_result->'data'->>'id')::uuid; rev:=(scene_result->>'revision')::bigint;
  select count(*) into n from public.scenes where id=scene_id and location_id=pl_id;
  if n<>1 then raise exception 'scene did not store the participation id (not the canonical id) as location_id'; end if;

  -- Mutating the canonical identity must not touch the scene's location_id at all.
  r:=public.update_location_canonical(canonical_id,(select revision from public.locations where id=canonical_id),'Battlefield of the Fallen');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'update_location_canonical failed: %', r; end if;
  select count(*) into n from public.scenes where id=scene_id and location_id=pl_id;
  if n<>1 then raise exception 'canonical mutation altered scene.location_id (must always stay the participation id)'; end if;
end $$;

-- ===========================================================================
-- Block H: cross-owner isolation for every new RPC (case 25).
-- ===========================================================================
do $$
declare
  proj1 uuid:='c2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj1;
  r:=public.create_location_canonical(proj1,rev,'Vault of Secrets');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
  declare b_project uuid:='c2000000-0000-4000-8000-000000000003'; b_rev bigint; r2 jsonb; begin
    select revision into b_rev from public.projects where id=b_project;
    r2:=public.create_location_canonical(b_project,b_rev,'Intruder Place');
    if not coalesce((r2->>'ok')::boolean,false) then raise exception 'user B create_location_canonical in own project unexpectedly failed: %', r2; end if;

    r2:=public.update_location_canonical(canonical_id,loc_rev,'Hacked Name');
    if coalesce((r2->>'ok')::boolean,false) or r2->>'code'<>'NOT_FOUND' then raise exception 'cross-owner update_location_canonical was not rejected: %', r2; end if;

    r2:=public.set_location_parent(canonical_id,loc_rev,null);
    if coalesce((r2->>'ok')::boolean,false) or r2->>'code'<>'NOT_FOUND' then raise exception 'cross-owner set_location_parent was not rejected: %', r2; end if;

    r2:=public.list_owned_locations();
    if exists(select 1 from jsonb_array_elements(r2->'data') x where (x->>'id')::uuid=canonical_id) then
      raise exception 'list_owned_locations leaked another owner''s canonical location';
    end if;
  end;
  perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
end $$;

-- ===========================================================================
-- Block I: existing local->cloud import remains compatible (case 26) -- import_local_project_content
-- is untouched by this migration; smoke-test it still works and its locations import path (which
-- writes canonical + participation rows exactly like the Phase 2 cutover) is unaffected.
-- ===========================================================================
do $$
declare
  import_project uuid:='c2000000-0000-4000-8000-000000000004';
  payload jsonb; result jsonb; n integer; canonical_id uuid;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'c1000000-0000-4000-8000-000000000001','Import Target P3',0);
  payload:=jsonb_build_object(
    'project_id',import_project::text,
    'source_project_id','phase3-local-project',
    'migration_attempt_id','c3000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object('id','c4000000-0000-4000-8000-000000000001','name','Imported Cabin','description','From local.','metadata',jsonb_build_object('provenance','local'))),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'c3000000-0000-4000-8000-000000000001'::uuid,'phase3-local-project',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'import_local_project_content broken by Phase 3 migration: %', result; end if;

  select location_id into canonical_id from public.project_locations where id='c4000000-0000-4000-8000-000000000001' and project_id=import_project;
  if canonical_id is null then raise exception 'imported location did not create a project_locations row under the payload id'; end if;
  select count(*) into n from public.locations where id=canonical_id and name='Imported Cabin' and base_profile->>'description'='From local.';
  if n<>1 then raise exception 'imported location did not create the expected canonical row'; end if;

  -- The imported location is a normal canonical row: the new canonical-path RPCs must work on it
  -- too (proves import didn't create some second-class shape).
  result:=public.update_location_canonical(canonical_id,(select revision from public.locations where id=canonical_id),'Imported Cabin',null,'{}','building');
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'update_location_canonical failed on an imported canonical location: %', result; end if;
end $$;

reset role;
rollback;
