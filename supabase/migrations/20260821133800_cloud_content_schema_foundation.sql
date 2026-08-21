-- Cloud content relational foundation. Production UI remains localStorage-backed.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.projects alter column revision type bigint using revision::bigint;
alter table public.projects alter column revision set default 0;
alter table public.projects add constraint projects_owner_id_id_key unique (owner_id, id);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  surname text not null default '',
  base_profile jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint characters_name_not_blank check (char_length(btrim(name)) between 1 and 200),
  constraint characters_base_profile_object check (jsonb_typeof(base_profile) = 'object'),
  constraint characters_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (owner_id, id)
);

create table public.project_characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete restrict,
  overrides jsonb not null default '{}'::jsonb,
  role text,
  sort_order numeric(20,10) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint project_characters_overrides_object check (jsonb_typeof(overrides) = 'object'),
  constraint project_characters_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint project_characters_project_character_key unique (project_id, character_id),
  constraint project_characters_project_id_id_key unique (project_id, id),
  constraint project_characters_character_id_id_key unique (character_id, id)
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  position numeric(20,10) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chapters_title_not_blank check (char_length(btrim(title)) between 1 and 300),
  constraint chapters_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (project_id, id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint locations_name_not_blank check (char_length(btrim(name)) between 1 and 300),
  constraint locations_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (project_id, id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_not_blank check (char_length(btrim(name)) between 1 and 200),
  constraint tags_normalized_name_not_blank check (char_length(btrim(normalized_name)) > 0),
  constraint tags_project_normalized_name_key unique (project_id, normalized_name),
  unique (project_id, id)
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_id uuid,
  location_id uuid,
  title text not null default '',
  scene_text text not null default '',
  scene_date date,
  scene_time time without time zone,
  placement_status text not null default 'placed',
  writing_status text not null default 'draft',
  included boolean not null default true,
  date_review boolean not null default false,
  position numeric(20,10) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint scenes_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint scenes_placement_status_allowed check (placement_status in ('placed','unplaced')),
  constraint scenes_writing_status_allowed check (writing_status in ('draft','in_progress','revised','final')),
  constraint scenes_project_chapter_fkey foreign key (project_id, chapter_id)
    references public.chapters(project_id, id) on delete set null (chapter_id),
  constraint scenes_project_location_fkey foreign key (project_id, location_id)
    references public.locations(project_id, id) on delete set null (location_id),
  unique (project_id, id)
);

create table public.scene_tags (
  project_id uuid not null,
  scene_id uuid not null,
  tag_id uuid not null,
  primary key (scene_id, tag_id),
  constraint scene_tags_scene_fkey foreign key (project_id, scene_id) references public.scenes(project_id, id) on delete cascade,
  constraint scene_tags_tag_fkey foreign key (project_id, tag_id) references public.tags(project_id, id) on delete cascade
);

create table public.scene_characters (
  project_id uuid not null,
  scene_id uuid not null,
  project_character_id uuid not null,
  action text not null default '',
  legacy_state text,
  sort_order numeric(20,10) not null default 0,
  constraint scene_characters_scene_fkey foreign key (project_id, scene_id) references public.scenes(project_id, id) on delete cascade,
  constraint scene_characters_project_character_fkey foreign key (project_id, project_character_id) references public.project_characters(project_id, id) on delete cascade,
  constraint scene_characters_scene_character_key unique (scene_id, project_character_id)
);

create table public.project_character_relations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_project_character_id uuid not null,
  to_project_character_id uuid not null,
  value_operation text,
  value text,
  visible boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_character_relations_from_fkey foreign key (project_id, from_project_character_id) references public.project_characters(project_id, id) on delete cascade,
  constraint project_character_relations_to_fkey foreign key (project_id, to_project_character_id) references public.project_characters(project_id, id) on delete cascade,
  constraint project_character_relations_not_self check (from_project_character_id <> to_project_character_id),
  constraint project_character_relations_operation check ((value_operation = 'set' and value is not null) or (value_operation = 'clear' and value is null) or value_operation is null),
  constraint project_character_relations_has_change check (value_operation is not null or visible is not null),
  constraint project_character_relations_pair_key unique (project_id, from_project_character_id, to_project_character_id),
  constraint project_character_relations_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.scene_relation_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  scene_id uuid not null,
  from_project_character_id uuid not null,
  to_project_character_id uuid not null,
  value_operation text,
  value text,
  visible boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scene_relation_changes_scene_fkey foreign key (project_id, scene_id) references public.scenes(project_id, id) on delete cascade,
  constraint scene_relation_changes_from_fkey foreign key (project_id, from_project_character_id) references public.project_characters(project_id, id) on delete cascade,
  constraint scene_relation_changes_to_fkey foreign key (project_id, to_project_character_id) references public.project_characters(project_id, id) on delete cascade,
  constraint scene_relation_changes_not_self check (from_project_character_id <> to_project_character_id),
  constraint scene_relation_changes_operation check ((value_operation = 'set' and value is not null) or (value_operation = 'clear' and value is null) or value_operation is null),
  constraint scene_relation_changes_has_change check (value_operation is not null or visible is not null),
  constraint scene_relation_changes_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (scene_id, from_project_character_id, to_project_character_id)
);

