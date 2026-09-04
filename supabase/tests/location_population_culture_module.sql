-- Location Adaptive Modules B3C (populationCulture) -- backend contract
-- (20260906090000_location_population_culture_module.sql). This migration is a one-line allowlist
-- extension; these tests confirm that extension is genuinely sufficient across every generic
-- surface that reads private.location_thematic_module_keys() -- update_location_canonical's
-- base_profile patch, update_project_location_module_selection's shown/hidden validation, and
-- import_local_project_content's sanitization -- without any per-module SQL logic anywhere. Runs in
-- the standard convention for this directory: applied after the full migration chain, everything
-- wrapped and rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','e5000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-b3c-a@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('e6000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','Project B3C-1',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','e5000000-0000-4000-8000-000000000001',true);

-- ===========================================================================
-- Block A: allowlist contains all five modules, in canonical order, existing four untouched.
-- ===========================================================================
do $$
declare allowed text[];
begin
  allowed:=private.location_thematic_module_keys();
  if allowed<>array['appearanceAtmosphere','geography','governmentSociety','economy','populationCulture'] then
    raise exception 'A: allowlist is not exactly the five expected keys in canonical order: %', allowed;
  end if;
end $$;

-- ===========================================================================
-- Block B: update_location_canonical accepts a populationCulture patch; existing
-- appearanceAtmosphere/geography/governmentSociety/economy data survives untouched (coexistence,
-- generic patch loop -- no per-module SQL).
-- ===========================================================================
do $$
declare
  proj uuid:='e6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Northgate II');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate II',null,'{}',null,null,'','',jsonb_build_object(
    'appearanceAtmosphere',jsonb_build_object('atmosphere','Bustling'),
    'geography',jsonb_build_object('terrain','Coastal plain'),
    'governmentSociety',jsonb_build_object('governmentForm','Republic'),
    'economy',jsonb_build_object('currency','Crown')
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: setup (four existing modules) failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate II',null,'{}',null,null,'','',jsonb_build_object(
    'populationCulture',jsonb_build_object(
      'populationCharacter','A cosmopolitan port full of sailors and merchants.',
      'peoplesAndGroups',jsonb_build_array('Dockworkers guild','Northern diaspora'),
      'languages',jsonb_build_array('Common','Old Northern'),
      'customsAndTraditions','Newcomers are expected to buy the first round at the harbor tavern.',
      'holidays',jsonb_build_array('Tide Festival'),
      'beliefs',jsonb_build_array('Sailors'' Faith'),
      'socialNorms','Never whistle on a docked ship.'
    )
  ));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: populationCulture patch was rejected: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if (select base_profile->'populationCulture'->>'populationCharacter' from public.locations where id=canonical_id)<>'A cosmopolitan port full of sailors and merchants.' then
    raise exception 'B: populationCulture.populationCharacter was not written';
  end if;
  if (select base_profile->'populationCulture'->'peoplesAndGroups' from public.locations where id=canonical_id)<>jsonb_build_array('Dockworkers guild','Northern diaspora') then
    raise exception 'B: populationCulture.peoplesAndGroups was not written';
  end if;
  if (select base_profile->'appearanceAtmosphere'->>'atmosphere' from public.locations where id=canonical_id)<>'Bustling' then
    raise exception 'B: adding populationCulture destroyed appearanceAtmosphere';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Coastal plain' then
    raise exception 'B: adding populationCulture destroyed geography';
  end if;
  if (select base_profile->'governmentSociety'->>'governmentForm' from public.locations where id=canonical_id)<>'Republic' then
    raise exception 'B: adding populationCulture destroyed governmentSociety';
  end if;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Crown' then
    raise exception 'B: adding populationCulture destroyed economy';
  end if;

  -- Clearing populationCulture back to empty (JSON null) leaves the other four modules untouched.
  r:=public.update_location_canonical(canonical_id,loc_rev,'Northgate II',null,'{}',null,null,'','',jsonb_build_object('populationCulture',null));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'B: clearing populationCulture failed: %', r; end if;
  if (select base_profile ? 'populationCulture' from public.locations where id=canonical_id) then raise exception 'B: populationCulture key still present after JSON-null clear'; end if;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Crown' then
    raise exception 'B: clearing populationCulture destroyed economy';
  end if;
