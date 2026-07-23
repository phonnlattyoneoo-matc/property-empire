create index if not exists rooms_status_updated_at_idx
  on public.rooms (status, updated_at);

create index if not exists room_players_room_id_last_seen_at_idx
  on public.room_players (room_id, last_seen_at);

create index if not exists room_players_last_seen_at_idx
  on public.room_players (last_seen_at);

create index if not exists game_states_updated_at_idx
  on public.game_states (updated_at);

create or replace function public.cleanup_abandoned_online_rooms(
  older_than interval default interval '24 hours',
  delete_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  safe_cutoff timestamptz;
  safe_limit integer;
begin
  safe_cutoff := now() - greatest(
    coalesce(older_than, interval '24 hours'),
    interval '24 hours'
  );
  safe_limit := least(greatest(coalesce(delete_limit, 100), 1), 500);

  with abandoned_rooms as (
    select rooms.id
    from public.rooms
    left join public.game_states
      on game_states.room_id = rooms.id
    where rooms.created_at < safe_cutoff
      and coalesce(game_states.updated_at, rooms.updated_at) < safe_cutoff
      and not exists (
        select 1
        from public.room_players
        where room_players.room_id = rooms.id
          and room_players.last_seen_at >= safe_cutoff
      )
      and (
        rooms.status in ('waiting', 'closed')
        or (
          rooms.status = 'started'
          and game_states.room_id is not null
          and game_states.updated_at < safe_cutoff
        )
      )
    order by coalesce(game_states.updated_at, rooms.updated_at) asc
    limit safe_limit
  ),
  deleted_rooms as (
    delete from public.rooms
    where rooms.id in (
      select abandoned_rooms.id
      from abandoned_rooms
    )
    returning rooms.id
  )
  select count(*)
    into deleted_count
    from deleted_rooms;

  return deleted_count;
end;
$$;

revoke all on function public.cleanup_abandoned_online_rooms(interval, integer)
  from public;
grant execute on function public.cleanup_abandoned_online_rooms(interval, integer)
  to authenticated;
