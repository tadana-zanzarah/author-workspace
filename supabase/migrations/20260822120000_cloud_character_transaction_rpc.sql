-- Transactional character identity, project membership, relations, and structural links.
-- Production workspace remains localStorage-backed; no Storage bucket is created.

alter table public.characters add column revision bigint not null default 0;
alter table public.character_links add column revision bigint not null default 0;

alter table public.characters add constraint characters_profile_multivalue_shape check (
  jsonb_typeof(base_profile)='object'
  and (not base_profile ? 'favorites' or jsonb_typeof(base_profile->'favorites')='array')
  and (not base_profile ? 'hobbies' or jsonb_typeof(base_profile->'hobbies')='array'));

create or replace function public.list_characters()
returns jsonb language sql stable security invoker set search_path=''
as $$ select case when (select auth.uid()) is null
  then jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false)
  else jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((
    select jsonb_agg(to_jsonb(c) order by lower(c.name),lower(c.surname),c.id)
    from public.characters c where c.owner_id=(select auth.uid()) and c.deleted_at is null
  ),'[]'::jsonb)) end $$;

create or replace function public.create_character(character_name text,character_surname text default '',base_profile jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.characters%rowtype;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false); end if;
  if char_length(btrim(coalesce(character_name,''))) not between 1 and 200 or jsonb_typeof(base_profile)<>'object' or (base_profile ? 'favorites' and jsonb_typeof(base_profile->'favorites')<>'array') or (base_profile ? 'hobbies' and jsonb_typeof(base_profile->'hobbies')<>'array') then
    return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Character profile is invalid.','changed',false);
  end if;
  insert into public.characters(owner_id,name,surname,base_profile) values((select auth.uid()),btrim(character_name),coalesce(character_surname,''),base_profile) returning * into item;
  return jsonb_build_object('ok',true,'code','OK','message','Character created.','characterRevision',item.revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_character(target_character_id uuid,expected_revision bigint,character_name text,character_surname text,base_profile jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.characters%rowtype;
begin
  select * into item from public.characters where id=target_character_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Character not found.','changed',false); end if;
  if item.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_REVISION_CONFLICT','message','Character changed. Reload before saving.','entityId',target_character_id,'expectedRevision',expected_revision,'actualRevision',item.revision,'changed',false); end if;
  if char_length(btrim(coalesce(character_name,''))) not between 1 and 200 or jsonb_typeof(base_profile)<>'object' or (base_profile ? 'favorites' and jsonb_typeof(base_profile->'favorites')<>'array') or (base_profile ? 'hobbies' and jsonb_typeof(base_profile->'hobbies')<>'array') then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Character profile is invalid.','characterRevision',item.revision,'changed',false); end if;
  if item.name=btrim(character_name) and item.surname=coalesce(character_surname,'') and item.base_profile=base_profile then return jsonb_build_object('ok',true,'code','OK','message','Character unchanged.','characterRevision',item.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.characters set name=btrim(character_name),surname=coalesce(character_surname,''),base_profile=$5,revision=revision+1 where id=target_character_id returning * into item;
  return jsonb_build_object('ok',true,'code','OK','message','Character updated.','characterRevision',item.revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.archive_character(target_character_id uuid,expected_revision bigint,archive boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item public.characters%rowtype; desired timestamptz;
begin
  select * into item from public.characters where id=target_character_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Character not found.','changed',false); end if;
  if item.revision<>expected_revision then return jsonb_build_object('ok',false,'code','CHARACTER_REVISION_CONFLICT','entityId',target_character_id,'expectedRevision',expected_revision,'actualRevision',item.revision,'message','Character changed. Reload before saving.','changed',false); end if;
  if (archive and item.archived_at is not null) or (not archive and item.archived_at is null) then return jsonb_build_object('ok',true,'code','OK','characterRevision',item.revision,'changed',false,'data',to_jsonb(item)); end if;
  desired:=case when archive then now() else null end;
  update public.characters set archived_at=desired,revision=revision+1 where id=target_character_id returning * into item;
  return jsonb_build_object('ok',true,'code','OK','characterRevision',item.revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.attach_project_character(target_project_id uuid,target_character_id uuid,expected_revision bigint,character_role text default null,character_sort_order numeric default 0,character_overrides jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.project_characters%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  if jsonb_typeof(character_overrides)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Overrides must be an object.','changed',false); end if;
  if not exists(select 1 from public.characters where id=target_character_id and owner_id=(select auth.uid()) and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Character not found.','changed',false); end if;
  if exists(select 1 from public.project_characters where project_id=target_project_id and character_id=target_character_id) then return jsonb_build_object('ok',false,'code','DUPLICATE','revision',p.revision,'message','Character is already attached.','changed',false); end if;
  insert into public.project_characters(project_id,character_id,overrides,role,sort_order) values(target_project_id,target_character_id,character_overrides,character_role,coalesce(character_sort_order,0)) returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.create_character_and_attach(target_project_id uuid,expected_revision bigint,character_name text,character_surname text,base_profile jsonb,character_role text default null,character_sort_order numeric default 0,character_overrides jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; c public.characters%rowtype; pc public.project_characters%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  if char_length(btrim(coalesce(character_name,''))) not between 1 and 200 or jsonb_typeof(base_profile)<>'object' or (base_profile ? 'favorites' and jsonb_typeof(base_profile->'favorites')<>'array') or (base_profile ? 'hobbies' and jsonb_typeof(base_profile->'hobbies')<>'array') or jsonb_typeof(character_overrides)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Character input is invalid.','changed',false); end if;
  insert into public.characters(owner_id,name,surname,base_profile) values((select auth.uid()),btrim(character_name),coalesce(character_surname,''),base_profile) returning * into c;
  insert into public.project_characters(project_id,character_id,overrides,role,sort_order) values(target_project_id,c.id,character_overrides,character_role,coalesce(character_sort_order,0)) returning * into pc;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'characterRevision',c.revision,'changed',true,'data',jsonb_build_object('character',to_jsonb(c),'project_character',to_jsonb(pc)));
end $$;

create or replace function public.update_project_character(target_project_id uuid,target_project_character_id uuid,expected_revision bigint,character_overrides jsonb,character_role text,character_sort_order numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.project_characters%rowtype; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  select * into item from public.project_characters where id=target_project_character_id and project_id=target_project_id and removed_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Project character not found.','changed',false); end if;
  if jsonb_typeof(character_overrides)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Overrides must be an object.','changed',false); end if;
  if item.overrides=character_overrides and item.role is not distinct from character_role and item.sort_order=coalesce(character_sort_order,0) then return jsonb_build_object('ok',true,'code','OK','revision',p.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.project_characters set overrides=character_overrides,role=character_role,sort_order=coalesce(character_sort_order,0) where id=target_project_character_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.remove_project_character(target_project_id uuid,target_project_character_id uuid,expected_revision bigint,cleanup_dependencies boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.project_characters%rowtype; counts jsonb; dependency_total bigint; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  select * into item from public.project_characters where id=target_project_character_id and project_id=target_project_id and removed_at is null;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Project character not found.','changed',false); end if;
  select jsonb_build_object(
    'sceneCharacters',(select count(*) from public.scene_characters where project_character_id=target_project_character_id),
    'initialRelations',(select count(*) from public.project_character_relations where from_project_character_id=target_project_character_id or to_project_character_id=target_project_character_id),
    'sceneRelationChanges',(select count(*) from public.scene_relation_changes where from_project_character_id=target_project_character_id or to_project_character_id=target_project_character_id),
    'characterImages',(select count(*) from public.character_images where project_character_id=target_project_character_id and deleted_at is null),
    'projectLinks',(select count(*) from public.character_links where project_id=target_project_id and deleted_at is null and (from_character_id=item.character_id or to_character_id=item.character_id))) into counts;
  dependency_total:=(counts->>'sceneCharacters')::bigint+(counts->>'initialRelations')::bigint+(counts->>'sceneRelationChanges')::bigint+(counts->>'characterImages')::bigint+(counts->>'projectLinks')::bigint;
  if dependency_total>0 and not cleanup_dependencies then return jsonb_build_object('ok',false,'code','DEPENDENCIES_EXIST','revision',p.revision,'message','Project character has dependencies.','changed',false,'dependencies',counts); end if;
  if cleanup_dependencies then
    delete from public.scene_characters where project_character_id=target_project_character_id;
    delete from public.project_character_relations where from_project_character_id=target_project_character_id or to_project_character_id=target_project_character_id;
    delete from public.scene_relation_changes where from_project_character_id=target_project_character_id or to_project_character_id=target_project_character_id;
    update public.character_images set deleted_at=coalesce(deleted_at,now()) where project_character_id=target_project_character_id and deleted_at is null;
    update public.character_links set deleted_at=coalesce(deleted_at,now()),revision=revision+1 where project_id=target_project_id and deleted_at is null and (from_character_id=item.character_id or to_character_id=item.character_id);
  end if;
  update public.project_characters set removed_at=now() where id=target_project_character_id returning * into item;
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'dependenciesRemoved',counts,'data',to_jsonb(item));
end $$;

create or replace function public.set_scene_characters(target_project_id uuid,target_scene_id uuid,expected_revision bigint,participants jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; normalized jsonb; existing jsonb; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  if not exists(select 1 from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Scene not found.','changed',false); end if;
  if jsonb_typeof(participants)<>'array' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Participants must be an array.','changed',false); end if;
  if exists(select 1 from jsonb_to_recordset(participants) x(project_character_id uuid,action text,legacy_state text,sort_order numeric) group by project_character_id having count(*)>1) then return jsonb_build_object('ok',false,'code','DUPLICATE','revision',p.revision,'message','Duplicate participant.','changed',false); end if;
  if exists(select 1 from jsonb_to_recordset(participants) x(project_character_id uuid,action text,legacy_state text,sort_order numeric) where not exists(select 1 from public.project_characters pc where pc.id=x.project_character_id and pc.project_id=target_project_id and pc.removed_at is null)) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Participant does not belong to project.','changed',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('project_character_id',x.project_character_id,'action',coalesce(x.action,''),'legacy_state',x.legacy_state,'sort_order',coalesce(x.sort_order,0)) order by coalesce(x.sort_order,0),x.project_character_id),'[]') into normalized from jsonb_to_recordset(participants) x(project_character_id uuid,action text,legacy_state text,sort_order numeric);
  select coalesce(jsonb_agg(jsonb_build_object('project_character_id',project_character_id,'action',action,'legacy_state',legacy_state,'sort_order',sort_order) order by sort_order,project_character_id),'[]') into existing from public.scene_characters where scene_id=target_scene_id;
  if normalized=existing then return jsonb_build_object('ok',true,'code','OK','revision',p.revision,'changed',false,'data',normalized); end if;
  delete from public.scene_characters where scene_id=target_scene_id;
  insert into public.scene_characters(project_id,scene_id,project_character_id,action,legacy_state,sort_order) select target_project_id,target_scene_id,x.project_character_id,coalesce(x.action,''),x.legacy_state,coalesce(x.sort_order,0) from jsonb_to_recordset(normalized) x(project_character_id uuid,action text,legacy_state text,sort_order numeric);
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'data',normalized);
end $$;

create or replace function public.set_project_character_relations(target_project_id uuid,expected_revision bigint,relations jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; normalized jsonb; existing jsonb; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  if jsonb_typeof(relations)<>'array' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Relations must be an array.','changed',false); end if;
  if exists(select 1 from jsonb_to_recordset(relations) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb) where x.from_project_character_id=x.to_project_character_id or (x.value_operation is null and x.visible is null) or x.value_operation not in ('set','clear') or (x.value_operation='set' and x.value is null) or (x.value_operation='clear' and x.value is not null)) then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Relation is invalid.','changed',false); end if;
  if exists(select x.from_project_character_id,x.to_project_character_id from jsonb_to_recordset(relations) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb) group by x.from_project_character_id,x.to_project_character_id having count(*)>1) then return jsonb_build_object('ok',false,'code','DUPLICATE','revision',p.revision,'message','Duplicate directed relation.','changed',false); end if;
  if exists(select 1 from jsonb_to_recordset(relations) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb) where not exists(select 1 from public.project_characters pc where pc.project_id=target_project_id and pc.removed_at is null and pc.id in (x.from_project_character_id,x.to_project_character_id) group by pc.project_id having count(*)=2)) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Relation character does not belong to project.','changed',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('from_project_character_id',x.from_project_character_id,'to_project_character_id',x.to_project_character_id,'value_operation',x.value_operation,'value',x.value,'visible',x.visible,'metadata',coalesce(x.metadata,'{}')) order by x.from_project_character_id,x.to_project_character_id),'[]') into normalized from jsonb_to_recordset(relations) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('from_project_character_id',from_project_character_id,'to_project_character_id',to_project_character_id,'value_operation',value_operation,'value',value,'visible',visible,'metadata',metadata) order by from_project_character_id,to_project_character_id),'[]') into existing from public.project_character_relations where project_id=target_project_id;
  if normalized=existing then return jsonb_build_object('ok',true,'code','OK','revision',p.revision,'changed',false,'data',normalized); end if;
  delete from public.project_character_relations where project_id=target_project_id;
  insert into public.project_character_relations(project_id,from_project_character_id,to_project_character_id,value_operation,value,visible,metadata) select target_project_id,x.from_project_character_id,x.to_project_character_id,x.value_operation,x.value,x.visible,coalesce(x.metadata,'{}') from jsonb_to_recordset(normalized) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'data',normalized);
end $$;

create or replace function public.set_scene_relation_changes(target_project_id uuid,target_scene_id uuid,expected_revision bigint,changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; normalized jsonb; existing jsonb; new_revision bigint;
begin
  select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  if not exists(select 1 from public.scenes where id=target_scene_id and project_id=target_project_id and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Scene not found.','changed',false); end if;
  if jsonb_typeof(changes)<>'array' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Changes must be an array.','changed',false); end if;
  if exists(select 1 from jsonb_to_recordset(changes) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb) where x.from_project_character_id=x.to_project_character_id or (x.value_operation is null and x.visible is null) or x.value_operation not in ('set','clear') or (x.value_operation='set' and x.value is null) or (x.value_operation='clear' and x.value is not null)) then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','revision',p.revision,'message','Scene relation change is invalid.','changed',false); end if;
  if exists(select x.from_project_character_id,x.to_project_character_id from jsonb_to_recordset(changes) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb) group by x.from_project_character_id,x.to_project_character_id having count(*)>1) then return jsonb_build_object('ok',false,'code','DUPLICATE','revision',p.revision,'message','Duplicate scene relation change.','changed',false); end if;
  if exists(select 1 from jsonb_to_recordset(changes) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb) where not exists(select 1 from public.project_characters pc where pc.project_id=target_project_id and pc.removed_at is null and pc.id in (x.from_project_character_id,x.to_project_character_id) group by pc.project_id having count(*)=2)) then return jsonb_build_object('ok',false,'code','NOT_FOUND','revision',p.revision,'message','Relation character does not belong to project.','changed',false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('from_project_character_id',x.from_project_character_id,'to_project_character_id',x.to_project_character_id,'value_operation',x.value_operation,'value',x.value,'visible',x.visible,'metadata',coalesce(x.metadata,'{}')) order by x.from_project_character_id,x.to_project_character_id),'[]') into normalized from jsonb_to_recordset(changes) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('from_project_character_id',from_project_character_id,'to_project_character_id',to_project_character_id,'value_operation',value_operation,'value',value,'visible',visible,'metadata',metadata) order by from_project_character_id,to_project_character_id),'[]') into existing from public.scene_relation_changes where scene_id=target_scene_id;
  if normalized=existing then return jsonb_build_object('ok',true,'code','OK','revision',p.revision,'changed',false,'data',normalized); end if;
  delete from public.scene_relation_changes where scene_id=target_scene_id;
  insert into public.scene_relation_changes(project_id,scene_id,from_project_character_id,to_project_character_id,value_operation,value,visible,metadata) select target_project_id,target_scene_id,x.from_project_character_id,x.to_project_character_id,x.value_operation,x.value,x.visible,coalesce(x.metadata,'{}') from jsonb_to_recordset(normalized) x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'changed',true,'data',normalized);
end $$;

create or replace function public.list_global_character_links()
returns jsonb language sql stable security invoker set search_path=''
as $$ select case when (select auth.uid()) is null then jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false) else jsonb_build_object('ok',true,'code','OK','changed',false,'data',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from public.character_links l where l.owner_id=(select auth.uid()) and l.project_id is null and l.deleted_at is null),'[]')) end $$;

