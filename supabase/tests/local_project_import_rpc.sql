-- Confirmed local -> cloud import contract. All fixtures roll back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','aa000000-0000-4000-8000-000000000001','authenticated','authenticated','import-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','bb000000-0000-4000-8000-000000000001','authenticated','authenticated','import-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title,revision) values
('aa000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000001','Empty',4),
('aa000000-0000-4000-8000-000000000003','aa000000-0000-4000-8000-000000000001','Rollback',0),
('bb000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000001','Foreign',0);
insert into public.characters(id,owner_id,name,surname,base_profile) values('aa000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000001','Existing','','{"keep":true}');

set local role authenticated;
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);

do $$
declare payload jsonb; r jsonb; original_profile jsonb;
begin
  payload=jsonb_build_object(
    'project_id','aa000000-0000-4000-8000-000000000002','source_project_id','legacy-one','expected_revision',4,'migration_attempt_id','aa000000-0000-4000-8000-000000000099',
    'characters',jsonb_build_array(
      jsonb_build_object('id','aa000000-0000-4000-8000-000000000010','project_character_id','aa000000-0000-4000-8000-000000000011','action','MAP_TO_EXISTING_CHARACTER','name','Changed','surname','','base_profile',jsonb_build_object('overwrite',true),'overrides',jsonb_build_object('nickname',null),'sort_order',1000,'metadata','{}'::jsonb),
      jsonb_build_object('id','aa000000-0000-4000-8000-000000000020','project_character_id','aa000000-0000-4000-8000-000000000021','action','CREATE_NEW_GLOBAL_IDENTITY','name','New','surname','Person','base_profile',jsonb_build_object('favorites',jsonb_build_array('tea'),'hobbies',jsonb_build_array()),'overrides','{}'::jsonb,'sort_order',2000,'metadata','{}'::jsonb)),
    'chapters',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000030','title','One','position',1000,'metadata','{}'::jsonb)),
    'locations',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000040','name','Home','description','','metadata','{}'::jsonb)),
    'tags',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000050','name','Tag','normalized_name','tag')),
    'scenes',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000060','chapter_id',null,'location_id','aa000000-0000-4000-8000-000000000040','title','Scene','scene_text','Text','scene_date','2026-08-29','scene_time','10:15','placement_status','placed','writing_status','draft','included',true,'date_review',true,'position',1000,'metadata','{}'::jsonb)),
    'scene_tags',jsonb_build_array(jsonb_build_object('scene_id','aa000000-0000-4000-8000-000000000060','tag_id','aa000000-0000-4000-8000-000000000050')),
    'scene_characters',jsonb_build_array(jsonb_build_object('scene_id','aa000000-0000-4000-8000-000000000060','project_character_id','aa000000-0000-4000-8000-000000000011','action','acts','legacy_state','old','sort_order',1)),
    'initial_relations',jsonb_build_array(jsonb_build_object('from_project_character_id','aa000000-0000-4000-8000-000000000011','to_project_character_id','aa000000-0000-4000-8000-000000000021','value_operation','set','value','trust','visible',true,'metadata','{}'::jsonb)),
    'scene_relation_changes',jsonb_build_array(jsonb_build_object('scene_id','aa000000-0000-4000-8000-000000000060','from_project_character_id','aa000000-0000-4000-8000-000000000011','to_project_character_id','aa000000-0000-4000-8000-000000000021','value_operation','clear','value',null,'visible',null,'metadata','{}'::jsonb)),
    'structural_links',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000070','project_id','aa000000-0000-4000-8000-000000000002','from_character_id','aa000000-0000-4000-8000-000000000010','to_character_id','aa000000-0000-4000-8000-000000000020','category','other','type','friend','reverse_type','friend','notes','','structure_kind','social','metadata','{}'::jsonb)),
    'character_images',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000080','character_id','aa000000-0000-4000-8000-000000000020','project_character_id','aa000000-0000-4000-8000-000000000021','storage_path','aa000000-0000-4000-8000-000000000001/characters/aa000000-0000-4000-8000-000000000020/aa000000-0000-4000-8000-000000000080/original.png','mime_type','image/png','crop','{}'::jsonb,'alt','','caption','','sort_order',0,'is_primary',true,'metadata','{}'::jsonb)));
  original_profile=(select base_profile from public.characters where id='aa000000-0000-4000-8000-000000000010');
  r=public.preflight_local_project_import('aa000000-0000-4000-8000-000000000002',3,'aa000000-0000-4000-8000-000000000099',payload);if r->>'code'<>'REVISION_CONFLICT' then raise exception 'revision preflight %',r;end if;
  r=public.import_local_project_content('aa000000-0000-4000-8000-000000000002',4,'aa000000-0000-4000-8000-000000000099','legacy-one',payload);
  if r->>'ok'<>'true' or (r->>'revision')::bigint<>5 or (select revision from public.projects where id='aa000000-0000-4000-8000-000000000002')<>5 then raise exception 'import result %',r;end if;
  if (select base_profile from public.characters where id='aa000000-0000-4000-8000-000000000010')<>original_profile then raise exception 'mapped identity overwritten';end if;
  if (select overrides ? 'nickname' and overrides->'nickname'='null'::jsonb from public.project_characters where id='aa000000-0000-4000-8000-000000000011') is not true then raise exception 'explicit null override lost';end if;
  if (select count(*) from public.scenes where project_id='aa000000-0000-4000-8000-000000000002')<>1 or (select chapter_id from public.scenes where id='aa000000-0000-4000-8000-000000000060') is not null then raise exception 'scene/unassigned mapping';end if;
  if (select count(*) from public.scene_tags where project_id='aa000000-0000-4000-8000-000000000002')<>1 or (select count(*) from public.scene_characters where project_id='aa000000-0000-4000-8000-000000000002')<>1 then raise exception 'scene adjuncts';end if;
  if (select count(*) from public.project_character_relations where project_id='aa000000-0000-4000-8000-000000000002')<>1 or (select count(*) from public.scene_relation_changes where project_id='aa000000-0000-4000-8000-000000000002')<>1 then raise exception 'relations';end if;
  if (select count(*) from public.character_images where id='aa000000-0000-4000-8000-000000000080' and storage_path like 'aa000000-0000-4000-8000-000000000001/characters/%')<>1 then raise exception 'image metadata';end if;
  r=public.import_local_project_content('aa000000-0000-4000-8000-000000000002',4,'aa000000-0000-4000-8000-000000000099','legacy-one',payload);if r->>'ok'<>'true' or (r->>'revision')::bigint<>5 then raise exception 'idempotent retry %',r;end if;
  r=public.preflight_local_project_import('aa000000-0000-4000-8000-000000000002',5,'aa000000-0000-4000-8000-000000000098',payload||jsonb_build_object('migration_attempt_id','aa000000-0000-4000-8000-000000000098'));if r->>'code'<>'TARGET_NOT_EMPTY' then raise exception 'nonempty %',r;end if;
end $$;

-- A relational failure rolls back identities created earlier in the same statement.
do $$ declare payload jsonb; begin
  payload=jsonb_build_object('project_id','aa000000-0000-4000-8000-000000000003','source_project_id','bad','migration_attempt_id','aa000000-0000-4000-8000-000000000097','characters',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000090','project_character_id','aa000000-0000-4000-8000-000000000091','action','CREATE_NEW_GLOBAL_IDENTITY','name','Rollback','base_profile',jsonb_build_object('favorites',jsonb_build_array(),'hobbies',jsonb_build_array()),'overrides','{}'::jsonb,'metadata','{}'::jsonb)),'chapters','[]'::jsonb,'locations','[]'::jsonb,'tags','[]'::jsonb,'scenes',jsonb_build_array(jsonb_build_object('id','aa000000-0000-4000-8000-000000000092','chapter_id','aa000000-0000-4000-8000-000000000093','position',1,'placement_status','placed','writing_status','draft')),'scene_tags','[]'::jsonb,'scene_characters','[]'::jsonb,'initial_relations','[]'::jsonb,'scene_relation_changes','[]'::jsonb,'structural_links','[]'::jsonb,'character_images','[]'::jsonb);
  begin perform public.import_local_project_content('aa000000-0000-4000-8000-000000000003',0,'aa000000-0000-4000-8000-000000000097','bad',payload);raise exception 'malformed import unexpectedly succeeded';exception when foreign_key_violation then null;end;
  if exists(select 1 from public.characters where id='aa000000-0000-4000-8000-000000000090') then raise exception 'new identity survived failed import';end if;
end $$;

do $$ declare r jsonb; empty_payload jsonb='{"project_id":"bb000000-0000-4000-8000-000000000002","source_project_id":"x","migration_attempt_id":"aa000000-0000-4000-8000-000000000096","characters":[],"chapters":[],"locations":[],"tags":[],"scenes":[],"scene_tags":[],"scene_characters":[],"initial_relations":[],"scene_relation_changes":[],"structural_links":[],"character_images":[]}'::jsonb;begin r=public.preflight_local_project_import('bb000000-0000-4000-8000-000000000002',0,'aa000000-0000-4000-8000-000000000096',empty_payload);if r->>'code'<>'FORBIDDEN' then raise exception 'foreign target %',r;end if;end $$;

reset role;set local role anon;
do $$ begin
  if has_function_privilege('anon','public.import_local_project_content(uuid,bigint,uuid,text,jsonb)','execute') then raise exception 'anon import execute';end if;
  if has_function_privilege('anon','public.preflight_local_project_import(uuid,bigint,uuid,jsonb)','execute') then raise exception 'anon preflight execute';end if;
end $$;
reset role;
rollback;
