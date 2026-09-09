-- update_scene_text (20260909120000_scene_rich_text.sql) contract: atomic
-- scene_text + metadata write, revision/no-op/validation/auth semantics
-- consistent with update_scene and every other content RPC.
-- Run against a migrated database. Dedicated fixtures are rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000001','authenticated','authenticated','rte-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000002','authenticated','authenticated','rte-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title) values
('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','RTE A'),
('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','RTE B');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);

do $$
declare r jsonb; scene_id uuid; doc jsonb; doc2 jsonb;
begin
  r:=public.create_scene('f2000000-0000-4000-8000-000000000001',0,null,null,'Scene','legacy plain text',null,null,'unplaced','draft',true,false,1000);
  if not (r->>'ok')::boolean then raise exception 'scene setup failed %',r; end if;
  scene_id:=(r#>>'{data,id}')::uuid;
  if (select revision from public.projects where id='f2000000-0000-4000-8000-000000000001')<>1 then raise exception 'setup did not consume exactly one revision'; end if;

  -- Real apply: scene_text and metadata.richText land together, atomically, one revision.
  doc:='{"richText":{"type":"doc","content":[{"type":"paragraph","attrs":{"align":"left"},"content":[{"type":"text","marks":[{"type":"strong"}],"text":"Rich text."}]}]}}'::jsonb;
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',scene_id,1,'Rich text.',doc);
  if not (r->>'ok')::boolean or not (r->>'changed')::boolean or (r->>'revision')::bigint<>2 then raise exception 'apply contract %',r; end if;
  if (select scene_text from public.scenes where id=scene_id)<>'Rich text.' then raise exception 'scene_text not persisted'; end if;
  if (select metadata from public.scenes where id=scene_id)<>doc then raise exception 'metadata not persisted'; end if;

  -- Semantic no-op (both fields identical): no revision bump, no row touched.
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',scene_id,2,'Rich text.',doc);
  if (r->>'changed')::boolean or (r->>'revision')::bigint<>2 then raise exception 'no-op bumped revision %',r; end if;

  -- Formatting-only change: scene_text identical, metadata differs -- still a
  -- real change, one revision, both columns end up exactly as sent.
  doc2:='{"richText":{"type":"doc","content":[{"type":"paragraph","attrs":{"align":"center"},"content":[{"type":"text","marks":[{"type":"strong"}],"text":"Rich text."}]}]}}'::jsonb;
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',scene_id,2,'Rich text.',doc2);
  if not (r->>'changed')::boolean or (r->>'revision')::bigint<>3 then raise exception 'formatting-only change contract %',r; end if;
  if (select scene_text from public.scenes where id=scene_id)<>'Rich text.' then raise exception 'formatting-only change altered scene_text'; end if;
  if (select metadata from public.scenes where id=scene_id)<>doc2 then raise exception 'formatting-only change did not persist metadata'; end if;

  -- Prose-only change: metadata identical, scene_text differs -- one revision,
  -- metadata untouched.
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',scene_id,3,'Edited prose.',doc2);
  if not (r->>'changed')::boolean or (r->>'revision')::bigint<>4 then raise exception 'prose-only change contract %',r; end if;
  if (select metadata from public.scenes where id=scene_id)<>doc2 then raise exception 'prose-only change altered metadata'; end if;

  -- Non-object metadata is rejected before any write, no revision bump.
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',scene_id,4,'x','[1,2,3]'::jsonb);
  if r->>'code'<>'VALIDATION_ERROR' or (select revision from public.projects where id='f2000000-0000-4000-8000-000000000001')<>4 then raise exception 'non-object metadata accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene_id)<>'Edited prose.' then raise exception 'rejected metadata call still wrote scene_text'; end if;

  -- Stale revision: rejected, nothing changed.
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',scene_id,1,'stolen','{}'::jsonb);
  if r->>'code'<>'REVISION_CONFLICT' or (r->>'actualRevision')::bigint<>4 then raise exception 'stale revision accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene_id)<>'Edited prose.' then raise exception 'stale-revision mutation changed state'; end if;

  -- Unknown scene: NOT_FOUND, no revision bump.
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001',4,'x','{}'::jsonb);
  if r->>'code'<>'NOT_FOUND' or (select revision from public.projects where id='f2000000-0000-4000-8000-000000000001')<>4 then raise exception 'unknown scene contract %',r; end if;
end $$;

-- Cross-user RPC calls cannot read or mutate another account's scene.
do $$ declare r jsonb; other_scene uuid; begin
  select id into other_scene from public.scenes where project_id='f2000000-0000-4000-8000-000000000001' limit 1;
  perform set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
  r:=public.update_scene_text('f2000000-0000-4000-8000-000000000001',other_scene,4,'attack','{}'::jsonb);
  if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user mutation %',r; end if;
  if (select scene_text from public.scenes where id=other_scene)<>'Edited prose.' then raise exception 'cross-user RPC changed data'; end if;
end $$;

reset role;
set local role anon;
do $$ begin
  if has_function_privilege('anon','public.update_scene_text(uuid,uuid,bigint,text,jsonb)','execute') then raise exception 'anon can execute update_scene_text'; end if;
end $$;
reset role;

rollback;
