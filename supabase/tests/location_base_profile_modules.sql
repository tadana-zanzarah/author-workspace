-- Location Architecture V2 -- generic base_profile thematic-module contract
-- (20260904130000_location_base_profile_modules.sql). Runs in the standard convention for this
-- directory: applied after the full migration chain, everything wrapped and rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-b3a-a@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Project B3A-1',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);

-- ===========================================================================
-- Block A: legacy B2 compatibility -- call update_location_canonical exactly as the published B2
-- frontend does (js/cloud-content-api.js), with NO location_base_profile_patch argument at all.
-- Must succeed, behave identically to before this migration, and leave base_profile module keys
-- (set out-of-band, simulating data this call never touches) untouched.
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Old Harbor',null,'{}',null,null,'A weathered dock.');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  update public.locations set base_profile=base_profile||jsonb_build_object('geography',jsonb_build_object('climate','Damp')) where id=canonical_id;

  -- Exact legacy positional call shape: name, official_name, aliases, type_preset,
  -- custom_type_label, description, short_summary -- no 10th argument.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Old Harbor',null,'{}',null,null,'Rebuilt after the storm.','Still standing.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'legacy-shaped update_location_canonical call broken by this migration: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Rebuilt after the storm.' then raise exception 'description did not update'; end if;
  if (select base_profile->>'shortSummary' from public.locations where id=canonical_id)<>'Still standing.' then raise exception 'shortSummary did not update'; end if;
  if (select base_profile->'geography'->>'climate' from public.locations where id=canonical_id)<>'Damp' then raise exception 'legacy-shaped call destroyed an untouched thematic module key'; end if;

  -- Revision behavior unchanged: stale revision still rejected the same way.
  r:=public.update_location_canonical(canonical_id,loc_rev-1,'Old Harbor',null,'{}',null,null,'Wrong.','Wrong.');
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'stale revision handling changed: %', r; end if;
end $$;

-- ===========================================================================
-- Block B/C: add appearanceAtmosphere, then add geography later -- each preserves the other,
-- preserves description/shortSummary, and preserves an unrelated future base_profile key this
-- migration's RPCs never touch (cases B, C, 5, 6, 7).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Silver Reach',null,'{}',null,null,'D','S');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  update public.locations set base_profile=base_profile||jsonb_build_object('futureKey',jsonb_build_object('keep',true)) where id=canonical_id;

  -- B: add appearanceAtmosphere.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Silver Reach',null,'{}',null,null,'D','S',jsonb_build_object('appearanceAtmosphere',jsonb_build_object('visualDescription','Stone walls')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'add appearanceAtmosphere failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'appearanceAtmosphere'->>'visualDescription' from public.locations where id=canonical_id)<>'Stone walls' then raise exception 'appearanceAtmosphere was not written'; end if;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'D' or (select base_profile->>'shortSummary' from public.locations where id=canonical_id)<>'S' then raise exception 'description/shortSummary not preserved after adding appearanceAtmosphere'; end if;
  if (select base_profile->'futureKey'->>'keep' from public.locations where id=canonical_id)<>'true' then raise exception 'unrelated future base_profile key not preserved'; end if;

  -- C: add geography -- appearanceAtmosphere must survive unchanged.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Silver Reach',null,'{}',null,null,'D','S',jsonb_build_object('geography',jsonb_build_object('terrain','Mountains')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'add geography failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Mountains' then raise exception 'geography was not written'; end if;
  if (select base_profile->'appearanceAtmosphere'->>'visualDescription' from public.locations where id=canonical_id)<>'Stone walls' then raise exception 'appearanceAtmosphere destroyed when adding geography'; end if;
  if (select base_profile->'futureKey'->>'keep' from public.locations where id=canonical_id)<>'true' then raise exception 'unrelated future base_profile key not preserved after second patch'; end if;
end $$;

