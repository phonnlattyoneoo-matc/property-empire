create extension if not exists pgcrypto;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  max_players integer not null default 4 check (max_players between 2 and 4),
  status text not null default 'waiting' check (status in ('waiting', 'started', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (
    char_length(trim(display_name)) between 1 and 24
  ),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table public.game_states (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version integer not null default 0 check (version >= 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rooms_code_idx on public.rooms (code);
create index rooms_host_user_id_idx on public.rooms (host_user_id);
create index room_players_room_id_joined_at_idx
  on public.room_players (room_id, joined_at);
create index room_players_user_id_idx on public.room_players (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_room_player_host_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_host := exists (
    select 1
    from public.rooms
    where id = new.room_id
      and host_user_id = new.user_id
  );

  return new;
end;
$$;

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_players
    where room_id = target_room_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_room_host(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where id = target_room_id
      and host_user_id = auth.uid()
  );
$$;

create or replace function public.room_has_capacity(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms
    where id = target_room_id
      and status = 'waiting'
      and (
        select count(*)
        from public.room_players
        where room_id = target_room_id
      ) < max_players
  );
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row
  execute function public.set_updated_at();

drop trigger if exists game_states_set_updated_at on public.game_states;
create trigger game_states_set_updated_at
  before update on public.game_states
  for each row
  execute function public.set_updated_at();

drop trigger if exists room_players_set_host_flag on public.room_players;
create trigger room_players_set_host_flag
  before insert or update on public.room_players
  for each row
  execute function public.set_room_player_host_flag();

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.game_states enable row level security;

drop policy if exists "Authenticated users can create rooms" on public.rooms;
create policy "Authenticated users can create rooms"
  on public.rooms
  for insert
  to authenticated
  with check (
    host_user_id = auth.uid()
    and status = 'waiting'
  );

drop policy if exists "Authenticated users can read open or joined rooms" on public.rooms;
create policy "Authenticated users can read open or joined rooms"
  on public.rooms
  for select
  to authenticated
  using (
    status = 'waiting'
    or public.is_room_member(id)
  );

drop policy if exists "Hosts can update rooms" on public.rooms;
create policy "Hosts can update rooms"
  on public.rooms
  for update
  to authenticated
  using (public.is_room_host(id))
  with check (host_user_id = auth.uid());

drop policy if exists "Hosts can delete rooms" on public.rooms;
create policy "Hosts can delete rooms"
  on public.rooms
  for delete
  to authenticated
  using (public.is_room_host(id));

drop policy if exists "Users can read waiting room players or their rooms" on public.room_players;
create policy "Users can read waiting room players or their rooms"
  on public.room_players
  for select
  to authenticated
  using (
    public.is_room_member(room_id)
    or exists (
      select 1
      from public.rooms
      where rooms.id = room_players.room_id
        and status = 'waiting'
    )
  );

drop policy if exists "Users can join waiting rooms with capacity" on public.room_players;
create policy "Users can join waiting rooms with capacity"
  on public.room_players
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.room_has_capacity(room_id)
  );

drop policy if exists "Users can update their own room player row" on public.room_players;
create policy "Users can update their own room player row"
  on public.room_players
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users and hosts can leave or remove room players" on public.room_players;
create policy "Users and hosts can leave or remove room players"
  on public.room_players
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_room_host(room_id)
  );

drop policy if exists "Room members can read game state" on public.game_states;
create policy "Room members can read game state"
  on public.game_states
  for select
  to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "Room members can create game state" on public.game_states;
drop policy if exists "Room hosts can create game state" on public.game_states;
create policy "Room hosts can create game state"
  on public.game_states
  for insert
  to authenticated
  with check (
    public.is_room_host(room_id)
    and updated_by = auth.uid()
  );

drop policy if exists "Room members can update game state" on public.game_states;
drop policy if exists "Room hosts can update game state" on public.game_states;
create policy "Room hosts can update game state"
  on public.game_states
  for update
  to authenticated
  using (public.is_room_host(room_id))
  with check (
    public.is_room_host(room_id)
    and updated_by = auth.uid()
  );

alter table public.rooms replica identity full;
alter table public.room_players replica identity full;
alter table public.game_states replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'rooms'
    ) then
      alter publication supabase_realtime add table public.rooms;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'room_players'
    ) then
      alter publication supabase_realtime add table public.room_players;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'game_states'
    ) then
      alter publication supabase_realtime add table public.game_states;
    end if;
  end if;
end;
$$;
