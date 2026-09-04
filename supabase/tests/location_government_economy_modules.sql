-- Location Adaptive Modules B3B (governmentSociety, economy) -- backend contract
-- (20260905090000_location_government_economy_modules.sql). This migration is a one-line
-- allowlist extension; these tests confirm that extension is genuinely sufficient across every
-- generic surface that reads private.location_thematic_module_keys() -- update_location_canonical's
-- base_profile patch, update_project_location_module_selection's shown/hidden validation, and
-- import_local_project_content's sanitization -- without any per-module SQL logic anywhere. Runs in
-- the standard convention for this directory: applied after the full migration chain, everything
-- wrapped and rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-b3b-a@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Project B3B-1',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);

-- ===========================================================================
-- Block A: allowlist contains governmentSociety/economy, in canonical order, immediately after
-- geography and before anything else. Checked as a sub-sequence (not full-array equality) because
-- this suite runs after the FULL migration chain -- including B3C (20260906090000_location_
-- population_culture_module.sql), applied on top of this migration in every disposable-CI/test run
-- -- so the live allowlist legitimately has a fifth key (populationCulture) beyond what this
-- migration itself added; a full-array equality here would go stale every time a later phase
-- extends the allowlist further, same lesson as the historical fixes to this file's Block C/G.
-- ===========================================================================
do $$
declare allowed text[];
begin
  allowed:=private.location_thematic_module_keys();
  if allowed[1:4]<>array['appearanceAtmosphere','geography','governmentSociety','economy'] then
    raise exception 'A: the first four allowlist keys are not appearanceAtmosphere/geography/governmentSociety/economy in that order: %', allowed;
  end if;
end $$;

-- ===========================================================================
-- Block B: update_location_canonical accepts a governmentSociety patch; existing appearanceAtmosphere/
-- geography data survives untouched (coexistence, generic patch loop -- no per-module SQL).
-- ===========================================================================
do $$
declare
  proj uuid:='e2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Northgate');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate',null,'{}',null,null,'','',jsonb_build_object(
    'appearanceAtmosphere',jsonb_build_object('atmosphere','Bustling'),
    'geography',jsonb_build_object('terrain','Coastal plain')
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: setup (appearance+geography) failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate',null,'{}',null,null,'','',jsonb_build_object(
    'governmentSociety',jsonb_build_object('governmentForm','Constitutional monarchy','leadership','King Edmund III','securityForces',jsonb_build_array('Royal Guard'))
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: governmentSociety patch was rejected: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'governmentSociety'->>'governmentForm' from public.locations where id=canonical_id)<>'Constitutional monarchy' then
    raise exception 'B: governmentSociety.governmentForm was not written';
  end if;
  if (select base_profile->'governmentSociety'->'securityForces' from public.locations where id=canonical_id)<>jsonb_build_array('Royal Guard') then
    raise exception 'B: governmentSociety.securityForces was not written';
  end if;
  if (select base_profile->'appearanceAtmosphere'->>'atmosphere' from public.locations where id=canonical_id)<>'Bustling' then
    raise exception 'B: adding governmentSociety destroyed appearanceAtmosphere';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Coastal plain' then
    raise exception 'B: adding governmentSociety destroyed geography';
  end if;

  -- economy patch: all three modules must now coexist.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate',null,'{}',null,null,'','',jsonb_build_object(
    'economy',jsonb_build_object('currency','Crown','industries',jsonb_build_array('Fishing','Shipbuilding'))
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: economy patch was rejected: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Crown' then raise exception 'B: economy.currency was not written'; end if;
  if (select base_profile->'governmentSociety'->>'governmentForm' from public.locations where id=canonical_id)<>'Constitutional monarchy' then
    raise exception 'B: adding economy destroyed governmentSociety';
  end if;
  if (select base_profile->'appearanceAtmosphere'->>'atmosphere' from public.locations where id=canonical_id)<>'Bustling' then
    raise exception 'B: adding economy destroyed appearanceAtmosphere';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Coastal plain' then
    raise exception 'B: adding economy destroyed geography';
  end if;

  -- Clearing economy back to empty (JSON null) leaves the other three modules untouched.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate',null,'{}',null,null,'','',jsonb_build_object('economy',null));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: clearing economy failed: %', r; end if;
  if (select base_profile ? 'economy' from public.locations where id=canonical_id) then raise exception 'B: economy key still present after JSON-null clear'; end if;
  if (select base_profile->'governmentSociety'->>'governmentForm' from public.locations where id=canonical_id)<>'Constitutional monarchy' then
    raise exception 'B: clearing economy destroyed governmentSociety';
  end if;
end $$;

-- ===========================================================================
-- Block C: unknown module key (never allowlisted) is still rejected -- the allowlist expansion
-- must not have accidentally loosened validation into "anything goes". Uses historyNotes --
-- populationCulture shipped in B3C (20260906090000_location_population_culture_module.sql) and is
-- no longer a valid example of an unallowlisted key.
-- ===========================================================================
do $$
declare
  proj uuid:='e2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Forbidden Ledger');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Forbidden Ledger',null,'{}',null,null,'','',jsonb_build_object('historyNotes',jsonb_build_object('note','still not allowlisted')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'C: still-unallowlisted module key was not rejected: %', r; end if;
  if (select base_profile ? 'historyNotes' from public.locations where id=canonical_id) then raise exception 'C: unallowlisted module key leaked into base_profile'; end if;