-- ===========================================================================
-- Block D: replace one module -- old fields not present in the replacement disappear; the other
-- module survives (case D).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Reed Marsh');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;
  r:=public.update_location_canonical(canonical_id,loc_rev,'Reed Marsh',null,'{}',null,null,'','',jsonb_build_object('appearanceAtmosphere',jsonb_build_object('visualDescription','Reeds','sounds','Wind')));
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  r:=public.update_location_canonical(canonical_id,loc_rev,'Reed Marsh',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object('terrain','Wetland')));
  loc_rev:=(r->'data'->>'location_revision')::bigint;

  -- Replace appearanceAtmosphere wholesale with a smaller object -- 'sounds' must vanish, not
  -- linger from the previous value.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Reed Marsh',null,'{}',null,null,'','',jsonb_build_object('appearanceAtmosphere',jsonb_build_object('atmosphere','Quiet and still')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'module replace failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'appearanceAtmosphere' ? 'sounds' from public.locations where id=canonical_id) then raise exception 'replaced module retained a field from the old object'; end if;
  if (select base_profile->'appearanceAtmosphere' ? 'visualDescription' from public.locations where id=canonical_id) then raise exception 'replaced module retained visualDescription from the old object'; end if;
  if (select base_profile->'appearanceAtmosphere'->>'atmosphere' from public.locations where id=canonical_id)<>'Quiet and still' then raise exception 'replacement value not written'; end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Wetland' then raise exception 'geography destroyed by an appearanceAtmosphere-only replace'; end if;
end $$;

-- ===========================================================================
-- Block E: clear one module -- JSON null removes the key entirely (not stored as JSON null); the
-- other module survives (case E).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Crooked Pines');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;
  r:=public.update_location_canonical(canonical_id,loc_rev,'Crooked Pines',null,'{}',null,null,'','',jsonb_build_object('appearanceAtmosphere',jsonb_build_object('visualDescription','Bent trees'),'geography',jsonb_build_object('terrain','Forest')));
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile ? 'appearanceAtmosphere' from public.locations where id=canonical_id)<>true then raise exception 'setup failed to write appearanceAtmosphere'; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Crooked Pines',null,'{}',null,null,'','',jsonb_build_object('appearanceAtmosphere',null));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'clear-module patch failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile ? 'appearanceAtmosphere' from public.locations where id=canonical_id) then raise exception 'appearanceAtmosphere key still present after JSON-null clear (must be ABSENT, not stored as JSON null)'; end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Forest' then raise exception 'geography destroyed by clearing appearanceAtmosphere'; end if;
end $$;

-- ===========================================================================
-- Block F: empty module {} normalizes to removal, same as JSON null (case F).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Windy Bluff');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;
  r:=public.update_location_canonical(canonical_id,loc_rev,'Windy Bluff',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object('terrain','Cliff')));
  loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Windy Bluff',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object()));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'empty-object module patch failed: %', r; end if;
  if (select base_profile ? 'geography' from public.locations where id=canonical_id) then raise exception 'empty-object patch did not normalize to module removal'; end if;
end $$;

-- ===========================================================================
-- Block G: reserved keys -- a patch touching description or shortSummary must be REJECTED, never
-- silently applied (case G).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Locked Vault',null,'{}',null,null,'Original description.');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Locked Vault',null,'{}',null,null,'Original description.',null,jsonb_build_object('description','Hacked via patch'));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'reserved key "description" in patch was not rejected: %', r; end if;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Original description.' then raise exception 'reserved-key patch attempt silently mutated description despite rejection'; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Locked Vault',null,'{}',null,null,'Original description.',null,jsonb_build_object('shortSummary','Hacked via patch'));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'reserved key "shortSummary" in patch was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block H: unknown/disallowed module key -- stable domain error, not a crash (case H).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Forbidden Archive');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Forbidden Archive',null,'{}',null,null,'','',jsonb_build_object('populationCulture',jsonb_build_object('note','not yet allowlisted')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'unknown module key was not rejected with a stable domain error: %', r; end if;
  if (select base_profile ? 'populationCulture' from public.locations where id=canonical_id) then raise exception 'unknown module key leaked into base_profile despite rejection'; end if;
end $$;

