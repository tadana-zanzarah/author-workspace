-- Location Architecture V2 -- generic, extensible base_profile thematic-module contract.
--
-- CONTEXT: Location Phase B3A ("Appearance & Atmosphere" + "Geography") needs a write path for
-- new base_profile module keys (base_profile.appearanceAtmosphere, base_profile.geography).
-- update_location_canonical (20260904120000_location_phase3_core_identity.sql) only ever writes
-- two hardcoded top-level base_profile keys -- description and shortSummary -- via
-- `item.base_profile || jsonb_build_object('description',...,'shortSummary',...)`. There is no
-- parameter through which any other key could reach that merge, and the merge operator (`||`)
-- can only add/overwrite a key, never delete one. This migration closes both gaps with the
-- SMALLEST safe, forward-extensible contract -- explicitly NOT one new named SQL parameter per
-- module (that would make the function signature grow without bound as
-- populationCulture/governmentSociety/economy/historyNotes/custom are added later).
--
-- DESIGN: one new trailing parameter, `location_base_profile_patch jsonb default null`, plus a
-- server-side allowlist of thematic module keys (kept in one place: the new
-- private.location_thematic_module_keys() helper, currently ['appearanceAtmosphere','geography']
-- -- extending to a future module is a one-line change to that single array literal, no RPC
-- signature change). "Generic" here means "one parameter can carry any number of allowlisted
-- module keys in one call," NOT "arbitrary uncontrolled JSONB mutation": description/shortSummary
-- stay controlled by their existing named parameters and are explicitly reserved -- a patch that
-- tries to touch either is rejected, never silently applied.
--
-- THREE-STATE PATCH CONTRACT (documented once here, enforced in update_location_canonical below):
--   location_base_profile_patch = SQL NULL          -> no thematic module changes this call.
--   patch key ABSENT                                -> that module left untouched.
--   patch key present, value JSON null               -> that module key is DELETED from
--                                                        base_profile (not stored as JSON null).
--   patch key present, value = {} (empty object)     -> ALSO normalizes to deletion, so editing a
--                                                        module down to zero meaningful fields
--                                                        never leaves a meaningless empty object
--                                                        behind (see AGENTS.md-adjacent B3A "clean
--                                                        JSON" guidance in the task brief).
--   patch key present, value = a non-empty JSON object -> that module's stored value is REPLACED
--                                                        wholesale with the supplied object (the
--                                                        frontend always sends the module's full
--                                                        current state, never a nested partial
--                                                        patch -- this is a one-level patch, by
--                                                        design; no recursive merge engine).
--   patch key present, value neither an object, {}, nor null -> VALIDATION_ERROR (case J).
--   patch key not in the allowlist                    -> VALIDATION_ERROR (case H).
--   patch key = 'description' or 'shortSummary'        -> VALIDATION_ERROR (case G, reserved).
--   location_base_profile_patch itself not a JSON object (array/string/number/bool) -> VALIDATION_
--                                                        ERROR (case I).
-- All patch validation happens BEFORE any field is computed for the UPDATE statement, so an
-- invalid patch never partially applies (mirrors every other VALIDATION_ERROR early-return in this
-- RPC).
--
-- OPERATION ORDER (per call): (1) load+lock row, check location_revision: (2) validate
-- name/official_name/type_preset/custom_type_label as before; (3) validate the thematic patch
-- shape (if not NULL) against the allowlist and reserved keys; (4) compute
-- merged_base_profile = item.base_profile || {description, shortSummary} (unchanged Phase 3
-- behavior -- description/shortSummary are ALWAYS explicitly set from the two named parameters,
-- exactly as before this migration); (5) apply the thematic patch on TOP of that, one module key
-- at a time (delete-or-replace, per the three-state contract above); (6) no-op detection compares
-- the fully computed merged_base_profile (and other columns) against the current row -- a save
-- that changes nothing (core fields AND thematic modules) still correctly reports changed:false
-- without bumping location_revision, exactly like the pre-existing Phase 3 no-op path did for
-- description/shortSummary alone.
--
-- WHY A SIGNATURE EXTENSION, NOT A NEW RPC NAME -- AND WHY IT NEEDS AN EXPLICIT DROP FIRST:
-- unlike the Phase 3 migration's decision to add create_location_canonical/update_location_
-- canonical as NEW distinct names next to the legacy create_location/update_location (to avoid
-- PostgREST overload-resolution ambiguity between TWO different functions sharing a name), the
-- intent here is a single function `update_location_canonical` with one new trailing DEFAULT
-- parameter -- NOT a second overload. That intent is NOT achieved by `CREATE OR REPLACE FUNCTION`
-- alone: Postgres identifies a function by (name, parameter TYPE list), and appending a parameter
-- -- even one with a DEFAULT -- changes that type list, so `CREATE OR REPLACE` does not replace
-- the existing 9-argument function at all; it silently CREATES A SECOND, DISTINCT 10-argument
-- overload beside it. This was caught for real by disposable CI on the first version of this
-- migration (not caught by static review): supabase/tests/location_phase3_core_identity.sql's own
-- positional 9-argument calls to update_location_canonical started failing with
-- "function public.update_location_canonical(uuid, bigint, unknown, ...) is not unique" --
-- because with the 10th parameter defaulted, a 9-argument call now matches BOTH the untouched old
-- function and the new one. The fix (below, immediately before the CREATE OR REPLACE) is an
-- explicit `DROP FUNCTION public.update_location_canonical(<the exact old 9-argument type list>)`
-- first, so exactly one function named update_location_canonical exists afterward -- a genuine
-- replacement, not an overload. PostgREST then resolves every RPC call unambiguously against that
-- one function by matching the JSON body's keys to its parameter names, so every already-published
-- B2 caller (whose JSON body never contains location_base_profile_patch) simply gets the new
-- parameter's NULL default and behaves exactly as before. Proven in
-- supabase/tests/location_base_profile_modules.sql Block A (legacy-shaped call, byte-for-byte) and
-- Block D (mixed core-identity + thematic edits in the same call), and by
-- location_phase3_core_identity.sql's pre-existing Block C/D positional calls continuing to pass
-- unmodified after this migration.
--
-- import_local_project_content (local -> cloud migration): the per-location insert previously
-- hardcoded base_profile to `jsonb_build_object('description', ...)` only -- it silently dropped
-- shortSummary (a live B2 bug, confirmed here) and would have dropped any B3A module data too.
-- Fixed to read two new optional payload fields per location item -- `short_summary` (text) and
-- `base_profile` (jsonb, the local Location's already-mirrored baseProfile object) -- and build the
-- canonical row's base_profile the same "smallest safe" way: description is always taken from the
-- existing `description` field (unchanged), shortSummary is included only if non-blank, and each
-- key of the incoming `base_profile` object is included ONLY if it passes the exact same
-- allowlist+shape check as the live-edit RPC (private.location_thematic_module_keys(), value must
-- be a non-empty JSON object). Anything else -- an unknown key, a non-object value, an empty
-- module object, or `base_profile` missing/not an object entirely (every pre-B2 local snapshot) --
-- is silently DROPPED, not rejected: import must degrade safely across every local schema
-- generation (pre-B2 description-only, B2 description+shortSummary, B3A
-- description+shortSummary+modules) without ever trusting an arbitrary key from untrusted
-- localStorage input into a global-identity row. This is a pure function-body change on an
-- existing function name (no new columns, no backfill of the 21 existing production canonical
-- Location rows -- see NO DATA BACKFILL below).
--
-- NO DATA BACKFILL: this migration adds/replaces function bodies only. It does not ALTER any
-- column, does not UPDATE any existing row, and does not touch RLS policies or grants beyond the
-- one new private helper's own grant (mirroring private.normalize_location_aliases's existing
-- pattern). The 21 existing production public.locations rows and their 21 public.project_locations
-- participation rows are structurally untouched by applying this migration.
--
-- ---------------------------------------------------------------------------
-- Shared allowlist: the ONLY place thematic module names are enumerated. Extending B3A's two
-- modules (appearanceAtmosphere, geography) to a future module (populationCulture,
-- governmentSociety, economy, historyNotes, custom, ...) is a one-line change here -- no RPC
-- signature change, no new migration touching update_location_canonical's parameter list.
-- Deliberately NOT pre-populated with the full future module list from the task brief: an
-- allowlisted key with no frontend/shape behind it yet is an unvalidated write surface with no
-- product behind it, so only the two modules this phase actually ships are allowed for now.
-- ---------------------------------------------------------------------------
create or replace function private.location_thematic_module_keys()
returns text[] language sql immutable security invoker set search_path = ''
as $$ select array['appearanceAtmosphere','geography'] $$;
grant execute on function private.location_thematic_module_keys() to authenticated;

-- ---------------------------------------------------------------------------
-- Explicit drop of the EXACT old 9-argument signature (see "WHY A SIGNATURE EXTENSION..." above)
-- -- required so the CREATE OR REPLACE just below genuinely replaces this function instead of
-- creating a second, ambiguous 10-argument overload beside it. No CASCADE: nothing in this schema
-- has a dependency on update_location_canonical's signature itself (RPCs are called by name via
-- PostgREST, not referenced from other function bodies/views/triggers), so a plain DROP is safe.
-- ---------------------------------------------------------------------------
drop function if exists public.update_location_canonical(uuid,bigint,text,text,text[],text,text,text,text);

