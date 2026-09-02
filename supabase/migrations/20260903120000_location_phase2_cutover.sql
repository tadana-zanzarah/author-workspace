-- Location Architecture V2 Phase 2: backfill + Scene FK cutover + RPC/read-model cutover.
--
-- Preconditions (see Location Foundation Phase 1, migration 20260902120000): the legacy
-- project-scoped table `location_projects_legacy_v1` is the live backing store for every
-- production Location, `public.locations` (global canonical identity) and
-- `public.project_locations` (project participation) exist but are empty, and
-- scenes.location_id still targets the legacy table.
--
-- This migration performs the one-time cutover:
--   1. Fail-closed assertions on the expected pre-state.
--   2. Backfill: one new canonical `locations` row per legacy row (fresh UUID identity), and
--      one `project_locations` participation row per legacy row that PRESERVES the legacy
--      row's id as its own id -- this is the critical invariant that keeps every existing
--      scenes.location_id value valid without rewriting a single scene row.
--   3. Internal verification of the backfill before anything downstream depends on it.
--   4. Scene FK cutover: drop the legacy-targeted FK, add the new one targeting
--      project_locations(project_id, id), preserving the existing ON DELETE SET NULL
--      column-level behavior.
--   5. Lock down the legacy table to read-only (observation/recovery) by revoking
--      INSERT/UPDATE/DELETE from `authenticated` -- SELECT and the table itself are kept.
--   6. Replace the Location RPC surface (create_location/update_location/delete_location),
--      get_project_content, create_scene/update_scene, and import_local_project_content to
--      read/write the new model. New `attach_project_location` RPC for reactivate-in-place
--      participation, mirroring the project_characters pattern
--      (20260830120000_fix_project_character_reattach.sql).
--
-- No DROP of the legacy table. No data loss: every legacy column that had meaning survives,
-- either on the canonical location (name, description -> base_profile.description) or on the
-- project participation row (metadata, deleted_at -> removed_at).

-- ---------------------------------------------------------------------------
-- Step 1: fail-closed precondition assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  fk_target text;
  loc_count integer;
  pl_count integer;
  orphan_count integer;
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='location_projects_legacy_v1') then
    raise exception 'Phase 2 precondition failed: public.location_projects_legacy_v1 is missing';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='locations') then
    raise exception 'Phase 2 precondition failed: public.locations is missing';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='project_locations') then
    raise exception 'Phase 2 precondition failed: public.project_locations is missing';
  end if;

  select c2.relname into fk_target
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey';
  if fk_target is distinct from 'location_projects_legacy_v1' then
    raise exception 'Phase 2 precondition failed: scenes_project_location_fkey targets % (expected location_projects_legacy_v1 -- has this migration already run?)', fk_target;
  end if;

  select count(*) into loc_count from public.locations;
  if loc_count<>0 then raise exception 'Phase 2 precondition failed: public.locations is not empty (count=%) -- has this migration already run?', loc_count; end if;
  select count(*) into pl_count from public.project_locations;
  if pl_count<>0 then raise exception 'Phase 2 precondition failed: public.project_locations is not empty (count=%) -- has this migration already run?', pl_count; end if;

  select count(*) into orphan_count
  from public.scenes s
  where s.location_id is not null
    and not exists (select 1 from public.location_projects_legacy_v1 l where l.id=s.location_id and l.project_id=s.project_id);
  if orphan_count<>0 then
    raise exception 'Phase 2 precondition failed: % scene(s) reference a location_id that does not resolve in location_projects_legacy_v1', orphan_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 2: backfill. `loc_source` is MATERIALIZED so gen_random_uuid() is evaluated exactly