-- ===========================================================================
-- Block I: invalid patch type -- array/string/etc. at the top level must fail (case I).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Shifting Sands');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Shifting Sands',null,'{}',null,null,'','','["appearanceAtmosphere"]'::jsonb);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'array-typed patch was not rejected: %', r; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Shifting Sands',null,'{}',null,null,'','','"appearanceAtmosphere"'::jsonb);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'string-typed patch was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block J: invalid module value -- a scalar where an object is required must fail (case J).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Hollow Peak');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Hollow Peak',null,'{}',null,null,'','',jsonb_build_object('geography','mountains'));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'scalar module value was not rejected: %', r; end if;
  if (select base_profile ? 'geography' from public.locations where id=canonical_id) then raise exception 'invalid module value leaked into base_profile despite rejection'; end if;
end $$;

-- ===========================================================================
-- Block K: revision -- successful thematic mutation bumps revision exactly once; a true no-op
-- (identical resulting base_profile) does not bump it; stale expected_location_revision is still
-- LOCATION_REVISION_CONFLICT (case K).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint; loc_rev_before bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Quiet Cove');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  loc_rev_before:=loc_rev;
  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Cove',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object('terrain','Beach')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'thematic mutation failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if loc_rev<>loc_rev_before+1 then raise exception 'thematic mutation did not bump revision by exactly 1: before=%, after=%', loc_rev_before, loc_rev; end if;

  -- Resubmitting the SAME patch (identical resulting base_profile) is a no-op: changed:false, no
  -- revision bump -- matches the existing identity/no-op semantics used elsewhere in this RPC.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Cove',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object('terrain','Beach')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'identical resubmitted patch was not detected as a no-op: %', r; end if;
  if (r->'data'->>'location_revision')::bigint<>loc_rev then raise exception 'no-op patch incorrectly bumped location_revision'; end if;

  -- Stale expected_location_revision still rejected.
  r:=public.update_location_canonical(canonical_id,loc_rev-1,'Quiet Cove',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object('terrain','Cove')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'stale revision with a thematic patch was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Blocks L-O: import_local_project_content preserves base_profile data across every local
-- snapshot generation, sanitizing unknown/malformed thematic data rather than rejecting the whole
-- import (cases L, M, N, O).
-- ===========================================================================
do $$
declare
  import_project uuid:='d2000000-0000-4000-8000-000000000002';
  payload jsonb; result jsonb; canonical_id uuid;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'d1000000-0000-4000-8000-000000000001','Import Target B3A',0);

  -- L: pre-B2 old local snapshot -- top-level description only, no short_summary/base_profile
  -- keys on the payload item at all. Must still import safely (no error, no crash).
  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','b3a-old-snapshot','migration_attempt_id','d3000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object('id','d4000000-0000-4000-8000-000000000001','name','Old Cabin','description','From an old snapshot.')),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'d3000000-0000-4000-8000-000000000001'::uuid,'b3a-old-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'old-snapshot (description-only) import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='d4000000-0000-4000-8000-000000000001' and project_id=import_project;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'From an old snapshot.' then raise exception 'old-snapshot description did not survive import'; end if;
  if (select base_profile ? 'shortSummary' from public.locations where id=canonical_id) then raise exception 'old snapshot fabricated a shortSummary key it never had'; end if;

  -- M: B2 local snapshot -- description + short_summary. Both must survive (this is the
  -- confirmed pre-existing bug this migration fixes: shortSummary was previously always dropped).
  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','b3a-b2-snapshot','migration_attempt_id','d3000000-0000-4000-8000-000000000002',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object('id','d4000000-0000-4000-8000-000000000002','name','Watch Tower','description','A tall tower.','short_summary','Guards the pass.')),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,(select revision from public.projects where id=import_project),'d3000000-0000-4000-8000-000000000002'::uuid,'b3a-b2-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'B2 snapshot (description+shortSummary) import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='d4000000-0000-4000-8000-000000000002' and project_id=import_project;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'A tall tower.' then raise exception 'B2-snapshot description did not survive import'; end if;
  if (select base_profile->>'shortSummary' from public.locations where id=canonical_id)<>'Guards the pass.' then raise exception 'B2-snapshot shortSummary did not survive import (this is the confirmed pre-existing bug)'; end if;

  -- N: B3A local snapshot -- description + short_summary + appearanceAtmosphere + geography, all
  -- via a base_profile object on the payload item. All four must survive.
  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','b3a-full-snapshot','migration_attempt_id','d3000000-0000-4000-8000-000000000003',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','d4000000-0000-4000-8000-000000000003','name','Sunken Temple','description','Below the waves.','short_summary','Lost to the sea.',
      'base_profile',jsonb_build_object('appearanceAtmosphere',jsonb_build_object('visualDescription','Coral-covered stone'),'geography',jsonb_build_object('terrain','Underwater'))
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,(select revision from public.projects where id=import_project),'d3000000-0000-4000-8000-000000000003'::uuid,'b3a-full-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'B3A full snapshot import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='d4000000-0000-4000-8000-000000000003' and project_id=import_project;
  if (select base_profile->>'description' from public.locations where id=canonical_id)<>'Below the waves.' then raise exception 'B3A-snapshot description did not survive import'; end if;
  if (select base_profile->>'shortSummary' from public.locations where id=canonical_id)<>'Lost to the sea.' then raise exception 'B3A-snapshot shortSummary did not survive import'; end if;
  if (select base_profile->'appearanceAtmosphere'->>'visualDescription' from public.locations where id=canonical_id)<>'Coral-covered stone' then raise exception 'B3A-snapshot appearanceAtmosphere did not survive import'; end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Underwater' then raise exception 'B3A-snapshot geography did not survive import'; end if;

  -- O: sanitization -- an unknown/unapproved base_profile key, plus a malformed (non-object)
  -- value for an allowlisted key, plus an empty-object module, must all be silently dropped
  -- rather than crash the whole import or leak into the canonical row.
  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','b3a-hostile-snapshot','migration_attempt_id','d3000000-0000-4000-8000-000000000004',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','d4000000-0000-4000-8000-000000000004','name','Suspicious Shack','description','Looks fine.',
      'base_profile',jsonb_build_object(
        'appearanceAtmosphere',jsonb_build_object('visualDescription','A leaning shack'),
        'geography','not-an-object',
        'populationCulture',jsonb_build_object('note','not allowlisted'),
        'economy',jsonb_build_object()
      )
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,(select revision from public.projects where id=import_project),'d3000000-0000-4000-8000-000000000004'::uuid,'b3a-hostile-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'sanitization-required import unexpectedly failed instead of sanitizing: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='d4000000-0000-4000-8000-000000000004' and project_id=import_project;
  if (select base_profile->'appearanceAtmosphere'->>'visualDescription' from public.locations where id=canonical_id)<>'A leaning shack' then raise exception 'valid allowlisted module was dropped alongside the invalid data'; end if;
  if (select base_profile ? 'geography' from public.locations where id=canonical_id) then raise exception 'malformed (non-object) geography value was not sanitized away'; end if;
  if (select base_profile ? 'populationCulture' from public.locations where id=canonical_id) then raise exception 'unapproved base_profile key leaked through import'; end if;
  if (select base_profile ? 'economy' from public.locations where id=canonical_id) then raise exception 'empty-object module leaked through import instead of being dropped'; end if;
