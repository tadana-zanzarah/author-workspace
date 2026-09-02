-- True upgrade-path CI fixture, step 1 of 2 (see .github/workflows/location-foundation-ci.yml).
--
-- MUST run against a disposable local database where the migration chain has been applied
-- EXCLUDING 20260902120000_location_foundation_schema.sql -- i.e. the pre-Phase-1 schema,
-- where `public.locations` is still the original project-scoped table. This seeds a Location
-- and a Scene through the *unmodified* production RPC, exactly as real pre-Phase-1 production
-- data would have been created.
--
-- Ends with COMMIT, not ROLLBACK: this data must persist so location_upgrade_01_post_verify.sql
-- can find it once the migration under test has been applied on top via `supabase migration
-- up`. The fixture table and every row this script creates live only in the disposable CI
-- database, which is destroyed with the runner. An explicit transaction is required here (unlike
-- the rollback-style test files) because `SET LOCAL role` / `set_config(..., true)` only take
-- effect for the duration of a transaction block -- without one, each statement below would run
-- as its own auto-committed implicit transaction and the role switch would silently not apply
-- to the next statement (psql just warns "SET LOCAL can only be used in transaction blocks" and
-- create_location/create_scene would then run as the unrestricted connecting role instead of
-- as the intended `authenticated` user, defeating the point of exercising the real RLS path).

create table if not exists public._ci_location_upgrade_fixture(key text primary key, value text);

begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','9a000000-0000-4000-8000-000000000001','authenticated','authenticated','ci-upgrade-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','9b000000-0000-4000-8000-000000000001','authenticated','authenticated','ci-upgrade-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('9c000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','CI Upgrade Project',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','9a000000-0000-4000-8000-000000000001',true);

do $$
declare
  loc_result jsonb; loc_id uuid; loc_rev bigint;
  scene_result jsonb; scene_id uuid; scene_rev bigint;
  pre_content jsonb;
begin
  loc_result := public.create_location('9c000000-0000-4000-8000-000000000001'::uuid,0,'Pre-Migration Harbor','Seeded before Phase 1.');
  if not coalesce((loc_result->>'ok')::boolean,false) then raise exception 'pre-seed create_location failed: %', loc_result; end if;
  loc_id := (loc_result->'data'->>'id')::uuid;
  loc_rev := (loc_result->>'revision')::bigint;

  scene_result := public.create_scene('9c000000-0000-4000-8000-000000000001'::uuid,loc_rev,null,loc_id,'Pre-Migration Scene','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene_result->>'ok')::boolean,false) then raise exception 'pre-seed create_scene failed: %', scene_result; end if;
  scene_id := (scene_result->'data'->>'id')::uuid;
  scene_rev := (scene_result->>'revision')::bigint;

  pre_content := public.get_project_content('9c000000-0000-4000-8000-000000000001'::uuid);
  if not coalesce((pre_content->>'ok')::boolean,false) then raise exception 'pre-seed get_project_content failed: %', pre_content; end if;
  if jsonb_array_length(pre_content->'data'->'locations')<>1 then raise exception 'pre-seed get_project_content locations count wrong: %', pre_content->'data'->'locations'; end if;

  insert into public._ci_location_upgrade_fixture(key,value) values
    ('location_id', loc_id::text),
    ('scene_id', scene_id::text),
    ('project_id', '9c000000-0000-4000-8000-000000000001'),
    ('other_user_id', '9b000000-0000-4000-8000-000000000001'),
    ('pre_revision', scene_rev::text);
end $$;

reset role;
commit;
