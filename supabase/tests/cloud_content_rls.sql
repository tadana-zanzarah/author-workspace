-- Cross-user CRUD and indirect-join isolation. Everything is rolled back.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','aa100000-0000-4000-8000-000000000001','authenticated','authenticated','rls-content-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','bb100000-0000-4000-8000-000000000001','authenticated','authenticated','rls-content-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title) values ('aa200000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','A'),('bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','B');
insert into public.characters(id,owner_id,name) values ('aa300000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','A'),('aa300000-0000-4000-8000-000000000002','aa100000-0000-4000-8000-000000000001','A2'),('bb300000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','B');
insert into public.project_characters(id,project_id,character_id) values ('aa400000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001'),('aa400000-0000-4000-8000-000000000002','aa200000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000002'),('bb400000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','bb300000-0000-4000-8000-000000000001');
insert into public.chapters(id,project_id,title,position) values ('aa500000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001','A',1),('bb500000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','B',1);
insert into public.locations(id,project_id,name) values ('aa600000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001','A'),('bb600000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','B');
insert into public.tags(id,project_id,name,normalized_name) values ('aa700000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001','A','a'),('bb700000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','B','b');
insert into public.scenes(id,project_id,title,position) values ('aa800000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001','A',1),('bb800000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','B',1);

set local role authenticated;
select set_config('request.jwt.claim.sub','aa100000-0000-4000-8000-000000000001',true);

do $$ declare n integer; begin
  select count(*) into n from public.characters; if n<>2 then raise exception 'A character visibility %',n; end if;
  select count(*) into n from public.scenes; if n<>1 then raise exception 'A scene visibility %',n; end if;
  update public.scenes set title='forbidden' where id='bb800000-0000-4000-8000-000000000001'; get diagnostics n=row_count; if n<>0 then raise exception 'A updated B scene'; end if;
  delete from public.scenes where id='bb800000-0000-4000-8000-000000000001'; get diagnostics n=row_count; if n<>0 then raise exception 'A deleted B scene'; end if;

  begin insert into public.scenes(project_id,title,position) values ('bb200000-0000-4000-8000-000000000001','bad',2); raise exception 'A inserted B scene'; exception when insufficient_privilege then null; end;
  begin insert into public.chapters(project_id,title,position) values ('bb200000-0000-4000-8000-000000000001','bad',2); raise exception 'A inserted B chapter'; exception when insufficient_privilege then null; end;
  begin insert into public.project_characters(project_id,character_id) values ('aa200000-0000-4000-8000-000000000001','bb300000-0000-4000-8000-000000000001'); raise exception 'A attached B character'; exception when insufficient_privilege or check_violation then null; end;
  begin insert into public.project_characters(project_id,character_id) values ('bb200000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001'); raise exception 'A attached to B project'; exception when insufficient_privilege or check_violation then null; end;
  begin insert into public.scene_tags(project_id,scene_id,tag_id) values ('bb200000-0000-4000-8000-000000000001','bb800000-0000-4000-8000-000000000001','bb700000-0000-4000-8000-000000000001'); raise exception 'A exploited hidden join'; exception when insufficient_privilege then null; end;
  begin insert into public.scene_tags(project_id,scene_id,tag_id) values ('aa200000-0000-4000-8000-000000000001','aa800000-0000-4000-8000-000000000001','bb700000-0000-4000-8000-000000000001'); raise exception 'A attached cross-project tag'; exception when foreign_key_violation then null; end;
  begin insert into public.scene_characters(project_id,scene_id,project_character_id) values ('aa200000-0000-4000-8000-000000000001','aa800000-0000-4000-8000-000000000001','bb400000-0000-4000-8000-000000000001'); raise exception 'A attached cross-project participant'; exception when foreign_key_violation then null; end;
  begin insert into public.character_links(owner_id,from_character_id,to_character_id,category,type,reverse_type) values ('aa100000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001','bb300000-0000-4000-8000-000000000001','other','x','x'); raise exception 'A linked B character'; exception when insufficient_privilege then null; end;
  begin insert into public.character_links(owner_id,project_id,from_character_id,to_character_id,category,type,reverse_type) values ('aa100000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000001','aa300000-0000-4000-8000-000000000002','other','x','x'); raise exception 'A exploited scoped link'; exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','bb100000-0000-4000-8000-000000000001',true);
do $$ declare n integer; begin
  select count(*) into n from public.characters; if n<>1 then raise exception 'B character visibility %',n; end if;
  select count(*) into n from public.scenes; if n<>1 then raise exception 'B scene visibility %',n; end if;
  update public.scenes set title='forbidden' where id='aa800000-0000-4000-8000-000000000001'; get diagnostics n=row_count; if n<>0 then raise exception 'B updated A scene'; end if;
end $$;
reset role;
set local role anon;
do $$ declare t text; begin foreach t in array array['characters','project_characters','chapters','locations','tags','scenes','scene_tags','scene_characters','project_character_relations','scene_relation_changes','character_links','character_images'] loop
  if has_table_privilege('anon',format('public.%I',t),'select') then raise exception 'anon select grant on %',t; end if;
end loop; end $$;
reset role;
rollback;
