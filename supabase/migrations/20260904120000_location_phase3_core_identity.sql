-- Location Architecture V2 Phase 3: canonical core identity (official_name/aliases/type/parent)
-- + a real canonical-revision concurrency contract + server-side hierarchy cycle prevention.
--
-- Almost function-only: every column this phase writes to (official_name, aliases, parent_id,
-- type_preset, custom_type_label, base_profile) already exists on public.locations since the
-- Phase 1 Foundation schema (20260902120000). The ONE exception, found while implementing
-- Correction 3 below, is `alter table ... alter column type_preset drop not null / drop default`
-- -- everything else is function bodies only. No backfill.
--
-- BACKWARD COMPATIBILITY (critical -- the published Phase A frontend must keep working the
-- moment this migration is applied, before any Phase B frontend exists):
--   create_location / update_location / delete_location / get_project_content are left
--   COMPLETELY UNTOUCHED by this migration (not even a `create or replace` of the same body) --
--   this file does not reference them except in this comment. The Phase A UI (js/locations.js)
--   only ever calls create_location/update_location with (name, description); that contract is
--   physically unchanged.
--
--   A brand new distinct-name RPC pair is added for the Phase B-capable path instead of adding
--   optional parameters to the existing functions: `create_location_canonical` and
--   `update_location_canonical`. Two reasons this was chosen over overloading update_location
--   with extra optional params (see Phase B audit "Correction 4"):
--     1. PostgREST resolves an RPC call by matching the JSON body's keys against a function's
--        parameter names; giving update_location a new optional `expected_location_revision`
--        parameter defaulting to NULL would let it be silently omitted by a caller, which is
--        exactly the "new callers can accidentally skip revision checking" hazard the task
--        explicitly ruled out -- there would be no way to make the check mandatory for new
--        callers while keeping it fully absent for the unpublished-when-this-lands old ones.
--     2. Two functions of the same public name but different parameter lists (real Postgres
--        overloading) is supported by PostgREST, but only unambiguously when the two signatures'
--        parameter-name sets don't overlap in a way that makes a given JSON payload match more
--        than one candidate; keeping the legacy and canonical paths as two entirely different
--        names removes that ambiguity surface completely rather than relying on overload
--        resolution behavior this repo has never exercised in CI before.
--   Old path (unpublished-frontend-safe): create_location / update_location -- unchanged,
--     project-revision-gated only, exactly as Phase 2 left them.
--   New path (Phase B-capable, mandatory canonical revision): create_location_canonical /
--     update_location_canonical / set_location_parent -- expected_location_revision (or, for
--     create, the fact that a freshly inserted row's revision is always 0) is a required
--     parameter with no default that silently disables the check.
--
-- CANONICAL REVISION CONCURRENCY (the audit's accepted finding): update_location bumps
-- locations.revision but only ever checked the PROJECT's expected_revision -- never a
-- caller-supplied expected value for the canonical row itself, unlike update_character's
-- characterRevision contract (20260822120000_cloud_character_transaction_rpc.sql). Now that
-- Phase B's product direction is "canonical Location is global and reusable across projects",
-- that gap becomes a real cross-project lost-update hazard. update_location_canonical and
-- set_location_parent both lock the `locations` row (`for update`) and require the caller's
-- `expected_location_revision` to match, mirroring update_character exactly: they are pure
-- global-identity mutations and do NOT take a project id or touch any project's revision, same
-- as update_character never does. The new failure code, LOCATION_REVISION_CONFLICT, follows the
-- exact established per-entity-type naming/shape pattern (CHARACTER_REVISION_CONFLICT,
-- GLOBAL_LINK_REVISION_CONFLICT) rather than inventing a new response shape.
-- create_location_canonical is still project-scoped (it creates the participation row in the
-- same transaction, mirroring create_character_and_attach) and continues to gate on + bump the
-- project's revision, exactly like the legacy create_location.
--
-- HIERARCHY: parent changes go through a dedicated `set_location_parent` RPC, never through
-- create_location_canonical or update_location_canonical, so cycle-prevention logic has exactly
-- one call site. Creating a location WITH a parent is still safe to allow inline in
-- create_location_canonical without any cycle walk: a location that doesn't exist yet cannot
-- already be an ancestor of anything, so attaching a parent at creation time is structurally
-- cycle-free -- only *moving* an existing location's parent needs the ancestor-chain check.
--
-- BASE_PROFILE SHAPE (per Correction 1/2 -- explicitly NOT what the original audit proposed):
-- `base_profile.description` keeps its existing top-level location exactly as Phase A already
-- writes it -- no shape migration, no backfill. The only addition is a sibling top-level key,
-- `base_profile.shortSummary`, for the short Gallery/Profile summary; thematic modules (Phase B3,
-- not built here) will live as their own sibling keys (`geography`, `populationCulture`, ...).
-- Every canonical write in this migration merges onto base_profile with the jsonb `||` operator
-- (`item.base_profile || jsonb_build_object('description',...,'shortSummary',...)`), which
-- overwrites only the two named top-level keys and leaves any other key -- including module keys
-- this phase never writes -- byte-for-byte untouched. Tested explicitly (see
-- supabase/tests/location_phase3_core_identity.sql, case 12).
--
-- TYPE PRESET (per Correction 3): type_preset must be nullable (NULL = "not specified"). Audited
-- and found the ONE real schema conflict this phase has to fix: the Phase 1 Foundation migration
-- declared `type_preset text not null default 'other'` (20260902120000_location_foundation_schema.sql:48)
-- -- a hard NOT NULL with a silently-applied default, exactly the "every existing/new Location
-- gets classified as other" outcome Correction 3 rules out. This migration drops both the
-- NOT NULL and the default (Step 0 below) so a canonical row can genuinely have no type opinion
-- going forward. This is a narrow, additive, non-rewriting ALTER: existing rows already carrying
-- 'other' from the Phase 1 default keep that literal value unchanged (no backfill converts them
-- to NULL -- Correction 3 also rules out silently reclassifying legacy data, and there is no
-- honest way to tell "the app defaulted this" apart from "the writer picked Other" after the
-- fact). Deliberately still no CHECK/enum constraint and no RPC-side enum validation --
-- `type_preset` was already designed in the Phase 1 schema as preset-plus-custom-label, not a
-- rigid taxonomy. Only a soft length guard is applied in the RPCs (defends against pathological
-- input, not a taxonomy decision).
--
-- READ MODEL: get_project_content's `locations` projection gains official_name, aliases,
-- parent_id, type_preset, custom_type_label, base_profile (whole object) and location_revision.
-- Every previously existing key (id, project_id, location_id, name, description, metadata,
-- overrides, sort_order, created_at, updated_at) is preserved with the exact same source
-- expression as before, so the already-published Phase A hydration
-- (js/cloud-project-sync.js:85, which only reads id/name/description/location_id) keeps working
-- unchanged -- it simply ignores the new fields.
--
-- GLOBAL PARENT/BREADCRUMB READ SURFACE: get_project_content only ever returns Locations
-- participating in the current project, but a parent may be a canonical ancestor that doesn't
-- participate in this project at all. Rather than build a bespoke breadcrumb RPC, this migration
-- adds `list_owned_locations()`, mirroring the existing `list_characters()` global-identity list
-- RPC exactly (owner-scoped, whole-row projection, same response shape) -- Phase B2's parent
-- picker and breadcrumb rendering can both be built by walking parent_id over one full
-- owner-scoped fetch, the same way the frontend already walks projectCharacterId/characterId maps
-- client-side. This is the minimum new read surface Phase B2 needs; no separate breadcrumb RPC.

-- ---------------------------------------------------------------------------
-- Step 0: the one real table change (see TYPE PRESET note above). A metadata-only ALTER on
-- Postgres -- no table rewrite, no row touched, existing 'other' values are left exactly as they
-- are. Safe to run on a live table under concurrent read/write load.
-- ---------------------------------------------------------------------------
alter table public.locations alter column type_preset drop not null;
alter table public.locations alter column type_preset drop default;

-- ---------------------------------------------------------------------------
-- Helper: alias normalization at the RPC boundary (trim, drop blanks, case-insensitive dedupe,
-- first-occurrence order preserved). Pure, no table access -- mirrors the shape of the existing
-- private.location_owned helper for the explicit authenticated-execute grant it needs since it's
-- called from a SECURITY INVOKER public function (schema `private` revokes all from public by
-- default, per 20260812193655_cloud_foundation.sql:107).
-- ---------------------------------------------------------------------------
create or replace function private.normalize_location_aliases(raw text[])
returns text[] language sql immutable security invoker set search_path = ''
as $$
  select coalesce(array_agg(alias order by first_ord), '{}'::text[])
  from (
    select (array_agg(btrim(a) order by ord))[1] as alias, min(ord) as first_ord
    from unnest(coalesce(raw,'{}'::text[])) with ordinality as u(a, ord)
    where btrim(a) <> ''
    group by lower(btrim(a))
  ) dedup
$$;
grant execute on function private.normalize_location_aliases(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- New create path: canonical core identity + project participation in one transaction, same
-- shape as create_character_and_attach. Legacy create_location is untouched and remains the
-- Phase A contract.
-- ---------------------------------------------------------------------------
create or replace function public.create_location_canonical(
  target_project_id uuid,
  expected_revision bigint,
  location_name text,
  location_official_name text default null,
  location_aliases text[] default '{}',
  location_type_preset text default null,
  location_custom_type_label text default null,
  location_description text default '',
  location_short_summary text default null,
  target_parent_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  p public.projects%rowtype;
  new_location public.locations%rowtype;
  participation public.project_locations%rowtype;
  new_revision bigint;
  trimmed_name text;
  safe_official_name text;
  safe_type_preset text;
  safe_custom_label text;
  safe_description text;
  safe_short_summary text;
  normalized_aliases text[];
  new_base_profile jsonb;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;

  trimmed_name:=btrim(coalesce(location_name,''));
  if char_length(trimmed_name) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','revision',p.revision,'changed',false); end if;

  safe_official_name:=nullif(btrim(coalesce(location_official_name,'')),'');
  if safe_official_name is not null and char_length(safe_official_name)>300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Official name is too long.','revision',p.revision,'changed',false); end if;

  -- type_preset is deliberately NOT validated against an enum here -- see the migration header
  -- (Correction 3): preset-plus-custom-label was always the intended design, NULL means
  -- "not specified", and only a soft length guard applies.
  safe_type_preset:=nullif(btrim(coalesce(location_type_preset,'')),'');
  if safe_type_preset is not null and char_length(safe_type_preset)>60 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location type is invalid.','revision',p.revision,'changed',false); end if;

  safe_custom_label:=nullif(btrim(coalesce(location_custom_type_label,'')),'');
  if safe_custom_label is not null and char_length(safe_custom_label)>300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Custom type label is too long.','revision',p.revision,'changed',false); end if;

  normalized_aliases:=private.normalize_location_aliases(location_aliases);

  -- Ownership check kept explicit (in addition to the locations_owner_parent_fkey composite FK)
  -- so a bad parent id returns a clean domain error instead of a raw FK-violation, matching the
  -- existing chapter/location checks inside create_scene/update_scene.
  if target_parent_id is not null and not exists(select 1 from public.locations where id=target_parent_id and owner_id=p.owner_id and deleted_at is null) then
    return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Parent location not found.','revision',p.revision,'changed',false);
  end if;

  safe_description:=coalesce(location_description,'');
  safe_short_summary:=coalesce(location_short_summary,'');
  new_base_profile:=jsonb_build_object('description',safe_description,'shortSummary',safe_short_summary);

  insert into public.locations(owner_id,name,official_name,aliases,parent_id,type_preset,custom_type_label,base_profile)
  values(p.owner_id,trimmed_name,safe_official_name,normalized_aliases,target_parent_id,safe_type_preset,safe_custom_label,new_base_profile)
  returning * into new_location;

  insert into public.project_locations(project_id,location_id) values(target_project_id,new_location.id) returning * into participation;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;

  return jsonb_build_object('ok',true,'code','OK','message','Location created.','revision',new_revision,'changed',true,'data',jsonb_build_object(
    'id',participation.id,'project_id',participation.project_id,'location_id',new_location.id,
    'name',new_location.name,'official_name',new_location.official_name,'aliases',new_location.aliases,
    'parent_id',new_location.parent_id,'type_preset',new_location.type_preset,'custom_type_label',new_location.custom_type_label,
    'base_profile',new_location.base_profile,'location_revision',new_location.revision,
    'description',coalesce(new_location.base_profile->>'description',''),
    'metadata',participation.metadata,'overrides',participation.overrides,'sort_order',participation.sort_order,
    'created_at',participation.created_at,'updated_at',participation.updated_at
  ));
end $$;

-- ---------------------------------------------------------------------------
-- New update path: pure global-identity mutation (no project_id, no project revision -- mirrors
-- update_character exactly). Requires the canonical location's OWN expected_revision. Merges
-- description/shortSummary into base_profile with `||` so any other key (future modules) is left
-- untouched. Legacy update_location is unchanged and remains the Phase A contract.
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
  location_short_summary text default null
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

  normalized_aliases:=private.normalize_location_aliases(location_aliases);
  safe_description:=coalesce(location_description,'');
  safe_short_summary:=coalesce(location_short_summary,'');
  merged_base_profile:=item.base_profile || jsonb_build_object('description',safe_description,'shortSummary',safe_short_summary);

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
-- Dedicated hierarchy mutation RPC: the only path allowed to change parent_id. Locks the row,
-- requires canonical expected_revision, rejects self-parent (schema already does via
-- locations_not_own_parent, this returns a clean domain error first), rejects cross-owner parents
-- (schema already does via locations_owner_parent_fkey composite FK, same reasoning), and walks
-- the proposed parent's ancestor chain server-side to reject any cycle -- the schema cannot detect
-- a multi-level cycle by itself. Bounded at depth 64 (generous for any realistic
-- World->Continent->...->Room chain) and fails CLOSED (rejects the move) if the chain doesn't
-- terminate within that bound, rather than assuming safety.
-- ---------------------------------------------------------------------------
create or replace function public.set_location_parent(
  target_location_id uuid,
  expected_location_revision bigint,
  target_parent_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.locations%rowtype;
  cycle_detected boolean;
  chain_truncated boolean;
begin
  select * into item from public.locations where id=target_location_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','changed',false); end if;
  if item.revision<>expected_location_revision then
    return jsonb_build_object('ok',false,'code','LOCATION_REVISION_CONFLICT','message','Location changed in another session. Reload before saving.','entityId',target_location_id,'expectedRevision',expected_location_revision,'actualRevision',item.revision,'changed',false);
  end if;

  if target_parent_id=target_location_id then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','A location cannot be its own parent.','locationRevision',item.revision,'changed',false);
  end if;

  if item.parent_id is not distinct from target_parent_id then
    return jsonb_build_object('ok',true,'code','OK','message','Parent unchanged.','locationRevision',item.revision,'changed',false,'data',jsonb_build_object('location_id',item.id,'parent_id',item.parent_id,'location_revision',item.revision,'updated_at',item.updated_at));
  end if;

  if target_parent_id is not null then
    if not exists(select 1 from public.locations where id=target_parent_id and owner_id=(select auth.uid()) and deleted_at is null) then
      return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Parent location not found.','locationRevision',item.revision,'changed',false);
    end if;

    with recursive ancestors(id,depth) as (
      select target_parent_id,1
      union all
      select l.parent_id,a.depth+1
      from ancestors a join public.locations l on l.id=a.id
      where l.parent_id is not null and a.depth<64
    )
    select
      exists(select 1 from ancestors where id=target_location_id),
      exists(select 1 from ancestors a join public.locations l on l.id=a.id where a.depth=64 and l.parent_id is not null)
    into cycle_detected,chain_truncated;

    if chain_truncated then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location hierarchy is too deep to verify safely.','locationRevision',item.revision,'changed',false);
    end if;
    if cycle_detected then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','This would create a hierarchy cycle.','locationRevision',item.revision,'changed',false);
    end if;
  end if;

  update public.locations set parent_id=target_parent_id,revision=revision+1 where id=target_location_id returning * into item;

  return jsonb_build_object('ok',true,'code','OK','message','Location parent updated.','locationRevision',item.revision,'changed',true,'data',jsonb_build_object('location_id',item.id,'parent_id',item.parent_id,'location_revision',item.revision,'updated_at',item.updated_at));
end $$;

-- ---------------------------------------------------------------------------
-- Owner-scoped canonical location listing, mirroring list_characters() exactly. Gives Phase B2 a
-- complete list to build a parent picker + client-side breadcrumb walk from, without a bespoke
-- breadcrumb RPC and without querying public.locations directly from UI code outside the
-- established RPC-encapsulation pattern this app already uses for every other global identity.
-- ---------------------------------------------------------------------------
create or replace function public.list_owned_locations()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select case when (select auth.uid()) is null
  then jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false)
  else jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((
    select jsonb_agg(to_jsonb(l) order by lower(l.name),l.id)
    from public.locations l where l.owner_id=(select auth.uid()) and l.deleted_at is null
  ),'[]'::jsonb)) end $$;

-- ---------------------------------------------------------------------------
-- Read model: extend the locations projection with the new canonical fields + location_revision.
-- Every field that existed before this migration keeps the exact same key name and source
-- expression -- this is a pure additive change to the shape Phase A's hydration already reads.
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
