create or replace function public.online_new_turn_deadline_json()
returns jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(statement_timestamp() + interval '60 seconds');
$$;

create or replace function public.enforce_online_turn_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_deadline_at timestamptz;
begin
  if old.state ->> 'phase' is distinct from 'online_game' then
    return new;
  end if;

  if old.state ->> 'winnerPlayerId' is not null then
    return new;
  end if;

  if old.state ->> 'turnDeadlineAt' is null then
    return new;
  end if;

  old_deadline_at := (old.state ->> 'turnDeadlineAt')::timestamptz;

  if old_deadline_at <= statement_timestamp()
    and coalesce(
      current_setting('property_empire.allow_expired_turn_update', true),
      ''
    ) <> 'true' then
    raise exception 'Turn timer expired. Refreshing the turn.'
      using errcode = '40001';
  end if;

  return new;
end;
$$;

create or replace function public.set_online_turn_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_player_index text;
  new_player_index text := new.state ->> 'currentPlayerIndex';
begin
  if new.state ->> 'phase' is distinct from 'online_game' then
    return new;
  end if;

  if new.state ->> 'winnerPlayerId' is not null then
    new.state := jsonb_set(new.state, '{turnDeadlineAt}', 'null'::jsonb, true);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_player_index := old.state ->> 'currentPlayerIndex';
  end if;

  if tg_op = 'INSERT'
    or old_player_index is distinct from new_player_index
    or new.state ->> 'turnDeadlineAt' is null then
    new.state := jsonb_set(
      new.state,
      '{turnDeadlineAt}',
      public.online_new_turn_deadline_json(),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists game_states_enforce_online_turn_deadline on public.game_states;
create trigger game_states_enforce_online_turn_deadline
  before update on public.game_states
  for each row
  execute function public.enforce_online_turn_deadline();

drop trigger if exists game_states_set_online_turn_deadline on public.game_states;
create trigger game_states_set_online_turn_deadline
  before insert or update on public.game_states
  for each row
  execute function public.set_online_turn_deadline();

update public.game_states
  set state = jsonb_set(
    state,
    '{turnDeadlineAt}',
    case
      when state ->> 'winnerPlayerId' is null then
        public.online_new_turn_deadline_json()
      else
        'null'::jsonb
    end,
    true
  )
  where state ->> 'phase' = 'online_game';

create or replace function public.expire_online_turn(
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
  current_player_name text;
  next_player_index integer;
  next_player_name text;
  next_player_is_detained boolean;
  pending_position integer;
  pending_space_name text;
  deadline_at timestamptz;
  has_rolled boolean;
  is_detention_turn boolean;
  next_turn_message text;
  timer_message text;
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

  if not public.is_room_member(target_room_id) then
    raise exception 'Only room members can resolve this timer.'
      using errcode = '42501';
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
    raise exception 'This online game is already finished.'
      using errcode = '22023';
  end if;

  if state_data ->> 'turnDeadlineAt' is null then
    raise exception 'This turn timer is paused.' using errcode = '22023';
  end if;

  deadline_at := (state_data ->> 'turnDeadlineAt')::timestamptz;

  if deadline_at > statement_timestamp() then
    raise exception 'Turn timer has not expired yet.'
      using errcode = '22023';
  end if;

  players_data := state_data -> 'players';

  if public.online_active_player_count(players_data) < 2 then
    raise exception 'This online game does not have enough active players.'
      using errcode = '22023';
  end if;

  current_player_index := (state_data ->> 'currentPlayerIndex')::integer;
  current_player := players_data -> current_player_index;
  current_player_name := current_player ->> 'name';
  has_rolled := coalesce((state_data ->> 'hasRolledThisTurn')::boolean, false);
  is_detention_turn :=
    coalesce((state_data ->> 'isDetentionTurn')::boolean, false);

  if current_player is null then
    raise exception 'Current player not found.' using errcode = '22023';
  end if;

  if coalesce((current_player ->> 'isEliminated')::boolean, false) then
    raise exception 'Eliminated players cannot take turns.'
      using errcode = '22023';
  end if;

  if state_data ->> 'pendingPropertyPurchasePosition' is not null then
    pending_position :=
      (state_data ->> 'pendingPropertyPurchasePosition')::integer;
    pending_space_name := public.online_board_space_name(pending_position);
  end if;

  if is_detention_turn then
    state_data := jsonb_set(
      state_data,
      array['players', current_player_index::text, 'isDetained'],
      'false'::jsonb,
      true
    );
    players_data := state_data -> 'players';
    timer_message :=
      current_player_name || ' missed a turn in Civic Detention when the timer expired.';
  elsif pending_position is not null then
    timer_message :=
      current_player_name || '''s timer expired. '
      || pending_space_name || ' was skipped automatically.';
  elsif has_rolled then
    timer_message :=
      current_player_name || '''s timer expired after the roll.';
  else
    timer_message :=
      current_player_name || '''s timer expired before rolling.';
  end if;

  next_player_index :=
    public.online_next_active_player_index(players_data, current_player_index);
  next_player_is_detained :=
    coalesce((players_data -> next_player_index ->> 'isDetained')::boolean, false);
  next_player_name := players_data -> next_player_index ->> 'name';
  next_turn_message := case
    when next_player_is_detained then
      next_player_name || ' is detained at Civic Detention and must miss this turn.'
    else
      next_player_name || '''s turn.'
  end;

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
    'null'::jsonb,
    true
  );
  state_data := jsonb_set(
    state_data,
    '{message}',
    to_jsonb(timer_message || ' ' || next_turn_message),
    false
  );

  perform set_config(
    'property_empire.allow_expired_turn_update',
    'true',
    true
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

revoke all on function public.online_new_turn_deadline_json() from public;
revoke all on function public.enforce_online_turn_deadline() from public;
revoke all on function public.set_online_turn_deadline() from public;
revoke all on function public.expire_online_turn(uuid, integer) from public;

grant execute on function public.expire_online_turn(uuid, integer) to authenticated;