-- ---------------------------------------------------------------------------
-- update_location_canonical: Phase 3 body, unchanged in every existing branch, plus the new
-- trailing location_base_profile_patch parameter and its validate-then-apply logic (see header).
-- ---------------------------------------------------------------------------
create or replace function public.update_location_canonical(
  target_location_id uuid,
  expected_location_revision bigint,
  location_name text,
  location_official_name text default null,
  location_aliases text[] default '{}',
  location_type_preset text default null,
  location_custom_type_label text default null,
  location_description text default '',
  location_short_summary text default null,
  location_base_profile_patch jsonb default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.locations%rowtype;
  trimmed_name text;
  safe_official_name text;
  safe_type_preset text;
  safe_custom_label text;
  safe_description text;
  safe_short_summary text;
  normalized_aliases text[];
  merged_base_profile jsonb;
  patch_key text;
  patch_value jsonb;
begin
  select * into item from public.locations where id=target_location_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','changed',false); end if;
  if item.revision<>expected_location_revision then
    return jsonb_build_object('ok',false,'code','LOCATION_REVISION_CONFLICT','message','Location changed in another session. Reload before saving.','entityId',target_location_id,'expectedRevision',expected_location_revision,'actualRevision',item.revision,'changed',false);
  end if;

  trimmed_name:=btrim(coalesce(location_name,''));
  if char_length(trimmed_name) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','locationRevision',item.revision,'changed',false); end if;

  safe_official_name:=nullif(btrim(coalesce(location_official_name,'')),'');
  if safe_official_name is not null and char_length(safe_official_name)>300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Official name is too long.','locationRevision',item.revision,'changed',false); end if;

  safe_type_preset:=nullif(btrim(coalesce(location_type_preset,'')),'');
  if safe_type_preset is not null and char_length(safe_type_preset)>60 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location type is invalid.','locationRevision',item.revision,'changed',false); end if;

  safe_custom_label:=nullif(btrim(coalesce(location_custom_type_label,'')),'');
  if safe_custom_label is not null and char_length(safe_custom_label)>300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Custom type label is too long.','locationRevision',item.revision,'changed',false); end if;

  -- Thematic module patch: validate the WHOLE patch before computing/applying anything (mirrors
  -- every other VALIDATION_ERROR early-return above -- an invalid patch must never partially
  -- apply). See migration header for the full three-state contract.
  if location_base_profile_patch is not null then
    if jsonb_typeof(location_base_profile_patch)<>'object' then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Base profile patch must be a JSON object.','locationRevision',item.revision,'changed',false);
    end if;
    for patch_key in select jsonb_object_keys(location_base_profile_patch) loop
      if patch_key in ('description','shortSummary') then
        return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Base profile patch cannot modify reserved core-identity keys.','locationRevision',item.revision,'changed',false);
      end if;
      if not (patch_key=any(private.location_thematic_module_keys())) then
        return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Unknown thematic module key.','locationRevision',item.revision,'changed',false);
      end if;
      patch_value:=location_base_profile_patch->patch_key;
      if patch_value<>'null'::jsonb and jsonb_typeof(patch_value)<>'object' then
        return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Thematic module value must be a JSON object.','locationRevision',item.revision,'changed',false);
      end if;
    end loop;
  end if;

  normalized_aliases:=private.normalize_location_aliases(location_aliases);
  safe_description:=coalesce(location_description,'');
  safe_short_summary:=coalesce(location_short_summary,'');
  merged_base_profile:=item.base_profile || jsonb_build_object('description',safe_description,'shortSummary',safe_short_summary);

  -- Apply the thematic patch on top: JSON null or an empty object BOTH normalize to "delete this
  -- module key" (no meaningless empty-module clutter accumulates in base_profile -- editing a
  -- module down to zero fields removes it entirely rather than storing {}); any other JSON object
  -- fully replaces that module's stored value. A key simply absent from the patch is never
  -- touched, because merged_base_profile started from item.base_profile -- the only write path for
  -- module data is this loop, so an omitted key survives by construction.
  if location_base_profile_patch is not null then
    for patch_key in select jsonb_object_keys(location_base_profile_patch) loop
      patch_value:=location_base_profile_patch->patch_key;
      if patch_value='null'::jsonb or patch_value='{}'::jsonb then
        merged_base_profile:=merged_base_profile - patch_key;
      else
        merged_base_profile:=merged_base_profile || jsonb_build_object(patch_key,patch_value);
      end if;
    end loop;
  end if;

  if item.name=trimmed_name and item.official_name is not distinct from safe_official_name and item.aliases=normalized_aliases
     and item.type_preset is not distinct from safe_type_preset and item.custom_type_label is not distinct from safe_custom_label
     and item.base_profile=merged_base_profile then
    return jsonb_build_object('ok',true,'code','OK','message','Location unchanged.','locationRevision',item.revision,'changed',false,'data',jsonb_build_object(
      'location_id',item.id,'name',item.name,'official_name',item.official_name,'aliases',item.aliases,
      'parent_id',item.parent_id,'type_preset',item.type_preset,'custom_type_label',item.custom_type_label,
      'base_profile',item.base_profile,'location_revision',item.revision,'description',coalesce(item.base_profile->>'description',''),'updated_at',item.updated_at
    ));
  end if;

  update public.locations set
    name=trimmed_name,official_name=safe_official_name,aliases=normalized_aliases,
    type_preset=safe_type_preset,custom_type_label=safe_custom_label,base_profile=merged_base_profile,
    revision=revision+1
  where id=target_location_id returning * into item;

  return jsonb_build_object('ok',true,'code','OK','message','Location updated.','locationRevision',item.revision,'changed',true,'data',jsonb_build_object(
    'location_id',item.id,'name',item.name,'official_name',item.official_name,'aliases',item.aliases,
    'parent_id',item.parent_id,'type_preset',item.type_preset,'custom_type_label',item.custom_type_label,
    'base_profile',item.base_profile,'location_revision',item.revision,'description',coalesce(item.base_profile->>'description',''),'updated_at',item.updated_at
  ));
