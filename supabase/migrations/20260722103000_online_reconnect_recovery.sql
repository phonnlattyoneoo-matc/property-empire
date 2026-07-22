create or replace function public.reconnect_online_player(
  target_room_id uuid,
  expected_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms%rowtype;
  target_player public.room_players%rowtype;
  player_seat_index integer;
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
    raise exception 'This online room cannot be reconnected.'
      using errcode = '22023';
  end if;

  update public.room_players
    set last_seen_at = now()
    where id = expected_player_id
      and room_id = target_room_id
      and user_id = current_user_id
    returning * into target_player;

  if not found then
    raise exception 'Saved online player was not found in this room.'
      using errcode = 'P0002';
  end if;

  with ordered_players as (
    select
      id,
      row_number() over (order by joined_at, id) - 1 as seat_index
    from public.room_players
    where room_id = target_room_id
  )
  select seat_index
    into player_seat_index
    from ordered_players
    where id = target_player.id;

  if player_seat_index is null then
    raise exception 'Saved online seat could not be restored.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'playerId', target_player.id,
    'roomId', target_room.id,
    'roomCode', target_room.code,
    'roomStatus', target_room.status,
    'userId', target_player.user_id,
    'displayName', target_player.display_name,
    'isHost', target_player.is_host,
    'seatIndex', player_seat_index
  );
end;
$$;

revoke all on function public.reconnect_online_player(uuid, uuid) from public;
grant execute on function public.reconnect_online_player(uuid, uuid) to authenticated;
