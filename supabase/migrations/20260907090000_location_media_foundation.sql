-- Location Media B4A: backend/storage foundation (no author-facing UI yet).
--
-- CONTEXT: "Location Media -- Final Implementation Spec" audit (accepted). Ships exactly the
-- backend/storage surface B4A needs: the `location_media` table, a private Storage bucket, RLS on
-- both, a small RPC surface mirroring the proven `character_images` contract, and a lean read-path
-- addition to `get_project_content` for a future Gallery cover -- with zero UI wiring. B4B (Profile
-- media editor, Gallery cover rendering, lightbox) is a separate, later phase.
--
-- SCOPE DECISIONS CARRIED OVER FROM THE AUDIT (see the audit report for full reasoning):
--   - Canonical-only UI in v1. The schema supports `project_location_id is not null` (a future
--     project-specific media scope) via the same composite-FK integrity model `character_images`
--     already proves for `project_character_id`, and this migration's RPCs DO implement that scope
--     branch (so the backend contract is complete and testable, mirroring how
--     `attach_project_location` shipped ahead of any UI that calls it) -- but nothing in this phase
--     creates, reads, or exposes a project-scoped row from any UI surface.
--   - `revision` and `storage_cleanup_required` ship on the table from day one (unlike
--     `character_images`, which had to retrofit both in 20260827122152_cloud_character_image_storage.sql
--     after the fact -- no reason to repeat that here).
--   - The composite scope-integrity FK `(location_id, project_location_id) ->
--     project_locations(location_id, id)` is possible with zero prerequisite migration: the unique
--     constraint it needs, `project_locations_location_id_id_key`, already exists (Foundation
--     schema, 20260902120000_location_foundation_schema.sql:83), unused by anything until now.
--     Verified present before writing this migration; not re-created here.
--   - The FK is `on delete cascade`, matching the CORRECTED final state of the `character_images`
--     precedent, not delete-restrict: 20260821133800_cloud_content_schema_foundation.sql originally
--     shipped `character_images_character_context_fkey ... on delete restrict`, and a later
--     migration (20260829122450_cascade_project_character_image_context.sql) fixed it to `on delete
--     cascade` specifically so a genuinely deleted `project_characters` row never leaves an
--     unremovable FK-violation trap for its images. `location_id`'s own FK to `locations(id)` stays
--     `on delete restrict` (locations are never hard-deleted by this app; this is a defensive
--     default, same as `character_images.character_id`).
--
-- REVISION-DOMAIN NUANCE (read the audit's own concurrency section before touching this): the
-- established `character_images` contract is NOT "every canonical mutation gates on
-- characters.revision". Read directly from create_character_image/update_character_image/
-- delete_character_image (20260827122152_cloud_character_image_storage.sql):
--   - CREATE (canonical): gates AND bumps characters.revision.
--   - UPDATE (canonical): gates AND bumps ONLY the image row's OWN revision -- characters.revision
--     is untouched. A pure caption/crop/primary edit on one image never conflicts with, or shows up
--     as, a change to the character identity's own revision.
--   - DELETE (canonical): gates on the image row's OWN revision, but ALSO bumps characters.revision
--     as a side effect (deleting an image changes the character's image SET, unlike an in-place
--     field edit, so a set-membership change is signalled through the identity's revision the same
--     way CREATE's set-membership change is).
-- location_media mirrors this exactly, substituting locations.revision for characters.revision:
-- create_location_media and delete_location_media (canonical scope) gate on/bump locations.revision
-- (via `expected_revision` compared against locations.revision); update_location_media (canonical
-- scope) gates on/bumps ONLY location_media.revision. This is what actually avoids the "editing a
-- caption spuriously conflicts with an unrelated Location profile edit" hazard the audit's
-- concurrency section (Q8) flagged -- and vice versa. Project-scoped mutations (all three) gate
-- on/bump projects.revision only, through the existing project_locations join, and never touch
-- locations.revision at all -- mirrors character_images' project branch exactly.
--
-- PRIMARY SEMANTICS: one primary per (scope, media_kind) -- the character precedent's "one primary
-- per scope" extended by exactly one dimension. Setting a row primary demotes the previous primary
-- of the SAME location_id-or-project_location_id AND the SAME media_kind only; a photo primary and
-- a map primary coexist independently. Delete of a primary promotes a deterministic fallback
-- (order by sort_order, id) within that same (scope, media_kind) pair, or none if none exists.
--
-- STORAGE_CLEANUP_REQUIRED: audited whether any existing RPC ever clears this flag back to false
-- for character_images -- it does not. Every migration that touches it
-- (20260827122152_cloud_character_image_storage.sql, 20260901120000_fix_character_image_update_
-- delete_p_ambiguity.sql) only ever sets it true on delete; js/cloud-character-image-api.js's
-- deleteImage() removes the Storage object client-side afterward but never calls back to clear the
-- flag. This is the actual, if asymmetric, established contract -- a permanent "this row was
-- deleted, verify its object" marker for out-of-band audit, not a live-cleared operational flag.
-- location_media reproduces this exactly rather than inventing a new clearing mechanism.
--
-- READ PATH (the one deliberate deviation from a naive character-image copy, per explicit
-- instruction not to call list_location_media once per Location during project hydration): this
-- migration adds ONE new RPC, list_location_media(target_location_id, target_project_location_id),
-- structurally identical to list_character_images, for a single Location's full media set (future
-- Profile lazy-load -- B4B). For the Gallery's cover-photo need across every participating Location
-- in one project, this migration instead extends get_project_content's existing per-location
-- projection with a single additive key, `primary_photo` -- a bounded correlated subquery against
-- location_media (canonical scope, media_kind='photo', is_primary, not deleted) that runs once per
-- location row already being enumerated in the SAME query get_project_content already issues on
-- every project load. This is a lean metadata-only projection (id/storage_path/mime_type/alt, never
-- bytes or a signed URL -- Postgres cannot sign Storage URLs, and a signed URL is a transient
-- runtime value per AGENTS.md, never canonical data) -- zero new RPC round trips, zero N+1, and
-- explicitly NOT "every media item for every Location" (which the audit itself warned against
-- loading eagerly). No other existing RPC (list_owned_locations, create_scene, etc.) is touched.
--
-- NO DATA BACKFILL: this migration creates one new table, one new bucket, and one new/extended
-- function surface. It does not ALTER any existing table's columns, does not UPDATE any existing
-- row, and does not touch any existing RLS policy or grant beyond get_project_content's own
-- pre-existing grant (re-stated identically).

-- ---------------------------------------------------------------------------
-- Step 0: verify the prerequisite unique constraint this migration's composite FK depends on
-- already exists. Fail closed (do not silently proceed) if it doesn't -- this migration must not
-- attempt to alter project_locations.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_locations'::regclass
      and conname = 'project_locations_location_id_id_key'
  ) then
    raise exception 'Location Media Foundation precondition failed: project_locations_location_id_id_key is missing -- this migration must not alter project_locations to add it.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 1: private Storage bucket. Idempotent upsert, mirroring the character-images bucket's own
