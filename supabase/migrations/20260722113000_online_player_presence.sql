create or replace function public.heartbeat_online_player(
  target_room_id uuid,
  expected_player_id uuid
)
returns public.room_players
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms%rowtype;
  updated_player public.room_players%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if expected_player_id is null then
    raise exception 'Saved online player is missing.' using errcode = '22023';
  end if;

  select *
    into target_room
    from public.rooms
    where id = target_room_id;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  if target_room.status = 'closed' then
    raise exception 'This online room has been closed.' using errcode = '22023';
  end if;

  if target_room.status not in ('waiting', 'started') then
    raise exception 'This online room cannot receive heartbeats.'
      using errcode = '22023';
  end if;

  update public.room_players
    set last_seen_at = now()
    where id = expected_player_id
      and room_id = target_room_id
      and user_id = current_user_id
    returning * into updated_player;

  if not found then
    raise exception 'Saved online player was not found in this room.'
      using errcode = 'P0002';
  end if;

  return updated_player;
end;
$$;

revoke all on function public.heartbeat_online_player(uuid, uuid) from public;
grant execute on function public.heartbeat_online_player(uuid, uuid) to authenticated;
