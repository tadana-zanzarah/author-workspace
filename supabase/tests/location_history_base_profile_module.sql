-- Location History H-base (populationCulture) -- backend contract
-- (20260908090000_location_history_base_profile_module.sql). This migration is a one-line allowlist
-- extension; these tests confirm that extension is genuinely sufficient across every generic
-- surface that reads private.location_thematic_module_keys() -- update_location_canonical's
-- base_profile patch and import_local_project_content's sanitization -- without any per-module SQL
-- logic anywhere. Runs in the standard convention for this directory: applied after the full
-- migration chain, everything wrapped and rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','f5000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-hist-base-a@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Project History-Base-1',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000001',true);

-- ===========================================================================
-- Block A: allowlist contains all six modules, in canonical order, existing five untouched.
-- ===========================================================================
do $$
declare allowed text[];
begin
  allowed:=private.location_thematic_module_keys();
  if allowed<>array['appearanceAtmosphere','geography','governmentSociety','economy','populationCulture','history'] then
    raise exception 'A: allowlist is not exactly the six expected keys in canonical order: %', allowed;
  end if;
end $$;

-- ===========================================================================
-- Block B: update_location_canonical accepts a history patch (historicalOverview/origin/legends);
-- existing appearanceAtmosphere/geography/governmentSociety/economy/populationCulture data survives
-- untouched (coexistence, generic patch loop -- no per-module SQL).
-- ===========================================================================
do $$
declare
  proj uuid:='f6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Northgate III');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate III',null,'{}',null,null,'','',jsonb_build_object(
    'appearanceAtmosphere',jsonb_build_object('atmosphere','Bustling'),
    'geography',jsonb_build_object('terrain','Coastal plain'),
    'governmentSociety',jsonb_build_object('governmentForm','Republic'),
    'economy',jsonb_build_object('currency','Crown'),
    'populationCulture',jsonb_build_object('populationCharacter','Cosmopolitan port')
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: setup (five existing modules) failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate III',null,'{}',null,null,'','',jsonb_build_object(
    'history',jsonb_build_object(
      'historicalOverview','Founded as a fishing village, grew into a trade hub after the harbor was deepened.',
      'origin','Settled by refugees fleeing the fall of the old capital.',
      'legends','Said to be built over a drowned temple; sailors leave offerings at the tide line.'
    )
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: history patch was rejected: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'history'->>'historicalOverview' from public.locations where id=canonical_id)<>'Founded as a fishing village, grew into a trade hub after the harbor was deepened.' then
    raise exception 'B: history.historicalOverview was not written';
  end if;
  if (select base_profile->'history'->>'origin' from public.locations where id=canonical_id)<>'Settled by refugees fleeing the fall of the old capital.' then
    raise exception 'B: history.origin was not written';
  end if;
  if (select base_profile->'history'->>'legends' from public.locations where id=canonical_id)<>'Said to be built over a drowned temple; sailors leave offerings at the tide line.' then
    raise exception 'B: history.legends was not written';
  end if;
  if (select base_profile->'appearanceAtmosphere'->>'atmosphere' from public.locations where id=canonical_id)<>'Bustling' then
    raise exception 'B: adding history destroyed appearanceAtmosphere';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Coastal plain' then
    raise exception 'B: adding history destroyed geography';
  end if;
  if (select base_profile->'governmentSociety'->>'governmentForm' from public.locations where id=canonical_id)<>'Republic' then
    raise exception 'B: adding history destroyed governmentSociety';
  end if;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Crown' then
    raise exception 'B: adding history destroyed economy';
  end if;
  if (select base_profile->'populationCulture'->>'populationCharacter' from public.locations where id=canonical_id)<>'Cosmopolitan port' then
    raise exception 'B: adding history destroyed populationCulture';
  end if;

  -- Clearing history back to empty (JSON null) leaves the other five modules untouched.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate III',null,'{}',null,null,'','',jsonb_build_object('history',null));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: clearing history failed: %', r; end if;
  if (select base_profile ? 'history' from public.locations where id=canonical_id) then raise exception 'B: history key still present after JSON-null clear'; end if;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Crown' then
    raise exception 'B: clearing history destroyed economy';
  end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;

  -- Empty-object patch ({}) also normalizes to deletion, same as JSON null (three-state contract).
  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate III',null,'{}',null,null,'','',jsonb_build_object('history',jsonb_build_object('origin','Temporary')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: re-adding history failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate III',null,'{}',null,null,'','',jsonb_build_object('history','{}'::jsonb));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: empty-object history patch was rejected: %', r; end if;
  if (select base_profile ? 'history' from public.locations where id=canonical_id) then raise exception 'B: empty-object history patch did not normalize to deletion'; end if;
end $$;