-- once per legacy row and the same canonical_id is reused by both inserts below -- without
-- `materialized`, Postgres 12+ may inline this CTE into each reference and generate a
-- different UUID per reference, breaking the id mapping.
-- ---------------------------------------------------------------------------
-- The primary INSERT below explicitly JOINs `ins_locations` (not just `loc_source`) so it has a
-- real data dependency on the locations backfill -- Postgres does NOT guarantee execution order
-- between sibling data-modifying WITH statements that aren't otherwise linked ("the order in
-- which the specified updates actually happen is unpredictable"), and project_locations' own
-- BEFORE INSERT owner-guard trigger requires the matching `locations` row to already exist.
-- Without this join, the trigger can spuriously fail with "project and location owners must
-- match" if the canonical row hasn't been inserted yet when the participation row is checked.
with loc_source as materialized (
  select
    l.id as legacy_id,
    gen_random_uuid() as canonical_id,
    l.project_id,
    p.owner_id,
    l.name,
    l.description,
    coalesce(l.metadata,'{}'::jsonb) as metadata,
    l.created_at,
    l.updated_at,
    l.deleted_at
  from public.location_projects_legacy_v1 l
  join public.projects p on p.id=l.project_id
), ins_locations as (
  insert into public.locations(id,owner_id,name,base_profile,metadata,revision,created_at,updated_at)
  select canonical_id, owner_id, name, jsonb_build_object('description',coalesce(description,'')), '{}'::jsonb, 0, created_at, updated_at
  from loc_source
  returning id
)
insert into public.project_locations(id,project_id,location_id,overrides,metadata,created_at,updated_at,removed_at)
select ls.legacy_id, ls.project_id, il.id, '{}'::jsonb, ls.metadata, ls.created_at, ls.updated_at, ls.deleted_at
from loc_source ls
join ins_locations il on il.id=ls.canonical_id;

-- ---------------------------------------------------------------------------
-- Step 3: internal verification before anything downstream (the FK cutover) depends on the
-- backfill being correct.
-- ---------------------------------------------------------------------------
do $$
declare
  legacy_count integer;
  loc_count integer;
  pl_count integer;
  bad_count integer;
  orphan_count integer;
begin
  select count(*) into legacy_count from public.location_projects_legacy_v1;
  select count(*) into loc_count from public.locations;
  select count(*) into pl_count from public.project_locations;

  if loc_count<>legacy_count then
    raise exception 'Phase 2 backfill verification failed: locations count % <> legacy count %', loc_count, legacy_count;
  end if;
  if pl_count<>legacy_count then
    raise exception 'Phase 2 backfill verification failed: project_locations count % <> legacy count %', pl_count, legacy_count;
  end if;

  -- every legacy row has exactly one project_locations row under its preserved id.
  select count(*) into bad_count
  from public.location_projects_legacy_v1 l
  where not exists (select 1 from public.project_locations pl where pl.id=l.id and pl.project_id=l.project_id);
  if bad_count<>0 then
    raise exception 'Phase 2 backfill verification failed: % legacy row(s) have no matching project_locations row under the preserved id', bad_count;
  end if;

  -- every project_locations row resolves to exactly one canonical location.
  select count(*) into bad_count
  from public.project_locations pl
  where not exists (select 1 from public.locations loc where loc.id=pl.location_id);
  if bad_count<>0 then
    raise exception 'Phase 2 backfill verification failed: % project_locations row(s) reference a missing canonical location', bad_count;
  end if;

  -- no unique(project_id,location_id) violations were introduced (defensive; should be
  -- structurally impossible since canonical_id is a fresh UUID per row).
  select count(*) into bad_count
  from (select project_id,location_id from public.project_locations group by 1,2 having count(*)>1) dup;
  if bad_count<>0 then
    raise exception 'Phase 2 backfill verification failed: % duplicate (project_id,location_id) pair(s) in project_locations', bad_count;
  end if;

  -- every scene location reference will resolve through project_locations once the FK flips.
  select count(*) into orphan_count
  from public.scenes s
  where s.location_id is not null
    and not exists (select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id);
  if orphan_count<>0 then
    raise exception 'Phase 2 backfill verification failed: % scene(s) would be orphaned by the FK cutover', orphan_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 4: Scene FK cutover. Preserves the existing column-level ON DELETE SET NULL behavior
-- (see 20260821133800_cloud_content_schema_foundation.sql:109-110).
-- ---------------------------------------------------------------------------
alter table public.scenes drop constraint scenes_project_location_fkey;
alter table public.scenes add constraint scenes_project_location_fkey
  foreign key (project_id, location_id) references public.project_locations(project_id, id)
  on delete set null (location_id);