-- on-conflict shape exactly.
-- ---------------------------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('location-media','location-media',false,8388608,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Step 2: location_media table. Ships revision + storage_cleanup_required from day one (see header
-- note -- character_images had to retrofit both).
-- ---------------------------------------------------------------------------
create table public.location_media (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  project_location_id uuid,
  media_kind text not null,
  storage_path text not null,
  mime_type text,
  crop jsonb not null default '{}'::jsonb,
  alt text not null default '',
  caption text not null default '',
  sort_order numeric(20,10) not null default 0,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  storage_cleanup_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint location_media_context_fkey
    foreign key (location_id, project_location_id)
    references public.project_locations(location_id, id)
    on delete cascade,
  constraint location_media_kind_check
    check (media_kind in ('photo','map','floorplan','other')),
  constraint location_media_storage_path_not_blank
    check (char_length(btrim(storage_path)) > 0),
  constraint location_media_crop_object check (jsonb_typeof(crop) = 'object'),
  constraint location_media_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint location_media_revision_nonnegative check (revision >= 0)
);

create unique index location_media_storage_path_unique_idx on public.location_media(storage_path);
create index location_media_location_idx on public.location_media(location_id) where deleted_at is null;
create index location_media_project_location_idx on public.location_media(project_location_id) where project_location_id is not null and deleted_at is null;
create unique index location_media_identity_primary_idx on public.location_media(location_id, media_kind)
  where project_location_id is null and is_primary and deleted_at is null;
create unique index location_media_project_primary_idx on public.location_media(project_location_id, media_kind)
  where project_location_id is not null and is_primary and deleted_at is null;

create trigger location_media_touch before update on public.location_media for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Step 3: path validation helper, mirroring private.character_image_path_valid exactly, substituting
-- the 'locations' path segment and locations-table ownership lookup.
-- ---------------------------------------------------------------------------
create or replace function private.location_media_path_valid(target_location_id uuid,target_path text)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from public.locations l
    where l.id=target_location_id
      and l.owner_id=(select auth.uid())
      and target_path=(l.owner_id::text||'/locations/'||l.id::text||'/'||split_part(target_path,'/',4)||'/'||split_part(target_path,'/',5))
      and split_part(target_path,'/',2)='locations'
      and split_part(target_path,'/',4)<>''
      and split_part(target_path,'/',5)~'^original\.(jpg|png|webp|gif)$'
  )
