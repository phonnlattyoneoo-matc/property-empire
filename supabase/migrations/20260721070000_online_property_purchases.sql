grant usage on schema public to authenticated;

grant select on table public.game_states to authenticated;
revoke insert, update, delete on table public.game_states from authenticated;

drop policy if exists "Room members can create game state" on public.game_states;
drop policy if exists "Room hosts can create game state" on public.game_states;
drop policy if exists "Room members can update game state" on public.game_states;
drop policy if exists "Room hosts can update game state" on public.game_states;

create or replace function public.online_property_price(space_position integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case space_position
    when 1 then 120
    when 3 then 140
    when 6 then 180
    when 7 then 200
    when 8 then 220
    when 11 then 260
    when 13 then 240
    when 16 then 280
    when 19 then 320
    when 20 then 360
    when 23 then 300
    else null
  end;
$$;

create or replace function public.online_property_rent(space_position integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case space_position
    when 1 then 12
    when 3 then 14
    when 6 then 18
    when 7 then 20
    when 8 then 22
    when 11 then 26
    when 13 then 24
    when 16 then 28
    when 19 then 32
    when 20 then 36
    when 23 then 30
    else null
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
    'propertyOwners', '{}'::jsonb,
    'pendingPropertyPurchasePosition', null,
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
  current_player_id text;
  current_player_user_id uuid;
  current_player_name text;
  old_position integer;
  new_position integer;
  old_balance integer;
  new_balance integer;
  bonus_amount integer;
  roll_total integer;
  passed_grand_plaza boolean;
  destination_name text;
  turn_message text;
  property_owners jsonb;
  property_owner_id text;
  property_price integer;
  rent_amount integer;
  owner_player_index integer := -1;
  scan_player_index integer;
  owner_player jsonb;
  owner_player_name text;
  owner_balance integer;
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

  if state_data -> 'pendingPropertyPurchasePosition' is not null
    and state_data -> 'pendingPropertyPurchasePosition' <> 'null'::jsonb then
    raise exception 'Resolve the property purchase before rolling again.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  property_owners := coalesce(state_data -> 'propertyOwners', '{}'::jsonb);
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if current_player_index < 0
    or current_player_index >= jsonb_array_length(players_data) then
    raise exception 'Current turn is invalid.' using errcode = '22023';
  end if;

  current_player := players_data -> current_player_index;
  current_player_id := current_player ->> 'id';
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
  bonus_amount := case when passed_grand_plaza then 200 else 0 end;
  new_balance := old_balance + bonus_amount;
  destination_name := public.online_board_space_name(new_position);
  current_player_name := current_player ->> 'name';
  property_price := public.online_property_price(new_position);
  rent_amount := public.online_property_rent(new_position);
  turn_message := current_player_name || ' rolled ' || die_one || ' + '
    || die_two || ' = ' || roll_total || ' and moved to '
    || destination_name || '.';

  if passed_grand_plaza then
    turn_message := turn_message || ' Collected $200 City Launch Bonus.';
  end if;

  state_data := jsonb_set(
    state_data,
    '{propertyOwners}',
    property_owners,
    true
  );

  if property_price is not null then
    property_owner_id := property_owners ->> (new_position::text);

    if property_owner_id is null then
      state_data := jsonb_set(
        state_data,
        '{pendingPropertyPurchasePosition}',
        to_jsonb(new_position),
        true
      );
      turn_message := turn_message || ' ' || destination_name
        || ' is available for $' || property_price
        || ' with $' || rent_amount || ' rent.';
    elsif property_owner_id = current_player_id then
      state_data := jsonb_set(
        state_data,
        '{pendingPropertyPurchasePosition}',
        'null'::jsonb,
        true
      );
      turn_message := turn_message || ' ' || current_player_name
        || ' already owns ' || destination_name || '.';
    else
      for scan_player_index in
        0..jsonb_array_length(players_data) - 1
      loop
        if players_data -> scan_player_index ->> 'id' = property_owner_id then
          owner_player_index := scan_player_index;
          exit;
        end if;
      end loop;

      if owner_player_index < 0 then
        raise exception 'Property owner could not be found.'
          using errcode = '22023';
      end if;

      owner_player := players_data -> owner_player_index;
      owner_player_name := owner_player ->> 'name';
      owner_balance := (owner_player ->> 'balance')::integer + rent_amount;
      new_balance := new_balance - rent_amount;

      state_data := jsonb_set(
        state_data,
        array['players', owner_player_index::text, 'balance'],
        to_jsonb(owner_balance),
        false
      );
      state_data := jsonb_set(
        state_data,
        '{pendingPropertyPurchasePosition}',
        'null'::jsonb,
        true
      );
      turn_message := turn_message || ' Paid $' || rent_amount
        || ' rent to ' || owner_player_name || ' for '
        || destination_name || '.';
    end if;
  else
    state_data := jsonb_set(
      state_data,
      '{pendingPropertyPurchasePosition}',
      'null'::jsonb,
      true
    );
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

create or replace function public.buy_online_property(
  target_room_id uuid,
  expected_version integer,
  property_position integer
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
  current_player_id text;
  current_player_user_id uuid;
  current_player_name text;
  old_balance integer;
  new_balance integer;
  property_owners jsonb;
  property_price integer;
  rent_amount integer;
  destination_name text;
  pending_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if property_position is null
    or public.online_property_price(property_position) is null then
    raise exception 'Only property spaces can be purchased.'
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

  if not coalesce((state_data ->> 'hasRolledThisTurn')::boolean, false) then
    raise exception 'Roll before buying a property.'
      using errcode = '22023';
  end if;

  if state_data ->> 'pendingPropertyPurchasePosition' is null then
    raise exception 'There is no property purchase to resolve.'
      using errcode = '22023';
  end if;

  pending_position := (state_data ->> 'pendingPropertyPurchasePosition')::integer;

  if pending_position <> property_position then
    raise exception 'That property is not available this turn.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  property_owners := coalesce(state_data -> 'propertyOwners', '{}'::jsonb);
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if current_player_index < 0
    or current_player_index >= jsonb_array_length(players_data) then
    raise exception 'Current turn is invalid.' using errcode = '22023';
  end if;

  current_player := players_data -> current_player_index;
  current_player_id := current_player ->> 'id';
  current_player_user_id := (current_player ->> 'userId')::uuid;

  if current_player_user_id <> current_user_id then
    raise exception 'Only the current player can buy this property.'
      using errcode = '42501';
  end if;

  if current_player ->> 'position' <> property_position::text then
    raise exception 'The current player is not on this property.'
      using errcode = '22023';
  end if;

  if property_owners ? (property_position::text) then
    raise exception 'This property has already been purchased.'
      using errcode = '22023';
  end if;

  property_price := public.online_property_price(property_position);
  rent_amount := public.online_property_rent(property_position);
  destination_name := public.online_board_space_name(property_position);
  current_player_name := current_player ->> 'name';
  old_balance := (current_player ->> 'balance')::integer;

  if old_balance < property_price then
    raise exception 'The current player cannot afford this property.'
      using errcode = '22023';
  end if;

  new_balance := old_balance - property_price;

  state_data := jsonb_set(
    state_data,
    '{propertyOwners}',
    property_owners,
    true
  );
  state_data := jsonb_set(
    state_data,
    array['propertyOwners', property_position::text],
    to_jsonb(current_player_id),
    true
  );
  state_data := jsonb_set(
    state_data,
    array['players', current_player_index::text, 'balance'],
    to_jsonb(new_balance),
    false
  );
  state_data := jsonb_set(
    state_data,
    '{pendingPropertyPurchasePosition}',
    'null'::jsonb,
    true
  );
  state_data := jsonb_set(
    state_data,
    '{message}',
    to_jsonb(
      current_player_name || ' bought ' || destination_name || ' for $'
      || property_price || '. Rent is $' || rent_amount || '.'
    ),
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

create or replace function public.skip_online_property_purchase(
  target_room_id uuid,
  expected_version integer,
  property_position integer
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
  destination_name text;
  pending_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if property_position is null
    or public.online_property_price(property_position) is null then
    raise exception 'Only property spaces can be skipped.'
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

  if state_data ->> 'pendingPropertyPurchasePosition' is null then
    raise exception 'There is no property purchase to resolve.'
      using errcode = '22023';
  end if;

  pending_position := (state_data ->> 'pendingPropertyPurchasePosition')::integer;

  if pending_position <> property_position then
    raise exception 'That property is not available this turn.'
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
    raise exception 'Only the current player can skip this purchase.'
      using errcode = '42501';
  end if;

  if current_player ->> 'position' <> property_position::text then
    raise exception 'The current player is not on this property.'
      using errcode = '22023';
  end if;

  current_player_name := current_player ->> 'name';
  destination_name := public.online_board_space_name(property_position);

  state_data := jsonb_set(
    state_data,
    '{pendingPropertyPurchasePosition}',
    'null'::jsonb,
    true
  );
  state_data := jsonb_set(
    state_data,
    '{message}',
    to_jsonb(current_player_name || ' skipped buying ' || destination_name || '.'),
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

  if state_data -> 'pendingPropertyPurchasePosition' is not null
    and state_data -> 'pendingPropertyPurchasePosition' <> 'null'::jsonb then
    raise exception 'Buy or skip the property before ending the turn.'
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
    '{pendingPropertyPurchasePosition}',
    'null'::jsonb,
    true
  );
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

revoke all on function public.online_property_price(integer) from public;
revoke all on function public.online_property_rent(integer) from public;
revoke all on function public.start_online_game(uuid) from public;
revoke all on function public.roll_online_turn(uuid, integer, integer, integer) from public;
revoke all on function public.buy_online_property(uuid, integer, integer) from public;
revoke all on function public.skip_online_property_purchase(uuid, integer, integer) from public;
revoke all on function public.end_online_turn(uuid, integer) from public;

grant execute on function public.start_online_game(uuid) to authenticated;
grant execute on function public.roll_online_turn(uuid, integer, integer, integer) to authenticated;
grant execute on function public.buy_online_property(uuid, integer, integer) to authenticated;
grant execute on function public.skip_online_property_purchase(uuid, integer, integer) to authenticated;
grant execute on function public.end_online_turn(uuid, integer) to authenticated;
