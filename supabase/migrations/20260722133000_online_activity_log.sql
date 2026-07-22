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

create or replace function public.online_activity_actor_name(
  state_data jsonb,
  fallback_player_index integer,
  actor_user_id uuid,
  action_type text
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  actor_name text;
begin
  if action_type <> 'timer' and actor_user_id is not null then
    select player_data ->> 'name'
      into actor_name
      from jsonb_array_elements(coalesce(state_data -> 'players', '[]'::jsonb))
        as player_entry(player_data)
      where player_data ->> 'userId' = actor_user_id::text
      limit 1;
  end if;

  if actor_name is null
    and fallback_player_index is not null
    and fallback_player_index >= 0
    and jsonb_typeof(state_data -> 'players') = 'array'
    and fallback_player_index < jsonb_array_length(state_data -> 'players') then
    actor_name := state_data -> 'players' -> fallback_player_index ->> 'name';
  end if;

  return coalesce(nullif(trim(actor_name), ''), 'System');
end;
$$;

create or replace function public.online_trim_activity_log(activity_log jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(log_entry order by entry_order), '[]'::jsonb)
  from (
    select log_entry, entry_order
    from jsonb_array_elements(
      case
        when jsonb_typeof(activity_log) = 'array' then activity_log
        else '[]'::jsonb
      end
    ) with ordinality as activity_entry(log_entry, entry_order)
    order by entry_order
    limit 25
  ) as limited_entries;
$$;

create or replace function public.online_append_activity_log(
  state_data jsonb,
  actor_name text,
  action_message text,
  action_type text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  clean_actor_name text :=
    coalesce(nullif(trim(actor_name), ''), 'System');
  clean_action_message text :=
    left(regexp_replace(trim(coalesce(action_message, '')), '\s+', ' ', 'g'), 240);
  clean_action_type text :=
    coalesce(nullif(trim(action_type), ''), 'turn');
  existing_log jsonb;
  next_log jsonb;
  next_entry jsonb;
begin
  existing_log := public.online_trim_activity_log(state_data -> 'activityLog');

  if clean_action_message = '' then
    return jsonb_set(state_data, '{activityLog}', existing_log, true);
  end if;

  next_entry := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'createdAt', statement_timestamp(),
    'playerName', clean_actor_name,
    'message', clean_action_message,
    'type', clean_action_type
  );
  next_log := public.online_trim_activity_log(jsonb_build_array(next_entry) || existing_log);

  return jsonb_set(state_data, '{activityLog}', next_log, true);
end;
$$;

create or replace function public.track_online_activity_log()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  action_message text;
  action_type text;
  actor_name text;
  fallback_player_index integer;
  actor_state jsonb;
begin
  if new.state ->> 'phase' is distinct from 'online_game' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    action_message := coalesce(
      nullif(new.state ->> 'message', ''),
      'Online game started.'
    );
    action_type := public.online_activity_type(action_message);
    fallback_player_index := (new.state ->> 'currentPlayerIndex')::integer;
    actor_name := public.online_activity_actor_name(
      new.state,
      fallback_player_index,
      new.updated_by,
      action_type
    );
    new.state := public.online_append_activity_log(
      new.state,
      actor_name,
      action_message,
      action_type
    );

    return new;
  end if;

  if new.state ->> 'message' is distinct from old.state ->> 'message' then
    action_message := coalesce(
      nullif(new.state ->> 'message', ''),
      'Online game updated.'
    );
    action_type := public.online_activity_type(action_message);
    actor_state := case
      when action_type = 'timer' then old.state
      else new.state
    end;
    fallback_player_index := coalesce(
      (old.state ->> 'currentPlayerIndex')::integer,
      (new.state ->> 'currentPlayerIndex')::integer
    );
    actor_name := public.online_activity_actor_name(
      actor_state,
      fallback_player_index,
      new.updated_by,
      action_type
    );
    new.state := public.online_append_activity_log(
      new.state,
      actor_name,
      action_message,
      action_type
    );
  else
    new.state := jsonb_set(
      new.state,
      '{activityLog}',
      public.online_trim_activity_log(
        coalesce(new.state -> 'activityLog', old.state -> 'activityLog')
      ),
      true
    );
  end if;

  return new;
end;
$$;

select set_config(
  'property_empire.allow_expired_turn_update',
  'true',
  true
);

update public.game_states
  set state = public.online_append_activity_log(
    jsonb_set(state, '{activityLog}', '[]'::jsonb, true),
    public.online_activity_actor_name(
      state,
      (state ->> 'currentPlayerIndex')::integer,
      updated_by,
      public.online_activity_type(
        coalesce(nullif(state ->> 'message', ''), 'Online game resumed.')
      )
    ),
    coalesce(nullif(state ->> 'message', ''), 'Online game resumed.'),
    public.online_activity_type(
      coalesce(nullif(state ->> 'message', ''), 'Online game resumed.')
    )
  )
  where state ->> 'phase' = 'online_game'
    and (
      state -> 'activityLog' is null
      or jsonb_typeof(state -> 'activityLog') <> 'array'
    );

drop trigger if exists game_states_track_online_activity on public.game_states;
create trigger game_states_track_online_activity
  before insert or update on public.game_states
  for each row
  execute function public.track_online_activity_log();

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

  update public.game_states
    set state = jsonb_set(
          current_game.state,
          '{message}',
          to_jsonb(restart_message),
          true
        ),
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

revoke all on function public.online_activity_type(text) from public;
revoke all on function public.online_activity_actor_name(jsonb, integer, uuid, text) from public;
revoke all on function public.online_trim_activity_log(jsonb) from public;
revoke all on function public.online_append_activity_log(jsonb, text, text, text) from public;
revoke all on function public.track_online_activity_log() from public;
revoke all on function public.restart_online_room(uuid, integer) from public;

grant execute on function public.restart_online_room(uuid, integer) to authenticated;
