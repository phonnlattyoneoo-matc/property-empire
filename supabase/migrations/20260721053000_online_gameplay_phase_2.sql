grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.rooms to authenticated;
grant select, insert, update, delete on table public.room_players to authenticated;
grant select on table public.game_states to authenticated;
revoke insert, update, delete on table public.game_states from authenticated;

drop policy if exists "Room members can create game state" on public.game_states;
drop policy if exists "Room hosts can create game state" on public.game_states;
drop policy if exists "Room members can update game state" on public.game_states;
drop policy if exists "Room hosts can update game state" on public.game_states;

create or replace function public.online_board_space_name(space_position integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case space_position
    when 0 then 'Grand Plaza'
    when 1 then 'CoLab Court'
    when 2 then 'City Tax'
    when 3 then 'Pixel Row'
    when 4 then 'Metro Loop'
    when 5 then 'Pop-Up Market'
    when 6 then 'Skyline Lofts'
    when 7 then 'Canal Walk'
    when 8 then 'Maker Lane'
    when 9 then 'Harbor Line'
    when 10 then 'Street Fest'
    when 11 then 'Glass Tower'
    when 12 then 'Civic Detention'
    when 13 then 'Greenway Flats'
    when 14 then 'Grid Levy'
    when 15 then 'Central Rail'
    when 16 then 'Neon Arcade'
    when 17 then 'City Vote'
    when 18 then 'Rooftop Rest'
    when 19 then 'Market Hall'
    when 20 then 'Riverfront'
    when 21 then 'Bike Hub'
    when 22 then 'Night Market'
    when 23 then 'Depot Flats'
    else 'Unknown Block'
  end;
$$;

create or replace function public.start_online_game(target_room_id uuid)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms%rowtype;
  lobby_players jsonb;
  lobby_player_count integer;
  first_player_name text;
  initial_state jsonb;
  updated_game public.game_states%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
    into target_room
    from public.rooms
    where id = target_room_id
    for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  if target_room.host_user_id <> current_user_id then
    raise exception 'Only the host can start the online game.'
      using errcode = '42501';
  end if;

  if target_room.status = 'started' then
    select *
      into updated_game
      from public.game_states
      where room_id = target_room_id;

    if found and updated_game.state ->> 'phase' = 'online_game' then
      return updated_game;
    end if;

    raise exception 'This room has already started.'
      using errcode = '22023';
  end if;

  if target_room.status <> 'waiting' then
    raise exception 'Only waiting rooms can be started.'
      using errcode = '22023';
  end if;

  with ordered_players as (
    select
      id,
      user_id,
      display_name,
      joined_at,
      row_number() over (order by joined_at, id) - 1 as player_index
    from public.room_players
    where room_id = target_room_id
  )
  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'userId', user_id,
          'name', display_name,
          'color', case player_index
            when 0 then '#ef476f'
            when 1 then '#3454d1'
            when 2 then '#06d6a0'
            else '#f8961e'
          end,
          'balance', 1500,
          'position', 0
        )
        order by joined_at, id
      ),
      '[]'::jsonb
    )
    into lobby_player_count, lobby_players
    from ordered_players;

  if lobby_player_count < 2 or lobby_player_count > 4 then
    raise exception 'Online games require two to four players.'
      using errcode = '22023';
  end if;

  if lobby_player_count > target_room.max_players then
    raise exception 'This room has more players than its limit.'
      using errcode = '22023';
  end if;

  first_player_name := lobby_players -> 0 ->> 'name';
  initial_state := jsonb_build_object(
    'phase', 'online_game',
    'boardSpaceCount', 24,
    'players', lobby_players,
    'currentPlayerIndex', 0,
    'hasRolledThisTurn', false,
    'lastRoll', null,
    'message', first_player_name || ' starts at Grand Plaza.'
  );

  insert into public.game_states (room_id, state, version, updated_by)
  values (target_room_id, initial_state, 0, current_user_id)
  on conflict (room_id) do update
    set state = excluded.state,
        version = public.game_states.version + 1,
        updated_by = excluded.updated_by
  returning * into updated_game;

  update public.rooms
    set status = 'started'
    where id = target_room_id;

  return updated_game;
end;
$$;

