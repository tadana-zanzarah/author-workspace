create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_path text,
  bio text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 120),
  constraint profiles_bio_length check (char_length(bio) <= 2000),
  constraint profiles_settings_object check (jsonb_typeof(settings) = 'object')
);

create table public.series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint series_title_not_blank check (char_length(btrim(title)) between 1 and 200),
  constraint series_description_length check (char_length(description) <= 10000)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references public.series(id) on delete set null,
  title text not null,
  description text not null default '',
  position_in_series integer,
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint projects_title_not_blank check (char_length(btrim(title)) between 1 and 200),
  constraint projects_description_length check (char_length(description) <= 10000),
  constraint projects_position_positive check (position_in_series is null or position_in_series >= 1),
  constraint projects_position_requires_series check (series_id is not null or position_in_series is null),
  constraint projects_status_allowed check (status in ('active', 'draft', 'archived')),
  constraint projects_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint projects_revision_nonnegative check (revision >= 0)
);

create index series_owner_active_idx
  on public.series (owner_id, created_at desc)
  where deleted_at is null;
create index projects_owner_active_idx
  on public.projects (owner_id, created_at desc)
  where deleted_at is null;
create index projects_series_order_idx
  on public.projects (series_id, position_in_series, created_at)
  where deleted_at is null and series_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger series_set_updated_at
before update on public.series
for each row execute function public.set_updated_at();
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create or replace function public.validate_project_series_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.series_id is not null and not exists (
    select 1
    from public.series
    where id = new.series_id
      and owner_id = new.owner_id
      and deleted_at is null
  ) then
    raise exception 'Project series must belong to the same owner and be active'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger projects_validate_series_owner
before insert or update of owner_id, series_id on public.projects
for each row execute function public.validate_project_series_owner();

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 120)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.series enable row level security;
alter table public.projects enable row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);
create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy series_select_own
on public.series for select
to authenticated
using ((select auth.uid()) = owner_id);
create policy series_insert_own
on public.series for insert
to authenticated
with check ((select auth.uid()) = owner_id);
create policy series_update_own
on public.series for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy series_delete_own
on public.series for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy projects_select_own
on public.projects for select
to authenticated
using ((select auth.uid()) = owner_id);
create policy projects_insert_own
on public.projects for insert
to authenticated
with check ((select auth.uid()) = owner_id);
create policy projects_update_own
on public.projects for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy projects_delete_own
on public.projects for delete
to authenticated
using ((select auth.uid()) = owner_id);

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.series to authenticated;
grant select, insert, update, delete on public.projects to authenticated;

create or replace function public.archive_series_keep_projects(target_series_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.projects
  set series_id = null, position_in_series = null
  where series_id = target_series_id
    and owner_id = (select auth.uid());

  update public.series
  set deleted_at = now()
  where id = target_series_id
    and owner_id = (select auth.uid());

  if not found then
    raise exception 'Series not found or access denied' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_project_series(
  target_project_id uuid,
  target_series_id uuid,
  target_position integer default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_series_id is not null and not exists (
    select 1 from public.series
    where id = target_series_id
      and owner_id = (select auth.uid())
      and deleted_at is null
  ) then
    raise exception 'Series not found or access denied' using errcode = 'P0002';
  end if;

  update public.projects
  set series_id = target_series_id,
      position_in_series = case when target_series_id is null then null else target_position end
  where id = target_project_id
    and owner_id = (select auth.uid())
    and deleted_at is null;

  if not found then
    raise exception 'Project not found or access denied' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.reorder_series_projects(
  target_series_id uuid,
  ordered_project_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_count integer;
  supplied_count integer;
begin
  if not exists (
    select 1 from public.series
    where id = target_series_id
      and owner_id = (select auth.uid())
      and deleted_at is null
  ) then
    raise exception 'Series not found or access denied' using errcode = 'P0002';
  end if;

  select count(*) into expected_count
  from public.projects
  where series_id = target_series_id
    and owner_id = (select auth.uid())
    and deleted_at is null;

  select count(distinct project_id) into supplied_count
  from unnest(ordered_project_ids) as project_id;

  if supplied_count <> expected_count or exists (
    select 1 from unnest(ordered_project_ids) as project_id
    where not exists (
      select 1 from public.projects
      where id = project_id
        and series_id = target_series_id
        and owner_id = (select auth.uid())
        and deleted_at is null
    )
  ) then
    raise exception 'Ordered project list must contain every active project in the series exactly once'
      using errcode = '22023';
  end if;

  update public.projects as project
  set position_in_series = ordering.position
  from unnest(ordered_project_ids) with ordinality as ordering(project_id, position)
  where project.id = ordering.project_id
    and project.owner_id = (select auth.uid());
end;
$$;

revoke all on function public.archive_series_keep_projects(uuid) from public, anon;
revoke all on function public.set_project_series(uuid, uuid, integer) from public, anon;
revoke all on function public.reorder_series_projects(uuid, uuid[]) from public, anon;
grant execute on function public.archive_series_keep_projects(uuid) to authenticated;
grant execute on function public.set_project_series(uuid, uuid, integer) to authenticated;
grant execute on function public.reorder_series_projects(uuid, uuid[]) to authenticated;
