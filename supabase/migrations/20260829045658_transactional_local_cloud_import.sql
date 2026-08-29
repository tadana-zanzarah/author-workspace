-- Atomic execution boundary for a confirmed local -> empty cloud migration.

create table public.local_project_import_attempts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_project_id text not null,
  payload_fingerprint text not null,
  status text not null default 'committed' check (status in ('committed')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, project_id, source_project_id)
);

alter table public.local_project_import_attempts enable row level security;
revoke all on table public.local_project_import_attempts from public, anon, authenticated;
grant select, insert on table public.local_project_import_attempts to authenticated;
create policy local_project_import_attempts_select on public.local_project_import_attempts
  for select to authenticated using ((select auth.uid())=owner_id);
create policy local_project_import_attempts_insert on public.local_project_import_attempts
  for insert to authenticated with check ((select auth.uid())=owner_id and private.project_owned(project_id));

create or replace function private.local_import_target_empty(target_project_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select not exists(select 1 from public.project_characters where project_id=target_project_id)
    and not exists(select 1 from public.chapters where project_id=target_project_id)
    and not exists(select 1 from public.locations where project_id=target_project_id)
    and not exists(select 1 from public.tags where project_id=target_project_id)
    and not exists(select 1 from public.scenes where project_id=target_project_id)
    and not exists(select 1 from public.character_links where project_id=target_project_id);
$$;
revoke all on function private.local_import_target_empty(uuid) from public, anon, authenticated;
grant execute on function private.local_import_target_empty(uuid) to authenticated;

create or replace function private.local_import_payload_valid(target_project_id uuid, import_payload jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select jsonb_typeof(import_payload)='object'
    and import_payload->>'project_id'=target_project_id::text
    and not (import_payload::text like '%data:%;base64,%')
    and (select bool_and(jsonb_typeof(import_payload->k)='array') from unnest(array[
      'characters','chapters','locations','tags','scenes','scene_tags','scene_characters',
      'initial_relations','scene_relation_changes','structural_links','character_images'
    ]) k);
$$;
revoke all on function private.local_import_payload_valid(uuid,jsonb) from public, anon, authenticated;
grant execute on function private.local_import_payload_valid(uuid,jsonb) to authenticated;

create or replace function public.preflight_local_project_import(target_project_id uuid, expected_revision bigint, migration_attempt_id uuid, import_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p public.projects%rowtype; prior public.local_project_import_attempts%rowtype;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  if target_project_id is null or expected_revision is null or migration_attempt_id is null or not private.local_import_payload_valid(target_project_id,import_payload) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  select * into p from public.projects where id=target_project_id and deleted_at is null for share;
  if not found or p.owner_id<>(select auth.uid()) then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select * into prior from public.local_project_import_attempts where id=migration_attempt_id;
  if found then
    if prior.owner_id=(select auth.uid()) and prior.project_id=target_project_id and prior.payload_fingerprint=md5(import_payload::text) then return jsonb_build_object('ok',true,'code','ALREADY_COMMITTED','status','committed','result',prior.result); end if;
    return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN');
  end if;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if not private.local_import_target_empty(target_project_id) then return jsonb_build_object('ok',false,'code','TARGET_NOT_EMPTY'); end if;
  if exists(select 1 from jsonb_array_elements(import_payload->'character_images') i where split_part(i->>'storage_path','/',1)<>p.owner_id::text or split_part(i->>'storage_path','/',2)<>'characters' or split_part(i->>'storage_path','/',3)<>i->>'character_id' or split_part(i->>'storage_path','/',4)<>i->>'id') then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  if exists(select 1 from (select i->>'character_id' character_id,i->>'project_character_id' project_character_id,count(*) from jsonb_array_elements(import_payload->'character_images') i where coalesce((i->>'is_primary')::boolean,false) group by 1,2 having count(*)>1) duplicates) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  if exists(select 1 from jsonb_array_elements(import_payload->'character_images') i join public.character_images current_image on current_image.character_id=(i->>'character_id')::uuid and current_image.project_character_id is null and current_image.is_primary and current_image.deleted_at is null where i->>'project_character_id' is null and coalesce((i->>'is_primary')::boolean,false)) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  return jsonb_build_object('ok',true,'code','OK','revision',p.revision);
end $$;

create or replace function public.get_local_project_import_attempt(migration_attempt_id uuid,target_project_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare item public.local_project_import_attempts%rowtype;
begin
  if (select auth.uid()) is null then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select * into item from public.local_project_import_attempts where id=migration_attempt_id and project_id=target_project_id and owner_id=(select auth.uid());
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'code','OK','status',item.status,'result',item.result);
end $$;

create or replace function public.import_local_project_content(target_project_id uuid,expected_revision bigint,migration_attempt_id uuid,source_project_id text,import_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare p public.projects%rowtype; prior public.local_project_import_attempts%rowtype; item jsonb; owner uuid; previous_revision bigint; new_revision bigint; result jsonb; created jsonb;
begin
  owner=(select auth.uid());
  if owner is null then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  if target_project_id is null or expected_revision is null or migration_attempt_id is null or nullif(btrim(source_project_id),'') is null or not private.local_import_payload_valid(target_project_id,import_payload) or import_payload->>'source_project_id'<>source_project_id or import_payload->>'migration_attempt_id'<>migration_attempt_id::text then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  select * into prior from public.local_project_import_attempts where id=migration_attempt_id;
  if found then
    if prior.owner_id=owner and prior.project_id=target_project_id and prior.source_project_id=source_project_id and prior.payload_fingerprint=md5(import_payload::text) then return prior.result; end if;
    return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN');
  end if;
  select * into p from public.projects where id=target_project_id and deleted_at is null for update;
  if not found or p.owner_id<>owner then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  previous_revision=p.revision;
  if p.revision<>expected_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT','expectedRevision',expected_revision,'actualRevision',p.revision); end if;
  if not private.local_import_target_empty(target_project_id) then return jsonb_build_object('ok',false,'code','TARGET_NOT_EMPTY'); end if;
  if exists(select 1 from jsonb_array_elements(import_payload->'character_images') i where split_part(i->>'storage_path','/',1)<>owner::text or split_part(i->>'storage_path','/',2)<>'characters' or split_part(i->>'storage_path','/',3)<>i->>'character_id' or split_part(i->>'storage_path','/',4)<>i->>'id') then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  if exists(select 1 from (select i->>'character_id' character_id,i->>'project_character_id' project_character_id,count(*) from jsonb_array_elements(import_payload->'character_images') i where coalesce((i->>'is_primary')::boolean,false) group by 1,2 having count(*)>1) duplicates) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;
  if exists(select 1 from jsonb_array_elements(import_payload->'character_images') i join public.character_images current_image on current_image.character_id=(i->>'character_id')::uuid and current_image.project_character_id is null and current_image.is_primary and current_image.deleted_at is null where i->>'project_character_id' is null and coalesce((i->>'is_primary')::boolean,false)) then return jsonb_build_object('ok',false,'code','INVALID_MIGRATION_PLAN'); end if;

  -- Identity creation and project attachment share this transaction with content.
  for item in select value from jsonb_array_elements(import_payload->'characters') loop
    if item->>'action'='CREATE_NEW_GLOBAL_IDENTITY' then
      insert into public.characters(id,owner_id,name,surname,base_profile,metadata)
      values((item->>'id')::uuid,owner,item->>'name',coalesce(item->>'surname',''),coalesce(item->'base_profile','{}'),coalesce(item->'metadata','{}'));
    elsif item->>'action'='MAP_TO_EXISTING_CHARACTER' then
      if not exists(select 1 from public.characters c where c.id=(item->>'id')::uuid and c.owner_id=owner and c.deleted_at is null) then raise exception 'INVALID_MIGRATION_PLAN' using errcode='22023'; end if;
    else raise exception 'INVALID_MIGRATION_PLAN' using errcode='22023';
    end if;
    insert into public.project_characters(id,project_id,character_id,overrides,role,sort_order,metadata)
    values((item->>'project_character_id')::uuid,target_project_id,(item->>'id')::uuid,coalesce(item->'overrides','{}'),item->>'role',coalesce((item->>'sort_order')::numeric,0),'{}');
  end loop;

  insert into public.chapters(id,project_id,title,position,metadata) select x.id,target_project_id,x.title,x.position,coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'chapters') as x(id uuid,title text,position numeric,metadata jsonb);
  insert into public.locations(id,project_id,name,description,metadata) select x.id,target_project_id,x.name,coalesce(x.description,''),coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'locations') as x(id uuid,name text,description text,metadata jsonb);
  insert into public.tags(id,project_id,name,normalized_name) select x.id,target_project_id,x.name,x.normalized_name from jsonb_to_recordset(import_payload->'tags') as x(id uuid,name text,normalized_name text);
  insert into public.scenes(id,project_id,chapter_id,location_id,title,scene_text,scene_date,scene_time,placement_status,writing_status,included,date_review,position,metadata)
    select x.id,target_project_id,x.chapter_id,x.location_id,coalesce(x.title,''),coalesce(x.scene_text,''),x.scene_date,x.scene_time,x.placement_status,x.writing_status,coalesce(x.included,true),coalesce(x.date_review,false),x.position,coalesce(x.metadata,'{}')
    from jsonb_to_recordset(import_payload->'scenes') as x(id uuid,chapter_id uuid,location_id uuid,title text,scene_text text,scene_date date,scene_time time,placement_status text,writing_status text,included boolean,date_review boolean,position numeric,metadata jsonb);
  insert into public.scene_tags(project_id,scene_id,tag_id) select target_project_id,x.scene_id,x.tag_id from jsonb_to_recordset(import_payload->'scene_tags') as x(scene_id uuid,tag_id uuid);
  insert into public.scene_characters(project_id,scene_id,project_character_id,action,legacy_state,sort_order) select target_project_id,x.scene_id,x.project_character_id,coalesce(x.action,''),x.legacy_state,coalesce(x.sort_order,0) from jsonb_to_recordset(import_payload->'scene_characters') as x(scene_id uuid,project_character_id uuid,action text,legacy_state text,sort_order numeric);
  insert into public.project_character_relations(project_id,from_project_character_id,to_project_character_id,value_operation,value,visible,metadata) select target_project_id,x.from_project_character_id,x.to_project_character_id,x.value_operation,x.value,x.visible,coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'initial_relations') as x(from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  insert into public.scene_relation_changes(project_id,scene_id,from_project_character_id,to_project_character_id,value_operation,value,visible,metadata) select target_project_id,x.scene_id,x.from_project_character_id,x.to_project_character_id,x.value_operation,x.value,x.visible,coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'scene_relation_changes') as x(scene_id uuid,from_project_character_id uuid,to_project_character_id uuid,value_operation text,value text,visible boolean,metadata jsonb);
  insert into public.character_links(id,owner_id,project_id,from_character_id,to_character_id,category,type,reverse_type,custom_label,reverse_custom_label,notes,structure_kind,metadata)
    select x.id,owner,x.project_id,x.from_character_id,x.to_character_id,x.category,x.type,x.reverse_type,x.custom_label,x.reverse_custom_label,coalesce(x.notes,''),coalesce(x.structure_kind,'other'),coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'structural_links') as x(id uuid,project_id uuid,from_character_id uuid,to_character_id uuid,category text,type text,reverse_type text,custom_label text,reverse_custom_label text,notes text,structure_kind text,metadata jsonb);
  insert into public.character_images(id,character_id,project_character_id,storage_path,mime_type,crop,alt,caption,sort_order,is_primary,metadata)
    select x.id,x.character_id,x.project_character_id,x.storage_path,x.mime_type,coalesce(x.crop,'{}'),coalesce(x.alt,''),coalesce(x.caption,''),coalesce(x.sort_order,0),coalesce(x.is_primary,false),coalesce(x.metadata,'{}') from jsonb_to_recordset(import_payload->'character_images') as x(id uuid,character_id uuid,project_character_id uuid,storage_path text,mime_type text,crop jsonb,alt text,caption text,sort_order numeric,is_primary boolean,metadata jsonb);

  update public.projects set revision=revision+1,updated_at=now() where id=target_project_id returning revision into new_revision;
  created=jsonb_build_object('characters',(select count(*) from jsonb_array_elements(import_payload->'characters') x where x->>'action'='CREATE_NEW_GLOBAL_IDENTITY'),'projectCharacters',jsonb_array_length(import_payload->'characters'),'chapters',jsonb_array_length(import_payload->'chapters'),'locations',jsonb_array_length(import_payload->'locations'),'tags',jsonb_array_length(import_payload->'tags'),'scenes',jsonb_array_length(import_payload->'scenes'),'sceneTags',jsonb_array_length(import_payload->'scene_tags'),'sceneCharacters',jsonb_array_length(import_payload->'scene_characters'),'relations',jsonb_array_length(import_payload->'initial_relations'),'relationChanges',jsonb_array_length(import_payload->'scene_relation_changes'),'structuralLinks',jsonb_array_length(import_payload->'structural_links'),'characterImages',jsonb_array_length(import_payload->'character_images'));
  result=jsonb_build_object('ok',true,'code','OK','migrationAttemptId',migration_attempt_id,'sourceProjectId',source_project_id,'targetProjectId',target_project_id,'previousRevision',previous_revision,'revision',new_revision,'created',created);
  insert into public.local_project_import_attempts(id,owner_id,project_id,source_project_id,payload_fingerprint,result) values(migration_attempt_id,owner,target_project_id,source_project_id,md5(import_payload::text),result);
  return result;