end $$;

-- ===========================================================================
-- Block D: revision semantics for governmentSociety/economy patches -- exactly one bump per real
-- change, no bump for a true no-op resubmit, stale expected_location_revision still rejected.
-- ===========================================================================
do $$
declare
  proj uuid:='e2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint; loc_rev_before bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Quiet Exchange');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;
  loc_rev_before:=loc_rev;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Exchange',null,'{}',null,null,'','',jsonb_build_object('economy',jsonb_build_object('currency','Shell')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'D: economy mutation failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if loc_rev<>loc_rev_before+1 then raise exception 'D: economy mutation did not bump revision by exactly 1: before=%, after=%', loc_rev_before, loc_rev; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Exchange',null,'{}',null,null,'','',jsonb_build_object('economy',jsonb_build_object('currency','Shell')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'D: identical resubmitted economy patch was not detected as a no-op: %', r; end if;
  if (r->'data'->>'location_revision')::bigint<>loc_rev then raise exception 'D: no-op economy patch incorrectly bumped location_revision'; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev-1,'Quiet Exchange',null,'{}',null,null,'','',jsonb_build_object('economy',jsonb_build_object('currency','Wrong')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'D: stale revision with an economy patch was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block E: update_project_location_module_selection accepts governmentSociety/economy in
-- shown/hidden -- same generic allowlist read, project-revision domain preserved (bump exactly
-- once on real change, no bump on no-op).
-- ===========================================================================
do $$
declare
  proj uuid:='e2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; rev_after_first bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Selection Yard');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('economy','governmentSociety')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'E: selection write with B3B keys failed: %', r; end if;
  rev:=(r->>'revision')::bigint; rev_after_first:=rev;
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id)<>jsonb_build_array('governmentSociety','economy') then
    raise exception 'E: shown was not canonically ordered (governmentSociety, economy per allowlist order): %', (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id);
  end if;

  -- No-op resubmit (identical after normalization) -- no revision bump.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('governmentSociety','economy','economy')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'E: no-op resubmit with B3B keys was not detected: %', r; end if;
  if (r->>'revision')::bigint<>rev_after_first then raise exception 'E: no-op resubmit incorrectly bumped project revision'; end if;

  -- Hiding one of the new modules is a real change.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('hidden',jsonb_build_array('economy')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>true then raise exception 'E: hiding economy failed: %', r; end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id=pl_id)<>jsonb_build_array('economy') then
    raise exception 'E: economy was not recorded as hidden';
  end if;
end $$;

-- ===========================================================================
-- Block F: unknown module key still rejected by the live selection RPC too (strict reject, not
-- sanitize -- see migration header on live-call vs. import-path philosophy).
-- ===========================================================================
do $$
declare
  proj uuid:='e2000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Selection Vault');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('historyNotes')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'F: still-unallowlisted module key in shown was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block G: import_local_project_content accepts a local snapshot carrying governmentSociety and
-- economy base_profile data plus a module_selection referencing them, sanitizing anything invalid
-- exactly like the existing two modules (same generic sanitizer, same allowlist).
-- ===========================================================================
do $$
declare
  import_project uuid:='e2000000-0000-4000-8000-000000000002';
  payload jsonb; result jsonb; canonical_id uuid;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'e1000000-0000-4000-8000-000000000001','Import Target B3B',0);

  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','b3b-full-snapshot','migration_attempt_id','e3000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','e4000000-0000-4000-8000-000000000001','name','Import Test City','description','A city that survived import.',
      'base_profile',jsonb_build_object(
        'geography',jsonb_build_object('terrain','Hills'),
        'governmentSociety',jsonb_build_object('leadership','Mayor Alvez'),
        'economy',jsonb_build_object('currency','Peso','industries',jsonb_build_array('Trade')),
        'historyNotes','not-an-object'
      ),
      'module_selection',jsonb_build_object('shown',jsonb_build_array('governmentSociety','economy'),'hidden',jsonb_build_array('geography'))
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'e3000000-0000-4000-8000-000000000001'::uuid,'b3b-full-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'G: B3B-carrying import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='e4000000-0000-4000-8000-000000000001' and project_id=import_project;

  if (select base_profile->'governmentSociety'->>'leadership' from public.locations where id=canonical_id)<>'Mayor Alvez' then
    raise exception 'G: governmentSociety did not survive import';
  end if;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Peso' then
    raise exception 'G: economy did not survive import';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Hills' then
    raise exception 'G: geography did not survive import alongside the new modules';
  end if;
  if (select base_profile ? 'historyNotes' from public.locations where id=canonical_id) then
    raise exception 'G: malformed (non-object) historyNotes value was not sanitized away';
  end if;

  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id='e4000000-0000-4000-8000-000000000001' and project_id=import_project)<>jsonb_build_array('governmentSociety','economy') then
    raise exception 'G: imported module_selection.shown for B3B keys not sanitized/ordered correctly: %', (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id='e4000000-0000-4000-8000-000000000001' and project_id=import_project);
  end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id='e4000000-0000-4000-8000-000000000001' and project_id=import_project)<>jsonb_build_array('geography') then
    raise exception 'G: imported module_selection.hidden for geography not preserved alongside new B3B keys';
  end if;
end $$;

reset role;
rollback;
