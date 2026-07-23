grant usage on schema public to authenticated;

grant select on table public.game_states to authenticated;
revoke insert, update, delete on table public.game_states from authenticated;

create or replace function public.online_property_group_id(space_position integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case space_position
    when 1 then 'growth-lab'
    when 3 then 'growth-lab'
    when 6 then 'urban-makers'
    when 7 then 'urban-makers'
    when 8 then 'urban-makers'
    when 11 then 'civic-lights'
    when 13 then 'civic-lights'
    when 16 then 'civic-lights'
    when 19 then 'waterfront-exchange'
    when 20 then 'waterfront-exchange'
    when 23 then 'waterfront-exchange'
    else null
  end;
$$;

create or replace function public.online_property_group_name(group_id text)
returns text
language sql
immutable
set search_path = public
as $$
  select case group_id
    when 'growth-lab' then 'Growth Lab'
    when 'urban-makers' then 'Urban Makers'
    when 'civic-lights' then 'Civic Lights'
    when 'waterfront-exchange' then 'Waterfront Exchange'
    else null
  end;
$$;

create or replace function public.online_property_group_positions(group_id text)
returns integer[]
language sql
immutable
set search_path = public
as $$
  select case group_id
    when 'growth-lab' then array[1, 3]
    when 'urban-makers' then array[6, 7, 8]
    when 'civic-lights' then array[11, 13, 16]
    when 'waterfront-exchange' then array[19, 20, 23]
    else null
  end;
$$;

create or replace function public.online_property_group_build_cost(group_id text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case group_id
    when 'growth-lab' then 50
    when 'urban-makers' then 75
    when 'civic-lights' then 100
    when 'waterfront-exchange' then 125
    else null
  end;
$$;

create or replace function public.online_property_group_sale_value(group_id text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select public.online_property_group_build_cost(group_id)::numeric / 2;
$$;

create or replace function public.online_property_development_level(
  property_developments jsonb,
  space_position integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(property_developments, '{}'::jsonb) ->> space_position::text
      ~ '^[0-5]$' then
      (coalesce(property_developments, '{}'::jsonb) ->> space_position::text)::integer
    else 0
  end;
$$;

create or replace function public.online_property_development_label(
  development_level integer
)
returns text
language sql
immutable
set search_path = public
as $$
  select case development_level
    when 0 then 'No buildings'
    when 1 then '1 house'
    when 2 then '2 houses'
    when 3 then '3 houses'
    when 4 then '4 houses'
    when 5 then 'Hotel'
    else 'No buildings'
  end;
$$;

create or replace function public.online_property_development_rent(
  space_position integer,
  development_level integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case space_position
    when 1 then (array[12, 50, 150, 330, 450, 600])[least(greatest(development_level, 0), 5) + 1]
    when 3 then (array[14, 60, 170, 360, 500, 650])[least(greatest(development_level, 0), 5) + 1]
    when 6 then (array[18, 80, 220, 480, 650, 850])[least(greatest(development_level, 0), 5) + 1]
    when 7 then (array[20, 90, 250, 520, 700, 900])[least(greatest(development_level, 0), 5) + 1]
    when 8 then (array[22, 100, 280, 560, 760, 980])[least(greatest(development_level, 0), 5) + 1]
    when 11 then (array[26, 120, 340, 700, 980, 1250])[least(greatest(development_level, 0), 5) + 1]
    when 13 then (array[24, 110, 310, 650, 900, 1150])[least(greatest(development_level, 0), 5) + 1]
    when 16 then (array[28, 130, 370, 760, 1060, 1350])[least(greatest(development_level, 0), 5) + 1]
    when 19 then (array[32, 160, 450, 950, 1300, 1650])[least(greatest(development_level, 0), 5) + 1]
    when 20 then (array[36, 180, 520, 1100, 1500, 1900])[least(greatest(development_level, 0), 5) + 1]
    when 23 then (array[30, 150, 420, 880, 1200, 1500])[least(greatest(development_level, 0), 5) + 1]
    else null
  end;
$$;

create or replace function public.online_property_rent(space_position integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select public.online_property_development_rent(space_position, 0);
$$;

create or replace function public.online_release_player_developments(
  property_developments jsonb,
  property_owners jsonb,
  owner_id text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(
      development_entry.space_position,
      to_jsonb(
        public.online_property_development_level(
          property_developments,
          development_entry.space_position::integer
        )
      )
    ),
    '{}'::jsonb
  )
  from jsonb_each(coalesce(property_developments, '{}'::jsonb))
    as development_entry(space_position, development_level)
  where public.online_property_price(development_entry.space_position::integer) is not null
    and public.online_property_development_level(
      property_developments,
      development_entry.space_position::integer
    ) > 0
    and coalesce(property_owners, '{}'::jsonb) ->> development_entry.space_position is not null
    and coalesce(property_owners, '{}'::jsonb) ->> development_entry.space_position <> owner_id;
$$;

create or replace function public.online_activity_type(action_message text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized_message text := lower(coalesce(action_message, ''));
begin
  if normalized_message like '%play again%' then
    return 'play_again';
  elsif normalized_message like '%timer expired%' then
    return 'timer';
  elsif normalized_message like '%wins%' or normalized_message like '%won%' then
    return 'winner';
  elsif normalized_message like '%bankrupt%'
    or normalized_message like '%eliminated%' then
    return 'bankruptcy';
  elsif normalized_message like '%detention%'
    or normalized_message like '%detained%' then
    return 'detention';
  elsif normalized_message like '%event:%' then
    return 'event';
  elsif normalized_message like '% built %'
    or normalized_message like '% sold %' then
    return 'development';
  elsif normalized_message like '%purchased%' then
    return 'purchase';
  elsif normalized_message like '%skipped%' then
    return 'skip';
  elsif normalized_message like '% rent%' then
    return 'rent';
  elsif normalized_message like '%tax%'
    or normalized_message like '%levy%' then
    return 'tax';
  elsif normalized_message like '%rolled%' then
    return 'roll';
  else
    return 'turn';
  end if;
end;
$$;

select set_config(
  'property_empire.allow_expired_turn_update',
  'true',
  true
);

update public.game_states
  set state = jsonb_set(
    state,
    '{propertyDevelopments}',
    case
      when jsonb_typeof(state -> 'propertyDevelopments') = 'object' then
        state -> 'propertyDevelopments'
      else '{}'::jsonb
    end,
    true
  )
  where state ->> 'phase' = 'online_game'
    and (
      state -> 'propertyDevelopments' is null
      or jsonb_typeof(state -> 'propertyDevelopments') <> 'object'
    );

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
          'isEliminated', false,
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
    'propertyDevelopments', '{}'::jsonb,
    'activityLog', '[]'::jsonb,
    'pendingPropertyPurchasePosition', null,
    'winnerPlayerId', null,
    'turnDeadlineAt', null,
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
  old_balance numeric;
  new_balance numeric;
  bonus_amount integer;
  roll_total integer;
  passed_grand_plaza boolean;
  destination_name text;
  turn_message text;
  property_owners jsonb;
  property_developments jsonb;
  released_property_owners jsonb;
  released_property_developments jsonb;
  space_owner_id text;
  property_price integer;
  transit_price integer;
  property_development_level integer;
  property_development_label text;
  rent_amount integer;
  owner_player_index integer := -1;
  scan_player_index integer;
  owner_player jsonb;
  owner_player_name text;
  owner_balance numeric;
  owner_transit_count integer;
  tax_amount integer;
  event_card jsonb;
  event_type text;
  event_title text;
  event_description text;
  event_result text;
  event_amount integer;
  event_cost integer;
  event_spaces integer;
  event_spaces_absolute integer;
  event_destination_position integer;
  event_destination_name text;
  event_bonus_amount integer;
  event_direction text;
  is_bankrupt boolean := false;
  winner_player_id text;
  winner_player_index integer;
  winner_player jsonb;
  winner_player_name text;
  next_player_index integer;
  next_player jsonb;
  next_player_name text;
  next_player_is_detained boolean;
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

  if state_data ->> 'winnerPlayerId' is not null then
    raise exception 'This online game already has a winner.'
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
    raise exception 'Resolve the pending purchase before rolling again.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  property_owners := coalesce(state_data -> 'propertyOwners', '{}'::jsonb);
  property_developments :=
    coalesce(state_data -> 'propertyDevelopments', '{}'::jsonb);
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if public.online_active_player_count(players_data) < 2 then
    raise exception 'This online game does not have enough active players.'
      using errcode = '22023';
  end if;

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

  if coalesce((current_player ->> 'isEliminated')::boolean, false) then
    raise exception 'Bankrupt players cannot roll.'
      using errcode = '22023';
  end if;

  if coalesce((current_player ->> 'isDetained')::boolean, false) then
    raise exception 'This player must miss their detention turn before rolling.'
      using errcode = '22023';
  end if;

  roll_total := die_one + die_two;
  old_position := (current_player ->> 'position')::integer;
  old_balance := (current_player ->> 'balance')::numeric;
  new_position := (old_position + roll_total) % 24;
  passed_grand_plaza := old_position + roll_total >= 24;
  bonus_amount := case when passed_grand_plaza then 200 else 0 end;
  new_balance := old_balance + bonus_amount;
  destination_name := public.online_board_space_name(new_position);
  current_player_name := current_player ->> 'name';
  property_price := public.online_property_price(new_position);
  transit_price := public.online_transit_price(new_position);
  property_development_level :=
    public.online_property_development_level(property_developments, new_position);
  property_development_label :=
    public.online_property_development_label(property_development_level);
  rent_amount :=
    public.online_property_development_rent(
      new_position,
      property_development_level
    );
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
  state_data := jsonb_set(
    state_data,
    '{propertyDevelopments}',
    property_developments,
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

    if new_balance < 0 then
      is_bankrupt := true;
      turn_message := turn_message || ' ' || current_player_name
        || ' could not pay $' || tax_amount || ' ' || destination_name || '.';
    else
      turn_message := turn_message || ' Paid $' || tax_amount || ' '
        || destination_name || '.';
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

      if event_amount < 0 then
        event_cost := abs(event_amount);
        new_balance := new_balance + event_amount;

        if new_balance < 0 then
          is_bankrupt := true;
          event_result := current_player_name || ' could not cover the $'
            || event_cost || ' event cost.';
        else
          event_result := current_player_name || ' paid $' || event_cost || '.';
        end if;
      else
        new_balance := new_balance + event_amount;
        event_result := current_player_name || ' received $'
          || event_amount || '.';
      end if;
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

    if new_balance < 0 and not is_bankrupt then
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
  elsif new_position = 12 then
    state_data := jsonb_set(
      state_data,
      array['players', current_player_index::text, 'isDetained'],
      'true'::jsonb,
      true
    );
    state_data := jsonb_set(
      state_data,
      '{pendingPropertyPurchasePosition}',
      'null'::jsonb,
      true
    );
    turn_message := turn_message || ' ' || current_player_name
      || ' entered Civic Detention and must miss their next turn.';
  elsif new_position = 18 then
    state_data := jsonb_set(
      state_data,
      '{pendingPropertyPurchasePosition}',
      'null'::jsonb,
      true
    );
    turn_message := turn_message || ' ' || current_player_name
      || ' is taking a break at Rooftop Rest. No payment or penalty.';
  elsif property_price is not null or transit_price is not null then
    space_owner_id := property_owners ->> (new_position::text);

    if space_owner_id is null then
      state_data := jsonb_set(
        state_data,
        '{pendingPropertyPurchasePosition}',
        to_jsonb(new_position),
        true
      );

      if transit_price is not null then
        turn_message := turn_message || ' ' || destination_name
          || ' is available for $' || transit_price
          || '. Transit rent starts at $25.';
      else
        turn_message := turn_message || ' ' || destination_name
          || ' is available for $' || property_price
          || ' with $' || rent_amount || ' rent.';
      end if;
    elsif space_owner_id = current_player_id then
      state_data := jsonb_set(
        state_data,
        '{pendingPropertyPurchasePosition}',
        'null'::jsonb,
        true
      );

      if transit_price is not null then
        turn_message := turn_message || ' ' || current_player_name
          || ' already owns ' || destination_name || '.';
      else
        turn_message := turn_message || ' ' || current_player_name
          || ' already owns ' || destination_name || ' with '
          || property_development_label || '.';
      end if;
    else
      owner_player_index := -1;

      for scan_player_index in
        0..jsonb_array_length(players_data) - 1
      loop
        if players_data -> scan_player_index ->> 'id' = space_owner_id then
          owner_player_index := scan_player_index;
          exit;
        end if;
      end loop;

      if owner_player_index < 0 then
        raise exception 'Space owner could not be found.'
          using errcode = '22023';
      end if;

      owner_player := players_data -> owner_player_index;
      owner_player_name := owner_player ->> 'name';

      if coalesce((owner_player ->> 'isEliminated')::boolean, false) then
        raise exception 'This space is owned by a bankrupt player.'
          using errcode = '22023';
      end if;

      if transit_price is not null then
        owner_transit_count :=
          public.online_owned_transit_count(property_owners, space_owner_id);
        rent_amount := public.online_transit_rent(owner_transit_count);
      end if;

      new_balance := new_balance - rent_amount;

      if new_balance < 0 then
        is_bankrupt := true;

        if transit_price is not null then
          turn_message := turn_message || ' ' || current_player_name
            || ' could not pay $' || rent_amount || ' transit rent to '
            || owner_player_name || ' for ' || destination_name || '.';
        else
          turn_message := turn_message || ' ' || current_player_name
            || ' could not pay $' || rent_amount || ' rent to '
            || owner_player_name || ' for ' || destination_name
            || ' with ' || property_development_label || '.';
        end if;
      else
        owner_balance := (owner_player ->> 'balance')::numeric + rent_amount;

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

        if transit_price is not null then
          turn_message := turn_message || ' Paid $' || rent_amount
            || ' transit rent to ' || owner_player_name || ' for '
            || destination_name || ' because ' || owner_player_name
            || ' owns ' || owner_transit_count || ' station'
            || case when owner_transit_count = 1 then '' else 's' end || '.';
        else
          turn_message := turn_message || ' Paid $' || rent_amount
            || ' rent to ' || owner_player_name || ' for '
            || destination_name || ' with ' || property_development_label || '.';
        end if;
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

  if is_bankrupt then
    players_data := state_data -> 'players';
    players_data := jsonb_set(
      players_data,
      array[current_player_index::text, 'position'],
      to_jsonb(new_position),
      false
    );
    players_data := jsonb_set(
      players_data,
      array[current_player_index::text, 'balance'],
      to_jsonb(new_balance),
      false
    );
    players_data := jsonb_set(
      players_data,
      array[current_player_index::text, 'isDetained'],
      'false'::jsonb,
      true
    );
    players_data := jsonb_set(
      players_data,
      array[current_player_index::text, 'isEliminated'],
      'true'::jsonb,
      true
    );

    released_property_owners :=
      public.online_release_player_holdings(property_owners, current_player_id);
    released_property_developments :=
      public.online_release_player_developments(
        property_developments,
        property_owners,
        current_player_id
      );
    winner_player_id := public.online_single_active_player_id(players_data);
    next_player_index :=
      public.online_next_active_player_index(players_data, current_player_index);

    if winner_player_id is not null then
      winner_player_index :=
        public.online_player_index_by_id(players_data, winner_player_id);

      if winner_player_index < 0 then
        raise exception 'Winner could not be found.'
          using errcode = '22023';
      end if;

      next_player_index := winner_player_index;
      winner_player := players_data -> winner_player_index;
      winner_player_name := winner_player ->> 'name';
      next_player_is_detained := false;
      turn_message := turn_message || ' ' || current_player_name
        || ' is bankrupt and eliminated. ' || current_player_name
        || '''s properties, transit stations, houses, and hotels are now unowned. '
        || winner_player_name || ' wins Property Empire with $'
        || (winner_player ->> 'balance') || '.';
    else
      next_player := players_data -> next_player_index;
      next_player_name := next_player ->> 'name';
      next_player_is_detained :=
        coalesce((next_player ->> 'isDetained')::boolean, false);
      turn_message := turn_message || ' ' || current_player_name
        || ' is bankrupt and eliminated. ' || current_player_name
        || '''s properties, transit stations, houses, and hotels are now unowned. '
        || case
          when next_player_is_detained then
            next_player_name || ' is detained at Civic Detention and must miss this turn.'
          else
            next_player_name || '''s turn.'
        end;
    end if;

    state_data := jsonb_set(state_data, '{players}', players_data, false);
    state_data := jsonb_set(
      state_data,
      '{propertyOwners}',
      released_property_owners,
      true
    );
    state_data := jsonb_set(
      state_data,
      '{propertyDevelopments}',
      released_property_developments,
      true
    );
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
      '{winnerPlayerId}',
      coalesce(to_jsonb(winner_player_id), 'null'::jsonb),
      true
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
        and version = expected_version
      returning * into updated_game;

    if not found then
      raise exception 'Game state changed. Refresh and try again.'
        using errcode = '40001';
    end if;

    return updated_game;
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
    '{winnerPlayerId}',
    'null'::jsonb,
    true
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
      and version = expected_version
    returning * into updated_game;

  if not found then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

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
  old_balance numeric;
  new_balance numeric;
  property_owners jsonb;
  property_price integer;
  transit_price integer;
  purchase_price integer;
  rent_amount integer;
  destination_name text;
  pending_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if property_position is null then
    raise exception 'Only property and transit spaces can be purchased.'
      using errcode = '22023';
  end if;

  property_price := public.online_property_price(property_position);
  transit_price := public.online_transit_price(property_position);
  purchase_price := coalesce(property_price, transit_price);

  if purchase_price is null then
    raise exception 'Only property and transit spaces can be purchased.'
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
    raise exception 'Roll before buying this space.'
      using errcode = '22023';
  end if;

  if state_data ->> 'pendingPropertyPurchasePosition' is null then
    raise exception 'There is no purchase to resolve.'
      using errcode = '22023';
  end if;

  pending_position := (state_data ->> 'pendingPropertyPurchasePosition')::integer;

  if pending_position <> property_position then
    raise exception 'That space is not available this turn.'
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
    raise exception 'Only the current player can buy this space.'
      using errcode = '42501';
  end if;

  if current_player ->> 'position' <> property_position::text then
    raise exception 'The current player is not on this space.'
      using errcode = '22023';
  end if;

  if property_owners ? (property_position::text) then
    raise exception 'This space has already been purchased.'
      using errcode = '22023';
  end if;

  rent_amount := public.online_property_rent(property_position);
  destination_name := public.online_board_space_name(property_position);
  current_player_name := current_player ->> 'name';
  old_balance := (current_player ->> 'balance')::numeric;

  if old_balance < purchase_price then
    raise exception 'The current player cannot afford this space.'
      using errcode = '22023';
  end if;

  new_balance := old_balance - purchase_price;

  state_data := jsonb_set(
    state_data,
    '{propertyOwners}',
    property_owners,
    true
  );
  state_data := jsonb_set(
    state_data,
    '{propertyDevelopments}',
    coalesce(state_data -> 'propertyDevelopments', '{}'::jsonb),
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

  if transit_price is not null then
    state_data := jsonb_set(
      state_data,
      '{message}',
      to_jsonb(
        current_player_name || ' bought ' || destination_name || ' for $'
        || transit_price || '. Transit rent starts at $25.'
      ),
      false
    );
  else
    state_data := jsonb_set(
      state_data,
      '{message}',
      to_jsonb(
        current_player_name || ' bought ' || destination_name || ' for $'
        || property_price || '. Rent is $' || rent_amount || '.'
      ),
      false
    );
  end if;

  update public.game_states
    set state = state_data,
        version = current_game.version + 1,
        updated_by = current_user_id
    where room_id = target_room_id
      and version = expected_version
    returning * into updated_game;

  if not found then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  return updated_game;
end;
$$;

create or replace function public.build_online_property_development(
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
  property_owners jsonb;
  property_developments jsonb;
  group_id text;
  group_name text;
  group_positions integer[];
  group_position integer;
  group_level integer;
  lowest_group_level integer := 5;
  build_cost integer;
  current_level integer;
  next_level integer;
  old_balance numeric;
  new_balance numeric;
  new_rent integer;
  development_name text;
  deadline_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if public.online_property_price(property_position) is null then
    raise exception 'Only property spaces can be developed.'
      using errcode = '22023';
  end if;

  group_id := public.online_property_group_id(property_position);
  group_name := public.online_property_group_name(group_id);
  group_positions := public.online_property_group_positions(group_id);
  build_cost := public.online_property_group_build_cost(group_id);

  if group_id is null or group_positions is null or build_cost is null then
    raise exception 'This property does not belong to a development group.'
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

  if state_data ->> 'winnerPlayerId' is not null then
    raise exception 'This online game already has a winner.'
      using errcode = '22023';
  end if;

  if state_data ->> 'turnDeadlineAt' is null then
    raise exception 'The turn timer is paused.'
      using errcode = '22023';
  end if;

  deadline_at := (state_data ->> 'turnDeadlineAt')::timestamptz;

  if deadline_at <= statement_timestamp() then
    raise exception 'Turn timer expired. Refreshing the turn.'
      using errcode = '40001';
  end if;

  if coalesce((state_data ->> 'isDetentionTurn')::boolean, false) then
    raise exception 'Leave detention before developing properties.'
      using errcode = '22023';
  end if;

  if state_data -> 'pendingPropertyPurchasePosition' is not null
    and state_data -> 'pendingPropertyPurchasePosition' <> 'null'::jsonb then
    raise exception 'Resolve the pending purchase before developing properties.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if current_player_index < 0
    or current_player_index >= jsonb_array_length(players_data) then
    raise exception 'Current turn is invalid.' using errcode = '22023';
  end if;

  current_player := players_data -> current_player_index;
  current_player_id := current_player ->> 'id';
  current_player_user_id := (current_player ->> 'userId')::uuid;
  current_player_name := current_player ->> 'name';

  if current_player_user_id <> current_user_id then
    raise exception 'Only the current player can build developments.'
      using errcode = '42501';
  end if;

  if coalesce((current_player ->> 'isEliminated')::boolean, false) then
    raise exception 'Bankrupt players cannot build developments.'
      using errcode = '22023';
  end if;

  if coalesce((current_player ->> 'isDetained')::boolean, false) then
    raise exception 'Leave detention before developing properties.'
      using errcode = '22023';
  end if;

  property_owners := coalesce(state_data -> 'propertyOwners', '{}'::jsonb);
  property_developments :=
    coalesce(state_data -> 'propertyDevelopments', '{}'::jsonb);

  if property_owners ->> property_position::text <> current_player_id then
    raise exception 'Only the owner can develop this property.'
      using errcode = '42501';
  end if;

  foreach group_position in array group_positions loop
    if property_owners ->> group_position::text <> current_player_id then
      raise exception 'Own every % property before building.', group_name
        using errcode = '22023';
    end if;
  end loop;

  current_level :=
    public.online_property_development_level(
      property_developments,
      property_position
    );

  if current_level >= 5 then
    raise exception 'This property already has a hotel.'
      using errcode = '22023';
  end if;

  old_balance := (current_player ->> 'balance')::numeric;

  if old_balance < build_cost then
    raise exception 'The current player cannot afford this development.'
      using errcode = '22023';
  end if;

  foreach group_position in array group_positions loop
    group_level :=
      public.online_property_development_level(
        property_developments,
        group_position
      );
    lowest_group_level := least(lowest_group_level, group_level);
  end loop;

  if current_level < 4 then
    if current_level <> lowest_group_level then
      raise exception 'Build evenly across the color group first.'
        using errcode = '22023';
    end if;

    next_level := current_level + 1;
  else
    foreach group_position in array group_positions loop
      if public.online_property_development_level(
        property_developments,
        group_position
      ) < 4 then
        raise exception 'Every property in the group needs 4 houses before a hotel.'
          using errcode = '22023';
      end if;
    end loop;

    next_level := 5;
  end if;

  new_balance := old_balance - build_cost;
  new_rent :=
    public.online_property_development_rent(property_position, next_level);
  development_name := case when next_level = 5 then 'a hotel' else 'a house' end;
  property_developments := jsonb_set(
    property_developments,
    array[property_position::text],
    to_jsonb(next_level),
    true
  );

  state_data := jsonb_set(
    state_data,
    '{propertyDevelopments}',
    property_developments,
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
    '{message}',
    to_jsonb(
      current_player_name || ' built ' || development_name || ' on '
      || public.online_board_space_name(property_position) || ' for $'
      || build_cost || '. Rent is now $' || new_rent || '.'
    ),
    false
  );

  update public.game_states
    set state = state_data,
        version = current_game.version + 1,
        updated_by = current_user_id
    where room_id = target_room_id
      and version = expected_version
    returning * into updated_game;

  if not found then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  return updated_game;
end;
$$;

create or replace function public.sell_online_property_development(
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
  property_owners jsonb;
  property_developments jsonb;
  group_id text;
  group_positions integer[];
  group_position integer;
  group_level integer;
  highest_group_level integer := 0;
  current_level integer;
  next_level integer;
  sale_value numeric;
  old_balance numeric;
  new_balance numeric;
  new_rent integer;
  development_name text;
  deadline_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if public.online_property_price(property_position) is null then
    raise exception 'Only property developments can be sold.'
      using errcode = '22023';
  end if;

  group_id := public.online_property_group_id(property_position);
  group_positions := public.online_property_group_positions(group_id);
  sale_value := public.online_property_group_sale_value(group_id);

  if group_id is null or group_positions is null or sale_value is null then
    raise exception 'This property does not belong to a development group.'
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

  if state_data ->> 'winnerPlayerId' is not null then
    raise exception 'This online game already has a winner.'
      using errcode = '22023';
  end if;

  if state_data ->> 'turnDeadlineAt' is null then
    raise exception 'The turn timer is paused.'
      using errcode = '22023';
  end if;

  deadline_at := (state_data ->> 'turnDeadlineAt')::timestamptz;

  if deadline_at <= statement_timestamp() then
    raise exception 'Turn timer expired. Refreshing the turn.'
      using errcode = '40001';
  end if;

  if coalesce((state_data ->> 'isDetentionTurn')::boolean, false) then
    raise exception 'Leave detention before selling developments.'
      using errcode = '22023';
  end if;

  if state_data -> 'pendingPropertyPurchasePosition' is not null
    and state_data -> 'pendingPropertyPurchasePosition' <> 'null'::jsonb then
    raise exception 'Resolve the pending purchase before selling developments.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';
  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;

  if current_player_index < 0
    or current_player_index >= jsonb_array_length(players_data) then
    raise exception 'Current turn is invalid.' using errcode = '22023';
  end if;

  current_player := players_data -> current_player_index;
  current_player_id := current_player ->> 'id';
  current_player_user_id := (current_player ->> 'userId')::uuid;
  current_player_name := current_player ->> 'name';

  if current_player_user_id <> current_user_id then
    raise exception 'Only the current player can sell developments.'
      using errcode = '42501';
  end if;

  if coalesce((current_player ->> 'isEliminated')::boolean, false) then
    raise exception 'Bankrupt players cannot sell developments.'
      using errcode = '22023';
  end if;

  if coalesce((current_player ->> 'isDetained')::boolean, false) then
    raise exception 'Leave detention before selling developments.'
      using errcode = '22023';
  end if;

  property_owners := coalesce(state_data -> 'propertyOwners', '{}'::jsonb);
  property_developments :=
    coalesce(state_data -> 'propertyDevelopments', '{}'::jsonb);

  if property_owners ->> property_position::text <> current_player_id then
    raise exception 'Only the owner can sell this development.'
      using errcode = '42501';
  end if;

  current_level :=
    public.online_property_development_level(
      property_developments,
      property_position
    );

  if current_level = 0 then
    raise exception 'This property has no buildings to sell.'
      using errcode = '22023';
  end if;

  foreach group_position in array group_positions loop
    group_level :=
      public.online_property_development_level(
        property_developments,
        group_position
      );
    highest_group_level := greatest(highest_group_level, group_level);
  end loop;

  if current_level <> highest_group_level then
    raise exception 'Sell from the most-developed properties first.'
      using errcode = '22023';
  end if;

  next_level := case when current_level = 5 then 4 else current_level - 1 end;
  old_balance := (current_player ->> 'balance')::numeric;
  new_balance := old_balance + sale_value;
  new_rent :=
    public.online_property_development_rent(property_position, next_level);
  development_name := case when current_level = 5 then 'a hotel' else 'a house' end;

  if next_level = 0 then
    property_developments := property_developments - property_position::text;
  else
    property_developments := jsonb_set(
      property_developments,
      array[property_position::text],
      to_jsonb(next_level),
      true
    );
  end if;

  state_data := jsonb_set(
    state_data,
    '{propertyDevelopments}',
    property_developments,
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
    '{message}',
    to_jsonb(
      current_player_name || ' sold ' || development_name || ' from '
      || public.online_board_space_name(property_position) || ' for $'
      || sale_value || '. Rent is now $' || new_rent || '.'
    ),
    false
  );

  update public.game_states
    set state = state_data,
        version = current_game.version + 1,
        updated_by = current_user_id
    where room_id = target_room_id
      and version = expected_version
    returning * into updated_game;

  if not found then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  return updated_game;
end;
$$;

create or replace function public.restart_online_room(
  target_room_id uuid,
  expected_version integer
)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms%rowtype;
  current_game public.game_states%rowtype;
  updated_room public.rooms%rowtype;
  host_name text;
  restart_message text;
  reset_state jsonb;
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
    raise exception 'Only the host can start a new game.'
      using errcode = '42501';
  end if;

  if target_room.status <> 'started' then
    raise exception 'Only finished started rooms can be reset.'
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

  if current_game.state ->> 'winnerPlayerId' is null then
    raise exception 'This online game is not finished yet.'
      using errcode = '22023';
  end if;

  select player_data ->> 'name'
    into host_name
    from jsonb_array_elements(current_game.state -> 'players')
      as player_entry(player_data)
    where player_data ->> 'userId' = current_user_id::text
    limit 1;

  restart_message :=
    coalesce(nullif(trim(host_name), ''), 'The host')
    || ' selected Play Again. The room is returning to the lobby.';
  reset_state := jsonb_set(
    current_game.state,
    '{propertyDevelopments}',
    '{}'::jsonb,
    true
  );
  reset_state := jsonb_set(
    reset_state,
    '{message}',
    to_jsonb(restart_message),
    true
  );

  update public.game_states
    set state = reset_state,
        version = current_game.version + 1,
        updated_by = current_user_id
    where room_id = target_room_id
      and version = expected_version;

  if not found then
    raise exception 'Game state changed. Refresh and try again.'
      using errcode = '40001';
  end if;

  update public.rooms
    set status = 'waiting'
    where id = target_room_id
    returning * into updated_room;

  return updated_room;
end;
$$;

revoke all on function public.online_property_group_id(integer) from public;
revoke all on function public.online_property_group_name(text) from public;
revoke all on function public.online_property_group_positions(text) from public;
revoke all on function public.online_property_group_build_cost(text) from public;
revoke all on function public.online_property_group_sale_value(text) from public;
revoke all on function public.online_property_development_level(jsonb, integer) from public;
revoke all on function public.online_property_development_label(integer) from public;
revoke all on function public.online_property_development_rent(integer, integer) from public;
revoke all on function public.online_property_rent(integer) from public;
revoke all on function public.online_release_player_developments(jsonb, jsonb, text) from public;
revoke all on function public.online_activity_type(text) from public;
revoke all on function public.start_online_game(uuid) from public;
revoke all on function public.roll_online_turn(uuid, integer, integer, integer) from public;
revoke all on function public.buy_online_property(uuid, integer, integer) from public;
revoke all on function public.build_online_property_development(uuid, integer, integer) from public;
revoke all on function public.sell_online_property_development(uuid, integer, integer) from public;
revoke all on function public.restart_online_room(uuid, integer) from public;

grant execute on function public.start_online_game(uuid) to authenticated;
grant execute on function public.roll_online_turn(uuid, integer, integer, integer) to authenticated;
grant execute on function public.buy_online_property(uuid, integer, integer) to authenticated;
grant execute on function public.build_online_property_development(uuid, integer, integer) to authenticated;
grant execute on function public.sell_online_property_development(uuid, integer, integer) to authenticated;
grant execute on function public.restart_online_room(uuid, integer) to authenticated;
