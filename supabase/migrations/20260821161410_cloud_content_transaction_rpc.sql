-- Transactional cloud content RPC foundation. The production workspace remains
-- localStorage-backed; these functions are API entrypoints for a later phase.

create or replace function public.get_project_content(target_project_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare project_row public.projects%rowtype;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false);
  end if;
  select * into project_row from public.projects
  where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null;
  if not found then
    return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false);
  end if;
  return jsonb_build_object(
    'ok',true,'code','OK','message','Project content loaded.','revision',project_row.revision,'changed',false,
    'data',jsonb_build_object(
      'project',jsonb_build_object('id',project_row.id,'revision',project_row.revision,'updated_at',project_row.updated_at),
      'chapters',coalesce((select jsonb_agg(to_jsonb(c) order by c.position,c.id) from public.chapters c where c.project_id=target_project_id and c.deleted_at is null),'[]'::jsonb),
      'locations',coalesce((select jsonb_agg(to_jsonb(l) order by lower(l.name),l.id) from public.locations l where l.project_id=target_project_id and l.deleted_at is null),'[]'::jsonb),
      'tags',coalesce((select jsonb_agg(to_jsonb(t) order by t.normalized_name,t.id) from public.tags t where t.project_id=target_project_id),'[]'::jsonb),
      'scenes',coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id) from public.scenes s where s.project_id=target_project_id and s.deleted_at is null),'[]'::jsonb),
      'scene_tags',coalesce((select jsonb_agg(to_jsonb(st) order by st.scene_id,st.tag_id) from public.scene_tags st where st.project_id=target_project_id),'[]'::jsonb)
    )
  );
end
$$;