$$;
revoke all on function private.location_media_path_valid(uuid,text) from public,anon;
grant execute on function private.location_media_path_valid(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 4: RLS on location_media. private.location_owned(location_id) is sufficient authorization
-- for BOTH canonical and project-scoped rows: project_locations_owner_guard (Foundation schema)
-- already prevents a project_locations row from ever existing where the project's owner differs
-- from the location's owner, so "caller owns the canonical location" transitively implies "caller
-- owns any project that legitimately participates in it" -- the same reasoning that makes
-- character_images' RLS sufficient with only private.character_owned(character_id), no separate
-- project-ownership check needed at the table-RLS layer (the RPCs still check project ownership
-- explicitly for project-scoped mutations, same as create_character_image does).
-- ---------------------------------------------------------------------------
alter table public.location_media enable row level security;
revoke all on table public.location_media from public, anon, authenticated;
grant select, insert, update, delete on table public.location_media to authenticated;

create policy location_media_select on public.location_media for select to authenticated using (private.location_owned(location_id));
create policy location_media_insert on public.location_media for insert to authenticated with check (private.location_owned(location_id) and private.location_media_path_valid(location_id,storage_path));
create policy location_media_update on public.location_media for update to authenticated using (private.location_owned(location_id)) with check (private.location_owned(location_id) and private.location_media_path_valid(location_id,storage_path));
create policy location_media_delete on public.location_media for delete to authenticated using (private.location_owned(location_id));

-- ---------------------------------------------------------------------------
-- Step 5: Storage RLS for the location-media bucket, mirroring the character-images bucket's four
-- policies exactly, substituting the bucket id and the 'locations' path segment.
-- ---------------------------------------------------------------------------
create policy location_media_storage_select on storage.objects for select to authenticated using(bucket_id='location-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy location_media_storage_insert on storage.objects for insert to authenticated with check(bucket_id='location-media' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2]='locations');
create policy location_media_storage_update on storage.objects for update to authenticated using(bucket_id='location-media' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='location-media' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2]='locations');
create policy location_media_storage_delete on storage.objects for delete to authenticated using(bucket_id='location-media' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Step 6: list_location_media -- full media set for ONE canonical Location (future Profile
-- lazy-load, B4B). Structurally identical to list_character_images.
-- ---------------------------------------------------------------------------
create or replace function public.list_location_media(target_location_id uuid,target_project_location_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.location_owned(target_location_id) then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if target_project_location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=target_project_location_id and pl.location_id=target_location_id and pl.removed_at is null and private.project_owned(pl.project_id)) then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  return jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((
    select jsonb_agg(to_jsonb(m) order by m.sort_order,m.id)
    from public.location_media m
    where m.location_id=target_location_id and m.deleted_at is null
      and (m.project_location_id is null or m.project_location_id=target_project_location_id)
  ),'[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Step 7: create_location_media. Trimmed relative to create_character_image's parameter list --
-- no separate image_scope/idempotency_key parameters (see header/audit): scope is derived purely
-- from project_location_id being null or not, and media_id itself IS the idempotency key (a row
-- with that id already existing, matching location_id/project_location_id/storage_path, is treated
-- as an already-applied replay rather than a DUPLICATE -- the same retry-safety the character path
-- gets from its separate idempotency_key parameter, without the redundant second parameter that
-- must always equal the first).
-- ---------------------------------------------------------------------------
create or replace function public.create_location_media(
  media_id uuid,
  location_id uuid,
  project_location_id uuid,
  storage_path text,
  mime_type text,
  media_kind text,
  crop jsonb,
  alt text,
  caption text,
  sort_order numeric,
  is_primary boolean,
  metadata jsonb,
  expected_revision bigint
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  loc public.locations%rowtype;
  participation public.project_locations%rowtype;
  p public.projects%rowtype;
  item public.location_media%rowtype;
  new_location_revision bigint;
  new_project_revision bigint;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','changed',false); end if;

  if create_location_media.media_kind not in ('photo','map','floorplan','other') then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Invalid media kind.','changed',false);
  end if;
  if not private.location_media_path_valid(create_location_media.location_id,create_location_media.storage_path) then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Invalid storage path.','changed',false);
  end if;

  select * into item from public.location_media m0 where m0.id=create_location_media.media_id;
  if found then
    return case when item.location_id=create_location_media.location_id
        and item.project_location_id is not distinct from create_location_media.project_location_id
        and item.storage_path=create_location_media.storage_path
      then jsonb_build_object('ok',true,'code','OK','changed',false,'mediaRevision',item.revision,'data',to_jsonb(item))
      else jsonb_build_object('ok',false,'code','DUPLICATE','changed',false) end;
  end if;

  if create_location_media.project_location_id is null then
    select * into loc from public.locations l0 where l0.id=create_location_media.location_id and l0.owner_id=(select auth.uid()) and l0.deleted_at is null for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','changed',false); end if;
    if loc.revision<>expected_revision then
      return jsonb_build_object('ok',false,'code','LOCATION_REVISION_CONFLICT','message','Location changed in another session. Reload before saving.','expectedRevision',expected_revision,'actualRevision',loc.revision,'changed',false);
    end if;
  else
    select * into participation from public.project_locations pl0 where pl0.id=create_location_media.project_location_id and pl0.location_id=create_location_media.location_id and pl0.removed_at is null;
    if not found then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location participation not found.','changed',false); end if;
    select * into p from public.projects where id=participation.project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
    if p.revision<>expected_revision then
      return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false);
    end if;
  end if;

  if create_location_media.is_primary then
    update public.location_media set is_primary=false,revision=revision+1
    where location_id=create_location_media.location_id
      and project_location_id is not distinct from create_location_media.project_location_id
      and media_kind=create_location_media.media_kind
      and is_primary and deleted_at is null;
  end if;

  insert into public.location_media(id,location_id,project_location_id,storage_path,mime_type,media_kind,crop,alt,caption,sort_order,is_primary,metadata)
  values(
    create_location_media.media_id,create_location_media.location_id,create_location_media.project_location_id,
    create_location_media.storage_path,create_location_media.mime_type,create_location_media.media_kind,
    coalesce(create_location_media.crop,'{}'),coalesce(create_location_media.alt,''),coalesce(create_location_media.caption,''),
    coalesce(create_location_media.sort_order,0),coalesce(create_location_media.is_primary,false),coalesce(create_location_media.metadata,'{}')
  )
  returning * into item;

  if create_location_media.project_location_id is null then
    update public.locations set revision=revision+1,updated_at=now() where id=create_location_media.location_id returning revision into new_location_revision;
    return jsonb_build_object('ok',true,'code','OK','message','Media created.','changed',true,'locationRevision',new_location_revision,'mediaRevision',item.revision,'data',to_jsonb(item));
  else
    update public.projects set revision=revision+1,updated_at=now() where id=p.id returning revision into new_project_revision;
    return jsonb_build_object('ok',true,'code','OK','message','Media created.','changed',true,'revision',new_project_revision,'mediaRevision',item.revision,'data',to_jsonb(item));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 8: update_location_media. Canonical scope gates on/bumps ONLY the media row's own revision
-- (locations.revision untouched -- see header note); project scope gates on/bumps projects.revision
-- (location_media.revision still bumps too, as the row-level token for the NEXT edit). Primary
-- demotion is scoped to (location_id-or-project_location_id, media_kind) -- never crosses kinds.
-- ---------------------------------------------------------------------------
create or replace function public.update_location_media(
  target_media_id uuid,
  expected_revision bigint,
  media_crop jsonb default null,
  media_alt text default null,
  media_caption text default null,
  media_is_primary boolean default null,
  media_sort_order numeric default null,
  media_metadata jsonb default null
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item public.location_media%rowtype;
  p public.projects%rowtype;
  wanted jsonb;
  current_value jsonb;
  new_project_revision bigint;
begin
  select * into item from public.location_media where id=target_media_id and deleted_at is null and private.location_owned(location_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;

  if item.project_location_id is null then
    if item.revision<>expected_revision then
      return jsonb_build_object('ok',false,'code','LOCATION_MEDIA_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false);
    end if;
  else
    select p.* into p from public.projects p join public.project_locations pl on pl.project_id=p.id where pl.id=item.project_location_id and p.owner_id=(select auth.uid()) for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
    if p.revision<>expected_revision then
      return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false);
    end if;
  end if;

  wanted=jsonb_build_object('crop',coalesce(media_crop,item.crop),'alt',coalesce(media_alt,item.alt),'caption',coalesce(media_caption,item.caption),'sort_order',coalesce(media_sort_order,item.sort_order),'is_primary',coalesce(media_is_primary,item.is_primary),'metadata',coalesce(media_metadata,item.metadata));
  current_value=jsonb_build_object('crop',item.crop,'alt',item.alt,'caption',item.caption,'sort_order',item.sort_order,'is_primary',item.is_primary,'metadata',item.metadata);
  if wanted=current_value then
    return jsonb_build_object('ok',true,'code','OK','changed',false,'revision',p.revision,'mediaRevision',item.revision,'data',to_jsonb(item));
  end if;

  if coalesce(media_is_primary,false) then
    update public.location_media set is_primary=false,revision=revision+1
    where location_id=item.location_id and project_location_id is not distinct from item.project_location_id
      and media_kind=item.media_kind and id<>item.id and is_primary and deleted_at is null;
  end if;

  update public.location_media set
    crop=coalesce(media_crop,crop),alt=coalesce(media_alt,alt),caption=coalesce(media_caption,caption),
    sort_order=coalesce(media_sort_order,sort_order),is_primary=coalesce(media_is_primary,is_primary),metadata=coalesce(media_metadata,metadata),
    revision=revision+1
  where id=item.id returning * into item;

  if item.project_location_id is not null then
    update public.projects set revision=revision+1,updated_at=now() where id=p.id returning revision into new_project_revision;
  end if;

  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_project_revision,'mediaRevision',item.revision,'data',to_jsonb(item));
end $$;

-- ---------------------------------------------------------------------------
-- Step 9: delete_location_media. Soft-delete, storage_cleanup_required=true, deterministic fallback
-- primary within the same (scope, media_kind). Canonical scope gates on the row's own revision but
-- ALSO bumps locations.revision as a side effect (a deletion changes the identity's media SET, same
-- as delete_character_image bumping characters.revision -- see header note).
-- ---------------------------------------------------------------------------
create or replace function public.delete_location_media(target_media_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  item public.location_media%rowtype;
  fallback_id uuid;
  p public.projects%rowtype;
  new_location_revision bigint;
  new_project_revision bigint;
  was_primary boolean;
begin
  select * into item from public.location_media where id=target_media_id and deleted_at is null and private.location_owned(location_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;

  if item.project_location_id is null then
    if item.revision<>expected_revision then
      return jsonb_build_object('ok',false,'code','LOCATION_MEDIA_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false);
    end if;
  else
    select p.* into p from public.projects p join public.project_locations pl on pl.project_id=p.id where pl.id=item.project_location_id and p.owner_id=(select auth.uid()) for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
    if p.revision<>expected_revision then
      return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false);
    end if;
  end if;

  was_primary=item.is_primary;
  update public.location_media set deleted_at=now(),is_primary=false,storage_cleanup_required=true,revision=revision+1 where id=item.id returning * into item;

  if was_primary then
    select id into fallback_id from public.location_media
    where location_id=item.location_id and project_location_id is not distinct from item.project_location_id and media_kind=item.media_kind and deleted_at is null
    order by sort_order,id limit 1;
    if fallback_id is not null then update public.location_media set is_primary=true,revision=revision+1 where id=fallback_id; end if;
  end if;

  if item.project_location_id is null then
    update public.locations set revision=revision+1,updated_at=now() where id=item.location_id returning revision into new_location_revision;
    return jsonb_build_object('ok',true,'code','OK','changed',true,'locationRevision',new_location_revision,'storagePath',item.storage_path,'fallbackPrimaryId',fallback_id,'data',to_jsonb(item));
  else
    update public.projects set revision=revision+1,updated_at=now() where id=p.id returning revision into new_project_revision;
    return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_project_revision,'storagePath',item.storage_path,'fallbackPrimaryId',fallback_id,'data',to_jsonb(item));
  end if;
end $$;

do $$ declare signature text; begin foreach signature in array array[
  'public.list_location_media(uuid,uuid)',
  'public.create_location_media(uuid,uuid,uuid,text,text,text,jsonb,text,text,numeric,boolean,jsonb,bigint)',
  'public.update_location_media(uuid,bigint,jsonb,text,text,boolean,numeric,jsonb)',
  'public.delete_location_media(uuid,bigint)'
] loop execute format('revoke execute on function %s from public,anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop; end $$;

-- ---------------------------------------------------------------------------
-- Step 10: get_project_content read-path addition. Every previously existing key in the `locations`
-- projection keeps the exact same source expression (see 20260904120000_location_phase3_core_
-- identity.sql's own "READ MODEL" discipline) -- this adds exactly one new key, `primary_photo`, a
-- bounded per-row correlated subquery (canonical scope, media_kind='photo', is_primary, not
-- deleted). No signed URL here -- see header "READ PATH" note.
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
        'official_name',loc.official_name,'aliases',loc.aliases,
        'parent_id',loc.parent_id,'type_preset',loc.type_preset,'custom_type_label',loc.custom_type_label,
        'base_profile',loc.base_profile,'location_revision',loc.revision,
        'metadata',pl.metadata,'overrides',pl.overrides,'sort_order',pl.sort_order,
        'created_at',pl.created_at,'updated_at',pl.updated_at,
        'primary_photo',(
          select jsonb_build_object('id',lm.id,'storage_path',lm.storage_path,'mime_type',lm.mime_type,'alt',lm.alt)
          from public.location_media lm
          where lm.location_id=loc.id and lm.project_location_id is null and lm.media_kind='photo' and lm.is_primary and lm.deleted_at is null
          limit 1
        )
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
