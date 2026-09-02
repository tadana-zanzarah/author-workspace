-- True upgrade-path CI fixture, step 2 of 2, for Location Architecture V2 Phase 2.
--
-- MUST run after location_phase2_00_pre_seed.sql seeded the pre-Phase-2 database AND after
-- `supabase migration up` applied 20260903120000_location_phase2_cutover.sql alone on top (no
-- other migration re-runs, no reset). Verifies the backfill/FK-cutover invariants against real
-- pre-existing data: preserved participation ids, no name-based dedup, unchanged
-- scenes.location_id values, the flipped FK target, the locked-down legacy table, and the new
-- RPC surface working end-to-end against the migrated rows.
--
-- Local variables below are named fixture_project_id/fixture_owner_id (not project_id/owner_id)
-- to avoid PL/pgSQL's default plpgsql.variable_conflict='error' behavior, which raises "column
-- reference is ambiguous" at runtime when a bare identifier in a query could mean either a
-- declared variable or a same-named table column (e.g. `where project_id=project_id`).

do $$
declare
  fixture_project_id uuid; fixture_owner_id uuid;
  loc1_id uuid; loc2_id uuid; scene1_id uuid; scene2_id uuid;
  canonical1 uuid; canonical2 uuid;
  n integer; fk_target text;
begin
  select value::uuid into fixture_project_id from public._ci_location_phase2_fixture where key='project_id';
  select value::uuid into fixture_owner_id from public._ci_location_phase2_fixture where key='owner_id';
  select value::uuid into loc1_id from public._ci_location_phase2_fixture where key='location1_id';
  select value::uuid into loc2_id from public._ci_location_phase2_fixture where key='location2_id';
  select value::uuid into scene1_id from public._ci_location_phase2_fixture where key='scene1_id';
  select value::uuid into scene2_id from public._ci_location_phase2_fixture where key='scene2_id';
  if fixture_project_id is null or loc1_id is null or loc2_id is null or scene1_id is null or scene2_id is null then
    raise exception 'fixture missing -- location_phase2_00_pre_seed.sql did not run before the migration was applied';
  end if;

  -- 1. Legacy rows survived untouched, under their original ids, in the (still-present) legacy
  --    table.
  select count(*) into n from public.location_projects_legacy_v1 where id in (loc1_id,loc2_id) and project_id=fixture_project_id and name='Old Harbor';
  if n<>2 then raise exception 'pre-migration legacy location rows missing/changed after migration'; end if;

  -- 2. Preserved-id invariant: project_locations.id = legacy.id for BOTH pre-existing rows.
  select location_id into canonical1 from public.project_locations where id=loc1_id and project_id=fixture_project_id;
  select location_id into canonical2 from public.project_locations where id=loc2_id and project_id=fixture_project_id;
  if canonical1 is null or canonical2 is null then raise exception 'backfill did not preserve legacy ids as project_locations ids'; end if;

  -- 3. No name-based dedup: two same-named legacy rows got two DISTINCT canonical identities.
  if canonical1=canonical2 then raise exception 'backfill incorrectly deduped two same-named legacy Locations into one canonical identity'; end if;
  select count(*) into n from public.locations where id in (canonical1,canonical2) and name='Old Harbor' and owner_id=fixture_owner_id;
  if n<>2 then raise exception 'expected 2 distinct canonical Old Harbor locations after backfill, found %', n; end if;
  select count(*) into n from public.locations where id=canonical1 and base_profile->>'description'='Seeded before Phase 2, copy 1.';
  if n<>1 then raise exception 'canonical location #1 description was not seeded from legacy description'; end if;
  select count(*) into n from public.locations where id=canonical2 and base_profile->>'description'='Seeded before Phase 2, copy 2 (same name).';
  if n<>1 then raise exception 'canonical location #2 description was not seeded from legacy description'; end if;

  -- 4. scenes.location_id is BYTE-FOR-BYTE unchanged by the cutover (still the legacy row id,
  --    now interpreted as a project_locations.id).
  select count(*) into n from public.scenes where id=scene1_id and location_id=loc1_id and project_id=fixture_project_id;
  if n<>1 then raise exception 'scene #1 location_id changed after migration'; end if;
  select count(*) into n from public.scenes where id=scene2_id and location_id=loc2_id and project_id=fixture_project_id;
  if n<>1 then raise exception 'scene #2 location_id changed after migration'; end if;

  -- 5. The FK now targets project_locations, not the legacy table or the bare `locations` table.
  select c2.relname into fk_target
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey';
  if fk_target is distinct from 'project_locations' then
    raise exception 'scenes_project_location_fkey targets % after migration (expected project_locations)', fk_target;
  end if;

  -- 6. No orphans: every scene location reference resolves through project_locations.
  select count(*) into n from public.scenes s where s.location_id is not null and not exists(select 1 from public.project_locations pl where pl.id=s.location_id and pl.project_id=s.project_id);
  if n<>0 then raise exception '% scene(s) orphaned after the FK cutover', n; end if;

  -- 7. Legacy table is locked to read-only: authenticated no longer has write privileges.
  if has_table_privilege('authenticated','public.location_projects_legacy_v1','INSERT') then raise exception 'authenticated still has INSERT on legacy table after migration'; end if;
  if has_table_privilege('authenticated','public.location_projects_legacy_v1','UPDATE') then raise exception 'authenticated still has UPDATE on legacy table after migration'; end if;
  if has_table_privilege('authenticated','public.location_projects_legacy_v1','DELETE') then raise exception 'authenticated still has DELETE on legacy table after migration'; end if;
  if not has_table_privilege('authenticated','public.location_projects_legacy_v1','SELECT') then raise exception 'authenticated lost SELECT on legacy table (must remain observable)'; end if;
