-- Transaction, concurrency, ordering, snapshot, and RPC security contract.
-- Run against a migrated database. Dedicated fixtures are rolled back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000001','authenticated','authenticated','rpc-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000001','authenticated','authenticated','rpc-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title) values
('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','RPC A'),
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','RPC B');

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);

do $$
declare r jsonb; chapter_id uuid; location_id uuid; tag_one uuid; tag_two uuid; scene_a uuid; scene_b uuid; scene_c uuid; before_revision bigint;
begin
  -- Match succeeds and exactly one revision is consumed.
  r:=public.create_chapter('c2000000-0000-4000-8000-000000000001',0,'One',1000);
  if not (r->>'ok')::boolean or (r->>'revision')::bigint<>1 then raise exception 'create chapter contract %',r; end if;
  chapter_id:=(r#>>'{data,id}')::uuid;

  -- Client B-style stale writer loses and changes nothing.
  r:=public.create_location('c2000000-0000-4000-8000-000000000001',0,'stale','');
  if r->>'code'<>'REVISION_CONFLICT' or (r->>'actualRevision')::bigint<>1 then raise exception 'race contract %',r; end if;
  if exists(select 1 from public.location_projects_legacy_v1 where name='stale') or (select revision from public.projects where id='c2000000-0000-4000-8000-000000000001')<>1 then raise exception 'stale mutation changed state'; end if;

  r:=public.update_chapter('c2000000-0000-4000-8000-000000000001',chapter_id,1,'One');
  if (r->>'changed')::boolean or (r->>'revision')::bigint<>1 then raise exception 'chapter no-op bumped %',r; end if;
  r:=public.update_chapter('c2000000-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000001',1,'bad');
  if r->>'code'<>'NOT_FOUND' or (select revision from public.projects where id='c2000000-0000-4000-8000-000000000001')<>1 then raise exception 'failed mutation bumped'; end if;

  r:=public.create_location('c2000000-0000-4000-8000-000000000001',1,'Room','North'); location_id:=(r#>>'{data,id}')::uuid;
  r:=public.create_tag('c2000000-0000-4000-8000-000000000001',2,'  Plot   Twist '); tag_one:=(r#>>'{data,id}')::uuid;
  r:=public.create_tag('c2000000-0000-4000-8000-000000000001',3,'plot twist');
  if r->>'code'<>'DUPLICATE' or (select revision from public.projects where id='c2000000-0000-4000-8000-000000000001')<>3 then raise exception 'normalized duplicate contract %',r; end if;
  r:=public.create_tag('c2000000-0000-4000-8000-000000000001',3,'Second'); tag_two:=(r#>>'{data,id}')::uuid;

  r:=public.create_scene('c2000000-0000-4000-8000-000000000001',4,chapter_id,location_id,'A','text','2026-02-03','10:15','placed','draft',true,false,1000); scene_a:=(r#>>'{data,id}')::uuid;
  r:=public.create_scene('c2000000-0000-4000-8000-000000000001',5,chapter_id,null,'B','','2026-02-04',null,'placed','in_progress',true,false,2000); scene_b:=(r#>>'{data,id}')::uuid;
  r:=public.create_scene('c2000000-0000-4000-8000-000000000001',6,null,null,'C','',null,null,'unplaced','draft',false,false,3000); scene_c:=(r#>>'{data,id}')::uuid;
  if (select revision from public.projects where id='c2000000-0000-4000-8000-000000000001')<>7 then raise exception 'scene create did not bump once'; end if;

  -- Cross-project chapter/location are rejected before a write.
  r:=public.create_scene('c2000000-0000-4000-8000-000000000001',7,'d5000000-0000-4000-8000-000000000001',null,'bad','',null,null,'placed','draft',true,false,4000);
  if r->>'code'<>'NOT_FOUND' then raise exception 'invalid chapter accepted %',r; end if;

  r:=public.set_scene_tags('c2000000-0000-4000-8000-000000000001',scene_a,7,array[tag_two,tag_one,tag_one]);
  if (r->>'revision')::bigint<>8 or (select count(*) from public.scene_tags where scene_id=scene_a)<>2 then raise exception 'scene tag replace %',r; end if;
  r:=public.set_scene_tags('c2000000-0000-4000-8000-000000000001',scene_a,8,array[tag_one,tag_two]);
  if (r->>'changed')::boolean or (r->>'revision')::bigint<>8 then raise exception 'identical tags bumped %',r; end if;

  -- Insert before, across chapter, end, and semantic no-op.
  r:=public.move_scene('c2000000-0000-4000-8000-000000000001',scene_c,8,chapter_id,scene_b);
  if (r->>'revision')::bigint<>9 or not (r->>'changed')::boolean then raise exception 'move before failed %',r; end if;
  if not (select date_review from public.scenes where id=scene_c) then raise exception 'actual move did not set date_review'; end if;
  r:=public.move_scene('c2000000-0000-4000-8000-000000000001',scene_c,9,chapter_id,scene_b);
  if (r->>'changed')::boolean or (r->>'revision')::bigint<>9 then raise exception 'move no-op bumped %',r; end if;
  r:=public.move_scene('c2000000-0000-4000-8000-000000000001',scene_a,9,null,null);
  if (r->>'revision')::bigint<>10 or (select s.chapter_id is not null from public.scenes s where s.id=scene_a) then raise exception 'move end/across chapter failed %',r; end if;

  -- Full core update, no-op update, soft delete.
  r:=public.update_scene('c2000000-0000-4000-8000-000000000001',scene_b,10,chapter_id,null,'B2','body','2026-02-05','11:00','placed','revised',false,false);
  if (r->>'revision')::bigint<>11 then raise exception 'scene update %',r; end if;
  r:=public.update_scene('c2000000-0000-4000-8000-000000000001',scene_b,11,chapter_id,null,'B2','body','2026-02-05','11:00','placed','revised',false,false);
  if (r->>'changed')::boolean or (r->>'revision')::bigint<>11 then raise exception 'scene update no-op %',r; end if;
  r:=public.delete_scene('c2000000-0000-4000-8000-000000000001',scene_b,11);
  if (r->>'revision')::bigint<>12 or (select deleted_at is null from public.scenes where id=scene_b) then raise exception 'scene soft delete %',r; end if;

  -- Snapshot is deterministic and contains revision with the same content read.
  r:=public.get_project_content('c2000000-0000-4000-8000-000000000001');
  if (r->>'revision')::bigint<>12 or jsonb_array_length(r#>'{data,scenes}')<>2 or jsonb_array_length(r#>'{data,scene_tags}')<>2 then raise exception 'snapshot contract %',r; end if;

  -- Chapter/location/tag deletion exercises SET NULL/cascade with one bump each.
  r:=public.delete_chapter('c2000000-0000-4000-8000-000000000001',chapter_id,12);
  if (r->>'revision')::bigint<>13 or exists(select 1 from public.scenes s where s.project_id='c2000000-0000-4000-8000-000000000001' and s.chapter_id is not null) then raise exception 'chapter delete contract %',r; end if;
  r:=public.delete_location('c2000000-0000-4000-8000-000000000001',location_id,13);
  if (r->>'revision')::bigint<>14 or exists(select 1 from public.scenes s where s.project_id='c2000000-0000-4000-8000-000000000001' and s.location_id is not null) then raise exception 'location delete contract %',r; end if;
  r:=public.delete_tag('c2000000-0000-4000-8000-000000000001',tag_one,14);
  if (r->>'revision')::bigint<>15 or exists(select 1 from public.scene_tags where tag_id=tag_one) then raise exception 'tag delete contract %',r; end if;

  -- A representable gap exhausted at scale 10 is normalized inside the move,
  -- while the logical operation still consumes only one revision.
  r:=public.create_scene('c2000000-0000-4000-8000-000000000001',15,null,null,'D','',null,null,'unplaced','draft',true,false,4000); scene_b:=(r#>>'{data,id}')::uuid;
  update public.scenes set position=case id when scene_a then 1 when scene_c then 1.0000000001 else 3 end where project_id='c2000000-0000-4000-8000-000000000001' and deleted_at is null;
  r:=public.move_scene('c2000000-0000-4000-8000-000000000001',scene_b,16,null,scene_c);
  if (r->>'revision')::bigint<>17 or not (r->>'normalized')::boolean then raise exception 'near-exhaustion normalization %',r; end if;
  if (select count(distinct position) from public.scenes where project_id='c2000000-0000-4000-8000-000000000001' and deleted_at is null)<>(select count(*) from public.scenes where project_id='c2000000-0000-4000-8000-000000000001' and deleted_at is null) then raise exception 'normalization produced duplicate positions'; end if;
end $$;

-- Structure update/reorder and collision paths use an independent revision stream.
insert into public.projects(id,owner_id,title) values('e2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','RPC structure');
do $$ declare r jsonb; c uuid; l uuid; t1 uuid; t2 uuid; begin
  r:=public.create_chapter('e2000000-0000-4000-8000-000000000001',0,'Draft',10); c:=(r#>>'{data,id}')::uuid;
  r:=public.reorder_chapter('e2000000-0000-4000-8000-000000000001',c,1,20); if (r->>'revision')::bigint<>2 then raise exception 'chapter reorder %',r; end if;
  r:=public.update_chapter('e2000000-0000-4000-8000-000000000001',c,2,'Final'); if (r#>>'{data,title}')<>'Final' then raise exception 'chapter update %',r; end if;
  r:=public.create_location('e2000000-0000-4000-8000-000000000001',3,'Old','A'); l:=(r#>>'{data,id}')::uuid;
  r:=public.update_location('e2000000-0000-4000-8000-000000000001',l,4,'New','B'); if (r#>>'{data,name}')<>'New' then raise exception 'location update %',r; end if;
  r:=public.create_tag('e2000000-0000-4000-8000-000000000001',5,'One'); t1:=(r#>>'{data,id}')::uuid;
  r:=public.create_tag('e2000000-0000-4000-8000-000000000001',6,'Two'); t2:=(r#>>'{data,id}')::uuid;
  r:=public.update_tag('e2000000-0000-4000-8000-000000000001',t2,7,' ONE ');
  if r->>'code'<>'DUPLICATE' or (select revision from public.projects where id='e2000000-0000-4000-8000-000000000001')<>7 then raise exception 'tag rename collision %',r; end if;
  r:=public.create_scene('e2000000-0000-4000-8000-000000000001',7,c,'ffffffff-0000-4000-8000-000000000001','bad','',null,null,'placed','draft',true,false,10);
  if r->>'code'<>'NOT_FOUND' or (select revision from public.projects where id='e2000000-0000-4000-8000-000000000001')<>7 then raise exception 'invalid location changed state %',r; end if;
end $$;

-- Cross-user RPC calls cannot read or mutate another account.
do $$ declare r jsonb; begin
  r:=public.get_project_content('d2000000-0000-4000-8000-000000000001'); if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user snapshot %',r; end if;
  r:=public.create_tag('d2000000-0000-4000-8000-000000000001',0,'attack'); if r->>'code'<>'NOT_FOUND' then raise exception 'cross-user mutation %',r; end if;
  if exists(select 1 from public.tags where project_id='d2000000-0000-4000-8000-000000000001') then raise exception 'cross-user RPC changed data'; end if;
end $$;

reset role;
set local role anon;
do $$ begin
  if has_function_privilege('anon','public.get_project_content(uuid)','execute') then raise exception 'anon can execute snapshot RPC'; end if;
  if has_function_privilege('anon','public.create_scene(uuid,bigint,uuid,uuid,text,text,date,time without time zone,text,text,boolean,boolean,numeric)','execute') then raise exception 'anon can execute mutation RPC'; end if;
end $$;
reset role;

rollback;