create or replace function public.roll_online_turn(
  target_room_id uuid,
  expected_version integer,
  die_one integer,
  die_two integer
)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms%rowtype;
  current_game public.game_states%rowtype;
  updated_game public.game_states%rowtype;
  state_data jsonb;
  players_data jsonb;
  current_player jsonb;
  current_player_index integer;
  current_player_user_id uuid;
  current_player_name text;
  old_position integer;
  new_position integer;
  old_balance integer;
  new_balance integer;
  roll_total integer;
  passed_grand_plaza boolean;
  destination_name text;
  turn_message text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if die_one is null
    or die_two is null
    or die_one not between 1 and 6
    or die_two not between 1 and 6 then
    raise exception 'Dice values must be between one and six.'
      using errcode = '22023';
  end if;

  select *
    into target_room
    from public.rooms
    where id = target_room_id
    for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  if target_room.status <> 'started' then
    raise exception 'This online game has not started.'
      using errcode = '22023';
  end if;

  select *
    into current_game
    from public.game_states
    where room_id = target_room_id
    for update;

  if not found then
    raise exception 'Game state not found.' using errcode = 'P0002';
  end if;

  if expected_version is null or current_game.version <> expected_version then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  state_data := current_game.state;

  if state_data ->> 'phase' is distinct from 'online_game' then
    raise exception 'This room is not in online gameplay.'
      using errcode = '22023';
  end if;

  if coalesce((state_data ->> 'hasRolledThisTurn')::boolean, false) then
    raise exception 'This player has already rolled this turn.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if current_player_index < 0
    or current_player_index >= jsonb_array_length(players_data) then
    raise exception 'Current turn is invalid.' using errcode = '22023';
  end if;

  current_player := players_data -> current_player_index;
  current_player_user_id := (current_player ->> 'userId')::uuid;

  if current_player_user_id <> current_user_id then
    raise exception 'Only the current player can roll the dice.'
      using errcode = '42501';
  end if;

  roll_total := die_one + die_two;
  old_position := (current_player ->> 'position')::integer;
  old_balance := (current_player ->> 'balance')::integer;
  new_position := (old_position + roll_total) % 24;
  passed_grand_plaza := old_position + roll_total >= 24;
  new_balance := old_balance + case when passed_grand_plaza then 200 else 0 end;
  destination_name := public.online_board_space_name(new_position);
  current_player_name := current_player ->> 'name';
  turn_message := current_player_name || ' rolled ' || die_one || ' + '
    || die_two || ' = ' || roll_total || ' and moved to '
    || destination_name || '.';

  if passed_grand_plaza then
    turn_message := turn_message || ' Collected $200 City Launch Bonus.';
  end if;

  state_data := jsonb_set(
    state_data,
    array['players', current_player_index::text, 'position'],
    to_jsonb(new_position),
    false
  );
  state_data := jsonb_set(
    state_data,
    array['players', current_player_index::text, 'balance'],
    to_jsonb(new_balance),
    false
  );
  state_data := jsonb_set(
    state_data,
    '{lastRoll}',
    jsonb_build_object(
      'dieOne', die_one,
      'dieTwo', die_two,
      'total', roll_total
    ),
    false
  );
  state_data := jsonb_set(
    state_data,
    '{hasRolledThisTurn}',
    'true'::jsonb,
    false
  );
  state_data := jsonb_set(
    state_data,
    '{message}',
    to_jsonb(turn_message),
    false
  );

  update public.game_states
    set state = state_data,
        version = current_game.version + 1,
        updated_by = current_user_id
    where room_id = target_room_id
    returning * into updated_game;

  return updated_game;
end;
$$;

create or replace function public.end_online_turn(
  target_room_id uuid,
  expected_version integer
)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms%rowtype;
  current_game public.game_states%rowtype;
  updated_game public.game_states%rowtype;
  state_data jsonb;
  players_data jsonb;
  current_player jsonb;
  current_player_index integer;
  current_player_user_id uuid;
  next_player_index integer;
  next_player_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select *
    into target_room
    from public.rooms
    where id = target_room_id
    for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  if target_room.status <> 'started' then
    raise exception 'This online game has not started.'
      using errcode = '22023';
  end if;

  select *
    into current_game
    from public.game_states
    where room_id = target_room_id
    for update;

  if not found then
    raise exception 'Game state not found.' using errcode = 'P0002';
  end if;

  if expected_version is null or current_game.version <> expected_version then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  state_data := current_game.state;

  if state_data ->> 'phase' is distinct from 'online_game' then
    raise exception 'This room is not in online gameplay.'
      using errcode = '22023';
  end if;

  if not coalesce((state_data ->> 'hasRolledThisTurn')::boolean, false) then
    raise exception 'Roll the dice before ending the turn.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if current_player_index < 0
    or current_player_index >= jsonb_array_length(players_data) then
    raise exception 'Current turn is invalid.' using errcode = '22023';
  end if;

  current_player := players_data -> current_player_index;
  current_player_user_id := (current_player ->> 'userId')::uuid;

  if current_player_user_id <> current_user_id then
    raise exception 'Only the current player can end their turn.'
      using errcode = '42501';
  end if;

  next_player_index := (current_player_index + 1) % jsonb_array_length(players_data);
  next_player_name := players_data -> next_player_index ->> 'name';

  state_data := jsonb_set(
    state_data,
    '{currentPlayerIndex}',
    to_jsonb(next_player_index),
    false
  );
  state_data := jsonb_set(
    state_data,
    '{hasRolledThisTurn}',
    'false'::jsonb,
    false
  );
  state_data := jsonb_set(state_data, '{lastRoll}', 'null'::jsonb, false);
  state_data := jsonb_set(
    state_data,
    '{message}',
    to_jsonb(next_player_name || '''s turn.'),
    false
  );

  update public.game_states
    set state = state_data,
        version = current_game.version + 1,
        updated_by = current_user_id
    where room_id = target_room_id
    returning * into updated_game;

  return updated_game;
end;
$$;

revoke all on function public.online_board_space_name(integer) from public;
revoke all on function public.start_online_game(uuid) from public;
revoke all on function public.roll_online_turn(uuid, integer, integer, integer) from public;
revoke all on function public.end_online_turn(uuid, integer) from public;

grant execute on function public.start_online_game(uuid) to authenticated;
grant execute on function public.roll_online_turn(uuid, integer, integer, integer) to authenticated;
grant execute on function public.end_online_turn(uuid, integer) to authenticated;