end $$;

-- ===========================================================================
-- Block C: unknown module key (never allowlisted) is still rejected -- the allowlist expansion
-- must not have accidentally loosened validation into "anything goes". Uses historyNotes, the
-- next genuinely-still-unallowlisted module name (populationCulture itself is now valid).
-- ===========================================================================
do $$
declare
  proj uuid:='e6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Forbidden Ledger II');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Forbidden Ledger II',null,'{}',null,null,'','',jsonb_build_object('historyNotes',jsonb_build_object('note','still not allowlisted')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'C: still-unallowlisted module key was not rejected: %', r; end if;
  if (select base_profile ? 'historyNotes' from public.locations where id=canonical_id) then raise exception 'C: unallowlisted module key leaked into base_profile'; end if;
end $$;

-- ===========================================================================
-- Block D: revision semantics for populationCulture patches -- exactly one bump per real change,
-- no bump for a true no-op resubmit, stale expected_location_revision still rejected.
-- ===========================================================================
do $$
declare
  proj uuid:='e6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; canonical_id uuid; loc_rev bigint; loc_rev_before bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Quiet Exchange II');
  canonical_id:=(r->'data'->>'location_id')::uuid; loc_rev:=(r->'data'->>'location_revision')::bigint;
  loc_rev_before:=loc_rev;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Exchange II',null,'{}',null,null,'','',jsonb_build_object('populationCulture',jsonb_build_object('populationCharacter','Mostly students.')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'D: populationCulture mutation failed: %', r; end if;
  loc_rev:=(r->'data'->>'location_revision')::bigint;
  if loc_rev<>loc_rev_before+1 then raise exception 'D: populationCulture mutation did not bump revision by exactly 1: before=%, after=%', loc_rev_before, loc_rev; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev,'Quiet Exchange II',null,'{}',null,null,'','',jsonb_build_object('populationCulture',jsonb_build_object('populationCharacter','Mostly students.')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'D: identical resubmitted populationCulture patch was not detected as a no-op: %', r; end if;
  if (r->'data'->>'location_revision')::bigint<>loc_rev then raise exception 'D: no-op populationCulture patch incorrectly bumped location_revision'; end if;

  r:=public.update_location_canonical(canonical_id,loc_rev-1,'Quiet Exchange II',null,'{}',null,null,'','',jsonb_build_object('populationCulture',jsonb_build_object('populationCharacter','Wrong')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'D: stale revision with a populationCulture patch was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block E: update_project_location_module_selection accepts populationCulture in shown/hidden --
-- same generic allowlist read, project-revision domain preserved (bump exactly once on real
-- change, no bump on no-op).
-- ===========================================================================
do $$
declare
  proj uuid:='e6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid; rev_after_first bigint;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Selection Yard II');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('populationCulture','economy')));
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'E: selection write with the B3C key failed: %', r; end if;
  rev:=(r->>'revision')::bigint; rev_after_first:=rev;
  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id)<>jsonb_build_array('economy','populationCulture') then
    raise exception 'E: shown was not canonically ordered (economy, populationCulture per allowlist order): %', (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id=pl_id);
  end if;

  -- No-op resubmit (identical after normalization) -- no revision bump.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('economy','populationCulture','populationCulture')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'E: no-op resubmit with the B3C key was not detected: %', r; end if;
  if (r->>'revision')::bigint<>rev_after_first then raise exception 'E: no-op resubmit incorrectly bumped project revision'; end if;

  -- Hiding the new module is a real change.
  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('hidden',jsonb_build_array('populationCulture')));
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>true then raise exception 'E: hiding populationCulture failed: %', r; end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id=pl_id)<>jsonb_build_array('populationCulture') then
    raise exception 'E: populationCulture was not recorded as hidden';
  end if;
