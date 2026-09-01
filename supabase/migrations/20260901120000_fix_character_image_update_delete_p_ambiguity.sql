-- Bug: public.update_character_image and public.delete_character_image declare a plpgsql
-- variable "p public.projects%rowtype" and then, for project-scoped images, run
-- "select p.* into p from public.projects p join public.project_characters pc on
-- pc.project_id=p.id where pc.id=... and p.owner_id=..." -- reusing "p" as both the table
-- alias and the plpgsql variable name. Postgres cannot tell whether a later qualified
-- reference like "p.id" means the range-table alias or the plpgsql record variable, and
-- raises: 42702 column reference "p.id" is ambiguous / "It could refer to either a
-- PL/pgSQL variable or a table column." This was reproduced live against the real project
-- (crchibwumcuuqhkabmfj) through cloudState.client.rpc('update_character_image', ...) and
-- ('delete_character_image', ...) for a project-scoped image, and fires on ordinary
-- make-primary, crop-save and delete of any project-scoped character image.
--
-- public.create_character_image already had the identical anti-pattern and was fixed by
-- 20260827122921_fix_character_image_create_rpc.sql (aliasing the table p0/p1/c1/ci instead
-- of reusing the plpgsql variable name p/c). update_character_image and delete_character_image
-- were not covered by that migration and still carry the original bug -- this migration
-- applies the same non-colliding-alias fix to both, without changing any other behavior.

create or replace function public.update_character_image(target_image_id uuid,expected_revision bigint,image_crop jsonb default null,image_alt text default null,image_caption text default null,image_is_primary boolean default null,image_sort_order numeric default null,image_metadata jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.character_images%rowtype; p public.projects%rowtype; wanted jsonb; current_value jsonb; new_revision bigint;
begin
  select * into item from public.character_images where id=target_image_id and deleted_at is null and private.character_owned(character_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if item.project_character_id is null then if item.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_IMAGE_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false); end if;
  else select p0.* into p from public.projects p0 join public.project_characters pc0 on pc0.project_id=p0.id where pc0.id=item.project_character_id and p0.owner_id=(select auth.uid()) for update; if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false); end if; end if;
  wanted=jsonb_build_object('crop',coalesce(image_crop,item.crop),'alt',coalesce(image_alt,item.alt),'caption',coalesce(image_caption,item.caption),'sort_order',coalesce(image_sort_order,item.sort_order),'is_primary',coalesce(image_is_primary,item.is_primary),'metadata',coalesce(image_metadata,item.metadata));
  current_value=jsonb_build_object('crop',item.crop,'alt',item.alt,'caption',item.caption,'sort_order',item.sort_order,'is_primary',item.is_primary,'metadata',item.metadata);
  if wanted=current_value then return jsonb_build_object('ok',true,'code','OK','changed',false,'revision',coalesce(p.revision,item.revision),'imageRevision',item.revision,'data',to_jsonb(item)); end if;
  if coalesce(image_is_primary,false) then update public.character_images ci set is_primary=false,revision=ci.revision+1 where ci.character_id=item.character_id and ci.project_character_id is not distinct from item.project_character_id and ci.id<>item.id and ci.is_primary and ci.deleted_at is null; end if;
  update public.character_images ci set crop=coalesce(image_crop,ci.crop),alt=coalesce(image_alt,ci.alt),caption=coalesce(image_caption,ci.caption),sort_order=coalesce(image_sort_order,ci.sort_order),is_primary=coalesce(image_is_primary,ci.is_primary),metadata=coalesce(image_metadata,ci.metadata),revision=ci.revision+1 where ci.id=item.id returning * into item;
  if item.project_character_id is not null then update public.projects p1 set revision=p1.revision+1,updated_at=now() where p1.id=p.id returning p1.revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_revision,'imageRevision',item.revision,'data',to_jsonb(item));
end $$;

create or replace function public.delete_character_image(target_image_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.character_images%rowtype; fallback_id uuid; p public.projects%rowtype; new_revision bigint; was_primary boolean;
begin
  select * into item from public.character_images where id=target_image_id and deleted_at is null and private.character_owned(character_id) for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','changed',false); end if;
  if item.project_character_id is null then if item.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_IMAGE_REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false); end if;
  else select p0.* into p from public.projects p0 join public.project_characters pc0 on pc0.project_id=p0.id where pc0.id=item.project_character_id and p0.owner_id=(select auth.uid()) for update; if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'changed',false); end if; end if;
  was_primary=item.is_primary;update public.character_images ci set deleted_at=now(),is_primary=false,storage_cleanup_required=true,revision=ci.revision+1 where ci.id=item.id returning * into item;
  if was_primary then select id into fallback_id from public.character_images where character_id=item.character_id and project_character_id is not distinct from item.project_character_id and deleted_at is null order by sort_order,id limit 1; if fallback_id is not null then update public.character_images ci set is_primary=true,revision=ci.revision+1 where ci.id=fallback_id; end if; end if;
  if item.project_character_id is null then update public.characters c1 set revision=c1.revision+1,updated_at=now() where c1.id=item.character_id returning c1.revision into new_revision; else update public.projects p1 set revision=p1.revision+1,updated_at=now() where p1.id=p.id returning p1.revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','changed',true,'revision',new_revision,'storagePath',item.storage_path,'fallbackPrimaryId',fallback_id,'data',to_jsonb(item));
end $$;
