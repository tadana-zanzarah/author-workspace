begin;

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','rls-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','rls-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects (id,owner_id,title) values
  ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Project A'),
  ('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Project B');

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);

do $$
declare
  visible_ids uuid[];
  affected integer;
begin
  select array_agg(id order by id) into visible_ids from public.projects;
  if visible_ids is distinct from array['aaaaaaaa-0000-4000-8000-000000000001'::uuid] then
    raise exception 'RLS failure: User A project visibility = %', visible_ids;
  end if;

  update public.projects set title='forbidden' where id='bbbbbbbb-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'RLS failure: User A updated Project B'; end if;

  update public.projects set title='allowed' where id='aaaaaaaa-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'RLS failure: User A cannot update Project A'; end if;
end
$$;

reset role;
rollback;
