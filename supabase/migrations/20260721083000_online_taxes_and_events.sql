grant usage on schema public to authenticated;

grant select on table public.game_states to authenticated;
revoke insert, update, delete on table public.game_states from authenticated;

drop policy if exists "Room members can create game state" on public.game_states;
drop policy if exists "Room hosts can create game state" on public.game_states;
drop policy if exists "Room members can update game state" on public.game_states;
drop policy if exists "Room hosts can update game state" on public.game_states;

create or replace function public.online_tax_amount(space_position integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case space_position
    when 2 then 150
    when 14 then 100
    else null
  end;
$$;

create or replace function public.online_event_card(card_index integer)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case card_index
    when 0 then jsonb_build_object(
      'title', 'Rooftop Solar Rebate',
      'description', 'A rooftop efficiency program sends a rebate straight to your city account.',
      'type', 'money',
      'amount', 90
    )
    when 1 then jsonb_build_object(
      'title', 'After-Hours Permit',
      'description', 'Your renovation crew missed a late-night work permit deadline.',
      'type', 'money',
      'amount', -60
    )
    when 2 then jsonb_build_object(
      'title', 'Express Scooter Lane',
      'description', 'A protected scooter lane opens early and gets you across town fast.',
      'type', 'move',
      'spaces', 3
    )
    when 3 then jsonb_build_object(
      'title', 'Bridge Detour',
      'description', 'Bridge maintenance reroutes traffic through side streets.',
      'type', 'move',
      'spaces', -2
    )
    when 4 then jsonb_build_object(
      'title', 'Pop-Up Sales Surge',
      'description', 'A weekend vendor fair drives surprise revenue to your holdings.',
      'type', 'money',
      'amount', 120
    )
    when 5 then jsonb_build_object(
      'title', 'Smart Meter Audit',
      'description', 'Smart-meter auditors find an old utility charge nobody budgeted for.',
      'type', 'money',
      'amount', -80
    )
    when 6 then jsonb_build_object(
      'title', 'Citywide App Launch',
      'description', 'Your startup demo goes viral and pulls you toward the entertainment district.',
      'type', 'moveTo',
      'destinationPosition', 16
    )
    when 7 then jsonb_build_object(
      'title', 'Harbor Shortcut',
      'description', 'A ferry captain shows you a faster route through the harbor grid.',
      'type', 'moveTo',
      'destinationPosition', 9
    )
    when 8 then jsonb_build_object(
      'title', 'Green Corridor Grant',
      'description', 'A green corridor grant points your crew toward new residential blocks.',
      'type', 'moveTo',
      'destinationPosition', 13
    )
    when 9 then jsonb_build_object(
      'title', 'Late Night Cleanup',
      'description', 'A sponsored night market closes with cleanup costs on your ledger.',
      'type', 'money',
      'amount', -45
    )
    when 10 then jsonb_build_object(
      'title', 'Community Festival',
      'description', 'Neighborhood organizers share festival proceeds with nearby investors.',
      'type', 'money',
      'amount', 75
    )
    when 11 then jsonb_build_object(
      'title', 'Transit Mix-Up',
      'description', 'A station announcement sends your group to the wrong platform.',
      'type', 'move',
      'spaces', -4
    )
    when 12 then jsonb_build_object(
      'title', 'Civic Hold Notice',
      'description', 'A surprise compliance hearing pulls you away from the table.',
      'type', 'detention'
    )
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
          'isDetained', false,
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
    'isDetentionTurn', false,
    'lastRoll', null,
    'lastEventCard', null,
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
  tax_amount integer;
  owner_player_index integer := -1;
  scan_player_index integer;
  owner_player jsonb;
  owner_player_name text;
  owner_balance integer;
  event_card jsonb;
  event_type text;
  event_title text;
  event_description text;
  event_result text;
  event_amount integer;
  event_spaces integer;
  event_spaces_absolute integer;
  event_destination_position integer;
  event_destination_name text;
  event_bonus_amount integer;
  event_direction text;
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

  if coalesce((state_data ->> 'isDetentionTurn')::boolean, false) then
    raise exception 'Leave detention before rolling.'
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

  if coalesce((current_player ->> 'isDetained')::boolean, false) then
    raise exception 'This player must miss their detention turn before rolling.'
      using errcode = '22023';
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
  tax_amount := public.online_tax_amount(new_position);
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
  state_data := jsonb_set(state_data, '{lastEventCard}', 'null'::jsonb, true);

  if tax_amount is not null then
    new_balance := new_balance - tax_amount;
    state_data := jsonb_set(
      state_data,
      '{pendingPropertyPurchasePosition}',
      'null'::jsonb,
      true
    );
    turn_message := turn_message || ' Paid $' || tax_amount || ' '
      || destination_name || '.';

    if new_balance < 0 then
      turn_message := turn_message || ' Warning: ' || current_player_name
        || '''s balance is now below $0.';
    end if;
  elsif new_position in (5, 10, 17, 22) then
    event_card := public.online_event_card(floor(random() * 13)::integer);

    if event_card is null then
      raise exception 'Event card could not be drawn.' using errcode = '22023';
    end if;

    event_type := event_card ->> 'type';
    event_title := event_card ->> 'title';
    event_description := event_card ->> 'description';
    event_destination_position := new_position;
    event_bonus_amount := 0;

    if event_type = 'money' then
      event_amount := (event_card ->> 'amount')::integer;
      new_balance := new_balance + event_amount;
      event_result := case
        when event_amount >= 0 then
          current_player_name || ' received $' || event_amount || '.'
        else
          current_player_name || ' paid $' || abs(event_amount) || '.'
      end;
    elsif event_type = 'move' then
      event_spaces := (event_card ->> 'spaces')::integer;
      event_spaces_absolute := abs(event_spaces);
      event_direction := case when event_spaces >= 0 then 'forward' else 'backward' end;
      event_destination_position :=
        ((new_position + event_spaces) % 24 + 24) % 24;

      if event_spaces >= 0 then
        event_bonus_amount := case
          when new_position + event_spaces >= 24 then 200
          else 0
        end;
      else
        event_bonus_amount := case
          when new_position > 0 and event_spaces_absolute >= new_position then 200
          else 0
        end;
      end if;

      new_balance := new_balance + event_bonus_amount;
      event_destination_name :=
        public.online_board_space_name(event_destination_position);
      event_result := current_player_name || ' moved ' || event_direction || ' '
        || event_spaces_absolute || ' spaces to ' || event_destination_name || '.';
    elsif event_type = 'moveTo' then
      event_destination_position :=
        (event_card ->> 'destinationPosition')::integer;
      event_bonus_amount := case
        when new_position <> event_destination_position
          and (event_destination_position = 0
            or event_destination_position < new_position) then 200
        else 0
      end;
      new_balance := new_balance + event_bonus_amount;
      event_destination_name :=
        public.online_board_space_name(event_destination_position);
      event_result := current_player_name || ' moved directly to '
        || event_destination_name || '.';
    elsif event_type = 'detention' then
      if bonus_amount > 0 then
        new_balance := new_balance - bonus_amount;
        turn_message := current_player_name || ' rolled ' || die_one || ' + '
          || die_two || ' = ' || roll_total || ' and moved to '
          || destination_name || '.';
      end if;

      event_destination_position := 12;
      event_destination_name :=
        public.online_board_space_name(event_destination_position);
      event_result := current_player_name || ' was sent directly to '
        || event_destination_name || ' and will miss their next turn.';
      state_data := jsonb_set(
        state_data,
        array['players', current_player_index::text, 'isDetained'],
        'true'::jsonb,
        true
      );
    else
      raise exception 'Event card type is invalid.' using errcode = '22023';
    end if;

    if event_bonus_amount > 0 then
      event_result := event_result || ' ' || current_player_name
        || ' collected a $200 City Launch Bonus.';
    end if;

    if new_balance < 0 then
      event_result := event_result || ' Warning: ' || current_player_name
        || '''s balance is now below $0.';
    end if;

    new_position := event_destination_position;
    state_data := jsonb_set(
      state_data,
      '{pendingPropertyPurchasePosition}',
      'null'::jsonb,
      true
    );
    state_data := jsonb_set(
      state_data,
      '{lastEventCard}',
      jsonb_build_object(
        'title', event_title,
        'description', event_description,
        'result', event_result
      ),
      true
    );
    turn_message := turn_message || ' Event: ' || event_title || '. '
      || event_result;
  elsif property_price is not null then
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

      if new_balance < 0 then
        turn_message := turn_message || ' Warning: ' || current_player_name
          || '''s balance is now below $0.';
      end if;
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
  next_player_is_detained boolean;
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
  next_player_is_detained :=
    coalesce((players_data -> next_player_index ->> 'isDetained')::boolean, false);
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
  state_data := jsonb_set(
    state_data,
    '{isDetentionTurn}',
    to_jsonb(next_player_is_detained),
    true
  );
  state_data := jsonb_set(state_data, '{lastRoll}', 'null'::jsonb, false);
  state_data := jsonb_set(state_data, '{lastEventCard}', 'null'::jsonb, true);
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
      case
        when next_player_is_detained then
          next_player_name || ' is detained at Civic Detention and must miss this turn.'
        else
          next_player_name || '''s turn.'
      end
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

create or replace function public.leave_online_detention(
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
  current_player_name text;
  next_player_index integer;
  next_player_is_detained boolean;
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

  if not coalesce((state_data ->> 'isDetentionTurn')::boolean, false) then
    raise exception 'No detention turn is waiting to be resolved.'
      using errcode = '22023';
  end if;

  if coalesce((state_data ->> 'hasRolledThisTurn')::boolean, false) then
    raise exception 'A rolled turn cannot be resolved as detention.'
      using errcode = '22023';
  end if;

  if state_data -> 'pendingPropertyPurchasePosition' is not null
    and state_data -> 'pendingPropertyPurchasePosition' <> 'null'::jsonb then
    raise exception 'Resolve the property purchase before leaving detention.'
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
  current_player_name := current_player ->> 'name';

  if current_player_user_id <> current_user_id then
    raise exception 'Only the detained current player can leave detention.'
      using errcode = '42501';
  end if;

  if not coalesce((current_player ->> 'isDetained')::boolean, false) then
    raise exception 'The current player is not detained.'
      using errcode = '22023';
  end if;

  state_data := jsonb_set(
    state_data,
    array['players', current_player_index::text, 'isDetained'],
    'false'::jsonb,
    true
  );
  players_data := state_data -> 'players';
  next_player_index := (current_player_index + 1) % jsonb_array_length(players_data);
  next_player_is_detained :=
    coalesce((players_data -> next_player_index ->> 'isDetained')::boolean, false);
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
  state_data := jsonb_set(
    state_data,
    '{isDetentionTurn}',
    to_jsonb(next_player_is_detained),
    true
  );
  state_data := jsonb_set(state_data, '{lastRoll}', 'null'::jsonb, false);
  state_data := jsonb_set(state_data, '{lastEventCard}', 'null'::jsonb, true);
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
      case
        when next_player_is_detained then
          current_player_name || ' left Civic Detention after missing one turn. '
          || next_player_name || ' is detained at Civic Detention and must miss this turn.'
        else
          current_player_name || ' left Civic Detention after missing one turn. '
          || next_player_name || '''s turn.'
      end
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

revoke all on function public.online_tax_amount(integer) from public;
revoke all on function public.online_event_card(integer) from public;
revoke all on function public.start_online_game(uuid) from public;
revoke all on function public.roll_online_turn(uuid, integer, integer, integer) from public;
revoke all on function public.end_online_turn(uuid, integer) from public;
revoke all on function public.leave_online_detention(uuid, integer) from public;

grant execute on function public.start_online_game(uuid) to authenticated;
grant execute on function public.roll_online_turn(uuid, integer, integer, integer) to authenticated;
grant execute on function public.end_online_turn(uuid, integer) to authenticated;
grant execute on function public.leave_online_detention(uuid, integer) to authenticated;
