-- True upgrade-path CI fixture, step 1 of 2, for Location Architecture V2 Phase 2 (mirrors the
-- Phase 1 convention in location_upgrade_00_pre_seed.sql / location_upgrade_01_post_verify.sql
-- and the workflow structure in .github/workflows/location-foundation-ci.yml).
--
-- MUST run against a disposable local database where the migration chain has been applied
-- EXCLUDING 20260903120000_location_phase2_cutover.sql -- i.e. the post-Phase-1 schema, where
-- `location_projects_legacy_v1` is still the live backing store for Locations and
-- scenes.location_id still targets it. Seeds two same-named legacy Locations (to prove the
-- Phase 2 backfill must NOT dedup them) and two Scenes -- one referencing each -- through the
-- *unmodified* pre-Phase-2 production RPC, exactly as real pre-Phase-2 production data would
-- have been created.
--
-- Ends with COMMIT, not ROLLBACK: this data must persist so location_phase2_01_post_verify.sql
-- can find it once 20260903120000_location_phase2_cutover.sql has been applied on top via
-- `supabase migration up`.

create table if not exists public._ci_location_phase2_fixture(key text primary key, value text);

begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-8000-000000000001','authenticated','authenticated','ci-p2-a@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title,revision) values
('7c000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','CI Phase 2 Upgrade Project',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000001',true);

do $$
declare
  loc1_result jsonb; loc1_id uuid; rev bigint;
  loc2_result jsonb; loc2_id uuid;
  scene1_result jsonb; scene1_id uuid;
  scene2_result jsonb; scene2_id uuid;
  pre_content jsonb;
begin
  loc1_result:=public.create_location('7c000000-0000-4000-8000-000000000001'::uuid,0,'Old Harbor','Seeded before Phase 2, copy 1.');
  if not coalesce((loc1_result->>'ok')::boolean,false) then raise exception 'pre-seed create_location #1 failed: %', loc1_result; end if;
  loc1_id:=(loc1_result->'data'->>'id')::uuid; rev:=(loc1_result->>'revision')::bigint;

  loc2_result:=public.create_location('7c000000-0000-4000-8000-000000000001'::uuid,rev,'Old Harbor','Seeded before Phase 2, copy 2 (same name).');
  if not coalesce((loc2_result->>'ok')::boolean,false) then raise exception 'pre-seed create_location #2 failed: %', loc2_result; end if;
  loc2_id:=(loc2_result->'data'->>'id')::uuid; rev:=(loc2_result->>'revision')::bigint;

  scene1_result:=public.create_scene('7c000000-0000-4000-8000-000000000001'::uuid,rev,null,loc1_id,'Scene At Copy 1','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene1_result->>'ok')::boolean,false) then raise exception 'pre-seed create_scene #1 failed: %', scene1_result; end if;
  scene1_id:=(scene1_result->'data'->>'id')::uuid; rev:=(scene1_result->>'revision')::bigint;

  scene2_result:=public.create_scene('7c000000-0000-4000-8000-000000000001'::uuid,rev,null,loc2_id,'Scene At Copy 2','',null,null,'placed','draft',true,false,null);
  if not coalesce((scene2_result->>'ok')::boolean,false) then raise exception 'pre-seed create_scene #2 failed: %', scene2_result; end if;
  scene2_id:=(scene2_result->'data'->>'id')::uuid; rev:=(scene2_result->>'revision')::bigint;

  pre_content:=public.get_project_content('7c000000-0000-4000-8000-000000000001'::uuid);
  if not coalesce((pre_content->>'ok')::boolean,false) then raise exception 'pre-seed get_project_content failed: %', pre_content; end if;
  if jsonb_array_length(pre_content->'data'->'locations')<>2 then raise exception 'pre-seed get_project_content locations count wrong: %', pre_content->'data'->'locations'; end if;

  insert into public._ci_location_phase2_fixture(key,value) values
    ('project_id','7c000000-0000-4000-8000-000000000001'),
    ('owner_id','7a000000-0000-4000-8000-000000000001'),
    ('location1_id',loc1_id::text),
    ('location2_id',loc2_id::text),
    ('scene1_id',scene1_id::text),
    ('scene2_id',scene2_id::text),
    ('pre_revision',rev::text);
end $$;

reset role;
commit;
