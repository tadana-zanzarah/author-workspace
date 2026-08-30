-- Character identity/project state transaction contract. Dedicated fixtures roll back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','character-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1000000-0000-4000-8000-000000000001','authenticated','authenticated','character-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Characters A'),
('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Characters B');
insert into public.characters(id,owner_id,name) values('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Foreign');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

do $$
declare r jsonb; a uuid; b uuid; pa uuid; pb uuid; scene_id uuid; link_id uuid;
begin
  r:=public.create_character('Ada','Lovelace','{"favorites":["math"],"hobbies":["music"],"future":{"safe":true},"nullable":null}');
  if not (r->>'ok')::boolean or (r->>'characterRevision')::bigint<>0 then raise exception 'create %',r; end if;
  a:=(r#>>'{data,id}')::uuid;
  r:=public.update_character(a,0,'Ada','Lovelace','{"favorites":["math"],"hobbies":["music"],"future":{"safe":true},"nullable":null}');
  if (r->>'changed')::boolean or (r->>'characterRevision')::bigint<>0 then raise exception 'identity no-op %',r; end if;
  r:=public.update_character(a,0,'Ada','Byron','{"favorites":["math"],"hobbies":["music"],"future":{"safe":true},"nullable":null}');
  if (r->>'characterRevision')::bigint<>1 then raise exception 'identity update %',r; end if;
  r:=public.update_character(a,0,'stale','','{}');
  if r->>'code'<>'CHARACTER_REVISION_CONFLICT' or (r->>'actualRevision')::bigint<>1 then raise exception 'identity stale writer %',r; end if;
  if (select surname from public.characters where id=a)<>'Byron' then raise exception 'stale overwrite'; end if;

  r:=public.create_character_and_attach('a2000000-0000-4000-8000-000000000001',0,'Grace','Hopper','{}','lead',10,'{}');
  if (r->>'revision')::bigint<>1 then raise exception 'atomic create attach revision %',r; end if;
  b:=(r#>>'{data,character,id}')::uuid; pb:=(r#>>'{data,project_character,id}')::uuid;
  r:=public.attach_project_character('a2000000-0000-4000-8000-000000000001',a,1,null,20,'{}');
  pa:=(r#>>'{data,id}')::uuid;
  r:=public.attach_project_character('a2000000-0000-4000-8000-000000000001',a,2,null,20,'{}');
  if r->>'code'<>'DUPLICATE' then raise exception 'duplicate attach %',r; end if;
  r:=public.update_project_character('a2000000-0000-4000-8000-000000000001',pa,2,'{"nickname":null}',null,20);
  if (r->>'revision')::bigint<>3 then raise exception 'overrides update %',r; end if;
  r:=public.update_project_character('a2000000-0000-4000-8000-000000000001',pa,3,'{"nickname":null}',null,20);
  if (r->>'changed')::boolean then raise exception 'project character no-op'; end if;

  r:=public.create_scene('a2000000-0000-4000-8000-000000000001',3,null,null,'S','',null,null,'unplaced','draft',true,false,1);
  scene_id:=(r#>>'{data,id}')::uuid;
  r:=public.set_scene_characters('a2000000-0000-4000-8000-000000000001',scene_id,4,jsonb_build_array(
    jsonb_build_object('project_character_id',pb,'action','acts','legacy_state',null,'sort_order',2),
    jsonb_build_object('project_character_id',pa,'action','','legacy_state','old','sort_order',1)));
  if (r->>'revision')::bigint<>5 then raise exception 'participants %',r; end if;
  r:=public.set_scene_characters('a2000000-0000-4000-8000-000000000001',scene_id,5,r#>'{data}');
  if (r->>'changed')::boolean then raise exception 'participants no-op'; end if;

  r:=public.set_project_character_relations('a2000000-0000-4000-8000-000000000001',5,jsonb_build_array(
    jsonb_build_object('from_project_character_id',pa,'to_project_character_id',pb,'value_operation','set','value','trust','visible',true),
    jsonb_build_object('from_project_character_id',pb,'to_project_character_id',pa,'value_operation','set','value','fear','visible',false)));
  if (r->>'revision')::bigint<>6 or (select count(*) from public.project_character_relations where project_id='a2000000-0000-4000-8000-000000000001')<>2 then raise exception 'directed relations %',r; end if;
  r:=public.set_scene_relation_changes('a2000000-0000-4000-8000-000000000001',scene_id,6,jsonb_build_array(
    jsonb_build_object('from_project_character_id',pa,'to_project_character_id',pb,'value_operation','clear','value',null,'visible',null)));
  if (r->>'revision')::bigint<>7 then raise exception 'scene relation changes %',r; end if;

  r:=public.create_character_link(null,null,a,b,'family','parent','child',null,null,'','biological','{}');
  link_id:=(r#>>'{data,id}')::uuid;
  r:=public.update_character_link(link_id,null,0,a,b,'family','parent','child',null,null,'note','biological','{}');
  if (r->>'linkRevision')::bigint<>1 then raise exception 'global link update %',r; end if;
  r:=public.update_character_link(link_id,null,0,a,b,'family','parent','child',null,null,'stale','biological','{}');
  if r->>'code'<>'GLOBAL_LINK_REVISION_CONFLICT' then raise exception 'global link stale %',r; end if;

  r:=public.remove_project_character('a2000000-0000-4000-8000-000000000001',pa,7,false);
  if r->>'code'<>'DEPENDENCIES_EXIST' then raise exception 'dependency guard %',r; end if;
  r:=public.get_project_content('a2000000-0000-4000-8000-000000000001');
  if jsonb_array_length(r#>'{data,project_characters}')<>2 or jsonb_array_length(r#>'{data,scene_characters}')<>2 or jsonb_array_length(r#>'{data,project_character_relations}')<>2 or jsonb_array_length(r#>'{data,scene_relation_changes}')<>1 then raise exception 'snapshot %',r; end if;

  -- Remove with cleanup, then re-attach the same global character to the same project: this must
  -- reactivate the soft-removed row (same id, since (project_id,character_id) is unique regardless
  -- of removed_at) rather than fail DUPLICATE forever or resurrect the cleaned-up dependencies.
  r:=public.remove_project_character('a2000000-0000-4000-8000-000000000001',pa,7,true);
  if r->>'code'<>'OK' or not (r->>'changed')::boolean or (r->>'revision')::bigint<>8 then raise exception 'cleanup remove %',r; end if;
  if (select removed_at from public.project_characters where id=pa) is null then raise exception 'removed_at not set after cleanup remove'; end if;
  if exists(select 1 from public.scene_characters where project_character_id=pa) then raise exception 'scene_characters not cleaned up on remove'; end if;
  if exists(select 1 from public.project_character_relations where from_project_character_id=pa or to_project_character_id=pa) then raise exception 'relations not cleaned up on remove'; end if;
  if exists(select 1 from public.scene_relation_changes where from_project_character_id=pa or to_project_character_id=pa) then raise exception 'scene relation changes not cleaned up on remove'; end if;

  r:=public.attach_project_character('a2000000-0000-4000-8000-000000000001',a,8,'newrole',999,'{"fresh":true}');
  if r->>'code'<>'OK' or not (r->>'changed')::boolean or (r->>'revision')::bigint<>9 then raise exception 'reattach after remove %',r; end if;
  if (r#>>'{data,id}')::uuid<>pa then raise exception 'reattach created a new row instead of reactivating the removed one %',r; end if;
  if (r#>>'{data,removed_at}') is not null then raise exception 'reattach left removed_at set %',r; end if;
  if (r#>>'{data,role}')<>'newrole' or (r#>>'{data,sort_order}')::numeric<>999 or (r#>'{data,overrides}')<>'{"fresh":true}'::jsonb then raise exception 'reattach did not apply the fresh call state %',r; end if;
  if (select count(*) from public.project_characters where project_id='a2000000-0000-4000-8000-000000000001' and character_id=a)<>1 then raise exception 'reattach left more than one participation row for the same pair'; end if;
  if exists(select 1 from public.scene_characters where project_character_id=pa) then raise exception 'reattach resurrected scene_characters'; end if;
  if exists(select 1 from public.project_character_relations where from_project_character_id=pa or to_project_character_id=pa) then raise exception 'reattach resurrected relations'; end if;

  -- The character is active again, so attaching it a second time must go back to being a true
  -- no-mutation duplicate rather than creating another row.
  r:=public.attach_project_character('a2000000-0000-4000-8000-000000000001',a,9,null,0,'{}');
  if r->>'code'<>'DUPLICATE' then raise exception 'active duplicate after reattach %',r; end if;
  if (select count(*) from public.project_characters where project_id='a2000000-0000-4000-8000-000000000001' and character_id=a)<>1 then raise exception 'duplicate attach created a second row'; end if;
  if (select revision from public.projects where id='a2000000-0000-4000-8000-000000000001')<>9 then raise exception 'duplicate attach bumped revision'; end if;
end $$;

-- Cross-owner reads/mutations are indistinguishable from missing resources.
do $$ declare r jsonb; begin
  r:=public.update_character('b3000000-0000-4000-8000-000000000001',0,'Attack','','{}'); if r->>'code'<>'NOT_FOUND' then raise exception 'foreign update %',r; end if;
  r:=public.attach_project_character('a2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',7,null,0,'{}'); if r->>'code'<>'NOT_FOUND' then raise exception 'foreign attach %',r; end if;
end $$;

reset role; set local role anon;
do $$ begin
  if has_function_privilege('anon','public.create_character(text,text,jsonb)','execute') then raise exception 'anon character execute'; end if;
  if has_function_privilege('anon','public.set_scene_characters(uuid,uuid,bigint,jsonb)','execute') then raise exception 'anon participant execute'; end if;
end $$;
reset role;
rollback;
