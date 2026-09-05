-- Location Media B4A (20260907090000_location_media_foundation.sql) -- backend/storage foundation.
-- Part 1 is read-only shape/introspection (no wrapper, nothing written). Part 2 is transactional
-- RLS/RPC/concurrency behavior, run after the full migration chain, everything rolled back.

-- ===========================================================================
-- Part 1: shape / introspection (read-only).
-- ===========================================================================
do $$
declare
  n integer;
  actual text[];
  delete_action "char";
begin
  -- 1. table shape: exactly the contracted columns, no more, no less.
  select array_agg(column_name order by column_name) into actual from information_schema.columns where table_schema='public' and table_name='location_media';
  if actual is distinct from (select array_agg(x order by x) from unnest(array[
    'alt','caption','created_at','crop','deleted_at','id','is_primary','location_id','media_kind',
    'metadata','mime_type','project_location_id','revision','sort_order','storage_cleanup_required',
    'storage_path','updated_at'
  ]) x) then
    raise exception 'public.location_media columns = % (expected the contracted set)', actual;
  end if;

  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='location_id') <> 'NO' then
    raise exception 'location_media.location_id is nullable';
  end if;
  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='project_location_id') <> 'YES' then
    raise exception 'location_media.project_location_id must be nullable (v1 canonical-only UI, project-scope-capable schema)';
  end if;
  if (select column_default from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='revision') is distinct from '0' then
    raise exception 'location_media.revision must default to 0';
  end if;
  if (select column_default from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='storage_cleanup_required') is distinct from 'false' then
    raise exception 'location_media.storage_cleanup_required must default to false';
  end if;
  if (select numeric_precision from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='sort_order') <> 20
     or (select numeric_scale from information_schema.columns where table_schema='public' and table_name='location_media' and column_name='sort_order') <> 10 then
    raise exception 'location_media.sort_order is not numeric(20,10)';
  end if;

  -- 2. media_kind CHECK constraint exists with exactly the four approved values (compared as a
  --    set via the constraint's own definition text, not a brittle byte-exact string match against
  --    Postgres's internal IN->ANY(ARRAY[...]) rewrite formatting).
  declare kind_def text; begin
    select pg_get_constraintdef(oid) into kind_def from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_kind_check';
    if kind_def is null then raise exception 'location_media_kind_check missing'; end if;
    if not (kind_def like '%''photo''%' and kind_def like '%''map''%' and kind_def like '%''floorplan''%' and kind_def like '%''other''%') then
      raise exception 'location_media_kind_check does not list exactly the four approved kinds: %', kind_def;
    end if;
    if kind_def like '%''document''%' or kind_def like '%''video''%' or kind_def like '%''audio''%' then
      raise exception 'location_media_kind_check unexpectedly allows an out-of-scope kind: %', kind_def;
    end if;
  end;

  -- 3. storage_path nonblank, crop/metadata object, revision nonnegative CHECK constraints exist.
  if not exists (select 1 from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_storage_path_not_blank') then
    raise exception 'location_media_storage_path_not_blank missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_crop_object') then
    raise exception 'location_media_crop_object missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_metadata_object') then
    raise exception 'location_media_metadata_object missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_revision_nonnegative') then
    raise exception 'location_media_revision_nonnegative missing';
  end if;

  -- 4. composite scope-integrity FK targets project_locations(location_id,id) and CASCADEs,
  --    mirroring the CORRECTED (post-20260829122450) character_images precedent, not its original
  --    on-delete-restrict shape.
  select confdeltype into delete_action from pg_constraint where conrelid='public.location_media'::regclass and conname='location_media_context_fkey';
  if delete_action is distinct from 'c' then raise exception 'location_media_context_fkey must cascade on delete (got %)', delete_action; end if;
  if not exists (
    select 1 from pg_constraint con join pg_class c2 on c2.oid=con.confrelid
    where con.conname='location_media_context_fkey' and c2.relname='project_locations'
      and pg_get_constraintdef(con.oid) like '%(location_id, project_location_id)%project_locations(location_id, id)%'
  ) then raise exception 'location_media_context_fkey does not target project_locations(location_id,id)'; end if;

  -- 5. location_id's own FK to locations(id) is ON DELETE RESTRICT (defensive default, matches
  --    character_images.character_id).
  select confdeltype into delete_action from pg_constraint
    where conrelid='public.location_media'::regclass and contype='f'
      and confrelid='public.locations'::regclass and conname<>'location_media_context_fkey';
  if delete_action is distinct from 'r' then raise exception 'location_media.location_id FK must be ON DELETE RESTRICT (got %)', delete_action; end if;

  -- 6. required uniqueness/indexing: unique storage_path, active-media index by location_id,
  --    active project-scope index by project_location_id, one primary per canonical (location_id,
  --    media_kind), one primary per project (project_location_id, media_kind).
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='location_media' and indexname='location_media_storage_path_unique_idx') then
    raise exception 'location_media_storage_path_unique_idx missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='location_media' and indexname='location_media_location_idx') then
    raise exception 'location_media_location_idx missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='location_media' and indexname='location_media_project_location_idx') then
    raise exception 'location_media_project_location_idx missing';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid
    where ic.relname='location_media_identity_primary_idx' and i.indisunique and i.indpred is not null
  ) then raise exception 'location_media_identity_primary_idx missing or not a partial unique index'; end if;
  if not exists (
    select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid
    where ic.relname='location_media_project_primary_idx' and i.indisunique and i.indpred is not null
  ) then raise exception 'location_media_project_primary_idx missing or not a partial unique index'; end if;

  -- 7. RLS enabled, no anon exposure, authenticated scoped to CRUD only.
  if not (select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='location_media') then
    raise exception 'RLS not enabled on location_media';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='location_media' and grantee='anon') then
    raise exception 'anon has grants on location_media';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='location_media' and grantee='authenticated' and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')) then
    raise exception 'authenticated has excessive grants on location_media';
  end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='location_media';
  if n<>4 then raise exception 'location_media policy count = % (expected 4)', n; end if;

  -- 8. private bucket exists with the approved limit/mime allowlist, and is not accidentally public.
  if not exists (
    select 1 from storage.buckets where id='location-media' and public=false and file_size_limit=8388608
      and allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif']
  ) then raise exception 'location-media bucket missing or misconfigured'; end if;

  -- 9. Storage object policies exist (4), scoped to the new bucket.
  select count(*) into n from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in ('location_media_storage_select','location_media_storage_insert','location_media_storage_update','location_media_storage_delete');
  if n<>4 then raise exception 'location-media storage policy count = % (expected 4)', n; end if;

  -- 10. path-validation helper exists, security invoker (not definer).
  if not exists (select 1 from pg_proc where proname='location_media_path_valid' and pronamespace='private'::regnamespace) then
    raise exception 'private.location_media_path_valid missing';
  end if;
  if exists (select 1 from pg_proc where proname='location_media_path_valid' and pronamespace='private'::regnamespace and prosecdef) then
    raise exception 'private.location_media_path_valid must be SECURITY INVOKER, not DEFINER';
  end if;

  -- 11. the four RPCs exist and are all SECURITY INVOKER.
  if exists (
    select 1 from pg_proc where pronamespace='public'::regnamespace
      and proname in ('list_location_media','create_location_media','update_location_media','delete_location_media')
      and prosecdef
  ) then raise exception 'a location_media RPC is unexpectedly SECURITY DEFINER'; end if;
  if (select count(distinct proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_media','create_location_media','update_location_media','delete_location_media'))<>4 then
    raise exception 'one or more location_media RPCs missing';
  end if;

  -- 12. new table is empty on a fresh database.
  select count(*) into n from public.location_media; if n<>0 then raise exception 'location_media is not empty on a fresh database, count=%', n; end if;
end $$;

-- ===========================================================================
-- Part 2: transactional RLS/RPC/concurrency behavior. All fixtures rolled back.
-- ===========================================================================
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-media-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000002','authenticated','authenticated','loc-media-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Media A1',0),
('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Media B1',0);

insert into public.locations(id,owner_id,name,revision) values
('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Location A',0),
('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','Location B',0),
-- A second location owned by User A (not participating in project e2...03 at all), used only to
-- isolate the composite-FK/participation scope-mismatch test in Block D from the separate
-- cross-owner-path concern -- both are owned by the same user so path validation alone can never
-- explain a rejection here, only the composite FK / explicit participation lookup can.
('e3000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','Location A2',0);

insert into public.project_locations(id,project_id,location_id) values
('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001'),
('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002');

-- A second project participation of Location A, for the project-scope backend tests (never
-- exposed by any UI in B4A/B4B, but the RPC contract must still be correct and tested per the
-- task's explicit "tests must prove scope integrity if the RPC accepts it" requirement).
insert into public.projects(id,owner_id,title,revision) values ('e2000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','Media A2',0);
insert into public.project_locations(id,project_id,location_id) values ('e4000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);

-- ---------------------------------------------------------------------------
-- Block A: canonical create, primary uniqueness per media_kind, revision bump on create.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; photo_id uuid:='e5000000-0000-4000-8000-000000000001'; map_id uuid:='e5000000-0000-4000-8000-000000000002'; loc_a uuid:='e3000000-0000-4000-8000-000000000001'; begin
  r:=public.create_location_media(photo_id,loc_a,null,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000001/original.png','image/png','photo','{"x":0.5,"y":0.5,"zoom":1}','alt','caption',0,true,'{"future":"kept"}',0);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'canonical photo create failed: %', r; end if;
  if (r->>'locationRevision')::bigint<>1 then raise exception 'canonical create must bump locations.revision exactly once: %', r; end if;

  -- 9. canonical primary uniqueness per media_kind: a second photo primary must demote the first,
  --    never raise a uniqueness violation.
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000003',loc_a,null,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000003/original.png','image/png','photo','{}','','',1,true,'{}',1);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'second primary photo create must succeed via demotion, not conflict: %', r; end if;
  if (select is_primary from public.location_media where id=photo_id) then raise exception 'first photo primary was not demoted'; end if;
  if not (select is_primary from public.location_media where id='e5000000-0000-4000-8000-000000000003') then raise exception 'second photo primary was not set'; end if;

  -- 11. primary of photo does not conflict with primary map -- independent primaries per kind.
  r:=public.create_location_media(map_id,loc_a,null,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000002/original.png','image/png','map','{}','','',0,true,'{}',2);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'map primary create failed: %', r; end if;
  if not (select is_primary from public.location_media where id='e5000000-0000-4000-8000-000000000003') then raise exception 'setting a map primary must not demote the photo primary'; end if;
  if not (select is_primary from public.location_media where id=map_id) then raise exception 'map primary was not set'; end if;

  -- 4. invalid media_kind rejected cleanly by the RPC (VALIDATION_ERROR, not a raw constraint error).
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000004',loc_a,null,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000004/original.png','image/png','poster','{}','','',0,false,'{}',2);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'invalid media_kind was not rejected: %', r; end if;

  -- 22. path validation: wrong location id in the path segment must be rejected.
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000005',loc_a,null,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000099/e5000000-0000-4000-8000-000000000005/original.png','image/png','photo','{}','','',0,false,'{}',2);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'mismatched location id in storage_path was not rejected: %', r; end if;

  -- 22b. path validation: another user's owner segment must be rejected (cross-owner path).
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000006',loc_a,null,'e1000000-0000-4000-8000-000000000002/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000006/original.png','image/png','photo','{}','','',0,false,'{}',2);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'foreign owner segment in storage_path was not rejected: %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block B: update -- no-op does not bump revisions, stale row revision rejected, kind-scoped
-- primary demotion on update.
-- ---------------------------------------------------------------------------
-- Entering this block: photo2_id (e5...03) was inserted fresh in Block A (own revision defaults
-- to 0 -- ONLY the row being DEMOTED gets its revision bumped on create, never the new row itself)
-- and is the current canonical photo primary. locations.revision is 3 (Block A's three
-- successful canonical creates: photo, photo2, map).
do $$ declare r jsonb; photo2_id uuid:='e5000000-0000-4000-8000-000000000003'; begin
  -- 14. no-op update does not bump the media row revision.
  r:=public.update_location_media(photo2_id,0,'{}','','' ,true,1,'{}');
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'identical update must be a no-op: %', r; end if;
  if (select revision from public.location_media where id=photo2_id)<>0 then raise exception 'no-op update must not bump media revision'; end if;

  -- real change: caption edit must bump ONLY the media row's revision, never locations.revision.
  r:=public.update_location_media(photo2_id,0,null,null,'new caption',null,null,null);
  if not coalesce((r->>'ok')::boolean,false) or (r->>'mediaRevision')::bigint<>1 then raise exception 'caption update failed or did not bump mediaRevision: %', r; end if;
  if (select revision from public.locations where id='e3000000-0000-4000-8000-000000000001')<>3 then
    raise exception 'a plain media field update must never bump locations.revision (still expected 3, got %)', (select revision from public.locations where id='e3000000-0000-4000-8000-000000000001');
  end if;

  -- 15. stale media revision rejected (0 is now stale -- the real change above already moved the
  -- row to revision 1).
  r:=public.update_location_media(photo2_id,0,null,null,'stale caption',null,null,null);
  if r->>'code'<>'LOCATION_MEDIA_REVISION_CONFLICT' then raise exception 'stale media revision was not rejected: %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block C: delete -- soft delete, storage_cleanup_required, deterministic fallback primary,
-- locations.revision bump on delete, list excludes deleted rows.
-- ---------------------------------------------------------------------------
-- photo2_id's own revision is 1 entering this block (Block B's real change); locations.revision
-- is still 3 (an in-place field update never touches it -- see Block B).
do $$ declare r jsonb; photo2_id uuid:='e5000000-0000-4000-8000-000000000003'; loc_a uuid:='e3000000-0000-4000-8000-000000000001'; fallback uuid; n integer; begin
  r:=public.delete_location_media(photo2_id,1);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'primary photo delete failed: %', r; end if;
  if (r->>'locationRevision')::bigint<>4 then raise exception 'canonical delete must bump locations.revision exactly once more: %', r; end if;
  fallback:=(r->>'fallbackPrimaryId')::uuid;
  if fallback<>'e5000000-0000-4000-8000-000000000001' then raise exception 'fallback primary must be the deterministic (sort_order,id) survivor, got %', fallback; end if;
  if not (select is_primary from public.location_media where id='e5000000-0000-4000-8000-000000000001') then raise exception 'fallback primary was not promoted'; end if;

  -- 17/18. soft delete + storage_cleanup_required.
  if (select deleted_at from public.location_media where id=photo2_id) is null then raise exception 'deleted row was not soft-deleted'; end if;
  if not (select storage_cleanup_required from public.location_media where id=photo2_id) then raise exception 'storage_cleanup_required was not set on delete'; end if;
  if (select is_primary from public.location_media where id=photo2_id) then raise exception 'deleted row must not remain primary'; end if;

  -- 20. list/read does not expose deleted rows.
  select count(*) into n from public.location_media where location_id=loc_a and project_location_id is null and deleted_at is null;
  if jsonb_array_length(public.list_location_media(loc_a)->'data')<>n then
    raise exception 'list_location_media must return exactly the active rows, got %', public.list_location_media(loc_a);
  end if;
  if exists (select 1 from jsonb_array_elements(public.list_location_media(loc_a)->'data') x where (x->>'id')::uuid=photo2_id) then
    raise exception 'list_location_media must not expose a soft-deleted row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block D: canonical primary does not conflict with project-scoped primary of the same kind
-- (independent scopes) -- and project-scoped mutation gates on projects.revision, never
-- locations.revision, per the audit's explicit "never expose in UI, but backend must be correct"
-- instruction.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; loc_a uuid:='e3000000-0000-4000-8000-000000000001'; pl_a2 uuid:='e4000000-0000-4000-8000-000000000003'; loc_before_rev bigint; begin
  select revision into loc_before_rev from public.locations where id=loc_a;
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000007',loc_a,pl_a2,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000007/original.png','image/png','photo','{}','','',0,true,'{}',0);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'project-scoped photo create failed: %', r; end if;
  if r ? 'locationRevision' then raise exception 'project-scoped create must never report/bump locationRevision: %', r; end if;
  if (select revision from public.locations where id=loc_a)<>loc_before_rev then raise exception 'project-scoped create must never bump locations.revision'; end if;
  -- 12. canonical primary does not conflict with project primary (independent partial unique indexes).
  if not (select is_primary from public.location_media where id='e5000000-0000-4000-8000-000000000001') then
    raise exception 'an existing canonical primary must be unaffected by a NEW project-scoped primary of the same kind';
  end if;
  if not (select is_primary from public.location_media where id='e5000000-0000-4000-8000-000000000007') then raise exception 'project-scoped primary was not set'; end if;

  -- 8. composite project_location scope integrity: project_location_id from a DIFFERENT location
  --    (still owned by the SAME user, so this isolates the composite-FK/participation mismatch
  --    from the separate cross-owner-path concern already covered in Block A) must be rejected
  --    (VALIDATION_ERROR -- pl_a2's own location_id is loc_a, not Location A2).
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000008','e3000000-0000-4000-8000-000000000003',pl_a2,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000003/e5000000-0000-4000-8000-000000000008/original.png','image/png','photo','{}','','',0,false,'{}',0);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'mismatched project_location_id/location_id scope was not rejected: %', r; end if;

  -- 16. stale project revision rejected.
  r:=public.create_location_media('e5000000-0000-4000-8000-000000000009',loc_a,pl_a2,'e1000000-0000-4000-8000-000000000001/locations/e3000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000009/original.png','image/png','map','{}','','',0,false,'{}',0);
  if r->>'code'<>'REVISION_CONFLICT' then raise exception 'stale project revision was not rejected: %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block E: cross-user isolation -- RLS and RPC NOT_FOUND, no cross-user leakage.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; loc_b uuid:='e3000000-0000-4000-8000-000000000002'; n integer; begin
  -- 21. cross-user RPC attempts rejected: User A cannot list against User B's Location.
  r:=public.list_location_media(loc_b);
  if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user list_location_media must report NOT_FOUND, got %', r; end if;
  -- A cross-user create attempt is caught even earlier, by path validation itself (private.
  -- location_media_path_valid's own lookup filters by owner_id=auth.uid(), so it can never resolve
  -- a location owned by someone else) -- VALIDATION_ERROR, not NOT_FOUND. This mirrors the
  -- established character_images precedent exactly: supabase/tests/cloud_character_image_storage.sql
  -- asserts the same VALIDATION_ERROR code for a foreign-path create attempt.
  r:=public.create_location_media('e5000000-0000-4000-8000-00000000000a',loc_b,null,'e1000000-0000-4000-8000-000000000002/locations/e3000000-0000-4000-8000-000000000002/e5000000-0000-4000-8000-00000000000a/original.png','image/png','photo','{}','','',0,false,'{}',0);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'cross-user create_location_media must be rejected by path validation (VALIDATION_ERROR), got %', r; end if;

  -- 6/7. RLS owner isolation: a direct table select of another owner's rows must be empty.
  select count(*) into n from public.location_media where location_id=loc_b;
  if n<>0 then raise exception 'RLS leak: User A can see User B Location media rows directly'; end if;
end $$;

select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
do $$ declare n integer; begin
  -- Reverse direction: User B must not see User A's location_media rows either.
  select count(*) into n from public.location_media where location_id='e3000000-0000-4000-8000-000000000001';
  if n<>0 then raise exception 'RLS leak: User B can see User A Location media rows directly'; end if;
end $$;

reset role;
rollback;
