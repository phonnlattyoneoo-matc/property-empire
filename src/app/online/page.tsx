"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
  hasSupabaseConfig,
} from "@/lib/supabase/client";
import { getSafeSupabaseErrorMessage } from "@/lib/supabase/error-message";
import {
  MAX_ONLINE_PLAYERS,
  MIN_ONLINE_PLAYERS,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizePlayerName,
  sanitizeRoomCode,
  type OnlineRoom,
  type OnlineRoomPlayer,
} from "@/lib/online-room";
import {
  clearOnlineSession,
  getStoredOnlineSession,
  isPermanentOnlineSessionError,
  reconnectOnlineSession,
  saveOnlineSession,
  saveOnlineSessionFromPlayers,
} from "@/lib/online-session";

export default function OnlinePage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(MAX_ONLINE_PLAYERS);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const isConfigured = hasSupabaseConfig();
  const canCreate =
    isConfigured &&
    normalizePlayerName(createName).length > 0 &&
    !isCreating &&
    !isJoining &&
    !isReconnecting;
  const canJoin =
    isConfigured &&
    normalizePlayerName(joinName).length > 0 &&
    isValidRoomCode(sanitizeRoomCode(joinCode)) &&
    !isCreating &&
    !isJoining &&
    !isReconnecting;

  useEffect(() => {
    if (!supabase || !isConfigured) {
      return;
    }

    const storedSession = getStoredOnlineSession();

    if (!storedSession) {
      return;
    }

    let isActive = true;
    const activeSupabase = supabase;
    const activeStoredSession = storedSession;

    async function reconnect() {
      try {
        setIsReconnecting(true);
        setErrorMessage("");
        setStatusMessage("Reconnecting...");

        const user = await ensureAnonymousUser(activeSupabase);

        if (user.id !== activeStoredSession.userId) {
          clearOnlineSession(activeStoredSession.roomCode);
          throw new Error(
            "Saved online session belongs to another browser profile. Join the room again.",
          );
        }

        const reconnectedSession = await reconnectOnlineSession(
          activeSupabase,
          activeStoredSession,
        );

        if (!isActive) {
          return;
        }

        if (reconnectedSession.roomStatus === "closed") {
          clearOnlineSession(reconnectedSession.roomCode);
          throw new Error("That online room has been closed.");
        }

        router.replace(
          reconnectedSession.roomStatus === "started"
            ? `/online/game/${reconnectedSession.roomCode}`
            : `/online/room/${reconnectedSession.roomCode}`,
        );
      } catch (error) {
        if (isActive) {
          if (isPermanentOnlineSessionError(error)) {
            clearOnlineSession(activeStoredSession.roomCode);
          }

          setStatusMessage("");
          setErrorMessage(getSafeSupabaseErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsReconnecting(false);
        }
      }
    }

    void reconnect();

    return () => {
      isActive = false;
    };
  }, [isConfigured, router, supabase]);

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    const displayName = normalizePlayerName(createName);

    if (!supabase || !displayName) {
      return;
    }

    setIsCreating(true);

    try {
      const user = await ensureAnonymousUser(supabase);
      let room: OnlineRoom | null = null;
      let latestError: unknown = null;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { data, error } = await supabase
          .from("rooms")
          .insert({
            code: generateRoomCode(),
            host_user_id: user.id,
            max_players: maxPlayers,
            status: "waiting",
          })
          .select("id, code, host_user_id, max_players, status, created_at")
          .single();

        if (!error && data) {
          room = data as OnlineRoom;
          break;
        }

        latestError = error;

        if (error?.code !== "23505") {
          throw error;
        }
      }

      if (!room) {
        throw latestError instanceof Error
          ? latestError
          : new Error("Could not create a unique room code.");
      }

      const { data: playerData, error: playerError } = await supabase
        .from("room_players")
        .insert({
          display_name: displayName,
          room_id: room.id,
          user_id: user.id,
        })
        .select(
          "id, room_id, user_id, display_name, is_host, joined_at, last_seen_at",
        )
        .single();

      if (playerError) {
        throw playerError;
      }

      const player = playerData as OnlineRoomPlayer;
      saveOnlineSession({
        displayName: player.display_name,
        isHost: player.is_host,
        playerId: player.id,
        roomCode: room.code,
        roomId: room.id,
        savedAt: new Date().toISOString(),
        seatIndex: 0,
        userId: player.user_id,
      });

      setStatusMessage(`Created room ${room.code}.`);
      router.push(`/online/room/${room.code}`);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    const displayName = normalizePlayerName(joinName);
    const roomCode = sanitizeRoomCode(joinCode);

    if (!supabase || !displayName || !isValidRoomCode(roomCode)) {
      return;
    }

    setIsJoining(true);

    try {
      const user = await ensureAnonymousUser(supabase);
      const { data, error } = await supabase
        .from("rooms")
        .select("id, code, host_user_id, max_players, status, created_at")
        .eq("code", roomCode)
        .eq("status", "waiting")
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("Room not found or already started.");
      }

      const room = data as OnlineRoom;
      const { data: existingPlayer, error: existingPlayerError } =
        await supabase
          .from("room_players")
          .select(
            "id, room_id, user_id, display_name, is_host, joined_at, last_seen_at",
          )
          .eq("room_id", room.id)
          .eq("user_id", user.id)
          .maybeSingle();

      if (existingPlayerError) {
        throw existingPlayerError;
      }

      if (!existingPlayer) {
        const { count, error: countError } = await supabase
          .from("room_players")
          .select("id", { count: "exact", head: true })
          .eq("room_id", room.id);

        if (countError) {
          throw countError;
        }

        if ((count ?? 0) >= room.max_players) {
          throw new Error("That room is full.");
        }
      }

      const { error: playerError } = await supabase
        .from("room_players")
        .upsert(
          {
            display_name: displayName,
            room_id: room.id,
            user_id: user.id,
          },
          { onConflict: "room_id,user_id" },
        );

      if (playerError) {
        throw playerError;
      }

      const { data: playerRows, error: playersError } = await supabase
        .from("room_players")
        .select(
          "id, room_id, user_id, display_name, is_host, joined_at, last_seen_at",
        )
        .eq("room_id", room.id);

      if (playersError) {
        throw playersError;
      }

      saveOnlineSessionFromPlayers(
        room,
        (playerRows ?? []) as OnlineRoomPlayer[],
        user.id,
      );

      setStatusMessage(`Joined room ${room.code}.`);
      router.push(`/online/room/${room.code}`);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f8f4] px-5 py-8 text-[#171915] sm:px-8 sm:py-12">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.05)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.05)_1px,transparent_1px)] bg-[size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-36 top-10 h-[360px] w-[360px] rotate-45 border-[14px] border-[#171915] opacity-[0.04] sm:h-[520px] sm:w-[520px]"
      />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col justify-center py-8">
        <Link
          className="mb-10 inline-flex h-11 w-fit items-center border-2 border-[#171915] bg-[#f7f8f4] px-5 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#43aa8b] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#43aa8b]/45"
          href="/"
        >
          Back
        </Link>

        <div className="grid items-start gap-10 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="mb-5 h-1.5 w-24 bg-[#118ab2]" aria-hidden="true" />
            <h1 className="text-4xl font-black tracking-normal sm:text-6xl">
              Online Lobby
            </h1>
            <p className="mt-5 max-w-md text-lg font-medium leading-8 text-[#445045]">
              Create a room code or join friends before the city opens.
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {!isConfigured ? (
              <div className="border-2 border-[#171915] bg-[#ffedf2] p-4 shadow-[8px_8px_0_0_#ef476f] xl:col-span-2">
                <h2 className="text-2xl font-black">Supabase Required</h2>
                <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                  Add `NEXT_PUBLIC_SUPABASE_URL` and
                  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `.env.local`, then
                  restart the app.
                </p>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="border-2 border-[#171915] bg-[#ffedf2] p-3 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#ef476f] xl:col-span-2">
                {errorMessage}
              </p>
            ) : null}

            {statusMessage ? (
              <p className="border-2 border-[#171915] bg-[#e7fbf4] p-3 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#06d6a0] xl:col-span-2">
                {statusMessage}
              </p>
            ) : null}

            <form
              className="border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#f9c74f] backdrop-blur sm:p-6"
              onSubmit={createRoom}
            >
              <h2 className="text-2xl font-black">Create Room</h2>

              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-black uppercase">
                  Player Name
                </span>
                <input
                  className="h-12 w-full border-2 border-[#171915] bg-white px-4 text-base font-bold outline-none transition-shadow placeholder:text-[#8b9387] focus:shadow-[0_0_0_4px_rgba(249,199,79,0.45)]"
                  maxLength={24}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Enter name"
                  type="text"
                  value={createName}
                />
              </label>

              <div className="mt-5">
                <p className="mb-2 text-sm font-black uppercase">Room Size</p>
                <div className="grid grid-cols-3 gap-2">
                  {[MIN_ONLINE_PLAYERS, 3, MAX_ONLINE_PLAYERS].map(
                    (playerCount) => (
                      <button
                        className={`h-11 border-2 border-[#171915] text-sm font-black transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#3454d1]/35 ${
                          maxPlayers === playerCount
                            ? "bg-[#3454d1] text-white shadow-[4px_4px_0_0_#171915]"
                            : "bg-[#f7f8f4] text-[#171915]"
                        }`}
                        key={playerCount}
                        onClick={() => setMaxPlayers(playerCount)}
                        type="button"
                      >
                        {playerCount}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <button
                className="mt-7 h-14 w-full border-2 border-[#171915] bg-[#171915] px-8 text-base font-bold text-white shadow-[8px_8px_0_0_#06d6a0] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/40 disabled:cursor-not-allowed disabled:bg-[#596057] disabled:opacity-55 disabled:shadow-none"
                disabled={!canCreate}
                type="submit"
              >
                {isCreating ? "Creating..." : "Create Room"}
              </button>
            </form>

            <form
              className="border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#118ab2] backdrop-blur sm:p-6"
              onSubmit={joinRoom}
            >
              <h2 className="text-2xl font-black">Join Room</h2>

              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-black uppercase">
                  Room Code
                </span>
                <input
                  className="h-12 w-full border-2 border-[#171915] bg-white px-4 text-center text-xl font-black uppercase tracking-[0.25em] outline-none transition-shadow placeholder:text-[#8b9387] focus:shadow-[0_0_0_4px_rgba(17,138,178,0.3)]"
                  maxLength={ROOM_CODE_LENGTH}
                  onChange={(event) =>
                    setJoinCode(sanitizeRoomCode(event.target.value))
                  }
                  placeholder="ABC123"
                  type="text"
                  value={joinCode}
                />
              </label>

              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-black uppercase">
                  Player Name
                </span>
                <input
                  className="h-12 w-full border-2 border-[#171915] bg-white px-4 text-base font-bold outline-none transition-shadow placeholder:text-[#8b9387] focus:shadow-[0_0_0_4px_rgba(17,138,178,0.3)]"
                  maxLength={24}
                  onChange={(event) => setJoinName(event.target.value)}
                  placeholder="Enter name"
                  type="text"
                  value={joinName}
                />
              </label>

              <button
                className="mt-7 h-14 w-full border-2 border-[#171915] bg-[#06d6a0] px-8 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/40 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
                disabled={!canJoin}
                type="submit"
              >
                {isJoining ? "Joining..." : "Join Room"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