comment on column public.scenes.location_id is
  'Architecture V2 Phase 2: references public.project_locations.id (project participation of a'
  ' canonical global public.locations row), NOT location_projects_legacy_v1 or public.locations'
  ' directly. Physically unchanged by the Phase 2 cutover for pre-existing scenes: the'
  ' participation row backfilled from each legacy Location row preserves the legacy row''s id,'
  ' so every existing scenes.location_id value continues to resolve without rewriting.';

-- ---------------------------------------------------------------------------
-- Step 5: legacy table becomes observation/recovery-only. Table and SELECT access (RLS-scoped)
-- are kept; no application code writes to it anymore.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on table public.location_projects_legacy_v1 from authenticated;

comment on table public.location_projects_legacy_v1 is
  'Legacy project-scoped Location table (pre Architecture V2). Backfilled into public.locations'
  ' + public.project_locations and superseded as the live backing store by the Architecture V2'
  ' Phase 2 cutover (20260903120000_location_phase2_cutover.sql): scenes.location_id now'
  ' references public.project_locations.id, and INSERT/UPDATE/DELETE are revoked from'
  ' `authenticated`. Retained read-only (SELECT still granted, RLS-scoped) as an'
  ' observation/recovery layer. Not dropped.';

-- ---------------------------------------------------------------------------
-- Step 6: read model for local->cloud import target-empty check.
-- ---------------------------------------------------------------------------
create or replace function private.local_import_target_empty(target_project_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select not exists(select 1 from public.project_characters where project_id=target_project_id)
    and not exists(select 1 from public.chapters where project_id=target_project_id)
    and not exists(select 1 from public.project_locations where project_id=target_project_id)
    and not exists(select 1 from public.tags where project_id=target_project_id)
    and not exists(select 1 from public.scenes where project_id=target_project_id)
    and not exists(select 1 from public.character_links where project_id=target_project_id);
$$;

-- ---------------------------------------------------------------------------
-- Step 7: Location RPC surface, cut over to the new model. Signatures are UNCHANGED from the
-- Phase 1 compat-fixed versions so js/cloud-content-api.js needs no call-site changes:
-- create_location/update_location(target_project_id,target_location_id,expected_revision,
-- location_name,location_description) and delete_location(target_project_id,
-- target_location_id,expected_revision) keep exactly their prior parameter lists.
-- `target_location_id` continues to mean the same physical id it always has (a
-- project_locations.id, preserving the pre-cutover legacy.id for existing rows).
-- ---------------------------------------------------------------------------

create or replace function public.create_location(target_project_id uuid,expected_revision bigint,location_name text,location_description text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; new_location_id uuid; participation public.project_locations%rowtype; new_revision bigint; trimmed_name text; safe_description text;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  trimmed_name:=btrim(coalesce(location_name,''));
  if char_length(trimmed_name) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','changed',false); end if;
  safe_description:=coalesce(location_description,'');
  insert into public.locations(owner_id,name,base_profile) values(p.owner_id,trimmed_name,jsonb_build_object('description',safe_description)) returning id into new_location_id;
  insert into public.project_locations(project_id,location_id) values(target_project_id,new_location_id) returning * into participation;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location created.','revision',new_revision,'changed',true,'data',jsonb_build_object(
    'id',participation.id,'project_id',participation.project_id,'location_id',new_location_id,
    'name',trimmed_name,'description',safe_description,'metadata',participation.metadata,
    'created_at',participation.created_at,'updated_at',participation.updated_at
  ));
end $$;