create or replace function public.create_character_link(target_project_id uuid,expected_project_revision bigint,from_character_id uuid,to_character_id uuid,link_category text,link_type text,link_reverse_type text,link_custom_label text,link_reverse_custom_label text,link_notes text,link_structure_kind text,link_metadata jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.character_links%rowtype; new_revision bigint;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false); end if;
  if target_project_id is not null then
    select * into p from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
    if p.revision<>expected_project_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_project_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  end if;
  if from_character_id=to_character_id or link_category not in ('family','romantic','social','professional','other') or link_structure_kind not in ('biological','legal','chosen','professional','social','other') or jsonb_typeof(link_metadata)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Link is invalid.','changed',false); end if;
  if not exists(select 1 from public.characters where id=from_character_id and owner_id=(select auth.uid()) and deleted_at is null) or not exists(select 1 from public.characters where id=to_character_id and owner_id=(select auth.uid()) and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Character not found.','changed',false); end if;
  if exists(select 1 from public.character_links l where l.owner_id=(select auth.uid()) and l.project_id is not distinct from target_project_id and l.deleted_at is null and ((l.from_character_id=$3 and l.to_character_id=$4 and l.type=link_type and l.reverse_type=link_reverse_type and l.custom_label is not distinct from link_custom_label and l.reverse_custom_label is not distinct from link_reverse_custom_label) or (l.from_character_id=$4 and l.to_character_id=$3 and l.type=link_reverse_type and l.reverse_type=link_type and l.custom_label is not distinct from link_reverse_custom_label and l.reverse_custom_label is not distinct from link_custom_label))) then return jsonb_build_object('ok',false,'code','DUPLICATE','revision',case when target_project_id is null then null else p.revision end,'message','Equivalent link already exists.','changed',false); end if;
  insert into public.character_links(owner_id,project_id,from_character_id,to_character_id,category,type,reverse_type,custom_label,reverse_custom_label,notes,structure_kind,metadata) values((select auth.uid()),target_project_id,from_character_id,to_character_id,link_category,link_type,link_reverse_type,link_custom_label,link_reverse_custom_label,coalesce(link_notes,''),link_structure_kind,link_metadata) returning * into item;
  if target_project_id is not null then update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'linkRevision',item.revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.update_character_link(target_link_id uuid,expected_project_revision bigint,expected_link_revision bigint,from_character_id uuid,to_character_id uuid,link_category text,link_type text,link_reverse_type text,link_custom_label text,link_reverse_custom_label text,link_notes text,link_structure_kind text,link_metadata jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.character_links%rowtype; new_revision bigint;
begin
  select * into item from public.character_links where id=target_link_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Link not found.','changed',false); end if;
  if item.project_id is null then
    if item.revision<>expected_link_revision then return jsonb_build_object('ok',false,'code','GLOBAL_LINK_REVISION_CONFLICT','entityId',target_link_id,'expectedRevision',expected_link_revision,'actualRevision',item.revision,'message','Global link changed. Reload before saving.','changed',false); end if;
  else
    select * into p from public.projects where id=item.project_id and owner_id=(select auth.uid()) and deleted_at is null for update;
    if p.revision<>expected_project_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_project_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if;
  end if;
  if from_character_id=to_character_id or link_category not in ('family','romantic','social','professional','other') or link_structure_kind not in ('biological','legal','chosen','professional','social','other') or jsonb_typeof(link_metadata)<>'object' then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Link is invalid.','changed',false); end if;
  if not exists(select 1 from public.characters where id=from_character_id and owner_id=(select auth.uid()) and deleted_at is null) or not exists(select 1 from public.characters where id=to_character_id and owner_id=(select auth.uid()) and deleted_at is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Character not found.','changed',false); end if;
  if (item.from_character_id,item.to_character_id,item.category,item.type,item.reverse_type,item.notes,item.structure_kind,item.metadata)=(from_character_id,to_character_id,link_category,link_type,link_reverse_type,coalesce(link_notes,''),link_structure_kind,link_metadata) and item.custom_label is not distinct from link_custom_label and item.reverse_custom_label is not distinct from link_reverse_custom_label then return jsonb_build_object('ok',true,'code','OK','revision',p.revision,'linkRevision',item.revision,'changed',false,'data',to_jsonb(item)); end if;
  update public.character_links set from_character_id=$4,to_character_id=$5,category=link_category,type=link_type,reverse_type=link_reverse_type,custom_label=link_custom_label,reverse_custom_label=link_reverse_custom_label,notes=coalesce(link_notes,''),structure_kind=link_structure_kind,metadata=link_metadata,revision=revision+1 where id=target_link_id returning * into item;
  if item.project_id is not null then update public.projects set revision=revision+1,updated_at=now() where id=item.project_id returning revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'linkRevision',item.revision,'changed',true,'data',to_jsonb(item));
end $$;

create or replace function public.delete_character_link(target_link_id uuid,expected_project_revision bigint,expected_link_revision bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.projects%rowtype; item public.character_links%rowtype; new_revision bigint;
begin
  select * into item from public.character_links where id=target_link_id and owner_id=(select auth.uid()) and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Link not found.','changed',false); end if;
  if item.project_id is null and item.revision<>expected_link_revision then return jsonb_build_object('ok',false,'code','GLOBAL_LINK_REVISION_CONFLICT','entityId',target_link_id,'expectedRevision',expected_link_revision,'actualRevision',item.revision,'message','Global link changed. Reload before saving.','changed',false); end if;
  if item.project_id is not null then select * into p from public.projects where id=item.project_id and owner_id=(select auth.uid()) and deleted_at is null for update; if p.revision<>expected_project_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_project_revision,'actualRevision',p.revision,'message','Project changed. Reload before saving.','changed',false); end if; end if;
  update public.character_links set deleted_at=now(),revision=revision+1 where id=target_link_id returning * into item;
  if item.project_id is not null then update public.projects set revision=revision+1,updated_at=now() where id=item.project_id returning revision into new_revision; end if;
  return jsonb_build_object('ok',true,'code','OK','revision',new_revision,'linkRevision',item.revision,'changed',true,'data',to_jsonb(item));
end $$;

-- Keep all project-scoped collections in the same row-lock-consistent snapshot.
create or replace function public.get_project_content(target_project_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare project_row public.projects%rowtype;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN','message','Authentication required.','changed',false); end if;
  select * into project_row from public.projects where id=target_project_id and owner_id=(select auth.uid()) and deleted_at is null for share;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','Project not found.','changed',false); end if;
  return jsonb_build_object('ok',true,'code','OK','message','Project content loaded.','revision',project_row.revision,'changed',false,'data',jsonb_build_object(
    'project',jsonb_build_object('id',project_row.id,'revision',project_row.revision,'updated_at',project_row.updated_at),
    'chapters',coalesce((select jsonb_agg(to_jsonb(x) order by x.position,x.id) from public.chapters x where x.project_id=target_project_id and x.deleted_at is null),'[]'),
    'locations',coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name),x.id) from public.locations x where x.project_id=target_project_id and x.deleted_at is null),'[]'),
    'tags',coalesce((select jsonb_agg(to_jsonb(x) order by x.normalized_name,x.id) from public.tags x where x.project_id=target_project_id),'[]'),
    'scenes',coalesce((select jsonb_agg(to_jsonb(x) order by x.position,x.id) from public.scenes x where x.project_id=target_project_id and x.deleted_at is null),'[]'),
    'scene_tags',coalesce((select jsonb_agg(to_jsonb(x) order by x.scene_id,x.tag_id) from public.scene_tags x where x.project_id=target_project_id),'[]'),
    'project_characters',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order,x.id) from public.project_characters x where x.project_id=target_project_id and x.removed_at is null),'[]'),
    'scene_characters',coalesce((select jsonb_agg(to_jsonb(x) order by x.scene_id,x.sort_order,x.project_character_id) from public.scene_characters x where x.project_id=target_project_id),'[]'),
    'project_character_relations',coalesce((select jsonb_agg(to_jsonb(x) order by x.from_project_character_id,x.to_project_character_id) from public.project_character_relations x where x.project_id=target_project_id),'[]'),
    'scene_relation_changes',coalesce((select jsonb_agg(to_jsonb(x) order by x.scene_id,x.from_project_character_id,x.to_project_character_id) from public.scene_relation_changes x where x.project_id=target_project_id),'[]'),
    'character_links',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from public.character_links x where x.project_id=target_project_id and x.deleted_at is null),'[]')
  ));
