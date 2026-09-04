-- Location Adaptive Module Selection -- Phase 1 backend foundation.
--
-- CONTEXT: "Adaptive Location Profile Modules" (audit) + "Adaptive Module Selection -- Final
-- Contract Addendum" (contract addendum), both accepted. This migration implements exactly the
-- backend surface those documents specified as required for Phase 1, and nothing else: Phase 1
-- ships the adaptive add/hide/delete SHELL against the two modules that already exist
-- (appearanceAtmosphere, geography) -- it adds zero new base_profile modules and does not touch
-- private.location_thematic_module_keys().
--
-- WHAT THIS MIGRATION DOES (function bodies + one new function; no ALTER TABLE, no new table, no
-- backfill of any existing row):
--
--   1. New RPC public.update_project_location_module_selection -- writes project-specific
--      presentation state (which of the two existing modules are explicitly shown/hidden in ONE
--      project) at project_locations.metadata.locationProfile.moduleSelection. This is a pure
--      project-participation mutation: it never touches public.locations or locations.revision,
--      mirrors update_location's ownership/participation checks exactly, and is gated on the
--      PROJECT's own expected_revision (projects.revision) -- the same domain create_location_
--      canonical/delete_location/attach_project_location already use, and a genuinely different
--      domain from update_location_canonical/set_location_parent's expected_location_revision
--      (locations.revision). Naming follows the existing project-scoped RPC convention exactly:
--      the project_locations.id parameter is named target_location_id, same as update_location/
--      delete_location, even though it is conceptually a participation id (see js/locations.js's
--      own header comment on this pre-existing naming looseness) -- introducing a more-precise-
--      but-inconsistent name here was rejected in the contract addendum review.
--
--   2. private.normalize_location_module_keys(raw text[], allowed text[]) -- a small ordering/
--      dedupe helper, same shape as the existing private.normalize_location_aliases: given a set
--      of already-allowlist-validated keys, returns them deduped and in canonical allowlist
--      order (not insertion order), so two semantically-equal selections always serialize
--      byte-identically -- this is what makes the RPC's no-op comparison (step 3 below) correct.
--
--   3. private.sanitize_imported_module_selection(raw jsonb, allowed text[]) -- the import-path
--      counterpart. Unlike the live RPC (which REJECTS anything invalid with VALIDATION_ERROR,
--      because a live call only ever comes from this app's own client code and a violation can
--      only mean a client bug), this function silently drops anything invalid -- wrong shape,
--      non-string entries, unknown keys -- and resolves a shown/hidden overlap by dropping the
--      key from `shown` (hidden wins), because untrusted local-snapshot JSON must degrade safely
--      rather than fail the whole import. Mirrors the exact "silently drop, never reject" import
--      philosophy import_local_project_content already applies to base_profile module data
--      (20260904130000_location_base_profile_modules.sql's own header, "IMPORT SANITIZATION").
--
--   4. list_owned_locations() gains one additive projected key per row, participation_count -- a
--      correlated subquery counting non-removed project_locations rows for that canonical
--      location. Every existing key (id, name, official_name, aliases, parent_id, type_preset,
--      custom_type_label, base_profile, metadata, revision, created_at, updated_at, archived_at,
--      deleted_at, owner_id, sort_order, deleted_at) is preserved byte-for-byte via `to_jsonb(l)
--      || jsonb_build_object('participation_count', ...)` -- a pure addition, never a replace.
--      This is the participation-count source the delete-safety UX needs (contract addendum §5):
--      no participation row is ever returned to the client, only a count, and the count is safe
--      by construction under RLS/ownership -- see the migration's own comment above the function
--      body for why a location a caller owns can only ever have project_locations rows in
--      projects that same caller also owns (the existing owner-guard trigger already enforces
--      this, so there is no cross-owner leak surface here even though this function is a plain
--      SECURITY INVOKER SELECT).
--
--   5. import_local_project_content gains one additive block in its existing per-location loop:
--      an optional `module_selection` field per local Location item (mirrors how `short_summary`/
--      `base_profile` were added in the base_profile-modules migration) is sanitized via (3) and,
--      if it produces anything, merged into that location's new project_locations.metadata at the
--      SAME namespaced path the live RPC uses -- never a bare root-level key, and never clobbering
--      whatever the payload's own `metadata` field already carried for that location.
--
-- METADATA NAMESPACE (contract addendum §1): every write in this migration uses
-- metadata.locationProfile.moduleSelection, never a bare metadata.moduleSelection key, and every
-- write is a targeted two-step merge -- first build the merged `locationProfile` object in a
-- variable (coalesce(metadata->'locationProfile','{}') merged with the new/absent moduleSelection
-- key), then write it back with a SINGLE top-level jsonb_set(metadata,'{locationProfile}', ...).
-- This is deliberately NOT a single nested jsonb_set(metadata,'{locationProfile,moduleSelection}',
-- ...) call: jsonb_set only auto-creates the FINAL path element, never intermediate ones, so that
-- one-shot form would silently no-op on every production row today (none has a locationProfile
-- key yet). The two-step form here never has that failure mode, and by construction never touches
-- any other root-level metadata key or any other sibling key that might one day live under
-- locationProfile.
--
-- EMPTY-SELECTION COLLAPSE: shown=[] and hidden=[] normalizes to "no moduleSelection key at all"
-- (never a stored `{}` boilerplate object, same "no meaningless empty object litter" principle
-- the base_profile three-state contract already established) -- and if that leaves locationProfile
-- itself as `{}`, that key is removed too. Both removals are targeted (`- 'key'`), never a full
-- metadata overwrite.
--
-- NO DATA BACKFILL: this migration adds/replaces function bodies and adds one new pair of private
-- helpers. It does not ALTER any column, does not UPDATE any existing row, and does not touch RLS
-- policies, grants (beyond the two new private helpers' own authenticated grant, mirroring private.
-- normalize_location_aliases's existing pattern), or constraints. project_locations.metadata
-- already exists with its object-shape check (project_locations_metadata_object, Foundation
-- schema) -- no schema change is needed for this migration to be safe.

-- ---------------------------------------------------------------------------
-- private.normalize_location_module_keys: dedupe + canonical-allowlist-order a set of already-
-- validated module keys. Pure, no table access.
-- ---------------------------------------------------------------------------
create or replace function private.normalize_location_module_keys(raw text[], allowed text[])
returns text[] language sql immutable security invoker set search_path = ''
as $$
  select coalesce(array_agg(a.key order by a.pos), '{}'::text[])
  from unnest(allowed) with ordinality as a(key, pos)
  where a.key = any(coalesce(raw, '{}'::text[]))
$$;
grant execute on function private.normalize_location_module_keys(text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- private.sanitize_imported_module_selection: untrusted-input counterpart. Never raises; always
-- returns either NULL (nothing usable) or a clean {shown:[...],hidden:[...]} object containing
-- only non-empty, allowlisted, deduped, canonically-ordered arrays. shown/hidden overlap in the
-- raw input resolves hidden-wins (contract addendum §2, edge case 2).
-- ---------------------------------------------------------------------------
create or replace function private.sanitize_imported_module_selection(raw jsonb, allowed text[])
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  shown_list text[] := '{}';
  hidden_list text[] := '{}';
  elem jsonb;
  normalized_shown text[];
  normalized_hidden text[];
  effective jsonb;
begin
  if jsonb_typeof(raw) is distinct from 'object' then return null; end if;

  if jsonb_typeof(raw->'shown')='array' then
    for elem in select value from jsonb_array_elements(raw->'shown') loop
      if jsonb_typeof(elem)='string' and (elem#>>'{}')=any(allowed) then shown_list:=shown_list||(elem#>>'{}'); end if;
    end loop;
  end if;
  if jsonb_typeof(raw->'hidden')='array' then
    for elem in select value from jsonb_array_elements(raw->'hidden') loop
      if jsonb_typeof(elem)='string' and (elem#>>'{}')=any(allowed) then hidden_list:=hidden_list||(elem#>>'{}'); end if;
    end loop;
  end if;

  normalized_hidden:=private.normalize_location_module_keys(hidden_list, allowed);
  -- hidden wins: drop any shown key that also ended up in the normalized hidden set BEFORE
  -- normalizing shown, so shown/hidden can never both contain the same key in the result.
  select coalesce(array_agg(x), '{}'::text[]) into shown_list from unnest(shown_list) x where not (x = any(normalized_hidden));
  normalized_shown:=private.normalize_location_module_keys(shown_list, allowed);

  if coalesce(array_length(normalized_shown,1),0)=0 and coalesce(array_length(normalized_hidden,1),0)=0 then
    return null;
  end if;
  effective:='{}'::jsonb;
  if coalesce(array_length(normalized_shown,1),0)>0 then effective:=effective||jsonb_build_object('shown',to_jsonb(normalized_shown)); end if;
  if coalesce(array_length(normalized_hidden,1),0)>0 then effective:=effective||jsonb_build_object('hidden',to_jsonb(normalized_hidden)); end if;
  return effective;
end $$;
grant execute on function private.sanitize_imported_module_selection(jsonb, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- update_project_location_module_selection: new project-scoped RPC. Live-call validation is
-- strict (reject, never sanitize) because a violation can only mean a client bug -- see header.
-- ---------------------------------------------------------------------------
create or replace function public.update_project_location_module_selection(
  target_project_id uuid,
  target_location_id uuid,
  expected_revision bigint,
  module_selection jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  p public.projects%rowtype;
  participation public.project_locations%rowtype;
  new_revision bigint;
  selection_key text;
  raw_shown jsonb;
  raw_hidden jsonb;
  elem jsonb;
  shown_list text[] := '{}';
  hidden_list text[] := '{}';
  allowed text[];
  normalized_shown text[];
  normalized_hidden text[];
  overlap text[];
  new_effective jsonb;
  current_location_profile jsonb;
  current_selection jsonb;
  old_effective jsonb;
  new_location_profile jsonb;
  new_metadata jsonb;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then
    return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision);
  end if;

  select * into participation from public.project_locations where id=target_location_id and project_id=target_project_id and removed_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;

  if jsonb_typeof(module_selection) is distinct from 'object' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Module selection must be a JSON object.','revision',p.revision,'changed',false);
  end if;

  for selection_key in select jsonb_object_keys(module_selection) loop
    if selection_key not in ('shown','hidden') then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Module selection may only contain shown/hidden.','revision',p.revision,'changed',false);
    end if;
  end loop;

  raw_shown:=module_selection->'shown';
  raw_hidden:=module_selection->'hidden';
  if raw_shown is not null and jsonb_typeof(raw_shown)<>'array' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','shown must be an array.','revision',p.revision,'changed',false);
  end if;
  if raw_hidden is not null and jsonb_typeof(raw_hidden)<>'array' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','hidden must be an array.','revision',p.revision,'changed',false);
  end if;

  allowed:=private.location_thematic_module_keys();

  for elem in select value from jsonb_array_elements(coalesce(raw_shown,'[]'::jsonb)) loop
    if jsonb_typeof(elem)<>'string' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','shown entries must be strings.','revision',p.revision,'changed',false); end if;
    if not ((elem#>>'{}')=any(allowed)) then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Unknown module key in shown.','revision',p.revision,'changed',false); end if;
    shown_list:=shown_list||(elem#>>'{}');
  end loop;

  for elem in select value from jsonb_array_elements(coalesce(raw_hidden,'[]'::jsonb)) loop
    if jsonb_typeof(elem)<>'string' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','hidden entries must be strings.','revision',p.revision,'changed',false); end if;
    if not ((elem#>>'{}')=any(allowed)) then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Unknown module key in hidden.','revision',p.revision,'changed',false); end if;
    hidden_list:=hidden_list||(elem#>>'{}');
  end loop;

  normalized_shown:=private.normalize_location_module_keys(shown_list, allowed);
  normalized_hidden:=private.normalize_location_module_keys(hidden_list, allowed);

  select array_agg(x) into overlap from unnest(normalized_shown) x where x=any(normalized_hidden);
  if overlap is not null and array_length(overlap,1)>0 then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','A module cannot be both shown and hidden.','revision',p.revision,'changed',false);
  end if;

  new_effective:=null;
  if coalesce(array_length(normalized_shown,1),0)>0 or coalesce(array_length(normalized_hidden,1),0)>0 then
    new_effective:='{}'::jsonb;
    if coalesce(array_length(normalized_shown,1),0)>0 then new_effective:=new_effective||jsonb_build_object('shown',to_jsonb(normalized_shown)); end if;
    if coalesce(array_length(normalized_hidden,1),0)>0 then new_effective:=new_effective||jsonb_build_object('hidden',to_jsonb(normalized_hidden)); end if;
  end if;

  current_location_profile:=coalesce(participation.metadata->'locationProfile','{}'::jsonb);
  current_selection:=current_location_profile->'moduleSelection';
  old_effective:=case when current_selection is null or current_selection='null'::jsonb then null else current_selection end;

  if new_effective is not distinct from old_effective then
    return jsonb_build_object('ok',true,'code','OK','message','Module selection unchanged.','revision',p.revision,'changed',false,'data',jsonb_build_object(
      'id',participation.id,'project_id',participation.project_id,'location_id',participation.location_id,
      'module_selection',coalesce(old_effective,'{}'::jsonb),'updated_at',participation.updated_at
    ));
  end if;

  -- Targeted merge (see header "METADATA NAMESPACE"): never a bare metadata.moduleSelection key,
  -- never a wholesale metadata or locationProfile overwrite. Empty selection removes the
  -- moduleSelection key entirely; an emptied-out locationProfile is removed too.
  new_location_profile:=case when new_effective is null then (current_location_profile - 'moduleSelection') else (current_location_profile || jsonb_build_object('moduleSelection', new_effective)) end;
  new_metadata:=case when new_location_profile='{}'::jsonb then (participation.metadata - 'locationProfile') else jsonb_set(participation.metadata, '{locationProfile}', new_location_profile) end;

  update public.project_locations set metadata=new_metadata where id=target_location_id returning * into participation;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;

  return jsonb_build_object('ok',true,'code','OK','message','Module selection updated.','revision',new_revision,'changed',true,'data',jsonb_build_object(
    'id',participation.id,'project_id',participation.project_id,'location_id',participation.location_id,
    'module_selection',coalesce(new_effective,'{}'::jsonb),'updated_at',participation.updated_at
  ));
end $$;

-- ---------------------------------------------------------------------------
-- list_owned_locations: additive participation_count projection (see header point 4). Owner-scoped
-- correlated subquery -- safe under RLS/ownership by construction: private.enforce_project_
-- location_owner() (Foundation schema) already guarantees a project_locations row can only exist
-- where the participation's project and its canonical location share the same owner_id, so a
-- location this caller owns can only ever have project_locations rows in projects this same
-- caller also owns. Every previously existing projected key is preserved byte-for-byte via `||`.
-- ---------------------------------------------------------------------------
create or replace function public.list_owned_locations()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select case when (select auth.uid()) is null
  then jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false)
  else jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((
    select jsonb_agg(to_jsonb(l) || jsonb_build_object('participation_count',(
      select count(*) from public.project_locations pl where pl.location_id=l.id and pl.removed_at is null
    )) order by lower(l.name),l.id)
    from public.locations l where l.owner_id=(select auth.uid()) and l.deleted_at is null
  ),'[]'::jsonb)) end $$;

-- ---------------------------------------------------------------------------
-- import_local_project_content: identical body to the base_profile-modules version, except the
-- per-location loop now ALSO reads an optional `module_selection` field per payload item, sanitizes
-- it via private.sanitize_imported_module_selection, and merges it into that location's new
-- project_locations.metadata at the same namespaced path the live RPC uses -- never a bare
-- metadata.moduleSelection key, and never clobbering whatever the payload's own `metadata` field
-- already carried for that location. A payload with no `module_selection` field at all (every
-- snapshot before this ships) behaves identically to an empty selection.
-- ---------------------------------------------------------------------------
create or replace function public.import_local_project_content(target_project_id uuid,expected_revision bigint,migration_attempt_id uuid,source_project_id text,import_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p public.projects%rowtype; prior public.local_project_import_attempts%rowtype; item jsonb; owner uuid; previous_revision bigint; new_revision bigint; result jsonb; created jsonb; loc_item jsonb; new_canonical_id uuid; safe_location_base_profile jsonb; module_key text; module_value jsonb; safe_module_selection jsonb; safe_participation_metadata jsonb;
begin
  owner=(select auth.uid());
  if owner is null then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  if target_project_id is null or expected_revision is null or migration_attempt_id is null or nullif(btrim(source_project_id),'') is null or not private.local_import_payload_valid(target_project_id,import_payload) or import_payload->>'source_project_id'<>source_project_id or import_payload->>'migration_attempt_id'<>migration_attempt_id::text then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  select * into prior from public.local_project_import_attempts where id=migration_attempt_id;
  if found then
    if prior.owner_id=owner and prior.project_id=target_project_id and prior.source_project_id=source_project_id and prior.payload_fingerprint=md5(import_payload::text) then return prior.result; end if;
    return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN');
  end if;
  select * into p from public.projects where id=target_project_id and deleted_at is null for update;
  if not found or p.owner_id<>owner then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  previous_revision=p.revision;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if not private.local_import_target_empty(target_project_id) then return jsonb_build_object('ok',false,'code','TARGET_NOT_EMPTY'); end if;
  if exists(select 1 from jsonb_array_elements(import_payload->'character_images') i where split_part(i->>'storage_path','/',1)<>owner::text or split_part(i->>'storage_path','/',2)<>'characters' or split_part(i->>'storage_path','/',3)<>i->>'character_id' or split_part(i->>'storage_path','/',4)<>i->>'id') then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  if exists(select 1 from (select i->>'character_id' character_id,i->>'project_character_id' project_character_id,count(*) from jsonb_array_elements(import_payload->'character_images') i where coalesce((i->>'is_primary')::boolean,false) group by 1,2 having count(*)>1) duplicates) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  if exists(select 1 from jsonb_array_elements(import_payload->'character_images') i join public.character_images current_image on current_image.character_id=(i->>'character_id')::uuid and current_image.project_character_id is null and current_image.is_primary and current_image.deleted_at is null where i->>'project_character_id' is null and coalesce((i->>'is_primary')::boolean,false)) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;

  -- Identity creation and project attachment share this transaction with content.
  for item in select value from jsonb_array_elements(import_payload->'characters') loop
    if item->>'action'='CREATE_NEW_GLOBAL_IDENTITY' then
      insert into public.characters(id,owner_id,name,surname,base_profile,metadata)
      values((item->>'id')::uuid,owner,item->>'name',coalesce(item->>'surname',''),coalesce(item->'base_profile','{}'),coalesce(item->'metadata','{}'));
    elsif item->>'action'='MAP_TO_EXISTING_CHARACTER' then
      if not exists(select 1 from public.characters c where c.id=(item->>'id')::uuid and c.owner_id=owner and c.deleted_at is null) then raise exception 'INVALID_MIGRATION_PLAN' using errcode='22023'; end if;
    else raise exception 'INVALID_MIGRATION_PLAN' using errcode='22023';
    end if;
    insert into public.project_characters(id,project_id,character_id,overrides,role,sort_order,metadata)
    values((item->>'project_character_id')::uuid,target_project_id,(item->>'id')::uuid,coalesce(item->'overrides','{}'),item->>'role',coalesce((item->>'sort_order')::numeric,0),'{}');
  end loop;

  insert into public.chapters(id,project_id,title,position,metadata) select x.id,target_project_id,x.title,x.position,coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'chapters') as x(id uuid,title text,position numeric,metadata jsonb);

  -- One writable-CTE statement does NOT work here: all of a single WITH's sub-statements share
  -- one snapshot, so the RLS policy gating this INSERT (private.location_owned, a plain SELECT
  -- against public.locations) cannot see a canonical row inserted by a sibling CTE in the same
  -- statement, regardless of statement ordering -- this function is SECURITY INVOKER and RLS is
  -- enforced. Loop with two separate statements per row instead, mirroring the
  -- CREATE_NEW_GLOBAL_IDENTITY + project_characters loop just above: each statement is its own
  -- command with a fresh snapshot, so the second INSERT correctly sees the first's row.
  for loc_item in select value from jsonb_array_elements(import_payload->'locations') loop
    -- description is always taken (unchanged); shortSummary only if genuinely non-blank; each
    -- base_profile module key only if it is on the allowlist AND a non-empty JSON object --
    -- anything else (unknown key, wrong type, empty object, or `base_profile` missing/not an
    -- object at all, which is every pre-B2 local snapshot) is silently dropped, never rejected.
    safe_location_base_profile:=jsonb_build_object('description',coalesce(loc_item->>'description',''));
    if nullif(btrim(coalesce(loc_item->>'short_summary','')),'') is not null then
      safe_location_base_profile:=safe_location_base_profile || jsonb_build_object('shortSummary',btrim(loc_item->>'short_summary'));
    end if;
    if jsonb_typeof(loc_item->'base_profile')='object' then
      for module_key in select jsonb_object_keys(loc_item->'base_profile') loop
        module_value:=loc_item->'base_profile'->module_key;
        if module_key=any(private.location_thematic_module_keys()) and jsonb_typeof(module_value)='object' and module_value<>'{}'::jsonb then
          safe_location_base_profile:=safe_location_base_profile || jsonb_build_object(module_key,module_value);
        end if;
      end loop;
    end if;

    insert into public.locations(id,owner_id,name,base_profile)
    values (gen_random_uuid(), owner, loc_item->>'name', safe_location_base_profile)
    returning id into new_canonical_id;

    -- Adaptive Module Selection (Phase 1): optional per-location `module_selection` field, e.g.
    -- {"shown":["appearanceAtmosphere"],"hidden":["geography"]} -- the local flat shape a local
    -- Location object carries (location.moduleSelection, contract addendum §9). Sanitized through
    -- the SAME allowlist as base_profile module data; anything invalid/unknown/malformed is
    -- silently dropped, never rejected (an import must degrade safely across every local schema
    -- generation, including every snapshot taken before this field existed). Merged into whatever
    -- this location's own `metadata` payload field already carried -- never a bare root key, never
    -- clobbering an existing locationProfile object that field might one day also carry.
    safe_module_selection:=private.sanitize_imported_module_selection(loc_item->'module_selection', private.location_thematic_module_keys());
    safe_participation_metadata:=loc_item->'metadata';
    if jsonb_typeof(safe_participation_metadata) is distinct from 'object' then safe_participation_metadata:='{}'::jsonb; end if;
    if safe_module_selection is not null then
      safe_participation_metadata:=jsonb_set(safe_participation_metadata,'{locationProfile}', coalesce(safe_participation_metadata->'locationProfile','{}'::jsonb) || jsonb_build_object('moduleSelection', safe_module_selection));
    end if;

    insert into public.project_locations(id,project_id,location_id,overrides,metadata)
    values ((loc_item->>'id')::uuid, target_project_id, new_canonical_id, '{}'::jsonb, safe_participation_metadata);
  end loop;

  insert into public.tags(id,project_id,name,normalized_name) select x.id,target_project_id,x.name,x.normalized_name from jsonb_to_recordset(import_payload->'tags') as x(id uuid,name text,normalized_name text);
  insert into public.scenes(id,project_id,chapter_id,location_id,title,scene_text,scene_date,scene_time,placement_status,writing_status,included,date_review,position,metadata)
    select x.id,target_project_id,x.chapter_id,x.location_id,coalesce(x.title,''),coalesce(x.scene_text,''),x.scene_date,x.scene_time,x.placement_status,x.writing_status,coalesce(x.included,true),coalesce(x.date_review,false),x.position,coalesce(x.metadata,'{}')
    from jsonb_to_recordset(import_payload->'scenes') as x(id uuid,chapter_id uuid,location_id uuid,title text,scene_text text,scene_date date,scene_time time,placement_status text,writing_status text,included boolean,date_review boolean,position numeric,metadata jsonb);
  insert into public.scene_tags(project_id,scene_id,tag_id) select target_project_id,x.scene_id,x.tag_id from jsonb_to_recordset(import_payload->'scene_tags') as x(scene_id uuid,tag_id uuid);
  insert into public.scene_characters(project_id,scene_id,project_character_id,action,legacy_state,sort_order) select target_project_id,x.scene_id,x.project_character_id,coalesce(x.action,''),x.legacy_state,coalesce(x.sort_order,0) from jsonb_to_recordset(import_payload->'scene_characters') as x(scene_id uuid,project_character_id uuid,action text,legacy_state text,sort_order numeric);
  insert into public.project_character_relations(project_id,from_project_character_id,to_project_character_id,value_operation,value,visible,metadata) select target_project_id,x.from_project_character_id,x.to_project_character_id,x.value_operation,x.value,x.visible,coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'initial_relations') as x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  insert into public.scene_relation_changes(project_id,scene_id,from_project_character_id,to_project_character_id,value_operation,value,visible,metadata) select target_project_id,x.scene_id,x.from_project_character_id,x.to_project_character_id,x.value_operation,x.value,x.visible,coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'scene_relation_changes') as x(scene_id uuid,from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  insert into public.character_links(id,owner_id,project_id,from_character_id,to_character_id,category,type,reverse_type,custom_label,reverse_custom_label,notes,structure_kind,metadata)
    select x.id,owner,x.project_id,x.from_character_id,x.to_character_id,x.category,x.type,x.reverse_type,x.custom_label,x.reverse_custom_label,coalesce(x.notes,''),coalesce(x.structure_kind,'other'),coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'structural_links') as x(id uuid,project_id uuid,from_character_id uuid,to_character_id uuid,category text,type text,reverse_type text,custom_label text,reverse_custom_label text,notes text,structure_kind text,metadata jsonb);
  insert into public.character_images(id,character_id,project_character_id,storage_path,mime_type,crop,alt,caption,sort_order,is_primary,metadata)
    select x.id,x.character_id,x.project_character_id,x.storage_path,x.mime_type,coalesce(x.crop,'{}'),coalesce(x.alt,''),coalesce(x.caption,''),coalesce(x.sort_order,0),coalesce(x.is_primary,false),coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'character_images') as x(id uuid,character_id uuid,project_character_id uuid,storage_path text,mime_type text,crop jsonb,alt text,caption text,sort_order numeric,is_primary boolean,metadata jsonb);

  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  created=jsonb_build_object('characters',(select count(*) from jsonb_array_elements(import_payload->'characters') x where x->>'action'='CREATE_NEW_GLOBAL_IDENTITY'),'projectCharacters',jsonb_array_length(import_payload->'characters'),'chapters',jsonb_array_length(import_payload->'chapters'),'locations',jsonb_array_length(import_payload->'locations'),'tags',jsonb_array_length(import_payload->'tags'),'scenes',jsonb_array_length(import_payload->'scenes'),'sceneTags',jsonb_array_length(import_payload->'scene_tags'),'sceneCharacters',jsonb_array_length(import_payload->'scene_characters'),'relations',jsonb_array_length(import_payload->'initial_relations'),'relationChanges',jsonb_array_length(import_payload->'scene_relation_changes'),'structuralLinks',jsonb_array_length(import_payload->'structural_links'),'characterImages',jsonb_array_length(import_payload->'character_images'));
  result=jsonb_build_object('ok',true,'code','OK','migrationAttemptId',migration_attempt_id,'sourceProjectId',source_project_id,'targetProjectId',target_project_id,'previousRevision',previous_revision,'revision',new_revision,'created',created);
  insert into public.local_project_import_attempts(id,owner_id,project_id,source_project_id,payload_fingerprint,result) values(migration_attempt_id,owner,target_project_id,source_project_id,md5(import_payload::text),result);
  return result;
end $$;
