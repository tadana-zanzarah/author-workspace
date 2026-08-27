-- Private original-image storage and conflict-aware metadata operations.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('character-images','character-images',false,3145728,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.character_images add column if not exists revision bigint not null default 0;
alter table public.character_images add column if not exists storage_cleanup_required boolean not null default false;
alter table public.character_images add constraint character_images_revision_nonnegative check(revision>=0);
create unique index if not exists character_images_storage_path_unique_idx on public.character_images(storage_path);

create or replace function private.character_image_path_valid(target_character_id uuid,target_path text)
returns boolean language sql stable security invoker set search_path=''
as $$ select exists(select 1 from public.characters c where c.id=target_character_id and c.owner_id=(select auth.uid()) and target_path=(c.owner_id::text||'/characters/'||c.id::text||'/'||split_part(target_path,'/',4)||'/'||split_part(target_path,'/',5)) and split_part(target_path,'/',2)='characters' and split_part(target_path,'/',4)<>'' and split_part(target_path,'/',5)~'^original\.(jpg|png|webp|gif)$') $$;
revoke all on function private.character_image_path_valid(uuid,text) from public,anon;
grant execute on function private.character_image_path_valid(uuid,text) to authenticated;

drop policy if exists character_images_insert on public.character_images;
drop policy if exists character_images_update on public.character_images;
create policy character_images_insert on public.character_images for insert to authenticated with check(private.character_owned(character_id) and private.character_image_path_valid(character_id,storage_path));
create policy character_images_update on public.character_images for update to authenticated using(private.character_owned(character_id)) with check(private.character_owned(character_id) and private.character_image_path_valid(character_id,storage_path));

drop policy if exists character_images_storage_select on storage.objects;
drop policy if exists character_images_storage_insert on storage.objects;
drop policy if exists character_images_storage_update on storage.objects;
drop policy if exists character_images_storage_delete on storage.objects;
create policy character_images_storage_select on storage.objects for select to authenticated using(bucket_id='character-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy character_images_storage_insert on storage.objects for insert to authenticated with check(bucket_id='character-images' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2]='characters');
create policy character_images_storage_update on storage.objects for update to authenticated using(bucket_id='character-images' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='character-images' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2]='characters');
create policy character_images_storage_delete on storage.objects for delete to authenticated using(bucket_id='character-images' and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.list_character_images(target_character_id uuid,target_project_character_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.character_owned(target_character_id) then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if target_project_character_id is not null and not exists(select 1 from public.project_characters pc where pc.id=target_project_character_id and pc.character_id=target_character_id and pc.removed_at is null and private.project_owned(pc.project_id)) then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  return jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order,i.id) from public.character_images i where i.character_id=target_character_id and i.deleted_at is null and (i.project_character_id is null or i.project_character_id=target_project_character_id)),'[]'::jsonb));
end $$;

create or replace function public.create_character_image(image_id uuid,character_id uuid,project_character_id uuid,storage_path text,mime_type text,crop jsonb,alt text,caption text,sort_order numeric,is_primary boolean,metadata jsonb,image_scope text,expected_revision bigint,idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.characters%rowtype; pc public.project_characters%rowtype; p public.projects%rowtype; item public.character_images%rowtype; new_revision bigint;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','changed',false); end if;
  if create_character_image.image_id<>create_character_image.idempotency_key or create_character_image.image_scope not in ('global','project') or (create_character_image.image_scope='global')<>(create_character_image.project_character_id is null) or not private.character_image_path_valid(create_character_image.character_id,create_character_image.storage_path) then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','changed',false); end if;
  select * into c from public.characters c0 where c0.id=create_character_image.character_id and c0.owner_id=(select auth.uid()) and c0.deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  select * into item from public.character_images i0 where i0.id=create_character_image.image_id;
  if found then return case when item.character_id=create_character_image.character_id and item.project_character_id is not distinct from create_character_image.project_character_id and item.storage_path=create_character_image.storage_path then jsonb_build_object('ok',true,'code','OK','changed',false,'imageRevision',item.revision,'data',to_jsonb(item)) else jsonb_build_object('ok',false,'code','DUPLICATE','changed',false) end; end if;
  if create_character_image.project_character_id is null then
    if c.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',c.revision,'changed',false); end if;
  else
    select * into pc from public.project_characters pc0 where pc0.id=create_character_image.project_character_id and pc0.character_id=create_character_image.character_id and pc0.removed_at is null;
    if not found then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','changed',false); end if;
    select * into p from public.projects where id=pc.project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
    if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false); end if;
  end if;
  if create_character_image.is_primary then update public.character_images set is_primary=false,revision=revision+1 where character_id=create_character_image.character_id and project_character_id is not distinct from create_character_image.project_character_id and is_primary and deleted_at is null; end if;
  insert into public.character_images(id,character_id,project_character_id,storage_path,mime_type,crop,alt,caption,sort_order,is_primary,metadata) values(create_character_image.image_id,create_character_image.character_id,create_character_image.project_character_id,create_character_image.storage_path,create_character_image.mime_type,coalesce(create_character_image.crop,'{}'),coalesce(create_character_image.alt,''),coalesce(create_character_image.caption,''),coalesce(create_character_image.sort_order,0),coalesce(create_character_image.is_primary,false),coalesce(create_character_image.metadata,'{}')) returning * into item;
  if create_character_image.project_character_id is null then update public.characters set revision=revision+1,updated_at=now() where id=create_character_image.character_id returning revision into new_revision; else update public.projects set revision=revision+1,updated_at=now() where id=p.id returning revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_revision,'imageRevision',item.revision,'data',to_jsonb(item));