create or replace function public.create_chapter(target_project_id uuid, expected_revision bigint, chapter_title text, chapter_position numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.chapters%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code',case when (select auth.uid()) is null then 'FORBIDDEN' else 'NOT_FOUND' end,'message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if char_length(btrim(coalesce(chapter_title,''))) not between 1 and 300 or chapter_position is null then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Chapter title and position are required.','changed',false); end if;
  insert into public.chapters(project_id,title,position) values(target_project_id,btrim(chapter_title),chapter_position) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Chapter created.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_chapter(target_project_id uuid, target_chapter_id uuid, expected_revision bigint, chapter_title text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.chapters%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if char_length(btrim(coalesce(chapter_title,''))) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Chapter title is required.','revision',p.revision,'changed',false); end if;
  if item.title=btrim(chapter_title) then return jsonb_build_object('ok',true,'code','OK','message','Chapter unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.chapters set title=btrim(chapter_title) where id=target_chapter_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Chapter updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.delete_chapter(target_project_id uuid, target_chapter_id uuid, expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  delete from public.chapters where id=target_chapter_id and project_id=target_project_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Chapter deleted.','revision',new_revision,'changed',true);
end $$;

create or replace function public.reorder_chapter(target_project_id uuid,target_chapter_id uuid,expected_revision bigint,chapter_position numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.chapters%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if chapter_position is null then return jsonb_build_object('ok',false,'code','POSITION_ERROR','message','Chapter position is required.','revision',p.revision,'changed',false); end if;
  if item.position=chapter_position then return jsonb_build_object('ok',true,'code','OK','message','Chapter order unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.chapters set position=chapter_position where id=target_chapter_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Chapter reordered.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.create_location(target_project_id uuid,expected_revision bigint,location_name text,location_description text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.locations%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if char_length(btrim(coalesce(location_name,''))) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','changed',false); end if;
  insert into public.locations(project_id,name,description) values(target_project_id,btrim(location_name),coalesce(location_description,'')) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location created.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_location(target_project_id uuid,target_location_id uuid,expected_revision bigint,location_name text,location_description text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.locations%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.locations where id=target_location_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if char_length(btrim(coalesce(location_name,''))) not between 1 and 300 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Location name is required.','revision',p.revision,'changed',false); end if;
  if item.name=btrim(location_name) and item.description=coalesce(location_description,'') then return jsonb_build_object('ok',true,'code','OK','message','Location unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.locations set name=btrim(location_name),description=coalesce(location_description,'') where id=target_location_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.delete_location(target_project_id uuid,target_location_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  delete from public.locations where id=target_location_id and project_id=target_project_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Location deleted.','revision',new_revision,'changed',true);
end $$;

create or replace function public.create_tag(target_project_id uuid,expected_revision bigint,tag_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.tags%rowtype; normalized text; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  normalized:=lower(regexp_replace(btrim(coalesce(tag_name,'')),'\s+',' ','g'));
  if char_length(normalized) not between 1 and 200 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Tag name is required.','revision',p.revision,'changed',false); end if;
  if exists(select 1 from public.tags where project_id=target_project_id and normalized_name=normalized) then return jsonb_build_object('ok',false,'code','DUPLICATE','message','A tag with this name already exists.','revision',p.revision,'changed',false); end if;
  insert into public.tags(project_id,name,normalized_name) values(target_project_id,btrim(tag_name),normalized) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Tag created.','revision',new_revision,'changed',true,'data',to_jsonb(item));
exception when unique_violation then return jsonb_build_object('ok',false,'code','DUPLICATE','message','A tag with this name already exists.','revision',p.revision,'changed',false);
end $$;

create or replace function public.update_tag(target_project_id uuid,target_tag_id uuid,expected_revision bigint,tag_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.tags%rowtype; normalized text; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.tags where id=target_tag_id and project_id=target_project_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Tag not found.','revision',p.revision,'changed',false); end if;
  normalized:=lower(regexp_replace(btrim(coalesce(tag_name,'')),'\s+',' ','g'));
  if char_length(normalized) not between 1 and 200 then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Tag name is required.','revision',p.revision,'changed',false); end if;
  if exists(select 1 from public.tags where project_id=target_project_id and normalized_name=normalized and id<>target_tag_id) then return jsonb_build_object('ok',false,'code','DUPLICATE','message','A tag with this name already exists.','revision',p.revision,'changed',false); end if;
  if item.name=btrim(tag_name) and item.normalized_name=normalized then return jsonb_build_object('ok',true,'code','OK','message','Tag unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.tags set name=btrim(tag_name),normalized_name=normalized where id=target_tag_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Tag updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
exception when unique_violation then return jsonb_build_object('ok',false,'code','DUPLICATE','message','A tag with this name already exists.','revision',p.revision,'changed',false);
end $$;

create or replace function public.delete_tag(target_project_id uuid,target_tag_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  delete from public.tags where id=target_tag_id and project_id=target_project_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Tag not found.','revision',p.revision,'changed',false); end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Tag deleted.','revision',new_revision,'changed',true);
end $$;

create or replace function public.create_scene(
  target_project_id uuid,expected_revision bigint,target_chapter_id uuid,target_location_id uuid,
  scene_title text,scene_text_value text,scene_date_value date,scene_time_value time,
  placement_status_value text,writing_status_value text,included_value boolean,date_review_value boolean,scene_position numeric
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; new_revision bigint; actual_position numeric(20,10);
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if target_chapter_id is not null and not exists(select 1 from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if target_location_id is not null and not exists(select 1 from public.locations where id=target_location_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if placement_status_value not in ('placed','unplaced') or writing_status_value not in ('draft','in_progress','revised','final') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Scene status is invalid.','revision',p.revision,'changed',false); end if;
  actual_position:=scene_position;
  if actual_position is null then select coalesce(max(position),0)+1000 into actual_position from public.scenes where project_id=target_project_id and deleted_at is null; end if;
  insert into public.scenes(project_id,chapter_id,location_id,title,scene_text,scene_date,scene_time,placement_status,writing_status,included,date_review,position)
  values(target_project_id,target_chapter_id,target_location_id,coalesce(scene_title,''),coalesce(scene_text_value,''),scene_date_value,scene_time_value,placement_status_value,writing_status_value,coalesce(included_value,true),coalesce(date_review_value,false),actual_position) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene created.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_scene(
  target_project_id uuid,target_scene_id uuid,expected_revision bigint,target_chapter_id uuid,target_location_id uuid,
  scene_title text,scene_text_value text,scene_date_value date,scene_time_value time,
  placement_status_value text,writing_status_value text,included_value boolean,date_review_value boolean
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false); end if;
  if target_chapter_id is not null and not exists(select 1 from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if target_location_id is not null and not exists(select 1 from public.locations where id=target_location_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Location not found.','revision',p.revision,'changed',false); end if;
  if placement_status_value not in ('placed','unplaced') or writing_status_value not in ('draft','in_progress','revised','final') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Scene status is invalid.','revision',p.revision,'changed',false); end if;
  if item.chapter_id is not distinct from target_chapter_id and item.location_id is not distinct from target_location_id and item.title=coalesce(scene_title,'') and item.scene_text=coalesce(scene_text_value,'') and item.scene_date is not distinct from scene_date_value and item.scene_time is not distinct from scene_time_value and item.placement_status=placement_status_value and item.writing_status=writing_status_value and item.included=coalesce(included_value,true) and item.date_review=coalesce(date_review_value,false) then return jsonb_build_object('ok',true,'code','OK','message','Scene unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.scenes set chapter_id=target_chapter_id,location_id=target_location_id,title=coalesce(scene_title,''),scene_text=coalesce(scene_text_value,''),scene_date=scene_date_value,scene_time=scene_time_value,placement_status=placement_status_value,writing_status=writing_status_value,included=coalesce(included_value,true),date_review=coalesce(date_review_value,false) where id=target_scene_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene updated.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.delete_scene(target_project_id uuid,target_scene_id uuid,expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  update public.scenes set deleted_at=now() where id=target_scene_id and project_id=target_project_id and deleted_at is null returning * into item;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false); end if;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene deleted.','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.move_scene(target_project_id uuid,target_scene_id uuid,expected_revision bigint,target_chapter_id uuid,before_scene_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.scenes%rowtype; target_scene public.scenes%rowtype; current_successor uuid; previous_position numeric(20,10); next_position numeric(20,10); new_position numeric(20,10); new_revision bigint; normalized boolean:=false;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  select * into item from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false); end if;
  if target_chapter_id is not null and not exists(select 1 from public.chapters where id=target_chapter_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Chapter not found.','revision',p.revision,'changed',false); end if;
  if before_scene_id=target_scene_id then return jsonb_build_object('ok',false,'code','POSITION_ERROR','message','A scene cannot be placed before itself.','revision',p.revision,'changed',false); end if;
  if before_scene_id is not null then
    select * into target_scene from public.scenes where id=before_scene_id and project_id=target_project_id and deleted_at is null;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Target scene not found.','revision',p.revision,'changed',false); end if;
  end if;
  select id into current_successor from public.scenes where project_id=target_project_id and deleted_at is null and (position,id)>(item.position,item.id) order by position,id limit 1;
  if item.chapter_id is not distinct from target_chapter_id and current_successor is not distinct from before_scene_id then return jsonb_build_object('ok',true,'code','OK','message','Scene position unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  if before_scene_id is null then
    select max(position) into previous_position from public.scenes where project_id=target_project_id and deleted_at is null and id<>target_scene_id;
    new_position:=coalesce(previous_position,0)+1000;
  else
    next_position:=target_scene.position;
    select max(position) into previous_position from public.scenes where project_id=target_project_id and deleted_at is null and id<>target_scene_id and (position,id)<(target_scene.position,target_scene.id);
    if previous_position is null then new_position:=next_position-1000; else new_position:=round((previous_position+next_position)/2,10); end if;
    if previous_position is not null and (new_position<=previous_position or new_position>=next_position) then
      update public.scenes scene
      set position=ordered.position*1000
      from (
        select id,row_number() over(order by position,id)::numeric(20,10) position
        from public.scenes where project_id=target_project_id and deleted_at is null
      ) ordered
      where scene.id=ordered.id;
      normalized:=true;
      select position into next_position from public.scenes where id=before_scene_id;
      select max(position) into previous_position from public.scenes where project_id=target_project_id and deleted_at is null and id<>target_scene_id and (position,id)<(next_position,before_scene_id);
      if previous_position is null then new_position:=next_position-1000; else new_position:=round((previous_position+next_position)/2,10); end if;
      if previous_position is not null and (new_position<=previous_position or new_position>=next_position) then raise exception 'position normalization failed' using errcode='22003'; end if;
    end if;
  end if;
  update public.scenes set chapter_id=target_chapter_id,position=new_position,date_review=true where id=target_scene_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene moved.','revision',new_revision,'changed',true,'normalized',normalized,'data',to_jsonb(item));
exception when numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','POSITION_ERROR','message','Scene position cannot be represented safely.','revision',p.revision,'changed',false);
end $$;

create or replace function public.set_scene_tags(target_project_id uuid,target_scene_id uuid,expected_revision bigint,tag_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; requested uuid[]; existing uuid[]; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','message','Project content changed. Reload before saving.','changed',false,'expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if not exists(select 1 from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Scene not found.','revision',p.revision,'changed',false); end if;
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into requested from unnest(coalesce(tag_ids,'{}'::uuid[])) x;
  if exists(select 1 from unnest(requested) x where not exists(select 1 from public.tags where id=x and project_id=target_project_id)) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','One or more tags do not belong to this project.','revision',p.revision,'changed',false); end if;
  select coalesce(array_agg(tag_id order by tag_id),'{}'::uuid[]) into existing from public.scene_tags where scene_id=target_scene_id;
  if existing=requested then return jsonb_build_object('ok',true,'code','OK','message','Scene tags unchanged.','revision',p.revision,'changed',false,'data',to_jsonb(existing)); end if;
  delete from public.scene_tags where scene_id=target_scene_id;
  insert into public.scene_tags(project_id,scene_id,tag_id) select target_project_id,target_scene_id,x from unnest(requested) x;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','message','Scene tags updated.','revision',new_revision,'changed',true,'data',to_jsonb(requested));
end $$;

-- Public Data API entrypoints are explicit. Internal helpers remain inaccessible.
revoke execute on function public.get_project_content(uuid) from public, anon;
revoke execute on function public.create_chapter(uuid,bigint,text,numeric) from public, anon;
revoke execute on function public.update_chapter(uuid,uuid,bigint,text) from public, anon;
revoke execute on function public.delete_chapter(uuid,uuid,bigint) from public, anon;
revoke execute on function public.reorder_chapter(uuid,uuid,bigint,numeric) from public, anon;
revoke execute on function public.create_location(uuid,bigint,text,text) from public, anon;
revoke execute on function public.update_location(uuid,uuid,bigint,text,text) from public, anon;
revoke execute on function public.delete_location(uuid,uuid,bigint) from public, anon;
revoke execute on function public.create_tag(uuid,bigint,text) from public, anon;
revoke execute on function public.update_tag(uuid,uuid,bigint,text) from public, anon;
revoke execute on function public.delete_tag(uuid,uuid,bigint) from public, anon;
revoke execute on function public.create_scene(uuid,bigint,uuid,uuid,text,text,date,time,text,text,boolean,boolean,numeric) from public, anon;
revoke execute on function public.update_scene(uuid,uuid,bigint,uuid,uuid,text,text,date,time,text,text,boolean,boolean) from public, anon;
revoke execute on function public.delete_scene(uuid,uuid,bigint) from public, anon;
revoke execute on function public.move_scene(uuid,uuid,bigint,uuid,uuid) from public, anon;
revoke execute on function public.set_scene_tags(uuid,uuid,bigint,uuid[]) from public, anon;

grant execute on function public.get_project_content(uuid) to authenticated;
grant execute on function public.create_chapter(uuid,bigint,text,numeric) to authenticated;
grant execute on function public.update_chapter(uuid,uuid,bigint,text) to authenticated;
grant execute on function public.delete_chapter(uuid,uuid,bigint) to authenticated;
grant execute on function public.reorder_chapter(uuid,uuid,bigint,numeric) to authenticated;
grant execute on function public.create_location(uuid,bigint,text,text) to authenticated;
grant execute on function public.update_location(uuid,uuid,bigint,text,text) to authenticated;
grant execute on function public.delete_location(uuid,uuid,bigint) to authenticated;
grant execute on function public.create_tag(uuid,bigint,text) to authenticated;
grant execute on function public.update_tag(uuid,uuid,bigint,text) to authenticated;
grant execute on function public.delete_tag(uuid,uuid,bigint) to authenticated;
grant execute on function public.create_scene(uuid,bigint,uuid,uuid,text,text,date,time,text,text,boolean,boolean,numeric) to authenticated;
grant execute on function public.update_scene(uuid,uuid,bigint,uuid,uuid,text,text,date,time,text,text,boolean,boolean) to authenticated;
grant execute on function public.delete_scene(uuid,uuid,bigint) to authenticated;
grant execute on function public.move_scene(uuid,uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.set_scene_tags(uuid,uuid,bigint,uuid[]) to authenticated;
