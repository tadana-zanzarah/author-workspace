-- Run after migrations; all fixtures are rolled back.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000001','authenticated','authenticated','image-a@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1100000-0000-4000-8000-000000000001','authenticated','authenticated','image-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.projects(id,owner_id,title) values('a1200000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','Image A');
insert into public.characters(id,owner_id,name) values
('a1300000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','A'),
('b1300000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001','B');
insert into public.project_characters(id,project_id,character_id) values('a1400000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; begin
  select public.create_character_image('a1500000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001',null,'a1100000-0000-4000-8000-000000000001/characters/a1300000-0000-4000-8000-000000000001/a1500000-0000-4000-8000-000000000001/original.png','image/png','{"x":0.5,"y":0.5,"zoom":1}','alt','caption',0,true,'{"future":"kept"}','global',0,'a1500000-0000-4000-8000-000000000001') into result;
  if result->>'ok'<>'true' then raise exception 'global create failed: %',result; end if;
  select public.update_character_image('a1500000-0000-4000-8000-000000000001',0,'{"x":0.2,"y":0.8,"zoom":1.7}',null,null,null,null,null) into result;
  if result->>'ok'<>'true' or result->>'imageRevision'<>'1' then raise exception 'crop update failed: %',result; end if;
  select public.update_character_image('a1500000-0000-4000-8000-000000000001',0,'{"x":0.9,"y":0.9,"zoom":2}',null,null,null,null,null) into result;
  if result->>'code'<>'CHARACTER_IMAGE_REVISION_CONFLICT' then raise exception 'stale crop was not rejected: %',result; end if;
  select public.create_character_image('a1500000-0000-4000-8000-000000000002','a1300000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001/characters/a1300000-0000-4000-8000-000000000001/a1500000-0000-4000-8000-000000000002/original.png','image/png','{}','','',0,false,'{}','project',0,'a1500000-0000-4000-8000-000000000002') into result;
  if result->>'code'<>'VALIDATION_ERROR' then raise exception 'foreign path accepted: %',result; end if;
end $$;

insert into storage.objects(bucket_id,name,owner_id,metadata) values('character-images','a1100000-0000-4000-8000-000000000001/characters/a1300000-0000-4000-8000-000000000001/a1500000-0000-4000-8000-000000000001/original.png','a1100000-0000-4000-8000-000000000001','{}');
do $$ begin begin insert into storage.objects(bucket_id,name,owner_id,metadata) values('character-images','b1100000-0000-4000-8000-000000000001/characters/b1300000-0000-4000-8000-000000000001/b1500000-0000-4000-8000-000000000001/original.png','a1100000-0000-4000-8000-000000000001','{}'); raise exception 'foreign upload accepted'; exception when insufficient_privilege then null; end; end $$;

select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000001',true);
do $$ declare n int; begin select count(*) into n from storage.objects where bucket_id='character-images';if n<>0 then raise exception 'foreign storage read visible';end if;end $$;
reset role;
do $$ begin if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('character_images_storage_select','character_images_storage_insert','character_images_storage_update','character_images_storage_delete'))<>4 then raise exception 'storage CRUD policies missing';end if;end $$;
do $$ declare delete_action "char"; begin
  select confdeltype into delete_action from pg_constraint where conrelid='public.character_images'::regclass and conname='character_images_character_context_fkey';
  if delete_action<>'c' then raise exception 'project character image context must cascade on delete';end if;
end $$;
rollback;