end $$;

-- ---------------------------------------------------------------------------
-- import_local_project_content: identical body to the Phase 2 cutover version, except the
-- per-location loop now also reads `short_summary`/`base_profile` off each payload item (both
-- optional, both absent-safe for every older local snapshot shape) and sanitizes `base_profile`
-- through the SAME allowlist as update_location_canonical before writing it -- see migration
-- header "IMPORT SANITIZATION". Unrecognized/malformed thematic data is silently dropped, never
-- rejected (an import must degrade safely across old local schema generations) and never trusted
-- verbatim (a local snapshot is untrusted shape, not a validated RPC payload).
-- ---------------------------------------------------------------------------
create or replace function public.import_local_project_content(target_project_id uuid,expected_revision bigint,migration_attempt_id uuid,source_project_id text,import_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p public.projects%rowtype; prior public.local_project_import_attempts%rowtype; item jsonb; owner uuid; previous_revision bigint; new_revision bigint; result jsonb; created jsonb; loc_item jsonb; new_canonical_id uuid; safe_location_base_profile jsonb; module_key text; module_value jsonb;
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

    insert into public.project_locations(id,project_id,location_id,overrides,metadata)
    values ((loc_item->>'id')::uuid, target_project_id, new_canonical_id, '{}'::jsonb, coalesce(loc_item->'metadata','{}'::jsonb));
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
