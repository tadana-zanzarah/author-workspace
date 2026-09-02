-- Location Foundation Schema (Architecture V2 Phase 1) -- shape/introspection assertions.
-- Run against a fully migrated database. Read-only: nothing is written, nothing to roll back.
do $$
declare
  fk_target text;
  n integer;
  expected_location_cols text[] := array['archived_at','aliases','base_profile','created_at','custom_type_label','deleted_at','id','metadata','name','official_name','owner_id','parent_id','revision','sort_order','type_preset','updated_at'];
  expected_project_location_cols text[] := array['created_at','id','location_id','metadata','overrides','project_id','removed_at','sort_order','updated_at'];
  actual text[];
begin
  -- 1. Legacy table survived the rename with its original (project-scoped) shape.
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='location_projects_legacy_v1') then
    raise exception 'location_projects_legacy_v1 is missing -- rename did not happen';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='locations' and table_type='BASE TABLE') then
    raise exception 'new public.locations table is missing';
  end if;
  select array_agg(column_name order by column_name) into actual from information_schema.columns where table_schema='public' and table_name='location_projects_legacy_v1';
  if not (actual @> array['project_id','name','description','metadata','created_at','updated_at','deleted_at']) then
    raise exception 'location_projects_legacy_v1 lost original columns: %', actual;
  end if;

  -- 2. New global `locations` table matches the Foundation contract exactly (no more, no less).
  select array_agg(column_name order by column_name) into actual from information_schema.columns where table_schema='public' and table_name='locations';
  if actual is distinct from (select array_agg(x order by x) from unnest(expected_location_cols) x) then
    raise exception 'public.locations columns = % (expected %)', actual, expected_location_cols;
  end if;
  if (select data_type from information_schema.columns where table_schema='public' and table_name='locations' and column_name='aliases') <> 'ARRAY' then
    raise exception 'locations.aliases is not an array column';
  end if;
  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='locations' and column_name='name') <> 'NO' then
    raise exception 'locations.name is nullable';
  end if;
  if (select column_default from information_schema.columns where table_schema='public' and table_name='locations' and column_name='type_preset') is distinct from '''other''::text' then
    raise exception 'locations.type_preset default = %', (select column_default from information_schema.columns where table_schema='public' and table_name='locations' and column_name='type_preset');
  end if;
  if (select numeric_precision from information_schema.columns where table_schema='public' and table_name='locations' and column_name='sort_order') <> 20
     or (select numeric_scale from information_schema.columns where table_schema='public' and table_name='locations' and column_name='sort_order') <> 10 then
    raise exception 'locations.sort_order is not numeric(20,10)';
  end if;

  -- 3. `project_locations` matches the Foundation contract exactly.
  select array_agg(column_name order by column_name) into actual from information_schema.columns where table_schema='public' and table_name='project_locations';
  if actual is distinct from (select array_agg(x order by x) from unnest(expected_project_location_cols) x) then
    raise exception 'public.project_locations columns = % (expected %)', actual, expected_project_location_cols;
  end if;

  -- 4. Required unique constraints exist, and the (project_id, location_id) one is NOT partial
  --    (must apply to removed rows too -- foundation for future reactivate-in-place semantics).
  select count(*) into n from pg_constraint con join pg_class c on c.oid=con.conrelid
    where c.relname='project_locations' and con.contype='u' and pg_get_constraintdef(con.oid) like '%(project_id, location_id)%';
  if n<>1 then raise exception 'unique(project_id,location_id) missing on project_locations'; end if;
  if exists (
    select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid
    where ic.relname='project_locations_project_location_key' and i.indpred is not null
  ) then raise exception 'project_locations unique(project_id,location_id) is partial (must not be)'; end if;

  select count(*) into n from pg_constraint con join pg_class c on c.oid=con.conrelid
    where c.relname='project_locations' and con.contype='u' and pg_get_constraintdef(con.oid) like '%(project_id, id)%';
  if n<>1 then raise exception 'unique(project_id,id) missing on project_locations'; end if;
  select count(*) into n from pg_constraint con join pg_class c on c.oid=con.conrelid
    where c.relname='project_locations' and con.contype='u' and pg_get_constraintdef(con.oid) like '%(location_id, id)%';
  if n<>1 then raise exception 'unique(location_id,id) missing on project_locations'; end if;

  select count(*) into n from pg_constraint con join pg_class c on c.oid=con.conrelid
    where c.relname='locations' and con.contype='u' and pg_get_constraintdef(con.oid) like '%(owner_id, id)%';
  if n<>1 then raise exception 'unique(owner_id,id) missing on locations'; end if;

  -- 5. Composite same-owner parent FK exists on locations.
  if not exists (
    select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid
    where c.relname='locations' and con.contype='f' and pg_get_constraintdef(con.oid) like '%(owner_id, parent_id)%locations(owner_id, id)%'
  ) then raise exception 'locations_owner_parent_fkey composite FK missing'; end if;

  -- 6. Owner-guard trigger present on project_locations, mirroring project_characters.
  if not exists (select 1 from information_schema.triggers where event_object_schema='public' and event_object_table='project_locations' and trigger_name='project_locations_owner_guard') then
    raise exception 'project_locations_owner_guard trigger missing';
  end if;

  -- 7. RLS enabled on both new tables, no anon exposure, authenticated scoped to CRUD only.
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname in ('locations','project_locations') and c.relrowsecurity) <> 2 then
    raise exception 'RLS not enabled on both new location tables';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('locations','project_locations') and grantee='anon') then
    raise exception 'anon has grants on new location tables';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('locations','project_locations') and grantee='authenticated' and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')) then
    raise exception 'authenticated has excessive grants on new location tables';
  end if;

  -- 8. Foundation index list (Architecture V2 §N) -- exactly these, nothing speculative.
  -- Excludes PK/UNIQUE-constraint-backing indexes (checked separately in §4/§5 above) via
  -- pg_index/pg_constraint, not a '%_pkey' name-pattern match: the legacy table already holds
  -- the constraint name `locations_pkey`, so the new table's own PK index gets
  -- auto-disambiguated to `locations_pkey1`, which a suffix-based name filter would miss.
  select array_agg(ic.relname order by ic.relname) into actual
  from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_class t on t.oid=i.indrelid join pg_namespace ns on ns.oid=t.relnamespace
  where ns.nspname='public' and t.relname='locations' and not i.indisprimary and not exists (select 1 from pg_constraint con where con.conindid=i.indexrelid);
  if actual is distinct from array['locations_owner_idx','locations_owner_name_idx','locations_owner_type_idx','locations_parent_idx'] then
    raise exception 'locations indexes = %', actual;
  end if;
  select array_agg(ic.relname order by ic.relname) into actual
  from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_class t on t.oid=i.indrelid join pg_namespace ns on ns.oid=t.relnamespace
  where ns.nspname='public' and t.relname='project_locations' and not i.indisprimary and not exists (select 1 from pg_constraint con where con.conindid=i.indexrelid);
  if actual is distinct from array['project_locations_location_idx','project_locations_project_sort_idx'] then
    raise exception 'project_locations indexes = %', actual;
  end if;
  if exists (select 1 from pg_indexes where schemaname='public' and tablename='locations' and indexname like '%alias%') then
    raise exception 'unexpected alias index exists (GIN aliases index is explicitly deferred in Phase 1)';
  end if;

  -- 9. The legacy table's own index/RLS/policy survived the rename by OID (not re-created).
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='location_projects_legacy_v1' and indexname='locations_project_idx') then
    raise exception 'locations_project_idx missing on renamed legacy table';
  end if;
  if not (select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='location_projects_legacy_v1') then
    raise exception 'RLS disabled on legacy table after rename';
  end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='location_projects_legacy_v1';
  if n<>4 then raise exception 'legacy table policy count = % (expected 4: select/insert/update/delete)', n; end if;
  if not exists (select 1 from information_schema.triggers where event_object_schema='public' and event_object_table='location_projects_legacy_v1' and trigger_name='locations_touch') then
    raise exception 'locations_touch trigger missing on legacy table after rename';
  end if;

  -- 10. THE critical guarantee: scenes.location_id FK still targets the renamed legacy table,
  --     resolved by OID (pg_constraint.confrelid), not by the new empty `locations` table that
  --     now happens to hold the old name. No FK cutover has happened in this phase.
  select c2.relname into fk_target
  from pg_constraint con join pg_class c1 on c1.oid=con.conrelid join pg_class c2 on c2.oid=con.confrelid
  where c1.relname='scenes' and con.conname='scenes_project_location_fkey';
  if fk_target is distinct from 'location_projects_legacy_v1' then
    raise exception 'scenes_project_location_fkey now targets % (expected location_projects_legacy_v1 -- FK cutover must not happen in Phase 1)', fk_target;
  end if;

  -- 11. New tables are empty -- no backfill happened in this phase.
  select count(*) into n from public.locations; if n<>0 then raise exception 'new locations table is not empty (backfill must not happen in Phase 1), count=%', n; end if;
  select count(*) into n from public.project_locations; if n<>0 then raise exception 'new project_locations table is not empty (backfill must not happen in Phase 1), count=%', n; end if;
end $$;