end $$;

-- Role-switching sections need their own explicit transaction (SET LOCAL role / set_config only
-- take effect for the duration of a transaction block).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000001',true);

do $$
declare
  fixture_project_id uuid; loc1_id uuid; scene1_id uuid;
  content jsonb; rev bigint; r jsonb; n integer;
begin
  select value::uuid into fixture_project_id from public._ci_location_phase2_fixture where key='project_id';
  select value::uuid into loc1_id from public._ci_location_phase2_fixture where key='location1_id';
  select value::uuid into scene1_id from public._ci_location_phase2_fixture where key='scene1_id';

  -- 8. get_project_content hydrates the pre-existing rows through the new join, same flat shape.
  content:=public.get_project_content(fixture_project_id);
  if not coalesce((content->>'ok')::boolean,false) then raise exception 'post-migration get_project_content failed: %', content; end if;
  if jsonb_array_length(content->'data'->'locations')<>2 then raise exception 'post-migration get_project_content locations count wrong: %', content->'data'->'locations'; end if;
  if not exists(select 1 from jsonb_array_elements(content->'data'->'locations') x where (x->>'id')::uuid=loc1_id and x->>'name'='Old Harbor') then
    raise exception 'post-migration get_project_content missing the pre-existing location under its preserved id: %', content->'data'->'locations';
  end if;
  rev:=(content->>'revision')::bigint;

  -- 9. update_location (new-model) still operates on the pre-existing participation id.
  r:=public.update_location(fixture_project_id,loc1_id,rev,'Old Harbor','Repaired after the Phase 2 migration.');
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'post-migration update_location failed: %', r; end if;
  rev:=(r->>'revision')::bigint;
  select count(*) into n from public.locations where id=(select location_id from public.project_locations where id=loc1_id) and base_profile->>'description'='Repaired after the Phase 2 migration.';
  if n<>1 then raise exception 'post-migration update_location did not update the canonical row';  end if;

  -- 10. delete_location (new-model) refuses because scene1 still references it.
  r:=public.delete_location(fixture_project_id,loc1_id,rev);
  if coalesce((r->>'ok')::boolean,false) or r->>'code'<>'DEPENDENCIES_EXIST' then raise exception 'post-migration delete_location did not refuse a referenced pre-existing location: %', r; end if;

  -- 11. Clearing the scene reference then allows delete_location to soft-remove participation,
  --     without touching the canonical identity or the (untouched) legacy row.
  r:=public.update_scene(fixture_project_id,scene1_id,rev,null,null,'Scene At Copy 1','',null,null,'placed','draft',true,false);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'post-migration update_scene (clear location) failed: %', r; end if;
  rev:=(r->>'revision')::bigint;
  r:=public.delete_location(fixture_project_id,loc1_id,rev);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'post-migration delete_location failed once unreferenced: %', r; end if;
  select count(*) into n from public.project_locations where id=loc1_id and removed_at is not null;
  if n<>1 then raise exception 'post-migration delete_location did not soft-remove participation'; end if;
  select count(*) into n from public.location_projects_legacy_v1 where id=loc1_id;
  if n<>1 then raise exception 'post-migration delete_location touched the legacy observation row (must never happen)'; end if;
end $$;

reset role;
commit;

drop table public._ci_location_phase2_fixture;
