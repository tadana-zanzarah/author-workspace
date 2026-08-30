-- Bug: a previously removed (soft-deleted) project_characters row still counts toward the
-- duplicate check, so a removed character can never be attached to the same project again.
-- Fix: only an ACTIVE participation (removed_at is null) is a duplicate. A soft-removed
-- participation for the same (project_id, character_id) pair is reactivated in place rather
-- than inserted as a new row, because project_characters_project_character_key is a unique
-- constraint on (project_id, character_id) regardless of removed_at, so a second row for the
-- same pair can never coexist -- reactivation is the only schema-compatible option, and it also
-- keeps the stable project_character_id that scene_characters/relations/character_images key off.
-- Reactivation is treated as a fresh attach (overrides/role/sort_order set from the call
-- arguments, matching what an insert would have produced) rather than resurrecting the stale
-- values left over from before removal: the client always calls attach_project_character the
-- same way for "never attached" and "previously removed" characters and has no UI for
-- inspecting or restoring old per-project overrides.
create or replace function public.attach_project_character(target_project_id uuid,target_character_id uuid,expected_revision bigint,character_role text default null,character_sort_order numeric default 0,character_overrides jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.project_characters%rowtype; new_revision bigint; existing_id uuid;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  if jsonb_typeof(character_overrides)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Overrides must be an object.','changed',false); end if;
  if not exists(select 1 from public.characters where id=target_character_id and owner_id=(select auth.uid()) and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Character not found.','changed',false); end if;
  if exists(select 1 from public.project_characters where project_id=target_project_id and character_id=target_character_id and removed_at is null) then return jsonb_build_object('ok',false,'code','DUPLICATE','revision',p.revision,'message','Character is already attached.','changed',false); end if;
  select id into existing_id from public.project_characters where project_id=target_project_id and character_id=target_character_id and removed_at is not null;
  if found then
    update public.project_characters set overrides=character_overrides,role=character_role,sort_order=coalesce(character_sort_order,0),removed_at=null where id=existing_id returning * into item;
  else
    insert into public.project_characters(project_id,character_id,overrides,role,sort_order) values(target_project_id,target_character_id,character_overrides,character_role,coalesce(character_sort_order,0)) returning * into item;
  end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;