-- ===========================================================================
-- Block C: unknown module key (never allowlisted) is still rejected -- the allowlist expansion
-- must not have accidentally loosened validation into "anything goes". Uses `chronology`, a name
-- deliberately never allowlisted by this or any prior migration.
-- ===========================================================================
do $$
declare
  proj uuid:='f6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Forbidden Ledger III');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Forbidden Ledger III',null,'{}',null,null,'','',jsonb_build_object('chronology',jsonb_build_object('note','still not allowlisted')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'C: still-unallowlisted module key was not rejected: %', r; end if;
  if (select base_profile ? 'chronology' from public.locations where id=canonical_id) then raise exception 'C: unallowlisted module key leaked into base_profile'; end if;
end $$;

-- ===========================================================================
-- Block D: revision semantics for history patches -- exactly one bump per real change, no bump for
-- a true no-op resubmit, stale expected_location_revision still rejected.
-- ===========================================================================
do $$
declare
  proj uuid:='f6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint; loc_rev_before bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Quiet Archive III');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;
  loc_rev_before:=loc_rev;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Archive III',null,'{}',null,null,'','',jsonb_build_object('history',jsonb_build_object('historicalOverview','Once a monastery.')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'D: history mutation failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if loc_rev<>loc_rev_before+1 then raise exception 'D: history mutation did not bump revision by exactly 1: before=%, after=%', loc_rev_before, loc_rev; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Archive III',null,'{}',null,null,'','',jsonb_build_object('history',jsonb_build_object('historicalOverview','Once a monastery.')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'D: identical resubmitted history patch was not detected as a no-op: %', r; end if;
  if (r->'data'->>'location_revision')::bigint<>loc_rev then raise exception 'D: no-op history patch incorrectly bumped location_revision'; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev-1,'Quiet Archive III',null,'{}',null,null,'','',jsonb_build_object('history',jsonb_build_object('historicalOverview','Wrong')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'D: stale revision with a history patch was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block E: import_local_project_content accepts a local snapshot carrying history base_profile
-- data, sanitizing anything invalid exactly like the existing five modules (same generic sanitizer,
-- same allowlist). A malformed (non-object) history value is dropped, never rejected.
-- ===========================================================================
do $$
declare
  import_project uuid:='f6000000-0000-4000-8000-000000000002';
  payload jsonb; result jsonb; canonical_id uuid;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'f5000000-0000-4000-8000-000000000001','Import Target History-Base',0);

  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','history-base-full-snapshot','migration_attempt_id','f7000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','f8000000-0000-4000-8000-000000000001','name','Import Test Village','description','A village that survived import.',
      'base_profile',jsonb_build_object(
        'geography',jsonb_build_object('terrain','Hills'),
        'history',jsonb_build_object('historicalOverview','Rebuilt twice after floods.','legends',jsonb_build_array('not','a','string, but still just data'))
      )
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'f7000000-0000-4000-8000-000000000001'::uuid,'history-base-full-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'E: history-carrying import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='f8000000-0000-4000-8000-000000000001' and project_id=import_project;

  if (select base_profile->'history'->>'historicalOverview' from public.locations where id=canonical_id)<>'Rebuilt twice after floods.' then
    raise exception 'E: history.historicalOverview did not survive import';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Hills' then
    raise exception 'E: geography did not survive import alongside the new module';
  end if;

  -- A location with NO history key at all (every pre-H local snapshot) must import cleanly with no
  -- history key present -- never a spurious empty object. A FRESH, separate target project is
  -- required here: import_local_project_content's own private.local_import_target_empty check
  -- means a project that already received one import (like import_project, right above) is no
  -- longer empty and would reject a second import attempt with TARGET_NOT_EMPTY.
  declare import_project_2 uuid:='f6000000-0000-4000-8000-000000000003'; begin
    insert into public.projects(id,owner_id,title,revision) values (import_project_2,'f5000000-0000-4000-8000-000000000001','Import Target History-Base Legacy',0);
    payload:=jsonb_build_object(
      'project_id',import_project_2::text,'source_project_id','history-base-full-snapshot-2','migration_attempt_id','f7000000-0000-4000-8000-000000000002',
      'characters','[]'::jsonb,'chapters','[]'::jsonb,
      'locations',jsonb_build_array(jsonb_build_object('id','f8000000-0000-4000-8000-000000000002','name','Legacy Town','description','')),
      'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
      'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
    );
    result:=public.import_local_project_content(import_project_2,0,'f7000000-0000-4000-8000-000000000002'::uuid,'history-base-full-snapshot-2',payload);
    if not coalesce((result->>'ok')::boolean,false) then raise exception 'E2: history-less legacy import failed: %', result; end if;
    select location_id into canonical_id from public.project_locations where id='f8000000-0000-4000-8000-000000000002' and project_id=import_project_2;
    if (select base_profile ? 'history' from public.locations where id=canonical_id) then
      raise exception 'E2: a legacy import with no history field must not gain a spurious history key';
    end if;
  end;
end $$;

reset role;
rollback;