end $$;

-- ===========================================================================
-- Block F: unknown module key still rejected by the live selection RPC too (strict reject, not
-- sanitize -- see migration header on live-call vs. import-path philosophy).
-- ===========================================================================
do $$
declare
  proj uuid:='e6000000-0000-4000-8000-000000000001';
  rev bigint; r jsonb; pl_id uuid;
begin
  select revision into rev from public.projects where id=proj;
  r:=public.create_location_canonical(proj,rev,'Selection Vault II');
  pl_id:=(r->'data'->>'id')::uuid; rev:=(r->>'revision')::bigint;

  r:=public.update_project_location_module_selection(proj,pl_id,rev,jsonb_build_object('shown',jsonb_build_array('historyNotes')));
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'VALIDATION_ERROR' then raise exception 'F: still-unallowlisted module key in shown was not rejected: %', r; end if;
end $$;

-- ===========================================================================
-- Block G: import_local_project_content accepts a local snapshot carrying populationCulture
-- base_profile data plus a module_selection referencing it, sanitizing anything invalid exactly
-- like the existing four modules (same generic sanitizer, same allowlist).
-- ===========================================================================
do $$
declare
  import_project uuid:='e6000000-0000-4000-8000-000000000002';
  payload jsonb; result jsonb; canonical_id uuid;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'e5000000-0000-4000-8000-000000000001','Import Target B3C',0);

  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','b3c-full-snapshot','migration_attempt_id','e7000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','e8000000-0000-4000-8000-000000000001','name','Import Test Town','description','A town that survived import.',
      'base_profile',jsonb_build_object(
        'geography',jsonb_build_object('terrain','Hills'),
        'economy',jsonb_build_object('currency','Peso'),
        'populationCulture',jsonb_build_object('populationCharacter','Old local families mixed with newcomers.','languages',jsonb_build_array('Spanish','Nahuatl')),
        'historyNotes','not-an-object'
      ),
      'module_selection',jsonb_build_object('shown',jsonb_build_array('populationCulture','economy'),'hidden',jsonb_build_array('geography'))
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'e7000000-0000-4000-8000-000000000001'::uuid,'b3c-full-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'G: B3C-carrying import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='e8000000-0000-4000-8000-000000000001' and project_id=import_project;

  if (select base_profile->'populationCulture'->>'populationCharacter' from public.locations where id=canonical_id)<>'Old local families mixed with newcomers.' then
    raise exception 'G: populationCulture did not survive import';
  end if;
  if (select base_profile->'populationCulture'->'languages' from public.locations where id=canonical_id)<>jsonb_build_array('Spanish','Nahuatl') then
    raise exception 'G: populationCulture.languages did not survive import';
  end if;
  if (select base_profile->'economy'->>'currency' from public.locations where id=canonical_id)<>'Peso' then
    raise exception 'G: economy did not survive import alongside the new module';
  end if;
  if (select base_profile->'geography'->>'terrain' from public.locations where id=canonical_id)<>'Hills' then
    raise exception 'G: geography did not survive import alongside the new module';
  end if;
  if (select base_profile ? 'historyNotes' from public.locations where id=canonical_id) then
    raise exception 'G: malformed (non-object) historyNotes value was not sanitized away';
  end if;

  if (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id='e8000000-0000-4000-8000-000000000001' and project_id=import_project)<>jsonb_build_array('economy','populationCulture') then
    raise exception 'G: imported module_selection.shown for the B3C key not sanitized/ordered correctly: %', (select metadata->'locationProfile'->'moduleSelection'->'shown' from public.project_locations where id='e8000000-0000-4000-8000-000000000001' and project_id=import_project);
  end if;
  if (select metadata->'locationProfile'->'moduleSelection'->'hidden' from public.project_locations where id='e8000000-0000-4000-8000-000000000001' and project_id=import_project)<>jsonb_build_array('geography') then
    raise exception 'G: imported module_selection.hidden for geography not preserved alongside the new B3C key';
  end if;
end $$;

reset role;
rollback;
