-- Run against a migrated database. Everything is rolled back.
begin;

do $$
declare
  expected text[] := array['chapters','character_images','character_links','characters','locations','project_character_relations','project_characters','scene_characters','scene_relation_changes','scene_tags','scenes','tags'];
  actual text[];
begin
  select array_agg(table_name order by table_name) into actual
  from information_schema.tables where table_schema='public' and table_name=any(expected);
  if actual is distinct from expected then raise exception 'content tables missing: %', actual; end if;
  if (select data_type from information_schema.columns where table_schema='public' and table_name='projects' and column_name='revision') <> 'bigint' then raise exception 'revision is not bigint'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='content_version') then raise exception 'parallel content_version exists'; end if;
  if (select numeric_precision from information_schema.columns where table_schema='public' and table_name='scenes' and column_name='position') <> 20
     or (select numeric_scale from information_schema.columns where table_schema='public' and table_name='scenes' and column_name='position') <> 10 then raise exception 'scene position is not numeric(20,10)'; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='character_images' and column_name in ('binary','base64','data_url','image_data')) then raise exception 'binary image column exists'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name=any(expected) and grantee='anon') then raise exception 'anon has private content grants'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name=any(expected) and grantee='authenticated' and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')) then raise exception 'authenticated has excessive content grants'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(expected) and c.relrowsecurity) <> cardinality(expected) then raise exception 'RLS missing'; end if;
end $$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','content-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1000000-0000-4000-8000-000000000001','authenticated','authenticated','content-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.projects(id,owner_id,title) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','A'),
('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','B');
insert into public.characters(id,owner_id,name,base_profile) values
('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','A','{"inherited":"yes","blank":null}'),
('a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','A2','{}'),
('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','B','{}');
insert into public.project_characters(id,project_id,character_id,overrides) values
('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','{"blank":null}'),
('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','{}'),
('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','{}');
insert into public.chapters(id,project_id,title,position) values
('a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','A',1024),
('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','B',1024);
insert into public.location_projects_legacy_v1(id,project_id,name) values
('a6000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','A'),
('b6000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','B');
insert into public.tags(id,project_id,name,normalized_name) values
('a7000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','A','a'),
('b7000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','B','b');
insert into public.scenes(id,project_id,chapter_id,location_id,title,position) values
('a8000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','A',1024),
('b8000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','B',1024);

-- Contract-positive variants.
insert into public.project_character_relations(project_id,from_project_character_id,to_project_character_id,value_operation,value,visible) values
('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002',null,null,true);
insert into public.scene_relation_changes(project_id,scene_id,from_project_character_id,to_project_character_id,value_operation,value,visible) values
('a2000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','set','warm',null),
('a2000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000001','clear',null,false);

insert into public.character_links(owner_id,project_id,from_character_id,to_character_id,category,type,reverse_type,structure_kind) values
('a1000000-0000-4000-8000-000000000001',null,'a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','family','sibling','sibling','biological'),
('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','social','friend','friend','social');

do $$
begin
  begin insert into public.scenes(project_id,chapter_id,title,position) values ('a2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','bad',2); raise exception 'cross-project chapter accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.scenes(project_id,location_id,title,position) values ('a2000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','bad',2); raise exception 'cross-project location accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.scene_tags(project_id,scene_id,tag_id) values ('a2000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001'); raise exception 'cross-project tag accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.scene_characters(project_id,scene_id,project_character_id) values ('a2000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001'); raise exception 'cross-project participant accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.scene_relation_changes(project_id,scene_id,from_project_character_id,to_project_character_id,visible) values ('a2000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',true); raise exception 'cross-project relation accepted'; exception when foreign_key_violation then null; end;
  begin insert into public.scene_relation_changes(project_id,scene_id,from_project_character_id,to_project_character_id) values ('a2000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002'); raise exception 'no-op relation accepted'; exception when check_violation then null; end;
  begin insert into public.character_links(owner_id,from_character_id,to_character_id,category,type,reverse_type) values ('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','other','self','self'); raise exception 'self link accepted'; exception when check_violation then null; end;
end $$;

delete from public.chapters where id='a5000000-0000-4000-8000-000000000001';
delete from public.location_projects_legacy_v1 where id='a6000000-0000-4000-8000-000000000001';
do $$ begin if (select chapter_id is not null or location_id is not null from public.scenes where id='a8000000-0000-4000-8000-000000000001') then raise exception 'SET NULL delete contract failed'; end if; end $$;

rollback;
