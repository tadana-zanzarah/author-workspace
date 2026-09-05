-- Location History H-events (20260908100000_location_history_events_foundation.sql) --
-- location_history_events backend foundation. Part 1 is read-only shape/introspection (no wrapper,
-- nothing written). Part 2 is transactional RLS/RPC/concurrency/import behavior, run after the full
-- migration chain, everything rolled back.

-- ===========================================================================
-- Part 1: shape / introspection (read-only).
-- ===========================================================================
do $$
declare
  n integer;
  actual text[];
begin
  -- 1. table shape: exactly the contracted columns, no more, no less -- notably no
  --    project_location_id, no sort_key, no event_type (explicitly rejected by product decision).
  select array_agg(column_name order by column_name) into actual from information_schema.columns where table_schema='public' and table_name='location_history_events';
  if actual is distinct from (select array_agg(x order by x) from unnest(array[
    'created_at','date_label','deleted_at','description','id','location_id','metadata','revision',
    'sort_order','title','updated_at'
  ]) x) then
    raise exception 'public.location_history_events columns = % (expected exactly the minimal contracted set, no project_location_id/sort_key/event_type)', actual;
  end if;

  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='location_id') <> 'NO' then
    raise exception 'location_history_events.location_id is nullable';
  end if;
  if (select is_nullable from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='title') <> 'NO' then
    raise exception 'location_history_events.title is nullable';
  end if;
  if (select column_default from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='revision') is distinct from '0' then
    raise exception 'location_history_events.revision must default to 0';
  end if;
  if (select column_default from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='date_label') is null then
    raise exception 'location_history_events.date_label must have a default (empty string)';
  end if;
  if (select data_type from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='date_label') <> 'text' then
    raise exception 'location_history_events.date_label must be free-form text, not date/timestamptz';
  end if;
  if (select numeric_precision from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='sort_order') <> 20
     or (select numeric_scale from information_schema.columns where table_schema='public' and table_name='location_history_events' and column_name='sort_order') <> 10 then
    raise exception 'location_history_events.sort_order is not numeric(20,10)';
  end if;

  -- 2. required CHECK constraints exist.
  if not exists (select 1 from pg_constraint where conrelid='public.location_history_events'::regclass and conname='location_history_events_title_not_blank') then
    raise exception 'location_history_events_title_not_blank missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.location_history_events'::regclass and conname='location_history_events_metadata_object') then
    raise exception 'location_history_events_metadata_object missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.location_history_events'::regclass and conname='location_history_events_revision_nonnegative') then
    raise exception 'location_history_events_revision_nonnegative missing';
  end if;

  -- 3. location_id FK to locations(id) is ON DELETE RESTRICT (defensive default, matches
  --    location_media.location_id).
  if (select confdeltype from pg_constraint where conrelid='public.location_history_events'::regclass and contype='f' and confrelid='public.locations'::regclass) <> 'r' then
    raise exception 'location_history_events.location_id FK must be ON DELETE RESTRICT';
  end if;

  -- 4. required indexes: active-events-by-location, ordering index.
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='location_history_events' and indexname='location_history_events_location_idx') then
    raise exception 'location_history_events_location_idx missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='location_history_events' and indexname='location_history_events_order_idx') then
    raise exception 'location_history_events_order_idx missing';
  end if;

  -- 5. RLS enabled, no anon exposure, authenticated scoped to CRUD only, exactly 4 policies.
  if not (select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='location_history_events') then
    raise exception 'RLS not enabled on location_history_events';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='location_history_events' and grantee='anon') then
    raise exception 'anon has grants on location_history_events';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='location_history_events' and grantee='authenticated' and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')) then
    raise exception 'authenticated has excessive grants on location_history_events';
  end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='location_history_events';
  if n<>4 then raise exception 'location_history_events policy count = % (expected 4)', n; end if;

  -- 6. the four RPCs exist and are all SECURITY INVOKER (never DEFINER -- no proven need here).
  if exists (
    select 1 from pg_proc where pronamespace='public'::regnamespace
      and proname in ('list_location_history_events','create_location_history_event','update_location_history_event','delete_location_history_event')
      and prosecdef
  ) then raise exception 'a location_history_events RPC is unexpectedly SECURITY DEFINER'; end if;
  if (select count(distinct proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('list_location_history_events','create_location_history_event','update_location_history_event','delete_location_history_event'))<>4 then
    raise exception 'one or more location_history_events RPCs missing';
  end if;

  -- 7. no project-scope overload exists for any of the four RPCs (canonical-only, by product
  --    decision -- unlike location_media, there must be exactly ONE signature per RPC name).
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='create_location_history_event')<>1 then
    raise exception 'create_location_history_event must have exactly one signature (canonical-only, no project-scope overload)';
  end if;

  -- 8. new table is empty on a fresh database.
  select count(*) into n from public.location_history_events; if n<>0 then raise exception 'location_history_events is not empty on a fresh database, count=%', n; end if;
