"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
  hasSupabaseConfig,
} from "@/lib/supabase/client";
import { getSafeSupabaseErrorMessage } from "@/lib/supabase/error-message";
import {
  MAX_ONLINE_PLAYERS,
  MIN_ONLINE_PLAYERS,
  sanitizeRoomCode,
  sortOnlineRoomPlayers,
  type OnlineRoom,
  type OnlineRoomPlayer,
} from "@/lib/online-room";
import {
  clearOnlineSession,
  getStoredOnlineSession,
  isPermanentOnlineSessionError,
  reconnectOnlineSession,
  saveOnlineSessionFromPlayers,
} from "@/lib/online-session";

function getRoomNotFoundMessage(error: { code?: string } | null) {
  return error?.code === "PGRST116"
    ? "This room no longer exists or is not available."
    : "";
}

export default function OnlineRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = sanitizeRoomCode(params.code ?? "");
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const isConfigured = hasSupabaseConfig();
  const [currentUserId, setCurrentUserId] = useState("");
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [players, setPlayers] = useState<OnlineRoomPlayer[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(isConfigured);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const currentPlayer = players.find((player) => {
    return player.user_id === currentUserId;
  });
  const isHost =
    room !== null &&
    currentUserId.length > 0 &&
    room.host_user_id === currentUserId &&
    currentPlayer?.is_host === true;
  const canStart =
    isHost &&
    room?.status === "waiting" &&
    players.length >= MIN_ONLINE_PLAYERS &&
    players.length <= (room?.max_players ?? MAX_ONLINE_PLAYERS) &&
    !isStarting;

  const loadPlayers = useCallback(
    async (roomId: string) => {
      if (!supabase) {
        return;
      }

      const { data, error } = await supabase
        .from("room_players")
        .select(
          "id, room_id, user_id, display_name, is_host, joined_at, last_seen_at",
        )
        .eq("room_id", roomId);

      if (error) {
        throw error;
      }

      const sortedPlayers = sortOnlineRoomPlayers(
        (data ?? []) as OnlineRoomPlayer[],
      );

      setPlayers(sortedPlayers);

      return sortedPlayers;
    },
    [supabase],
  );

  const loadRoom = useCallback(
    async (code: string) => {
      if (!supabase) {
        return null;
      }

      const { data, error } = await supabase
        .from("rooms")
        .select("id, code, host_user_id, max_players, status, created_at")
        .eq("code", code)
        .single();

      const notFoundMessage = getRoomNotFoundMessage(error);

      if (notFoundMessage) {
        clearOnlineSession(code);
        throw new Error(notFoundMessage);
      }

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("Room not found.");
      }

      const loadedRoom = data as OnlineRoom;

      if (loadedRoom.status === "closed") {
        clearOnlineSession(loadedRoom.code);
        throw new Error("This online room has been closed.");
      }

      setRoom(loadedRoom);

      return loadedRoom;
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase || !isConfigured) {
      return;
    }

    let isActive = true;
    const activeSupabase = supabase;

    async function loadLobby() {
      try {
        setIsLoading(true);
        setIsReconnecting(true);
        setErrorMessage("");

        const user = await ensureAnonymousUser(activeSupabase);
        const storedSession = getStoredOnlineSession(roomCode);

        if (storedSession) {
          if (storedSession.userId !== user.id) {
            clearOnlineSession(roomCode);
            throw new Error(
              "Saved online session belongs to another browser profile. Return to the lobby and join again.",
            );
          }

          const reconnectedSession = await reconnectOnlineSession(
            activeSupabase,
            storedSession,
          );

          if (reconnectedSession.roomStatus === "closed") {
            clearOnlineSession(roomCode);
            throw new Error("This online room has been closed.");
          }
        }

        const loadedRoom = await loadRoom(roomCode);

        if (!loadedRoom || !isActive) {
          return;
        }

        setCurrentUserId(user.id);
        const loadedPlayers = await loadPlayers(loadedRoom.id);

        if (loadedPlayers) {
          saveOnlineSessionFromPlayers(loadedRoom, loadedPlayers, user.id);
        }
      } catch (error) {
        if (isActive) {
          if (isPermanentOnlineSessionError(error)) {
            clearOnlineSession(roomCode);
          }

          setErrorMessage(getSafeSupabaseErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
          setIsReconnecting(false);
        }
      }
    }

    void loadLobby();

    return () => {
      isActive = false;
    };
  }, [isConfigured, loadPlayers, loadRoom, roomCode, supabase]);

  useEffect(() => {
    if (!supabase || !room?.id) {
      return;
    }

    const channel: RealtimeChannel = supabase
      .channel(`property-empire-room-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `room_id=eq.${room.id}`,
          schema: "public",
          table: "room_players",
        },
        () => {
          void loadPlayers(room.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          filter: `id=eq.${room.id}`,
          schema: "public",
          table: "rooms",
        },
        () => {
          void loadRoom(room.code);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPlayers, loadRoom, room, supabase]);

  useEffect(() => {
    if (room?.status === "started") {
      router.replace(`/online/game/${room.code}`);
    }
  }, [room, router]);

  async function startRoom() {
    if (!supabase || !room || !currentUserId || !canStart) {
      return;
    }

    setIsStarting(true);
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("start_online_game", {
        target_room_id: room.id,
      });

      if (error) {
        throw error;
      }

      await loadRoom(room.code);
      router.push(`/online/game/${room.code}`);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  function exitLobby() {
    clearOnlineSession(room?.code ?? roomCode);
    router.push("/");
  }

  function returnToLobby() {
    clearOnlineSession(room?.code ?? roomCode);
    router.push("/online");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f8f4] px-5 py-8 text-[#171915] sm:px-8 sm:py-12">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.05)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.05)_1px,transparent_1px)] bg-[size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="absolute -left-40 top-20 h-[440px] w-[440px] rotate-45 border-[16px] border-[#171915] opacity-[0.04]"
      />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col justify-center py-8">
        <Link
          className="mb-10 inline-flex h-11 w-fit items-center border-2 border-[#171915] bg-[#f7f8f4] px-5 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#43aa8b] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#43aa8b]/45"
          href="/online"
        >
          Back
        </Link>

        <div className="grid items-start gap-10 lg:grid-cols-[0.76fr_1.24fr]">
          <div>
            <p className="mb-5 h-1.5 w-24 bg-[#06d6a0]" aria-hidden="true" />
            <h1 className="text-4xl font-black tracking-normal sm:text-6xl">
              Waiting Lobby
            </h1>
            <p className="mt-5 max-w-md text-lg font-medium leading-8 text-[#445045]">
              Share the room code and wait for the host to start.
            </p>
          </div>

          <div className="border-2 border-[#171915] bg-white/90 p-4 shadow-[10px_10px_0_0_#f9c74f] backdrop-blur sm:p-6">
            {!isConfigured ? (
              <div className="border-2 border-[#171915] bg-[#ffedf2] p-4">
                <h2 className="text-2xl font-black">Supabase Required</h2>
                <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                  Add the public Supabase environment variables and restart the
                  app before using online rooms.
                </p>
              </div>
            ) : isLoading ? (
              <p className="border-2 border-[#171915] bg-[#f7f8f4] p-4 text-sm font-black">
                {isReconnecting ? "Reconnecting..." : "Loading lobby"}
              </p>
            ) : errorMessage ? (
              <div className="border-2 border-[#171915] bg-[#ffedf2] p-4">
                <h2 className="text-2xl font-black">Lobby Unavailable</h2>
                <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                  {errorMessage}
                </p>
                <button
                  className="mt-5 inline-flex h-12 items-center justify-center border-2 border-[#171915] bg-[#171915] px-6 text-sm font-bold text-white shadow-[5px_5px_0_0_#f9c74f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#f9c74f]/45"
                  onClick={returnToLobby}
                  type="button"
                >
                  Return to Lobby
                </button>
              </div>
            ) : room ? (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div>
                    <p className="text-sm font-black uppercase text-[#596057]">
                      Room Code
                    </p>
                    <p className="mt-2 w-fit border-2 border-[#171915] bg-[#171915] px-4 py-2 text-3xl font-black tracking-[0.2em] text-white shadow-[6px_6px_0_0_#06d6a0]">
                      {room.code}
                    </p>
                  </div>
                  <p className="w-fit border-2 border-[#171915] bg-[#e8f7fc] px-4 py-2 text-sm font-black">
                    {players.length} / {room.max_players} Players
                  </p>
                </div>

                <div className="mt-6 space-y-3">
                  {players.map((player, index) => (
                    <div
                      className="grid gap-3 border-2 border-[#171915] bg-[#f7f8f4] p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                      key={player.id}
                    >
                      <span className="flex h-9 w-9 items-center justify-center border-2 border-[#171915] bg-white text-sm font-black">
                        {index + 1}
                      </span>
                      <div>
                        <p className="break-words text-base font-black">
                          {player.display_name}
                        </p>
                        {player.user_id === currentUserId ? (
                          <p className="text-xs font-black uppercase text-[#596057]">
                            You
                          </p>
                        ) : null}
                      </div>
                      {player.is_host ? (
                        <span className="w-fit border-2 border-[#171915] bg-[#f9c74f] px-2 py-1 text-xs font-black uppercase">
                          Host
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  {isHost ? (
                    <button
                      className="h-14 border-2 border-[#171915] bg-[#06d6a0] px-6 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
                      disabled={!canStart}
                      onClick={startRoom}
                      type="button"
                    >
                      {room.status === "started"
                        ? "Room Started"
                        : isStarting
                          ? "Starting..."
                          : "Start Online Game"}
                    </button>
                  ) : (
                    <button
                      className="h-14 cursor-not-allowed border-2 border-[#171915] bg-[#c6cbbf] px-6 text-base font-bold text-[#596057] opacity-70"
                      disabled
                      type="button"
                    >
                      Waiting for Host
                    </button>
                  )}

                  <button
                    className="h-14 border-2 border-[#171915] bg-[#ef476f] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
                    onClick={exitLobby}
                    type="button"
                  >
                    Exit Lobby
                  </button>
                </div>

                {room.status === "started" ? (
                  <p className="mt-5 border-2 border-[#171915] bg-[#e7fbf4] p-3 text-sm font-bold leading-6 text-[#445045]">
                    The online lobby is ready. Synchronized online gameplay
                    will be added in the next phase.
                  </p>
                ) : players.length < MIN_ONLINE_PLAYERS ? (
                  <p className="mt-5 border-2 border-[#171915] bg-[#fff1de] p-3 text-sm font-bold leading-6 text-[#445045]">
                    At least {MIN_ONLINE_PLAYERS} players are needed before the
                    host can start.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