end $$;

create or replace function public.update_character_image(target_image_id uuid,expected_revision bigint,image_crop jsonb default null,image_alt text default null,image_caption text default null,image_is_primary boolean default null,image_sort_order numeric default null,image_metadata jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.character_images%rowtype; p public.projects%rowtype; wanted jsonb; current_value jsonb; new_revision bigint;
begin
  select * into item from public.character_images where id=target_image_id and deleted_at is null and private.character_owned(character_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if item.project_character_id is null then if item.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_IMAGE_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false); end if;
  else select p.* into p from public.projects p join public.project_characters pc on pc.project_id=p.id where pc.id=item.project_character_id and p.owner_id=(select auth.uid()) for update; if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false); end if; end if;
  wanted=jsonb_build_object('crop',coalesce(image_crop,item.crop),'alt',coalesce(image_alt,item.alt),'caption',coalesce(image_caption,item.caption),'sort_order',coalesce(image_sort_order,item.sort_order),'is_primary',coalesce(image_is_primary,item.is_primary),'metadata',coalesce(image_metadata,item.metadata));
  current_value=jsonb_build_object('crop',item.crop,'alt',item.alt,'caption',item.caption,'sort_order',item.sort_order,'is_primary',item.is_primary,'metadata',item.metadata);
  if wanted=current_value then return jsonb_build_object('ok',true,'code','OK','changed',false,'revision',coalesce(p.revision,item.revision),'imageRevision',item.revision,'data',to_jsonb(item)); end if;
  if coalesce(image_is_primary,false) then update public.character_images set is_primary=false,revision=revision+1 where character_id=item.character_id and project_character_id is not distinct from item.project_character_id and id<>item.id and is_primary and deleted_at is null; end if;
  update public.character_images set crop=coalesce(image_crop,crop),alt=coalesce(image_alt,alt),caption=coalesce(image_caption,caption),sort_order=coalesce(image_sort_order,sort_order),is_primary=coalesce(image_is_primary,is_primary),metadata=coalesce(image_metadata,metadata),revision=revision+1 where id=item.id returning * into item;
  if item.project_character_id is not null then update public.projects set revision=revision+1,updated_at=now() where id=p.id returning revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_revision,'imageRevision',item.revision,'data',to_jsonb(item));
end $$;

create or replace function public.delete_character_image(target_image_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.character_images%rowtype; fallback_id uuid; p public.projects%rowtype; new_revision bigint; was_primary boolean;
begin
  select * into item from public.character_images where id=target_image_id and deleted_at is null and private.character_owned(character_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if item.project_character_id is null then if item.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_IMAGE_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false); end if;
  else select p.* into p from public.projects p join public.project_characters pc on pc.project_id=p.id where pc.id=item.project_character_id and p.owner_id=(select auth.uid()) for update; if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false); end if; end if;
  was_primary=item.is_primary;update public.character_images set deleted_at=now(),is_primary=false,storage_cleanup_required=true,revision=revision+1 where id=item.id returning * into item;
  if was_primary then select id into fallback_id from public.character_images where character_id=item.character_id and project_character_id is not distinct from item.project_character_id and deleted_at is null order by sort_order,id limit 1; if fallback_id is not null then update public.character_images set is_primary=true,revision=revision+1 where id=fallback_id; end if; end if;
  if item.project_character_id is null then update public.characters set revision=revision+1,updated_at=now() where id=item.character_id returning revision into new_revision; else update public.projects set revision=revision+1,updated_at=now() where id=p.id returning revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_revision,'storagePath',item.storage_path,'fallbackPrimaryId',fallback_id,'data',to_jsonb(item));
end $$;

do $$ declare signature text; begin foreach signature in array array[
  'public.list_character_images(uuid,uuid)','public.create_character_image(uuid,uuid,uuid,text,text,jsonb,text,text,numeric,boolean,jsonb,text,bigint,uuid)','public.update_character_image(uuid,bigint,jsonb,text,text,boolean,numeric,jsonb)','public.delete_character_image(uuid,bigint)'
] loop execute format('revoke execute on function %s from public,anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop; end $$;
