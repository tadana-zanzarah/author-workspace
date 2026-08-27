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
    select * into p from public.projects p0 where p0.id=pc.project_id and p0.owner_id=(select auth.uid()) and p0.deleted_at is null for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
    if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false); end if;
  end if;
  if create_character_image.is_primary then update public.character_images ci set is_primary=false,revision=ci.revision+1 where ci.character_id=create_character_image.character_id and ci.project_character_id is not distinct from create_character_image.project_character_id and ci.is_primary and ci.deleted_at is null; end if;
  insert into public.character_images(id,character_id,project_character_id,storage_path,mime_type,crop,alt,caption,sort_order,is_primary,metadata) values(create_character_image.image_id,create_character_image.character_id,create_character_image.project_character_id,create_character_image.storage_path,create_character_image.mime_type,coalesce(create_character_image.crop,'{}'),coalesce(create_character_image.alt,''),coalesce(create_character_image.caption,''),coalesce(create_character_image.sort_order,0),coalesce(create_character_image.is_primary,false),coalesce(create_character_image.metadata,'{}')) returning * into item;
  if create_character_image.project_character_id is null then update public.characters c1 set revision=c1.revision+1,updated_at=now() where c1.id=create_character_image.character_id returning c1.revision into new_revision; else update public.projects p1 set revision=p1.revision+1,updated_at=now() where p1.id=p.id returning p1.revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_revision,'imageRevision',item.revision,'data',to_jsonb(item));
end $$;
