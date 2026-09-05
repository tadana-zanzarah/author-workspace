-- Location History H-events: location_history_events backend foundation.
--
-- CONTEXT: "LOCATION HISTORY -- HYBRID IMPLEMENTATION" (accepted, following the Location History
-- product/architecture audit). Ships the STRUCTURED half of History: a new canonical-only child
-- table, RLS, a minimal list/create/update/delete RPC surface mirroring the proven location_media
-- contract (20260907090000_location_media_foundation.sql) with the scope simplified to
-- canonical-only (no project_location_id branch at all -- product decision, not deferred-for-later:
-- "History Events are CANONICAL-ONLY in this phase", "Do NOT implement: project_location_id on
-- location_history_events"), and the local->cloud import wiring so events created locally survive
-- migration into this table.
--
-- REJECTED BY EXPLICIT PRODUCT DECISION (do not reintroduce any of these without a new decision):
-- sort_key, project_location_id / project-specific events, a second visibility system for events
-- (module hiding hides the whole History section, prose AND events together -- enforced entirely in
-- js/location-module-selection.js's locationModuleHasData, not here), event_type taxonomy,
-- event-specific media, Scene/Character/Location relations, temporal Location snapshots, automatic
-- chronology parsing of date_label, Gregorian date enforcement (date_label is free-form display text,
-- see the column comment below; ordering is sort_order only, exactly like location_media/chapters).
--
-- REVISION DOMAIN (mirrors location_media's own established split exactly, substituting
-- location_history_events for location_media -- see that migration's header for the original
-- character_images precedent this both descend from):
--   - CREATE: gates on AND bumps locations.revision (a new event changes the Location's event SET).
--   - UPDATE: gates on AND bumps ONLY the event row's OWN revision -- locations.revision is
--     untouched, so editing one event's title/date_label/description/sort_order never spuriously
--     conflicts with, or shows up as, an unrelated Location profile edit.
--   - DELETE: gates on the event row's OWN revision, but ALSO bumps locations.revision as a side
--     effect (soft-deleting an event changes the event SET, same as CREATE's set-membership change).
-- No client-invented revision increments anywhere in this contract; every RPC threads the real
-- returned revision back to the caller.
--
-- AMBIGUOUS-COLUMN AVOIDANCE: create_location_media hit a real disposable-CI failure ("column
-- reference \"location_id\" is ambiguous ... could refer to either a PL/pgSQL variable or a table
-- column", fixed in 20260901120000_fix_character_image_update_delete_p_ambiguity.sql's sibling and
-- documented in the Media migration itself) because its RPC parameters were named identically to
-- table columns. Every parameter here is instead prefixed (target_*/event_*) so no parameter name
-- can ever collide with a location_history_events column -- and every UPDATE/DELETE statement below
-- still aliases its target table explicitly as defense-in-depth, per the task brief's explicit
-- instruction, even though the naming choice alone already prevents the ambiguity class.
--
-- SECURITY: every function here is SECURITY INVOKER (RLS-enforced), like every other Location RPC.
-- No SECURITY DEFINER is introduced -- nothing in this schema needs to see across an ownership
-- boundary that RLS (private.location_owned, already proven by location_media) doesn't already grant.
--
-- NO CHANGE to private.local_import_payload_valid's top-level payload-shape check: this migration
-- deliberately nests each location's history events INSIDE that location's own payload object
-- (loc_item->'history_events'), not as a new top-level import_payload key -- the canonical
-- location_id a history event needs is only known AFTER import_local_project_content generates it
-- server-side (gen_random_uuid(), same as every other canonical Location), so nesting the events
-- under their own location's payload entry is the only shape that lets the per-location loop insert
-- them immediately after that location's own canonical row, with zero pre-known cross-reference.

-- ---------------------------------------------------------------------------
-- Step 1: location_history_events table. Minimal columns only -- see header for what was
-- deliberately rejected. date_label is free-form author text (e.g. "около 1240 года", "за три века
-- до войны", "" , "неизвестно"), never parsed by any function in this migration to determine order;
-- sort_order is the ONLY thing that determines display order, author-controlled, exactly like
-- chapters.position / location_media.sort_order.
-- ---------------------------------------------------------------------------
create table public.location_history_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  title text not null,
  date_label text not null default '',
  description text not null default '',
  sort_order numeric(20,10) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint location_history_events_title_not_blank check (char_length(btrim(title)) > 0),
  constraint location_history_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint location_history_events_revision_nonnegative check (revision >= 0)
);
comment on column public.location_history_events.date_label is
  'Free-form author-entered display text (e.g. "около 1240 года", "за три века до войны", "", or "неизвестно"). Never parsed to determine order -- see sort_order.';

create index location_history_events_location_idx on public.location_history_events(location_id) where deleted_at is null;
create index location_history_events_order_idx on public.location_history_events(location_id, sort_order, id) where deleted_at is null;

create trigger location_history_events_touch before update on public.location_history_events for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Step 2: RLS. private.location_owned(location_id) is sufficient (canonical-only, no project scope
-- branch to reason about at all -- unlike location_media/character_images).
-- ---------------------------------------------------------------------------
alter table public.location_history_events enable row level security;
revoke all on table public.location_history_events from public, anon, authenticated;
grant select, insert, update, delete on table public.location_history_events to authenticated;

create policy location_history_events_select on public.location_history_events for select to authenticated using (private.location_owned(location_id));
create policy location_history_events_insert on public.location_history_events for insert to authenticated with check (private.location_owned(location_id));
create policy location_history_events_update on public.location_history_events for update to authenticated using (private.location_owned(location_id)) with check (private.location_owned(location_id));
create policy location_history_events_delete on public.location_history_events for delete to authenticated using (private.location_owned(location_id));

-- ---------------------------------------------------------------------------
-- Step 3: list_location_history_events -- full active event set for ONE canonical Location (Profile
-- lazy-load, mirrors list_location_media exactly).
-- ---------------------------------------------------------------------------
create or replace function public.list_location_history_events(target_location_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.location_owned(target_location_id) then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  return jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((
    select jsonb_agg(to_jsonb(e) order by e.sort_order,e.id)
    from public.location_history_events e
    where e.location_id=target_location_id and e.deleted_at is null
  ),'[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Step 4: create_location_history_event. event_id is client/import-supplied (same idempotency-key
-- idiom create_location_media established: the id itself is the retry key, a row with that id
-- already existing and matching location_id is treated as an already-applied replay, not a
-- DUPLICATE). Gates on locations.revision (see header REVISION DOMAIN); bumps it exactly once on a
-- real create.
-- ---------------------------------------------------------------------------
create or replace function public.create_location_history_event(
  event_id uuid,
  target_location_id uuid,
  event_title text,
  event_date_label text,
  event_description text,
  event_sort_order numeric,
  event_metadata jsonb,
  expected_revision bigint
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  loc public.locations%rowtype;
  item public.location_history_events%rowtype;
  new_location_revision bigint;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','changed',false); end if;
  if nullif(btrim(coalesce(event_title,'')),'') is null then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Title is required.','changed',false);
  end if;
  if jsonb_typeof(coalesce(event_metadata,'{}'::jsonb))<>'object' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Invalid metadata.','changed',false);
  end if;

  select * into item from public.location_history_events e0 where e0.id=create_location_history_event.event_id;
  if found then
    return case when item.location_id=create_location_history_event.target_location_id
      then jsonb_build_object('ok',true,'code','OK','changed',false,'eventRevision',item.revision,'data',to_jsonb(item))
      else jsonb_build_object('ok',false,'code','DUPLICATE','changed',false) end;
  end if;

  select * into loc from public.locations l0 where l0.id=create_location_history_event.target_location_id and l0.owner_id=(select auth.uid()) and l0.deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','changed',false); end if;
  if loc.revision<>expected_revision then
    return jsonb_build_object('ok',false,'code','LOCATION_REVISION_CONFLICT','message','Location changed in another session. Reload before saving.','expectedRevision',expected_revision,'actualRevision',loc.revision,'changed',false);
  end if;

  insert into public.location_history_events(id,location_id,title,date_label,description,sort_order,metadata)
  values(create_location_history_event.event_id,create_location_history_event.target_location_id,btrim(event_title),coalesce(event_date_label,''),coalesce(event_description,''),coalesce(event_sort_order,0),coalesce(event_metadata,'{}'))
  returning * into item;

  update public.locations set revision=revision+1,updated_at=now() where id=create_location_history_event.target_location_id returning revision into new_location_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Event created.','changed',true,'locationRevision',new_location_revision,'eventRevision',item.revision,'data',to_jsonb(item));
end $$;

-- ---------------------------------------------------------------------------
-- Step 5: update_location_history_event. Gates on/bumps ONLY the event's own revision -- never
-- locations.revision (see header REVISION DOMAIN). Semantic no-op (every provided field, or every
-- omitted field's current value, already matches) reports changed:false and does not bump anything,
-- mirroring update_location_media's own no-op contract.
-- ---------------------------------------------------------------------------
create or replace function public.update_location_history_event(
  target_event_id uuid,
  expected_revision bigint,
  event_title text default null,
  event_date_label text default null,
  event_description text default null,
  event_sort_order numeric default null,
  event_metadata jsonb default null
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item public.location_history_events%rowtype;
  wanted jsonb;
  current_value jsonb;
  final_title text;
begin
  select * into item from public.location_history_events e where e.id=target_event_id and e.deleted_at is null and private.location_owned(e.location_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if item.revision<>expected_revision then
    return jsonb_build_object('ok',false,'code','LOCATION_HISTORY_EVENT_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false);
  end if;

  final_title:=coalesce(event_title,item.title);
  if nullif(btrim(final_title),'') is null then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Title is required.','changed',false);
  end if;
  if event_metadata is not null and jsonb_typeof(event_metadata)<>'object' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Invalid metadata.','changed',false);
  end if;

  wanted:=jsonb_build_object('title',btrim(final_title),'date_label',coalesce(event_date_label,item.date_label),'description',coalesce(event_description,item.description),'sort_order',coalesce(event_sort_order,item.sort_order),'metadata',coalesce(event_metadata,item.metadata));
  current_value:=jsonb_build_object('title',item.title,'date_label',item.date_label,'description',item.description,'sort_order',item.sort_order,'metadata',item.metadata);
  if wanted=current_value then
    return jsonb_build_object('ok',true,'code','OK','changed',false,'eventRevision',item.revision,'data',to_jsonb(item));
  end if;

  update public.location_history_events e set
    title=btrim(final_title),
    date_label=coalesce(event_date_label,e.date_label),
    description=coalesce(event_description,e.description),
    sort_order=coalesce(event_sort_order,e.sort_order),
    metadata=coalesce(event_metadata,e.metadata),
    revision=e.revision+1
  where e.id=target_event_id
  returning * into item;

  return jsonb_build_object('ok',true,'code','OK','changed',true,'eventRevision',item.revision,'data',to_jsonb(item));
end $$;

-- ---------------------------------------------------------------------------
-- Step 6: delete_location_history_event. Soft delete. Gates on the event's own revision, bumps it,
-- AND bumps locations.revision as a side effect (see header REVISION DOMAIN). No fallback-primary
-- concept -- events have no "primary" notion.
-- ---------------------------------------------------------------------------
create or replace function public.delete_location_history_event(target_event_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item public.location_history_events%rowtype;
  new_location_revision bigint;
begin
  select * into item from public.location_history_events e where e.id=target_event_id and e.deleted_at is null and private.location_owned(e.location_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if item.revision<>expected_revision then
    return jsonb_build_object('ok',false,'code','LOCATION_HISTORY_EVENT_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false);
  end if;

  update public.location_history_events e set deleted_at=now(),revision=e.revision+1 where e.id=target_event_id returning * into item;
  update public.locations set revision=revision+1,updated_at=now() where id=item.location_id returning revision into new_location_revision;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'locationRevision',new_location_revision,'data',to_jsonb(item));
end $$;

do $$ declare signature text; begin foreach signature in array array[
  'public.list_location_history_events(uuid)',
  'public.create_location_history_event(uuid,uuid,text,text,text,numeric,jsonb,bigint)',
  'public.update_location_history_event(uuid,bigint,text,text,text,numeric,jsonb)',
  'public.delete_location_history_event(uuid,bigint)'
] loop execute format('revoke execute on function %s from public,anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop; end $$;

-- ---------------------------------------------------------------------------
-- Step 7: import_local_project_content -- identical body to the adaptive-module-selection version
-- (20260904140000_location_adaptive_module_selection.sql), plus ONE addition inside the existing
-- per-location loop: after that location's own canonical row and project_locations participation are
-- inserted (new_canonical_id is now known), insert whatever history events this location's own
-- payload entry carries (loc_item->'history_events', an array nested per-location -- see this
-- migration's header for why nesting, not a new top-level payload key, is the only shape that works
-- here). Malformed/blank-title events are silently dropped at this layer too (WHERE clause), never
-- rejected -- the client-side plan builder (js/local-to-cloud-migration.js) already drops those
-- before they ever reach the payload and surfaces a warning for each one; this WHERE clause is
-- defense-in-depth only, matching the base_profile module sanitizer's own "degrade safely, never
-- reject" convention one loop above. `created` gains one more count key, historyEvents, for
-- observability parity with every other created-entity count already reported.
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
  -- enforced. Loop with separate statements per row instead, mirroring the
  -- CREATE_NEW_GLOBAL_IDENTITY + project_characters loop just above: each statement is its own
  -- command with a fresh snapshot, so a later INSERT correctly sees an earlier one's row.
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

    -- Location History H-events: nested per-location history_events, inserted immediately after
    -- this location's own canonical row so new_canonical_id is available -- see this migration's
    -- header for why this must be nested rather than a flat top-level payload key. Blank/malformed
    -- titles are dropped here too (defense-in-depth; the client-side plan builder already drops
    -- them and reports a warning per event) rather than aborting the whole import.
    insert into public.location_history_events(id,location_id,title,date_label,description,sort_order)
    select x.id,new_canonical_id,btrim(x.title),coalesce(x.date_label,''),coalesce(x.description,''),coalesce(x.sort_order,0)
    from jsonb_to_recordset(loc_item->'history_events') as x(id uuid,title text,date_label text,description text,sort_order numeric)
    where nullif(btrim(x.title),'') is not null;
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
  created=jsonb_build_object('characters',(select count(*) from jsonb_array_elements(import_payload->'characters') x where x->>'action'='CREATE_NEW_GLOBAL_IDENTITY'),'projectCharacters',jsonb_array_length(import_payload->'characters'),'chapters',jsonb_array_length(import_payload->'chapters'),'locations',jsonb_array_length(import_payload->'locations'),'tags',jsonb_array_length(import_payload->'tags'),'scenes',jsonb_array_length(import_payload->'scenes'),'sceneTags',jsonb_array_length(import_payload->'scene_tags'),'sceneCharacters',jsonb_array_length(import_payload->'scene_characters'),'relations',jsonb_array_length(import_payload->'initial_relations'),'relationChanges',jsonb_array_length(import_payload->'scene_relation_changes'),'structuralLinks',jsonb_array_length(import_payload->'structural_links'),'characterImages',jsonb_array_length(import_payload->'character_images'),'historyEvents',coalesce((select sum(jsonb_array_length(coalesce(l->'history_events','[]'::jsonb))) from jsonb_array_elements(import_payload->'locations') l),0));
  result=jsonb_build_object('ok',true,'code','OK','migrationAttemptId',migration_attempt_id,'sourceProjectId',source_project_id,'targetProjectId',target_project_id,'previousRevision',previous_revision,'revision',new_revision,'created',created);
  insert into public.local_project_import_attempts(id,owner_id,project_id,source_project_id,payload_fingerprint,result) values(migration_attempt_id,owner,target_project_id,source_project_id,md5(import_payload::text),result);
  return result;
end $$;

do $$ declare signature text; begin foreach signature in array array[
  'public.import_local_project_content(uuid,bigint,uuid,text,jsonb)'
] loop execute format('revoke execute on function %s from public,anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop; end $$;

-- ---------------------------------------------------------------------------
-- Step 8: get_local_project_import_snapshot -- one more additive verification key,
-- location_history_events, alongside the existing character_images/character_links additions, so
-- executeLocalToCloudMigration's post-import verification (js/local-to-cloud-migration-execution.js)
-- can confirm every planned event actually landed, exactly as it already does for every other
-- entity kind. Every previously existing projected key is preserved byte-for-byte.
-- ---------------------------------------------------------------------------
create or replace function public.get_local_project_import_snapshot(target_project_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare base jsonb;
begin
  base=public.get_project_content(target_project_id);
  if coalesce((base->>'ok')::boolean,false)=false then return base; end if;
  return jsonb_set(jsonb_set(jsonb_set(base,
    '{data,character_images}',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.character_images i where i.deleted_at is null and exists(select 1 from public.project_characters pc where pc.project_id=target_project_id and pc.character_id=i.character_id and (i.project_character_id is null or i.project_character_id=pc.id))),'[]')),
    '{data,character_links}',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.character_links l where l.deleted_at is null and (l.project_id=target_project_id or (l.project_id is null and exists(select 1 from public.project_characters a where a.project_id=target_project_id and a.character_id=l.from_character_id) and exists(select 1 from public.project_characters b where b.project_id=target_project_id and b.character_id=l.to_character_id)))),'[]')),
    '{data,location_history_events}',coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from public.location_history_events e
      join public.project_locations pl on pl.location_id=e.location_id and pl.removed_at is null
      where pl.project_id=target_project_id and e.deleted_at is null
    ),'[]')
  );
end $$;
revoke execute on function public.get_local_project_import_snapshot(uuid) from public,anon;
grant execute on function public.get_local_project_import_snapshot(uuid) to authenticated;