end $$;

-- ===========================================================================
-- Part 2: transactional RLS/RPC/concurrency/import behavior. All fixtures rolled back.
-- ===========================================================================
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-hist-events-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000002','authenticated','authenticated','loc-hist-events-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','History Events A1',0),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','History Events B1',0);

insert into public.locations(id,owner_id,name,revision) values
('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Location A',0),
('a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','Location B',0);

insert into public.project_locations(id,project_id,location_id) values
('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001'),
('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

-- ---------------------------------------------------------------------------
-- Block A: create -- title required, canonical create bumps locations.revision exactly once,
-- stale location revision rejected, event's own revision starts at 0.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; loc_a uuid:='a3000000-0000-4000-8000-000000000001'; event1 uuid:='a5000000-0000-4000-8000-000000000001'; begin
  -- blank title rejected cleanly (VALIDATION_ERROR, not a raw constraint error).
  r:=public.create_location_history_event('a5000000-0000-4000-8000-000000000099',loc_a,'   ','','',0,'{}',0);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'blank title on create was not rejected: %', r; end if;

  r:=public.create_location_history_event(event1,loc_a,'Пожар уничтожил северное крыло','около 1240 года','Пожар начался ночью и распространился быстро.',0,'{}',0);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'canonical event create failed: %', r; end if;
  if (r->>'locationRevision')::bigint<>1 then raise exception 'canonical create must bump locations.revision exactly once: %', r; end if;
  if (r->>'eventRevision')::bigint<>0 then raise exception 'a freshly created event must start at revision 0: %', r; end if;
  if (select date_label from public.location_history_events where id=event1)<>'около 1240 года' then raise exception 'free-form date_label was not stored verbatim'; end if;

  -- stale location revision rejected.
  r:=public.create_location_history_event('a5000000-0000-4000-8000-000000000002',loc_a,'Second event','','',1,'{}',0);
  if r->>'code'<>'LOCATION_REVISION_CONFLICT' then raise exception 'stale expected_revision on create was not rejected: %', r; end if;

  -- idempotent retry: same event id + matching location -> ok, changed:false, no duplicate row, no
  -- second locations.revision bump.
  r:=public.create_location_history_event(event1,loc_a,'Пожар уничтожил северное крыло','около 1240 года','Пожар начался ночью и распространился быстро.',0,'{}',1);
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean is distinct from false then raise exception 'idempotent replay of an already-applied create must be ok/changed:false: %', r; end if;
  if (select count(*) from public.location_history_events where id=event1)<>1 then raise exception 'idempotent replay must not create a duplicate row'; end if;
  if (select revision from public.locations where id=loc_a)<>1 then raise exception 'idempotent replay must not bump locations.revision again'; end if;

  -- same event id, DIFFERENT location -> DUPLICATE (id collision across a different owner scope).
  r:=public.create_location_history_event(event1,'a3000000-0000-4000-8000-000000000002','Different location event','','',0,'{}',0);
  if r->>'code'<>'DUPLICATE' then raise exception 'reusing an existing event id against a different location must report DUPLICATE: %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block B: ordering -- list returns active events ordered by sort_order,id regardless of insert
-- order; fantasy/blank date labels accepted verbatim.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; loc_a uuid:='a3000000-0000-4000-8000-000000000001'; rev bigint; ids uuid[]; begin
  select revision into rev from public.locations where id=loc_a;
  r:=public.create_location_history_event('a5000000-0000-4000-8000-000000000010',loc_a,'Основание Академии','незадолго до основания Академии','',2,'{}',rev); rev:=(r->>'locationRevision')::bigint;
  r:=public.create_location_history_event('a5000000-0000-4000-8000-000000000011',loc_a,'Легендарное происхождение','за три века до войны','',1,'{}',rev); rev:=(r->>'locationRevision')::bigint;
  r:=public.create_location_history_event('a5000000-0000-4000-8000-000000000012',loc_a,'Событие без даты','','неизвестно когда это произошло',3,'{}',rev); rev:=(r->>'locationRevision')::bigint;
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'ordering fixture create failed: %', r; end if;

  select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(public.list_location_history_events(loc_a)->'data') x;
  -- Expected order (sort_order,id): event1 (0), a5...11 (1), a5...10 (2), a5...12 (3).
  if ids<>array['a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000011','a5000000-0000-4000-8000-000000000010','a5000000-0000-4000-8000-000000000012']::uuid[] then
    raise exception 'list_location_history_events did not return events ordered by (sort_order,id): %', ids;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block C: update -- no-op does not bump anything, real change bumps ONLY the event's own
-- revision (never locations.revision), stale event revision rejected, blank title on update
-- rejected.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; event1 uuid:='a5000000-0000-4000-8000-000000000001'; loc_a uuid:='a3000000-0000-4000-8000-000000000001'; loc_rev_before bigint; begin
  select revision into loc_rev_before from public.locations where id=loc_a;

  -- identical resubmit is a no-op.
  r:=public.update_location_history_event(event1,0,'Пожар уничтожил северное крыло','около 1240 года','Пожар начался ночью и распространился быстро.',0,'{}');
  if not coalesce((r->>'ok')::boolean,false) or (r->>'changed')::boolean<>false then raise exception 'identical update must be a no-op: %', r; end if;
  if (select revision from public.location_history_events where id=event1)<>0 then raise exception 'no-op update must not bump the event revision'; end if;

  -- real change: description edit must bump ONLY the event row's revision, never locations.revision.
  r:=public.update_location_history_event(event1,0,null,null,'Новое описание пожара.',null,null);
  if not coalesce((r->>'ok')::boolean,false) or (r->>'eventRevision')::bigint<>1 then raise exception 'description update failed or did not bump eventRevision: %', r; end if;
  if (select revision from public.locations where id=loc_a)<>loc_rev_before then
    raise exception 'a plain event field update must never bump locations.revision (still expected %, got %)', loc_rev_before, (select revision from public.locations where id=loc_a);
  end if;

  -- stale event revision rejected (0 is now stale -- the real change above already moved it to 1).
  r:=public.update_location_history_event(event1,0,null,null,'stale description',null,null);
  if r->>'code'<>'LOCATION_HISTORY_EVENT_REVISION_CONFLICT' then raise exception 'stale event revision was not rejected: %', r; end if;

  -- clearing the title to blank is rejected (title remains required on update, not just create).
  r:=public.update_location_history_event(event1,1,'   ',null,null,null,null);
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'blank title on update was not rejected: %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block D: delete -- soft delete, event's own revision bumps, locations.revision bumps once more,
-- list excludes the deleted row.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; event1 uuid:='a5000000-0000-4000-8000-000000000001'; loc_a uuid:='a3000000-0000-4000-8000-000000000001'; loc_rev_before bigint; n integer; begin
  select revision into loc_rev_before from public.locations where id=loc_a;
  r:=public.delete_location_history_event(event1,1);
  if not coalesce((r->>'ok')::boolean,false) then raise exception 'event delete failed: %', r; end if;
  if (r->>'locationRevision')::bigint<>loc_rev_before+1 then raise exception 'canonical delete must bump locations.revision exactly once more: %', r; end if;
  if (select deleted_at from public.location_history_events where id=event1) is null then raise exception 'deleted row was not soft-deleted'; end if;
  if (select revision from public.location_history_events where id=event1)<>2 then raise exception 'delete must also bump the event''s own revision (expected 2, got %)', (select revision from public.location_history_events where id=event1); end if;

  select count(*) into n from public.location_history_events where location_id=loc_a and deleted_at is null;
  if jsonb_array_length(public.list_location_history_events(loc_a)->'data')<>n then
    raise exception 'list_location_history_events must return exactly the active rows';
  end if;
  if exists (select 1 from jsonb_array_elements(public.list_location_history_events(loc_a)->'data') x where (x->>'id')::uuid=event1) then
    raise exception 'list_location_history_events must not expose a soft-deleted row';
  end if;

  -- stale (already-deleted) event revision rejected as NOT_FOUND, not a silent success.
  r:=public.delete_location_history_event(event1,2);
  if r->>'code'<>'NOT_FOUND' then raise exception 'deleting an already-deleted event must report NOT_FOUND, got %', r; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Block E: cross-user isolation -- RLS and RPC NOT_FOUND, no cross-user leakage.
-- ---------------------------------------------------------------------------
do $$ declare r jsonb; loc_b uuid:='a3000000-0000-4000-8000-000000000002'; n integer; begin
  r:=public.list_location_history_events(loc_b);
  if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user list_location_history_events must report NOT_FOUND, got %', r; end if;

  r:=public.create_location_history_event('a5000000-0000-4000-8000-000000000020',loc_b,'Cross owner attempt','','',0,'{}',0);
  if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user create_location_history_event must report NOT_FOUND, got %', r; end if;

  select count(*) into n from public.location_history_events where location_id=loc_b;
  if n<>0 then raise exception 'RLS leak: User A can see User B location_history_events rows directly'; end if;
end $$;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
do $$ declare n integer; begin
  select count(*) into n from public.location_history_events where location_id='a3000000-0000-4000-8000-000000000001';
  if n<>0 then raise exception 'RLS leak: User B can see User A location_history_events rows directly'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Block F: local->cloud import -- nested per-location history_events land in
-- location_history_events with the correct canonical location_id and manual order preserved;
-- a malformed (blank-title) event is dropped, not rejected; get_local_project_import_snapshot
-- surfaces the imported events for post-import verification.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
do $$
declare
  import_project uuid:='a2000000-0000-4000-8000-000000000003';
  payload jsonb; result jsonb; canonical_id uuid; snapshot jsonb; events jsonb;
begin
  insert into public.projects(id,owner_id,title,revision) values (import_project,'a1000000-0000-4000-8000-000000000001','Import Target History Events',0);

  payload:=jsonb_build_object(
    'project_id',import_project::text,'source_project_id','history-events-full-snapshot','migration_attempt_id','a7000000-0000-4000-8000-000000000001',
    'characters','[]'::jsonb,'chapters','[]'::jsonb,
    'locations',jsonb_build_array(jsonb_build_object(
      'id','a8000000-0000-4000-8000-000000000001','name','Imported City','description','Survived import.',
      'history_events',jsonb_build_array(
        jsonb_build_object('id','a9000000-0000-4000-8000-000000000001','title','Основание города','date_label','около 800 года','description','','sort_order',0),
        jsonb_build_object('id','a9000000-0000-4000-8000-000000000002','title','Гражданская война','date_label','','description','Долгий период смуты.','sort_order',1),
        jsonb_build_object('id','a9000000-0000-4000-8000-000000000003','title','   ','date_label','должно быть отброшено','description','','sort_order',2)
      )
    )),
    'tags','[]'::jsonb,'scenes','[]'::jsonb,'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,
    'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb
  );
  result:=public.import_local_project_content(import_project,0,'a7000000-0000-4000-8000-000000000001'::uuid,'history-events-full-snapshot',payload);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'F: history-events-carrying import failed: %', result; end if;
  select location_id into canonical_id from public.project_locations where id='a8000000-0000-4000-8000-000000000001' and project_id=import_project;

  if (select count(*) from public.location_history_events where location_id=canonical_id)<>2 then
    raise exception 'F: expected exactly 2 events to survive import (the blank-title one dropped), got %', (select count(*) from public.location_history_events where location_id=canonical_id);
  end if;
  if not exists (select 1 from public.location_history_events where id='a9000000-0000-4000-8000-000000000001' and location_id=canonical_id and title='Основание города' and date_label='около 800 года' and sort_order=0) then
    raise exception 'F: first imported event did not land with the expected fields';
  end if;
  if not exists (select 1 from public.location_history_events where id='a9000000-0000-4000-8000-000000000002' and location_id=canonical_id and description='Долгий период смуты.' and sort_order=1) then
    raise exception 'F: second imported event did not land with the expected fields';
  end if;
  if exists (select 1 from public.location_history_events where id='a9000000-0000-4000-8000-000000000003') then
    raise exception 'F: blank-title malformed event must be dropped, not imported';
  end if;
  if (result->'created'->>'historyEvents')::int<>3 then
    raise exception 'F: created.historyEvents count must reflect the payload count (3), not the post-sanitization count: %', result;
  end if;

  -- get_local_project_import_snapshot must surface the imported events for post-import
  -- verification, scoped to this project via project_locations.
  snapshot:=public.get_local_project_import_snapshot(import_project);
  if not coalesce((snapshot->>'ok')::boolean,false) then raise exception 'F: get_local_project_import_snapshot failed: %', snapshot; end if;
  events:=snapshot->'data'->'location_history_events';
  if jsonb_array_length(events)<>2 then raise exception 'F: import snapshot must list exactly the 2 surviving events, got %', events; end if;
end $$;
reset role;

rollback;