create or replace function public.update_location(target_project_id uuid,target_location_id uuid,expected_revision bigint,location_name text,location_description text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; participation public.project_locations%rowtype; loc public.locations%rowtype; new_revision bigint; trimmed_name text; new_description text;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into participation from public.project_locations where id=target_location_id and project_id=target_project_id and removed_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  select * into loc from public.locations where id=participation.location_id;
  trimmed_name:=btrim(coalesce(location_name,''));
  if char_length(trimmed_name) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','revision',p.revision,'changed',false); end if;
  new_description:=coalesce(location_description,'');
  if loc.name=trimmed_name and coalesce(loc.base_profile->>'description','')=new_description then
    return jsonb_build_object('ok',true,'code','OK','message','Location unchanged.','revision',p.revision,'changed',false,'data',jsonb_build_object(
      'id',participation.id,'project_id',participation.project_id,'location_id',loc.id,'name',loc.name,'description',coalesce(loc.base_profile->>'description',''),
      'metadata',participation.metadata,'created_at',participation.created_at,'updated_at',participation.updated_at));
  end if;
  update public.locations set name=trimmed_name,base_profile=jsonb_set(base_profile,'{description}'::text[],to_jsonb(new_description)),revision=revision+1 where id=loc.id returning * into loc;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location updated.','revision',new_revision,'changed',true,'data',jsonb_build_object(
    'id',participation.id,'project_id',participation.project_id,'location_id',loc.id,'name',loc.name,'description',coalesce(loc.base_profile->>'description',''),
    'metadata',participation.metadata,'created_at',participation.created_at,'updated_at',loc.updated_at));
end $$;

-- Semantics change from Phase 1: this now soft-removes the project's PARTICIPATION row
-- (the canonical global Location is never deleted by a project-scoped call), and refuses with
-- a domain error instead of relying on the FK's ON DELETE SET NULL when the project's active
-- Scenes still reference it -- mirroring remove_project_character's DEPENDENCIES_EXIST contract
-- (20260822120000_cloud_character_transaction_rpc.sql). No cleanup_dependencies escape hatch is
-- added here: no UI surface calls for one in this phase.
create or replace function public.delete_location(target_project_id uuid,target_location_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; participation public.project_locations%rowtype; new_revision bigint; scene_count integer;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into participation from public.project_locations where id=target_location_id and project_id=target_project_id and removed_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  select count(*) into scene_count from public.scenes where project_id=target_project_id and location_id=target_location_id and deleted_at is null;
  if scene_count>0 then
    return jsonb_build_object('ok',false,'code','DEPENDENCIES_EXIST','message','Location is used by '||scene_count||' scene(s) in this project. Remove it from those scenes first.','revision',p.revision,'changed',false,'dependencies',jsonb_build_object('scenes',scene_count));
  end if;
  update public.project_locations set removed_at=now() where id=target_location_id;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location removed from project.','revision',new_revision,'changed',true);
end $$;

-- New RPC: attach (or reactivate) a canonical global Location's participation in a project.
-- No UI calls this in Phase 2 (no Location Gallery yet) -- it exists so the backend contract is
-- complete and testable, matching the project_characters precedent of shipping the RPC ahead of
-- its UI (js/cloud-character-api.js). Reactivate-in-place mirrors attach_project_character
-- exactly (20260830120000_fix_project_character_reattach.sql), required because
-- project_locations_project_location_key is NOT partial (applies to removed rows too).
create or replace function public.attach_project_location(target_project_id uuid,target_global_location_id uuid,expected_revision bigint,location_overrides jsonb default '{}'::jsonb,location_sort_order numeric default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; existing_id uuid; item public.project_locations%rowtype; new_revision bigint; safe_overrides jsonb;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if not exists(select 1 from public.locations where id=target_global_location_id and owner_id=p.owner_id) then
    return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false);
  end if;
  if exists(select 1 from public.project_locations where project_id=target_project_id and location_id=target_global_location_id and removed_at is null) then
    return jsonb_build_object('ok',false,'code','DUPLICATE','message','Location is already attached to this project.','revision',p.revision,'changed',false);
  end if;
  safe_overrides:=coalesce(location_overrides,'{}'::jsonb);
  select id into existing_id from public.project_locations where project_id=target_project_id and location_id=target_global_location_id and removed_at is not null;
  if found then
    update public.project_locations set overrides=safe_overrides,sort_order=coalesce(location_sort_order,0),removed_at=null where id=existing_id returning * into item;
  else
    insert into public.project_locations(project_id,location_id,overrides,sort_order) values(target_project_id,target_global_location_id,safe_overrides,coalesce(location_sort_order,0)) returning * into item;
  end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location attached.','revision',new_revision,'changed',true,'data',jsonb_build_object(
    'id',item.id,'project_id',item.project_id,'location_id',item.location_id,'overrides',item.overrides,'sort_order',item.sort_order,'created_at',item.created_at,'updated_at',item.updated_at));
