grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.rooms to authenticated;
grant select, insert, update, delete on table public.room_players to authenticated;
grant select, insert, update on table public.game_states to authenticated;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.is_room_host(uuid) from public;
revoke all on function public.room_has_capacity(uuid) from public;

grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_host(uuid) to authenticated;
grant execute on function public.room_has_capacity(uuid) to authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_room_player_host_flag() from public;