create table public.character_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  from_character_id uuid not null,
  to_character_id uuid not null,
  category text not null,
  type text not null,
  reverse_type text not null,
  custom_label text,
  reverse_custom_label text,
  notes text not null default '',
  structure_kind text not null default 'other',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint character_links_owner_project_fkey foreign key (owner_id, project_id) references public.projects(owner_id, id) on delete cascade,
  constraint character_links_owner_from_fkey foreign key (owner_id, from_character_id) references public.characters(owner_id, id) on delete restrict,
  constraint character_links_owner_to_fkey foreign key (owner_id, to_character_id) references public.characters(owner_id, id) on delete restrict,
  constraint character_links_not_self check (from_character_id <> to_character_id),
  constraint character_links_category_allowed check (category in ('family','romantic','social','professional','other')),
  constraint character_links_structure_kind_allowed check (structure_kind in ('biological','legal','chosen','professional','social','other')),
  constraint character_links_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.character_images (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete restrict,
  project_character_id uuid,
  storage_path text not null,
  mime_type text,
  crop jsonb not null default '{}'::jsonb,
  alt text not null default '',
  caption text not null default '',
  sort_order numeric(20,10) not null default 0,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint character_images_character_context_fkey foreign key (character_id, project_character_id) references public.project_characters(character_id, id) on delete restrict,
  constraint character_images_storage_path_not_blank check (char_length(btrim(storage_path)) > 0),
  constraint character_images_crop_object check (jsonb_typeof(crop) = 'object'),
  constraint character_images_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create or replace function private.project_owned(target_project_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select exists (select 1 from public.projects p where p.id=target_project_id and p.owner_id=(select auth.uid())) $$;
create or replace function private.character_owned(target_character_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select exists (select 1 from public.characters c where c.id=target_character_id and c.owner_id=(select auth.uid())) $$;
create or replace function private.scene_owned(target_scene_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select exists (select 1 from public.scenes s join public.projects p on p.id=s.project_id where s.id=target_scene_id and p.owner_id=(select auth.uid())) $$;

grant usage on schema private to authenticated;
grant execute on function private.project_owned(uuid), private.character_owned(uuid), private.scene_owned(uuid) to authenticated;

create or replace function private.enforce_project_character_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects p join public.characters c on c.owner_id=p.owner_id where p.id=new.project_id and c.id=new.character_id) then
    raise exception 'project and character owners must match' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.enforce_project_character_owner() from public, anon, authenticated;
create trigger project_characters_owner_guard before insert or update of project_id,character_id on public.project_characters for each row execute function private.enforce_project_character_owner();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end $$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['characters','project_characters','chapters','locations','tags','scenes','project_character_relations','scene_relation_changes','character_links','character_images'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function private.touch_updated_at()',t,t);
  end loop;
end $$;

create index characters_owner_idx on public.characters(owner_id);
create index characters_owner_name_idx on public.characters(owner_id,lower(name),lower(surname));
create index project_characters_project_sort_idx on public.project_characters(project_id,sort_order,id) where removed_at is null;
create index project_characters_character_idx on public.project_characters(character_id,project_id) where removed_at is null;
create index chapters_project_position_idx on public.chapters(project_id,position,id) where deleted_at is null;
create index locations_project_idx on public.locations(project_id) where deleted_at is null;
create index scenes_project_position_idx on public.scenes(project_id,position,id) where deleted_at is null;
create index scenes_project_chapter_position_idx on public.scenes(project_id,chapter_id,position,id);
create index scenes_project_location_idx on public.scenes(project_id,location_id);
create index scene_tags_tag_idx on public.scene_tags(tag_id,scene_id);
create index scene_characters_project_character_idx on public.scene_characters(project_character_id,scene_id);
create index project_character_relations_from_idx on public.project_character_relations(project_id,from_project_character_id);
create index project_character_relations_to_idx on public.project_character_relations(project_id,to_project_character_id);
create index scene_relation_changes_scene_idx on public.scene_relation_changes(scene_id);
create index character_links_from_idx on public.character_links(from_character_id);
create index character_links_to_idx on public.character_links(to_character_id);
create index character_links_project_idx on public.character_links(project_id) where project_id is not null;
create index character_images_character_idx on public.character_images(character_id);
create index character_images_project_character_idx on public.character_images(project_character_id) where project_character_id is not null;
create unique index character_images_identity_primary_idx on public.character_images(character_id) where project_character_id is null and is_primary and deleted_at is null;
create unique index character_images_project_primary_idx on public.character_images(project_character_id) where project_character_id is not null and is_primary and deleted_at is null;

do $$ declare t text; begin
  foreach t in array array['characters','project_characters','chapters','locations','tags','scenes','scene_tags','scene_characters','project_character_relations','scene_relation_changes','character_links','character_images'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',t);
  end loop;
end $$;

create policy characters_select on public.characters for select to authenticated using ((select auth.uid())=owner_id);
create policy characters_insert on public.characters for insert to authenticated with check ((select auth.uid())=owner_id);
create policy characters_update on public.characters for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy characters_delete on public.characters for delete to authenticated using ((select auth.uid())=owner_id);

create policy project_characters_select on public.project_characters for select to authenticated using (private.project_owned(project_id));
create policy project_characters_insert on public.project_characters for insert to authenticated with check (private.project_owned(project_id) and private.character_owned(character_id));
create policy project_characters_update on public.project_characters for update to authenticated using (private.project_owned(project_id)) with check (private.project_owned(project_id) and private.character_owned(character_id));
create policy project_characters_delete on public.project_characters for delete to authenticated using (private.project_owned(project_id));

do $$ declare t text; begin
  foreach t in array array['chapters','locations','tags','scenes','project_character_relations'] loop
    execute format('create policy %I_select on public.%I for select to authenticated using (private.project_owned(project_id))',t,t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (private.project_owned(project_id))',t,t);
    execute format('create policy %I_update on public.%I for update to authenticated using (private.project_owned(project_id)) with check (private.project_owned(project_id))',t,t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (private.project_owned(project_id))',t,t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['scene_tags','scene_characters','scene_relation_changes'] loop
    execute format('create policy %I_select on public.%I for select to authenticated using (private.scene_owned(scene_id))',t,t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (private.scene_owned(scene_id))',t,t);
    execute format('create policy %I_update on public.%I for update to authenticated using (private.scene_owned(scene_id)) with check (private.scene_owned(scene_id))',t,t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (private.scene_owned(scene_id))',t,t);
  end loop;
end $$;

create policy character_links_select on public.character_links for select to authenticated using ((select auth.uid())=owner_id and (project_id is null or private.project_owned(project_id)));
create policy character_links_insert on public.character_links for insert to authenticated with check ((select auth.uid())=owner_id and private.character_owned(from_character_id) and private.character_owned(to_character_id) and (project_id is null or private.project_owned(project_id)));
create policy character_links_update on public.character_links for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id and private.character_owned(from_character_id) and private.character_owned(to_character_id) and (project_id is null or private.project_owned(project_id)));
create policy character_links_delete on public.character_links for delete to authenticated using ((select auth.uid())=owner_id);

create policy character_images_select on public.character_images for select to authenticated using (private.character_owned(character_id));
create policy character_images_insert on public.character_images for insert to authenticated with check (private.character_owned(character_id));
create policy character_images_update on public.character_images for update to authenticated using (private.character_owned(character_id)) with check (private.character_owned(character_id));
create policy character_images_delete on public.character_images for delete to authenticated using (private.character_owned(character_id));