end $$;
revoke all on function public.attach_project_location(uuid,uuid,bigint,jsonb,numeric) from public, anon, authenticated;
grant execute on function public.attach_project_location(uuid,uuid,bigint,jsonb,numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 8: read model. `get_project_content`'s `locations` array keeps its Phase-1 field names
-- (`id`, `name`, `description`) exactly -- js/cloud-project-sync.js:85 hydration only reads
-- those -- while `id` continues to mean the project_locations.id (so scene.locationId keeps
-- working unchanged) and `location_id` exposes the canonical global identity for forward
-- compatibility. Ordering stays `lower(name), id` to preserve the existing UI order (backfilled
-- rows have no meaningful sort_order yet).
-- ---------------------------------------------------------------------------
create or replace function public.get_project_content(target_project_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare project_row public.projects%rowtype;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false); end if;
  select * into project_row from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for share;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  return jsonb_build_object('ok',true,'code','OK','message','Project content loaded.','revision',project_row.revision,'changed',false,'data',jsonb_build_object(
    'project',jsonb_build_object('id',project_row.id,'revision',project_row.revision,'updated_at',project_row.updated_at),
    'chapters',coalesce((select jsonb_agg(to_jsonb(x) order by x.position,x.id) from public.chapters x where x.project_id=target_project_id and x.deleted_at is null),'[]'),
    'locations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',pl.id,'project_id',pl.project_id,'location_id',pl.location_id,
        'name',loc.name,'description',coalesce(loc.base_profile->>'description',''),
        'metadata',pl.metadata,'overrides',pl.overrides,'sort_order',pl.sort_order,
        'created_at',pl.created_at,'updated_at',pl.updated_at
      ) order by lower(loc.name),pl.id)
      from public.project_locations pl join public.locations loc on loc.id=pl.location_id
      where pl.project_id=target_project_id and pl.removed_at is null
    ),'[]'),
    'tags',coalesce((select jsonb_agg(to_jsonb(x) order by x.normalized_name,x.id) from public.tags x where x.project_id=target_project_id),'[]'),
    'scenes',coalesce((select jsonb_agg(to_jsonb(x) order by x.position,x.id) from public.scenes x where x.project_id=target_project_id and x.deleted_at is null),'[]'),
    'scene_tags',coalesce((select jsonb_agg(to_jsonb(x) order by x.scene_id,x.tag_id) from public.scene_tags x where x.project_id=target_project_id),'[]'),
    'project_characters',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order,x.id) from public.project_characters x where x.project_id=target_project_id and x.removed_at is null),'[]'),
    'scene_characters',coalesce((select jsonb_agg(to_jsonb(x) order by x.scene_id,x.sort_order,x.project_character_id) from public.scene_characters x where x.project_id=target_project_id),'[]'),
    'project_character_relations',coalesce((select jsonb_agg(to_jsonb(x) order by x.from_project_character_id,x.to_project_character_id) from public.project_character_relations x where x.project_id=target_project_id),'[]'),
    'scene_relation_changes',coalesce((select jsonb_agg(to_jsonb(x) order by x.scene_id,x.from_project_character_id,x.to_project_character_id) from public.scene_relation_changes x where x.project_id=target_project_id),'[]'),
    'character_links',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.character_links x where x.project_id=target_project_id and x.deleted_at is null),'[]')
  ));
end $$;

