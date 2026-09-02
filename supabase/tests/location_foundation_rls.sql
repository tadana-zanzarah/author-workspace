-- Location Foundation Schema (Architecture V2 Phase 1) -- two-user isolation + owner-guard.
-- No RPC exists yet for the new tables (Phase 1 is schema-only), so this exercises the raw
-- RLS/trigger contract directly, the same way cloud_content_rls.sql exercises project_characters.
-- Everything is rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','e1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-rls-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000001','authenticated','authenticated','loc-rls-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title) values
('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','A'),
('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','B');

-- Seed one global location per user directly as the table owner (RLS-exempt), so the
-- owner-guard trigger test below can run before any RLS role switch happens.
insert into public.locations(id,owner_id,name) values
('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','A Location'),
('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','B Location');

-- 0. Owner-guard trigger rejects a cross-owner participation row even when RLS itself is
--    bypassed (table owner / outside the normal frontend path) -- the trigger, not RLS, is
--    the last line of defense here.
do $$ begin
  insert into public.project_locations(project_id,location_id) values ('e2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
  raise exception 'owner-guard trigger accepted a cross-owner project/location pair';
exception when check_violation then null;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);

do $$ declare visible uuid[]; n integer; begin
  -- 1. User A sees only their own global location.
  select array_agg(id order by id) into visible from public.locations;
  if visible is distinct from array['e3000000-0000-4000-8000-000000000001'::uuid] then raise exception 'A location visibility = %', visible; end if;

  -- 2. User A cannot mutate User B's global location.
  update public.locations set name='forbidden' where id='f3000000-0000-4000-8000-000000000001';
  get diagnostics n=row_count; if n<>0 then raise exception 'A updated B global location'; end if;

  -- 3. User A cannot insert a location owned by User B.
  begin
    insert into public.locations(owner_id,name) values ('f1000000-0000-4000-8000-000000000001','sneaky');
    raise exception 'A created a location owned by B';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- 4. User A can attach their own location to their own project.
  insert into public.project_locations(project_id,location_id) values ('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
  select count(*) into n from public.project_locations where project_id='e2000000-0000-4000-8000-000000000001' and location_id='e3000000-0000-4000-8000-000000000001';
  if n<>1 then raise exception 'A could not attach own location to own project'; end if;

  -- 5. User A cannot attach their own location to User B's project.
  begin
    insert into public.project_locations(project_id,location_id) values ('f2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
    raise exception 'A attached own location to B project';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- 6. User A cannot attach User B's location to their own project.
  begin
    insert into public.project_locations(project_id,location_id) values ('e2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
    raise exception 'A attached B location to own project';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);

do $$ declare visible uuid[]; n integer; begin
  -- 7. User B sees only their own global location, and cannot see A's participation row.
  select array_agg(id order by id) into visible from public.locations;
  if visible is distinct from array['f3000000-0000-4000-8000-000000000001'::uuid] then raise exception 'B location visibility = %', visible; end if;
  select count(*) into n from public.project_locations;
  if n<>0 then raise exception 'B can see A project_locations row(s), count=%', n; end if;
end $$;

reset role;
set local role anon;
do $$ begin
  if has_table_privilege('anon','public.locations','select') then raise exception 'anon has select on locations'; end if;
  if has_table_privilege('anon','public.project_locations','select') then raise exception 'anon has select on project_locations'; end if;
end $$;
reset role;

rollback;
