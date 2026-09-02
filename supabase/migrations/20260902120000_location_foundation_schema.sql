-- Location Foundation Schema (Architecture V2 Phase 1).
--
-- This migration is intentionally inert: production continues to operate against the
-- legacy project-scoped Location table (renamed below, not migrated), no data is moved,
-- no new RPC surface is introduced, and scenes.location_id keeps referencing the legacy
-- table exactly as before. See Location Architecture V2 (Foundation Core, §B/§K) for the
-- full design rationale.
--
-- Step 1 renames the legacy table out of the `locations` name so the new global identity
-- table (Step 2) can claim it. The scenes_project_location_fkey constraint is resolved by
-- Postgres via the table's OID, not its name, so it continues pointing at the renamed
-- table with zero downtime and no ALTER of its own.
--
-- Steps 3-5 audit-fix the existing production Location RPC surface (create_location,
-- update_location, delete_location, get_project_content, create_scene, update_scene, and
-- the local->cloud import RPC), all of which reference the old `public.locations` name as
-- literal text inside their function bodies (plpgsql function bodies resolve identifiers
-- by name at call time, not by OID at CREATE time). Left untouched, these functions would
-- silently start reading/writing the new, schema-incompatible global `locations` table
-- created in Step 2 instead of the legacy data. Step 3-5 repoints them at
-- `location_projects_legacy_v1` with no other behavioral change -- this is the minimal
-- compatibility fix required to keep current production behavior identical, not a
-- rewrite onto the new architecture.

-- ---------------------------------------------------------------------------
-- Step 1: rename the legacy project-scoped Location table.
-- ---------------------------------------------------------------------------
alter table public.locations rename to location_projects_legacy_v1;
comment on table public.location_projects_legacy_v1 is
  'Legacy project-scoped Location table (pre Architecture V2). Renamed out of the way so the'
  ' new global `locations` identity table could claim the name. Still the live backing store'
  ' for all production Location CRUD until the Scene FK cutover (Architecture V2 Phase 3)'
  ' and the RPC/UI cutover phases land. Retention/drop is a separate future decision.';

-- ---------------------------------------------------------------------------
-- Step 2: new Foundation tables (Architecture V2 §B). Empty; nothing reads or writes
-- these yet -- no backfill, no RPC, no FK cutover in this phase.
-- ---------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  official_name text,
  aliases text[] not null default '{}'::text[],
  parent_id uuid references public.locations(id) on delete restrict,
  sort_order numeric(20,10) not null default 0,
  type_preset text not null default 'other',
  custom_type_label text,
  base_profile jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint locations_name_not_blank check (char_length(btrim(name)) between 1 and 300),
  constraint locations_official_name_length check (official_name is null or char_length(official_name) <= 300),
  constraint locations_base_profile_object check (jsonb_typeof(base_profile) = 'object'),
  constraint locations_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint locations_not_own_parent check (parent_id is null or parent_id <> id),
  constraint locations_owner_id_key unique (owner_id, id),
  constraint locations_owner_parent_fkey foreign key (owner_id, parent_id) references public.locations(owner_id, id)
);
comment on column public.locations.parent_id is
  'Global hierarchy parent. Recursive-CTE breadcrumb; multi-level cycle prevention is enforced'
  ' by future move_location RPC, not by this schema (see Architecture V2 §G).';

create table public.project_locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  overrides jsonb not null default '{}'::jsonb,
  sort_order numeric(20,10) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint project_locations_overrides_object check (jsonb_typeof(overrides) = 'object'),
  constraint project_locations_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint project_locations_project_location_key unique (project_id, location_id),
  constraint project_locations_project_id_id_key unique (project_id, id),
  constraint project_locations_location_id_id_key unique (location_id, id)
);
comment on table public.project_locations is
  'Project participation of a global location (Architecture V2 §B). '
  'project_locations_project_location_key is intentionally NOT partial: it applies to'
  ' removed rows too, so future attach RPC must reactivate-in-place rather than insert a'
  ' second row for the same (project_id, location_id) pair (see the project_characters'
  ' reattach fix in 20260830120000_fix_project_character_reattach.sql for the class of bug'
  ' this avoids).';

-- ---------------------------------------------------------------------------
-- Step 3: owner-guard trigger + RLS helper for the new tables, mirroring the existing
-- private.enforce_project_character_owner() / private.character_owned() patterns.
-- ---------------------------------------------------------------------------

create or replace function private.location_owned(target_location_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select exists (select 1 from public.locations l where l.id=target_location_id and l.owner_id=(select auth.uid())) $$;
grant execute on function private.location_owned(uuid) to authenticated;

create or replace function private.enforce_project_location_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects p join public.locations l on l.owner_id=p.owner_id where p.id=new.project_id and l.id=new.location_id) then
    raise exception 'project and location owners must match' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.enforce_project_location_owner() from public, anon, authenticated;
create trigger project_locations_owner_guard before insert or update of project_id, location_id on public.project_locations for each row execute function private.enforce_project_location_owner();

create trigger locations_touch before update on public.locations for each row execute function private.touch_updated_at();
create trigger project_locations_touch before update on public.project_locations for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Step 4: indexes (Architecture V2 §N). Only the approved Foundation set -- no GIN alias
-- index, no speculative indexes.
-- ---------------------------------------------------------------------------

