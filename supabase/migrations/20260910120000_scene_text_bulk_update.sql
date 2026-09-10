-- Find/Replace Stage A: generic atomic bulk scene-text writer. This function
-- knows nothing about Find/Replace matching -- it only writes already-computed
-- final (scene_text, metadata) values for many scenes in one call, so that a
-- future project-wide operation (e.g. Find/Replace "Заменить все" across
-- "Весь проект") can never leave the manuscript partially rewritten: either
-- every targeted scene's text+metadata lands together with exactly one
-- projects.revision bump, or nothing lands at all. Mirrors update_scene_text's
-- own narrow, set-not-merge metadata contract
-- (20260909120000_scene_rich_text.sql) at the batch level -- see
-- docs/find-replace-architecture.md for the full feature architecture this is
-- the foundation of. Not wired into any application UI/save flow yet.
--
-- replacements shape: a JSON array of {"scene_id":uuid,"scene_text":text,
-- "metadata":object}. Extra keys are ignored; scene_text/metadata default to
-- ''/{} the same way update_scene_text's own arguments do.
--
-- ATOMICITY DESIGN NOTE: unlike update_scene_text (which can return a plain
-- {ok:false,...} JSON the instant it finds a problem, because nothing has
-- been written yet), a bulk writer cannot afford that once its loop has
-- started -- a bare RETURN after some UPDATEs have already run does NOT undo
-- them; only an aborted/rolled-back statement does. This function resolves
-- that by validating and resolving EVERY element (shape, duplicate scene_id,
-- metadata shape, scene existence/ownership) in a first pass that performs no
-- writes at all, and only then runs a second pass that writes every row. That
-- gives clean, specific error codes (VALIDATION_ERROR/DUPLICATE/NOT_FOUND) for
-- every expected failure while still guaranteeing "any invalid element,
-- anywhere in the array, including after earlier valid ones -> zero writes" --
-- a stronger guarantee than "write then roll back on failure", not a weaker
-- one. The write pass still RAISEs (aborting and rolling back everything it
-- has written so far in this call) on the row-vanished-mid-batch case, as a
-- pure defensive backstop for an interleaving that should be unreachable
-- given the project row is held FOR UPDATE from before pass one begins.
-- See supabase/tests/cloud_scene_text_bulk_update_rpc.sql for the regression
-- coverage, including a deliberately-invalid late array element asserting the
-- earlier, individually-valid elements never get written.
create or replace function public.bulk_update_scene_text(
  target_project_id uuid,expected_revision bigint,replacements jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  p public.projects%rowtype;
  new_revision bigint;
  elem jsonb;
  idx int;
  n int;
  scene_id uuid;
  safe_metadata jsonb;
  ids uuid[]:='{}'::uuid[];
  texts text[]:='{}'::text[];
  metas jsonb[]:='{}'::jsonb[];
  existing_text text;
  existing_metadata jsonb;
  any_changed boolean:=false;
  results jsonb:='[]'::jsonb;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;

  if replacements is null or jsonb_typeof(replacements)<>'array' then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','replacements must be a JSON array.','revision',p.revision,'changed',false);
  end if;

  n:=jsonb_array_length(replacements);
  if n=0 then
    return jsonb_build_object('ok',true,'code','OK','message','No replacements supplied.','revision',p.revision,'changed',false,'data',jsonb_build_object('results','[]'::jsonb));
  end if;

  -- PASS 1: validate and resolve every element. No writes happen in this
  -- loop, so any element failing here -- first or last -- leaves the database
  -- exactly as it was, and lets us return a specific, safe error code instead
  -- of relying on an exception for expected validation failures.
  for idx in 0..n-1 loop
    elem:=replacements->idx;
    if jsonb_typeof(elem)<>'object' or not(elem ? 'scene_id') then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Each replacement must be an object with scene_id.','revision',p.revision,'changed',false);
    end if;
    begin
      scene_id:=(elem->>'scene_id')::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','scene_id must be a UUID.','revision',p.revision,'changed',false);
    end;
    if scene_id=any(ids) then
      return jsonb_build_object('ok',false,'code','DUPLICATE','message','Duplicate scene_id in one bulk_update_scene_text call.','revision',p.revision,'changed',false,'entityId',scene_id);
    end if;
    safe_metadata:=coalesce(elem->'metadata','{}'::jsonb);
    if jsonb_typeof(safe_metadata)<>'object' then
      return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','metadata must be a JSON object.','revision',p.revision,'changed',false,'entityId',scene_id);
    end if;
    if not exists(select 1 from public.scenes where id=scene_id and project_id=target_project_id and deleted_at is null) then
      return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false,'entityId',scene_id);
    end if;
    ids:=ids||scene_id;
    texts:=texts||coalesce(elem->>'scene_text','');
    metas:=metas||safe_metadata;
  end loop;

  -- PASS 2: every element already validated and every scene confirmed to
  -- exist under this project -- write them all. The NOT FOUND branch here is
  -- a defensive backstop only (see the design note above): it should be
  -- unreachable because the project row has been locked FOR UPDATE since
  -- before pass one, so no concurrent mutation of these scenes under this
  -- same project can have interleaved. If it is ever hit anyway, RAISE aborts
  -- the whole statement, rolling back every update this call has made so far
  -- -- never a partial write escaping as a normal return.
  for idx in 1..array_length(ids,1) loop
    select scene_text,metadata into existing_text,existing_metadata from public.scenes where id=ids[idx] and project_id=target_project_id and deleted_at is null;
    if not found then
      raise exception 'scene % vanished mid-batch for project %',ids[idx],target_project_id using errcode='P0002';
    end if;
    if existing_text is distinct from texts[idx] or existing_metadata is distinct from metas[idx] then
      update public.scenes set scene_text=texts[idx],metadata=metas[idx] where id=ids[idx] and project_id=target_project_id and deleted_at is null;
      if not found then
        raise exception 'bulk scene text update affected zero rows for scene %',ids[idx] using errcode='P0002';
      end if;
      any_changed:=true;
      results:=results||jsonb_build_array(jsonb_build_object('sceneId',ids[idx],'changed',true));
    else
      results:=results||jsonb_build_array(jsonb_build_object('sceneId',ids[idx],'changed',false));
    end if;
  end loop;

  if not any_changed then
    return jsonb_build_object('ok',true,'code','OK','message','No scenes changed.','revision',p.revision,'changed',false,'data',jsonb_build_object('results',results));
  end if;

  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene text bulk-updated.','revision',new_revision,'changed',true,'data',jsonb_build_object('results',results));
end $$;

revoke execute on function public.bulk_update_scene_text(uuid,bigint,jsonb) from public, anon;
grant execute on function public.bulk_update_scene_text(uuid,bigint,jsonb) to authenticated;
