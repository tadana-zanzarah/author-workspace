-- bulk_update_scene_text (20260910120000_scene_text_bulk_update.sql) contract:
-- Find/Replace Stage A atomic foundation. This RPC does not implement any
-- Find/Replace matching -- it is a generic "write these final scene_text +
-- metadata values for many scenes, atomically" primitive. Covers: successful
-- multi-scene write with exactly one revision bump, semantic no-op detection,
-- stale revision, wrong-project/nonexistent/deleted scene, duplicate scene_id,
-- an invalid LATE array element leaving even earlier valid elements
-- unwritten, cross-user isolation, and anon denial.
-- Run against a migrated database. Dedicated fixtures are rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000001','authenticated','authenticated','bulk-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','a1000000-0000-4000-8000-000000000002','authenticated','authenticated','bulk-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Bulk A'),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','Bulk B');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

do $$
declare
  r jsonb; scene1 uuid; scene2 uuid; scene3 uuid; other_project_scene uuid;
  doc1 jsonb; doc2 jsonb;
begin
  -- Fixtures: three scenes in project A (revision 0 -> 3), one scene in
  -- project B (owned by a different user).
  r:=public.create_scene('a2000000-0000-4000-8000-000000000001',0,null,null,'Scene 1','Original text 1',null,null,'unplaced','draft',true,false,1000);
  if not (r->>'ok')::boolean then raise exception 'scene1 setup failed %',r; end if;
  scene1:=(r#>>'{data,id}')::uuid;
  r:=public.create_scene('a2000000-0000-4000-8000-000000000001',1,null,null,'Scene 2','Original text 2',null,null,'unplaced','draft',true,false,2000);
  if not (r->>'ok')::boolean then raise exception 'scene2 setup failed %',r; end if;
  scene2:=(r#>>'{data,id}')::uuid;
  r:=public.create_scene('a2000000-0000-4000-8000-000000000001',2,null,null,'Scene 3','Original text 3',null,null,'unplaced','draft',true,false,3000);
  if not (r->>'ok')::boolean then raise exception 'scene3 setup failed %',r; end if;
  scene3:=(r#>>'{data,id}')::uuid;
  if (select revision from public.projects where id='a2000000-0000-4000-8000-000000000001')<>3 then raise exception 'fixture setup did not consume exactly 3 revisions'; end if;

  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
  r:=public.create_scene('a2000000-0000-4000-8000-000000000002',0,null,null,'Other project scene','Other project text',null,null,'unplaced','draft',true,false,1000);
  if not (r->>'ok')::boolean then raise exception 'other-project scene setup failed %',r; end if;
  other_project_scene:=(r#>>'{data,id}')::uuid;
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

  -- 1. Successful multi-scene update: scene_text + metadata land together for
  -- BOTH scenes, and the project revision bumps exactly ONCE, not once per
  -- scene.
  doc1:='{"richText":{"type":"doc","content":[{"type":"paragraph","attrs":{"align":null},"content":[{"type":"text","text":"New text 1"}]}]}}'::jsonb;
  doc2:='{"richText":{"type":"doc","content":[{"type":"paragraph","attrs":{"align":null},"content":[{"type":"text","text":"New text 2"}]}]}}'::jsonb;
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',3,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','New text 1','metadata',doc1),
    jsonb_build_object('scene_id',scene2,'scene_text','New text 2','metadata',doc2)
  ));
  if not (r->>'ok')::boolean or not (r->>'changed')::boolean or (r->>'revision')::bigint<>4 then raise exception 'bulk apply contract %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' or (select metadata from public.scenes where id=scene1)<>doc1 then raise exception 'scene1 text+metadata not persisted together'; end if;
  if (select scene_text from public.scenes where id=scene2)<>'New text 2' or (select metadata from public.scenes where id=scene2)<>doc2 then raise exception 'scene2 text+metadata not persisted together'; end if;
  if (select scene_text from public.scenes where id=scene3)<>'Original text 3' then raise exception 'scene3 (not in the batch) was unexpectedly touched'; end if;

  -- 2. All-semantic-no-op batch (identical values already persisted): no
  -- revision bump, no row touched.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',4,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','New text 1','metadata',doc1),
    jsonb_build_object('scene_id',scene2,'scene_text','New text 2','metadata',doc2)
  ));
  if (r->>'changed')::boolean or (r->>'revision')::bigint<>4 then raise exception 'no-op batch bumped revision %',r; end if;

  -- 3. Stale expected_revision: rejected, zero writes.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',3,jsonb_build_array(jsonb_build_object('scene_id',scene1,'scene_text','Hacked','metadata','{}'::jsonb)));
  if r->>'code'<>'REVISION_CONFLICT' or (r->>'actualRevision')::bigint<>4 then raise exception 'stale revision accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'stale-revision call still wrote scene1'; end if;

  -- 4. One element belongs to a DIFFERENT project: the whole batch fails,
  -- including the otherwise-valid, listed-FIRST scene1 element.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',4,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','Should not land','metadata','{}'::jsonb),
    jsonb_build_object('scene_id',other_project_scene,'scene_text','Wrong project','metadata','{}'::jsonb)
  ));
  if r->>'code'<>'NOT_FOUND' then raise exception 'cross-project scene id accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'cross-project batch still wrote the valid earlier element'; end if;
  if (select revision from public.projects where id='a2000000-0000-4000-8000-000000000001')<>4 then raise exception 'cross-project batch bumped revision'; end if;

  -- 5. One element references a scene id that does not exist at all: whole
  -- batch fails, earlier valid element unwritten.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',4,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','Should not land either','metadata','{}'::jsonb),
    jsonb_build_object('scene_id','ffffffff-0000-4000-8000-000000000099','scene_text','Ghost','metadata','{}'::jsonb)
  ));
  if r->>'code'<>'NOT_FOUND' then raise exception 'nonexistent scene id accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'nonexistent-scene batch still wrote the valid earlier element'; end if;

  -- 6. Soft-deleted scene: whole batch fails, earlier valid element unwritten.
  r:=public.delete_scene('a2000000-0000-4000-8000-000000000001',scene3,4);
  if not (r->>'ok')::boolean or (r->>'revision')::bigint<>5 then raise exception 'scene3 delete setup failed %',r; end if;
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',5,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','Still should not land','metadata','{}'::jsonb),
    jsonb_build_object('scene_id',scene3,'scene_text','Resurrected','metadata','{}'::jsonb)
  ));
  if r->>'code'<>'NOT_FOUND' then raise exception 'deleted scene id accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'deleted-scene batch still wrote the valid earlier element'; end if;
  if (select revision from public.projects where id='a2000000-0000-4000-8000-000000000001')<>5 then raise exception 'deleted-scene batch bumped revision'; end if;

  -- 7. Duplicate scene_id within one call: rejected, zero writes.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',5,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','AAA','metadata','{}'::jsonb),
    jsonb_build_object('scene_id',scene1,'scene_text','BBB','metadata','{}'::jsonb)
  ));
  if r->>'code'<>'DUPLICATE' then raise exception 'duplicate scene_id accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'duplicate-scene_id batch still wrote a row'; end if;

  -- 8. CRITICAL ATOMICITY CASE: a valid element followed by a LATE invalid
  -- element (non-object metadata) must leave the earlier, individually-valid
  -- element completely unwritten -- not "written then rolled back", not
  -- "written and left inconsistent": genuinely never persisted.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',5,jsonb_build_array(
    jsonb_build_object('scene_id',scene1,'scene_text','Valid new text','metadata',jsonb_build_object('richText','ok')),
    jsonb_build_object('scene_id',scene2,'scene_text','Also valid text','metadata','[1,2,3]'::jsonb)
  ));
  if r->>'code'<>'VALIDATION_ERROR' then raise exception 'invalid late metadata accepted %',r; end if;
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'invalid-late-element batch still wrote the earlier valid element'; end if;
  if (select scene_text from public.scenes where id=scene2)<>'New text 2' then raise exception 'invalid-late-element batch touched scene2'; end if;
  if (select revision from public.projects where id='a2000000-0000-4000-8000-000000000001')<>5 then raise exception 'invalid-late-element batch bumped revision'; end if;

  -- 9. Empty batch: defined, safe no-op.
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',5,'[]'::jsonb);
  if not (r->>'ok')::boolean or (r->>'changed')::boolean or (r->>'revision')::bigint<>5 then raise exception 'empty batch contract %',r; end if;
end $$;

-- Cross-user: user B cannot bulk-write scenes belonging to project A, and the
-- attempt leaves project A's data untouched.
do $$ declare r jsonb; scene1 uuid; begin
  select id into scene1 from public.scenes where project_id='a2000000-0000-4000-8000-000000000001' and title='Scene 1';
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
  r:=public.bulk_update_scene_text('a2000000-0000-4000-8000-000000000001',5,jsonb_build_array(jsonb_build_object('scene_id',scene1,'scene_text','attack','metadata','{}'::jsonb)));
  if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user bulk mutation %',r; end if;
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
  if (select scene_text from public.scenes where id=scene1)<>'New text 1' then raise exception 'cross-user RPC changed data'; end if;
end $$;

reset role;
set local role anon;
do $$ begin
  if has_function_privilege('anon','public.bulk_update_scene_text(uuid,bigint,jsonb)','execute') then raise exception 'anon can execute bulk_update_scene_text'; end if;
end $$;
reset role;

rollback;