end $$;

-- Data API exposure is allow-listed. SECURITY INVOKER plus RLS remains authoritative.
do $$ declare signature text; begin
  foreach signature in array array[
    'public.list_characters()','public.create_character(text,text,jsonb)','public.update_character(uuid,bigint,text,text,jsonb)','public.archive_character(uuid,bigint,boolean)',
    'public.attach_project_character(uuid,uuid,bigint,text,numeric,jsonb)','public.create_character_and_attach(uuid,bigint,text,text,jsonb,text,numeric,jsonb)','public.update_project_character(uuid,uuid,bigint,jsonb,text,numeric)','public.remove_project_character(uuid,uuid,bigint,boolean)',
    'public.set_scene_characters(uuid,uuid,bigint,jsonb)','public.set_project_character_relations(uuid,bigint,jsonb)','public.set_scene_relation_changes(uuid,uuid,bigint,jsonb)','public.list_global_character_links()',
    'public.create_character_link(uuid,bigint,uuid,uuid,text,text,text,text,text,text,text,jsonb)','public.update_character_link(uuid,bigint,bigint,uuid,uuid,text,text,text,text,text,text,text,jsonb)','public.delete_character_link(uuid,bigint,bigint)'
  ] loop execute format('revoke execute on function %s from public,anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop;
end $$;