-- ---------------------------------------------------------------------------
-- Step 9: create_scene/update_scene validate target_location_id against project_locations now
-- (the FK also enforces this; the app-level check keeps returning a clean NOT_FOUND instead of
-- a raw FK-violation error, matching the existing chapter-id check).
-- ---------------------------------------------------------------------------
create or replace function public.create_scene(
  target_project_id uuid,expected_revision bigint,target_chapter_id uuid,target_location_id uuid,
  scene_title text,scene_text_value text,scene_date_value date,scene_time_value time,
  placement_status_value text,writing_status_value text,included_value boolean,date_review_value boolean,scene_position numeric
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; new_revision bigint; actual_position numeric(20,10);
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if target_chapter_id is not null and not exists(select 1 from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if target_location_id is not null and not exists(select 1 from public.project_locations where id=target_location_id and project_id=target_project_id and removed_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if placement_status_value not in ('placed','unplaced') or writing_status_value not in ('draft','in_progress','revised','final') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Scene status is invalid.','revision',p.revision,'changed',false); end if;
  actual_position:=scene_position;
  if actual_position is null then select coalesce(max(position),0)+1000 into actual_position from public.scenes where project_id=target_project_id and deleted_at is null; end if;
  insert into public.scenes(project_id,chapter_id,location_id,title,scene_text,scene_date,scene_time,placement_status,writing_status,included,date_review,position)
  values(target_project_id,target_chapter_id,target_location_id,coalesce(scene_title,''),coalesce(scene_text_value,''),scene_date_value,scene_time_value,placement_status_value,writing_status_value,coalesce(included_value,true),coalesce(date_review_value,false),actual_position) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene created.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_scene(
  target_project_id uuid,target_scene_id uuid,expected_revision bigint,target_chapter_id uuid,target_location_id uuid,
  scene_title text,scene_text_value text,scene_date_value date,scene_time_value time,
  placement_status_value text,writing_status_value text,included_value boolean,date_review_value boolean
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false); end if;
  if target_chapter_id is not null and not exists(select 1 from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if target_location_id is not null and not exists(select 1 from public.project_locations where id=target_location_id and project_id=target_project_id and removed_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if placement_status_value not in ('placed','unplaced') or writing_status_value not in ('draft','in_progress','revised','final') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Scene status is invalid.','revision',p.revision,'changed',false); end if;
  if item.chapter_id is not distinct from target_chapter_id and item.location_id is not distinct from target_location_id and item.title=coalesce(scene_title,'') and item.scene_text=coalesce(scene_text_value,'') and item.scene_date is not distinct from scene_date_value and item.scene_time is not distinct from scene_time_value and item.placement_status=placement_status_value and item.writing_status=writing_status_value and item.included=coalesce(included_value,true) and item.date_review=coalesce(date_review_value,false) then return jsonb_build_object('ok',true,'code','OK','message','Scene unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.scenes set chapter_id=target_chapter_id,location_id=target_location_id,title=coalesce(scene_title,''),scene_text=coalesce(scene_text_value,''),scene_date=scene_date_value,scene_time=scene_time_value,placement_status=placement_status_value,writing_status=writing_status_value,included=coalesce(included_value,true),date_review=coalesce(date_review_value,false) where id=target_scene_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

-- ---------------------------------------------------------------------------
-- Step 10: local->cloud import. `import_payload.locations` items keep their existing shape
-- (id,name,description,metadata -- see js/local-to-cloud-migration-execution.js:40); `x.id`
-- becomes the new project_locations.id (participation), and a fresh canonical `locations` row
-- is created alongside it, exactly mirroring the backfill mapping in Step 2 above.
-- ---------------------------------------------------------------------------
create or replace function public.import_local_project_content(target_project_id uuid,expected_revision bigint,migration_attempt_id uuid,source_project_id text,import_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p public.projects%rowtype; prior public.local_project_import_attempts%rowtype; item jsonb; owner uuid; previous_revision bigint; new_revision bigint; result jsonb; created jsonb;
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

  -- See the analogous backfill comment in Step 2 above: the primary INSERT must JOIN
  -- `ins_locations`, not just select from `loc_source`, or the project_locations owner-guard
  -- trigger can spuriously fail on an unlucky execution order.
  with loc_source as materialized (
    select x.id as legacy_id, gen_random_uuid() as canonical_id, x.name, x.description, coalesce(x.metadata,'{}'::jsonb) as metadata
    from jsonb_to_recordset(import_payload->'locations') as x(id uuid,name text,description text,metadata jsonb)
  ), ins_locations as (
    insert into public.locations(id,owner_id,name,base_profile)
    select canonical_id, owner, name, jsonb_build_object('description',coalesce(description,''))
    from loc_source
    returning id
  )
  insert into public.project_locations(id,project_id,location_id,overrides,metadata)
  select ls.legacy_id, target_project_id, il.id, '{}'::jsonb, ls.metadata
  from loc_source ls
  join ins_locations il on il.id=ls.canonical_id;

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