create index locations_owner_idx on public.locations(owner_id);
create index locations_owner_name_idx on public.locations(owner_id, lower(name));
create index locations_owner_type_idx on public.locations(owner_id, type_preset) where deleted_at is null;
create index locations_parent_idx on public.locations(parent_id) where deleted_at is null;
create index project_locations_project_sort_idx on public.project_locations(project_id, sort_order, id) where removed_at is null;
create index project_locations_location_idx on public.project_locations(location_id, project_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Step 5: RLS + grants (Architecture V2 §L). Direct owner isolation on `locations`;
-- project-ownership + owner-guard trigger on `project_locations`. No cross-user access.
-- ---------------------------------------------------------------------------

alter table public.locations enable row level security;
revoke all on table public.locations from public, anon, authenticated;
grant select, insert, update, delete on table public.locations to authenticated;

create policy locations_select on public.locations for select to authenticated using ((select auth.uid())=owner_id);
create policy locations_insert on public.locations for insert to authenticated with check ((select auth.uid())=owner_id);
create policy locations_update on public.locations for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy locations_delete on public.locations for delete to authenticated using ((select auth.uid())=owner_id);

alter table public.project_locations enable row level security;
revoke all on table public.project_locations from public, anon, authenticated;
grant select, insert, update, delete on table public.project_locations to authenticated;

create policy project_locations_select on public.project_locations for select to authenticated using (private.project_owned(project_id));
create policy project_locations_insert on public.project_locations for insert to authenticated with check (private.project_owned(project_id) and private.location_owned(location_id));
create policy project_locations_update on public.project_locations for update to authenticated using (private.project_owned(project_id)) with check (private.project_owned(project_id) and private.location_owned(location_id));
create policy project_locations_delete on public.project_locations for delete to authenticated using (private.project_owned(project_id));

-- ---------------------------------------------------------------------------
-- Step 6: compatibility fix. The existing production Location RPC surface references
-- `public.locations` as literal text (see migration audit in the Phase 1 report). Recreate
-- each function, unchanged except for the table reference, so current production behavior
-- is identical to before this migration. No RPC logic, validation, or response shape
-- changes. No new Location RPC is introduced here.
-- ---------------------------------------------------------------------------

create or replace function public.create_location(target_project_id uuid,expected_revision bigint,location_name text,location_description text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.location_projects_legacy_v1%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if char_length(btrim(coalesce(location_name,''))) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','changed',false); end if;
  insert into public.location_projects_legacy_v1(project_id,name,description) values(target_project_id,btrim(location_name),coalesce(location_description,'')) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location created.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_location(target_project_id uuid,target_location_id uuid,expected_revision bigint,location_name text,location_description text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.location_projects_legacy_v1%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.location_projects_legacy_v1 where id=target_location_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if char_length(btrim(coalesce(location_name,''))) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','revision',p.revision,'changed',false); end if;
  if item.name=btrim(location_name) and item.description=coalesce(location_description,'') then return jsonb_build_object('ok',true,'code','OK','message','Location unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.location_projects_legacy_v1 set name=btrim(location_name),description=coalesce(location_description,'') where id=target_location_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.delete_location(target_project_id uuid,target_location_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  delete from public.location_projects_legacy_v1 where id=target_location_id and project_id=target_project_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location deleted.','revision',new_revision,'changed',true);
end $$;

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
    'locations',coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name),x.id) from public.location_projects_legacy_v1 x where x.project_id=target_project_id and x.deleted_at is null),'[]'),
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
  if target_location_id is not null and not exists(select 1 from public.location_projects_legacy_v1 where id=target_location_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
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
  if target_location_id is not null and not exists(select 1 from public.location_projects_legacy_v1 where id=target_location_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if placement_status_value not in ('placed','unplaced') or writing_status_value not in ('draft','in_progress','revised','final') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Scene status is invalid.','revision',p.revision,'changed',false); end if;
  if item.chapter_id is not distinct from target_chapter_id and item.location_id is not distinct from target_location_id and item.title=coalesce(scene_title,'') and item.scene_text=coalesce(scene_text_value,'') and item.scene_date is not distinct from scene_date_value and item.scene_time is not distinct from scene_time_value and item.placement_status=placement_status_value and item.writing_status=writing_status_value and item.included=coalesce(included_value,true) and item.date_review=coalesce(date_review_value,false) then return jsonb_build_object('ok',true,'code','OK','message','Scene unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.scenes set chapter_id=target_chapter_id,location_id=target_location_id,title=coalesce(scene_title,''),scene_text=coalesce(scene_text_value,''),scene_date=scene_date_value,scene_time=scene_time_value,placement_status=placement_status_value,writing_status=writing_status_value,included=coalesce(included_value,true),date_review=coalesce(date_review_value,false) where id=target_scene_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function private.local_import_target_empty(target_project_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select not exists(select 1 from public.project_characters where project_id=target_project_id)
    and not exists(select 1 from public.chapters where project_id=target_project_id)
    and not exists(select 1 from public.location_projects_legacy_v1 where project_id=target_project_id)
    and not exists(select 1 from public.tags where project_id=target_project_id)
    and not exists(select 1 from public.scenes where project_id=target_project_id)
    and not exists(select 1 from public.character_links where project_id=target_project_id);
$$;

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
  insert into public.location_projects_legacy_v1(id,project_id,name,description,metadata) select x.id,target_project_id,x.name,coalesce(x.description,''),coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'locations') as x(id uuid,name text,description text,metadata jsonb);
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

comment on column public.scenes.location_id is
  'Phase 1 of Architecture V2: still references location_projects_legacy_v1.id (legacy'
  ' project-scoped Location), NOT the new global locations.id. Will be repointed to'
  ' project_locations.id in the separate Scene FK cutover phase (Architecture V2 §J/§K'
  ' Step 5), not in this migration.';