end $$;

-- ===========================================================================
-- Block P: scene/participation invariants -- location binding stays participation-based; nothing
-- about project_locations semantics changes (case P).
-- ===========================================================================
do $$
declare
  proj uuid:='d2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; canonical_id uuid; scene_result jsonb; scene_id uuid; n integer;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Thematic Battlefield');
  pl_id:=(r->'data'->>'id')::uuid; canonical_id:=(r->'data'->>'location_id')::uuid; rev:=(r->>'revision')::bigint;

  scene_result:=public.create_scene(proj,rev,null,pl_id,'Final Stand','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'create_scene against a canonical-path location failed: %', scene_result; end if;
  scene_id:=(scene_result->'data'->>'id')::uuid;

  -- A thematic-module-only mutation must not touch the scene's location_id (still the
  -- participation id) at all.
  r:=public.update_location_canonical(canonical_id,(select revision from public.locations where id=canonical_id),'Thematic Battlefield',null,'{}',null,null,'','',jsonb_build_object('geography',jsonb_build_object('terrain','Plains')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'thematic-only update_location_canonical failed: %', r; end if;
  select count(*) into n from public.scenes where id=scene_id and location_id=pl_id;
  if n<>1 then raise exception 'thematic-module mutation altered scene.location_id (must always stay the participation id)'; end if;
end $$;

reset role;
rollback;
