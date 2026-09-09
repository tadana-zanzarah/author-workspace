-- Text Formatting T1: narrow, dedicated RPC for the rich-text scene editor
-- (#textModal / #fullSceneText only). Does NOT extend update_scene's signature --
-- this codebase's own precedent (see the createLocationCanonical comment in
-- js/cloud-content-api.js) is a new, narrowly-scoped RPC rather than overloading
-- an existing one. update_scene_text touches only scene_text and metadata, so it
-- can never step on chapter/location/title/date/status fields another concurrent
-- save is making through update_scene, and the two columns are written together
-- in one transaction so a rich document can never be left out of sync with the
-- plain prose extracted from it.
--
-- public.scenes.metadata already exists (see
-- 20260821133800_cloud_content_schema_foundation.sql) but has never been written
-- by any RPC until now. This migration adds no columns -- it only exposes a write
-- path to a column that was already present and already returned (unused) by
-- get_project_content's `to_jsonb(scenes row)` projection.
--
-- Shape convention: metadata = {"richText": <ProseMirror doc JSON>} | {}. For T1,
-- scenes.metadata is fully owned by this feature (nothing else reads/writes it
-- yet) -- update_scene_text *sets* metadata rather than merging it. If a future
-- feature needs other metadata keys on scenes, this RPC (or a sibling) should
-- switch to a merge instead of a set.
create or replace function public.update_scene_text(
  target_project_id uuid,target_scene_id uuid,expected_revision bigint,
  scene_text_value text,scene_metadata jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; new_revision bigint; safe_metadata jsonb;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false); end if;
  safe_metadata:=coalesce(scene_metadata,'{}'::jsonb);
  if jsonb_typeof(safe_metadata)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Scene metadata must be a JSON object.','revision',p.revision,'changed',false); end if;
  if item.scene_text=coalesce(scene_text_value,'') and item.metadata=safe_metadata then
    return jsonb_build_object('ok',true,'code','OK','message','Scene unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item));
  end if;
  update public.scenes set scene_text=coalesce(scene_text_value,''),metadata=safe_metadata where id=target_scene_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene text updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

revoke execute on function public.update_scene_text(uuid,uuid,bigint,text,jsonb) from public, anon;
grant execute on function public.update_scene_text(uuid,uuid,bigint,text,jsonb) to authenticated;