end $$;

do $$ declare signature text; begin foreach signature in array array[
  'public.preflight_local_project_import(uuid,bigint,uuid,jsonb)',
  'public.get_local_project_import_attempt(uuid,uuid)',
  'public.import_local_project_content(uuid,bigint,uuid,text,jsonb)'
] loop execute format('revoke execute on function %s from public,anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop; end $$;

-- Verification snapshot includes image metadata and global links whose endpoints both
-- participate in this project. Existing get_project_content fields remain unchanged.
create or replace function public.get_local_project_import_snapshot(target_project_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare base jsonb;
begin
  base=public.get_project_content(target_project_id);
  if coalesce((base->>'ok')::boolean,false)=false then return base; end if;
  return jsonb_set(jsonb_set(base,'{data,character_images}',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.character_images i where i.deleted_at is null and exists(select 1 from public.project_characters pc where pc.project_id=target_project_id and pc.character_id=i.character_id and (i.project_character_id is null or i.project_character_id=pc.id))),'[]')),'{data,character_links}',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.character_links l where l.deleted_at is null and (l.project_id=target_project_id or (l.project_id is null and exists(select 1 from public.project_characters a where a.project_id=target_project_id and a.character_id=l.from_character_id) and exists(select 1 from public.project_characters b where b.project_id=target_project_id and b.character_id=l.to_character_id)))),'[]'));
end $$;
revoke execute on function public.get_local_project_import_snapshot(uuid) from public,anon;
grant execute on function public.get_local_project_import_snapshot(uuid) to authenticated;
