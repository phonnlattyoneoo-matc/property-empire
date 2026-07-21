"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BOARD_SPACE_COUNT,
  CITY_LAUNCH_BONUS,
  STARTING_BALANCE,
} from "@/lib/game-state";
import {
  ONLINE_BOARD_SPACES,
  isOnlinePropertySpace,
  onlineSpaceStyles,
  type OnlinePropertySpace,
} from "@/lib/online-board";
import {
  parseOnlineGameStateRow,
  type OnlineGameState,
  type OnlineGamePlayer,
  type OnlineGameStateRow,
} from "@/lib/online-game-state";
import { sanitizeRoomCode, type OnlineRoom } from "@/lib/online-room";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
  hasSupabaseConfig,
} from "@/lib/supabase/client";
import { getSafeSupabaseErrorMessage } from "@/lib/supabase/error-message";

function getBoardPosition(index: number): CSSProperties {
  if (index < 7) {
    return { gridColumn: index + 1, gridRow: 7 };
  }

  if (index < 13) {
    return { gridColumn: 7, gridRow: 13 - index };
  }

  if (index < 19) {
    return { gridColumn: 19 - index, gridRow: 1 };
  }

  return { gridColumn: 1, gridRow: index - 17 };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function getPropertyOwner(gameState: OnlineGameState, position: number) {
  const ownerId = gameState.propertyOwners[String(position)];

  if (!ownerId) {
    return null;
  }

  return gameState.players.find((player) => player.id === ownerId) ?? null;
}

function getNotFoundMessage(error: { code?: string } | null) {
  return error?.code === "PGRST116"
    ? "Room not found for this online player."
    : "";
}

export default function OnlineGamePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = sanitizeRoomCode(params.code ?? "");
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const isConfigured = hasSupabaseConfig();
  const [currentUserId, setCurrentUserId] = useState("");
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [gameRow, setGameRow] = useState<OnlineGameStateRow | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(isConfigured);
  const [isActing, setIsActing] = useState(false);

  const gameState = gameRow?.state ?? null;
  const currentPlayer =
    gameState?.players[gameState.currentPlayerIndex] ?? null;
  const currentSpace = currentPlayer
    ? ONLINE_BOARD_SPACES[currentPlayer.position]
    : null;
  const currentProperty =
    currentSpace && isOnlinePropertySpace(currentSpace)
      ? currentSpace
      : null;
  const currentPropertyOwner =
    gameState && currentPlayer && currentProperty
      ? getPropertyOwner(gameState, currentPlayer.position)
      : null;
  const hasPendingPropertyPurchase =
    gameState?.pendingPropertyPurchasePosition !== null &&
    gameState?.pendingPropertyPurchasePosition !== undefined;
  const localPlayer = gameState?.players.find((player) => {
    return player.userId === currentUserId;
  });
  const isCurrentPlayer =
    currentPlayer !== null && currentPlayer.userId === currentUserId;
  const canRoll =
    Boolean(room && gameRow && isCurrentPlayer) &&
    !gameState?.hasRolledThisTurn &&
    !hasPendingPropertyPurchase &&
    !isActing;
  const canEndTurn =
    Boolean(room && gameRow && isCurrentPlayer) &&
    Boolean(gameState?.hasRolledThisTurn) &&
    !hasPendingPropertyPurchase &&
    !isActing;
  const canBuyProperty =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    hasPendingPropertyPurchase &&
    currentProperty !== null &&
    currentPropertyOwner === null &&
    currentPlayer!.position === gameState?.pendingPropertyPurchasePosition &&
    currentPlayer!.balance >= currentProperty.price &&
    !isActing;
  const canSkipProperty =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    hasPendingPropertyPurchase &&
    currentProperty !== null &&
    currentPropertyOwner === null &&
    currentPlayer!.position === gameState?.pendingPropertyPurchasePosition &&
    !isActing;

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

      const notFoundMessage = getNotFoundMessage(error);

      if (notFoundMessage) {
        throw new Error(notFoundMessage);
      }

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("Room not found.");
      }

      const loadedRoom = data as OnlineRoom;
      setRoom(loadedRoom);

      return loadedRoom;
    },
    [supabase],
  );

  const loadGameState = useCallback(
    async (roomId: string) => {
      if (!supabase) {
        return null;
      }

      const { data, error } = await supabase
        .from("game_states")
        .select("room_id, state, version, updated_by, updated_at")
        .eq("room_id", roomId)
        .single();

      const notFoundMessage = getNotFoundMessage(error);

      if (notFoundMessage) {
        throw new Error("Online game state is not ready yet.");
      }

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid. Restart this room.");
      }

      setGameRow(parsedGameState);
      setErrorMessage("");

      return parsedGameState;
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase || !isConfigured) {
      return;
    }

    let isActive = true;
    const activeSupabase = supabase;

    async function loadOnlineGame() {
      try {
        setIsLoading(true);
        setErrorMessage("");

        const user = await ensureAnonymousUser(activeSupabase);
        const loadedRoom = await loadRoom(roomCode);

        if (!loadedRoom || !isActive) {
          return;
        }

        setCurrentUserId(user.id);

        if (loadedRoom.status !== "started") {
          router.replace(`/online/room/${loadedRoom.code}`);
          return;
        }

        await loadGameState(loadedRoom.id);
      } catch (error) {
        if (isActive) {
          setErrorMessage(getSafeSupabaseErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadOnlineGame();

    return () => {
      isActive = false;
    };
  }, [isConfigured, loadGameState, loadRoom, roomCode, router, supabase]);

  useEffect(() => {
    if (!supabase || !room?.id) {
      return;
    }

    const channel: RealtimeChannel = supabase
      .channel(`property-empire-online-game-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `room_id=eq.${room.id}`,
          schema: "public",
          table: "game_states",
        },
        () => {
          void loadGameState(room.id).catch((error: unknown) => {
            setErrorMessage(getSafeSupabaseErrorMessage(error));
          });
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
          void loadRoom(room.code).catch((error: unknown) => {
            setErrorMessage(getSafeSupabaseErrorMessage(error));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadGameState, loadRoom, room, supabase]);

  async function rollDice() {
    if (!supabase || !room || !gameRow || !canRoll) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const dieOne = rollDie();
      const dieTwo = rollDie();
      const { data, error } = await supabase.rpc("roll_online_turn", {
        die_one: dieOne,
        die_two: dieTwo,
        expected_version: gameRow.version,
        target_room_id: room.id,
      });

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid after rolling.");
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  async function endTurn() {
    if (!supabase || !room || !gameRow || !canEndTurn) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("end_online_turn", {
        expected_version: gameRow.version,
        target_room_id: room.id,
      });

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid after ending the turn.");
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  async function buyProperty() {
    if (
      !supabase ||
      !room ||
      !gameRow ||
      !currentProperty ||
      gameState?.pendingPropertyPurchasePosition === null ||
      gameState?.pendingPropertyPurchasePosition === undefined ||
      !canBuyProperty
    ) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("buy_online_property", {
        expected_version: gameRow.version,
        property_position: gameState.pendingPropertyPurchasePosition,
        target_room_id: room.id,
      });

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid after buying.");
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  async function skipPropertyPurchase() {
    if (
      !supabase ||
      !room ||
      !gameRow ||
      !currentProperty ||
      gameState?.pendingPropertyPurchasePosition === null ||
      gameState?.pendingPropertyPurchasePosition === undefined ||
      !canSkipProperty
    ) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "skip_online_property_purchase",
        {
          expected_version: gameRow.version,
          property_position: gameState.pendingPropertyPurchasePosition,
          target_room_id: room.id,
        },
      );

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid after skipping.");
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  function renderPropertyPanel(property: OnlinePropertySpace) {
    if (!gameState || !currentPlayer) {
      return null;
    }

    const isPendingProperty =
      gameState.pendingPropertyPurchasePosition === currentPlayer.position;
    const owner = currentPropertyOwner;

    return (
      <div className="border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#3454d1] backdrop-blur">
        <h2 className="text-2xl font-black">Property</h2>

        <div className="mt-4 space-y-3 border-2 border-[#171915] bg-[#f7f8f4] p-3">
          <div>
            <p className="text-sm font-black uppercase text-[#596057]">
              Space
            </p>
            <p className="break-words text-xl font-black">{property.name}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                Price
              </p>
              <p className="text-lg font-black">
                {formatCurrency(property.price)}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                Rent
              </p>
              <p className="text-lg font-black">
                {formatCurrency(property.rent)}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                Balance
              </p>
              <p className="text-lg font-black">
                {formatCurrency(currentPlayer.balance)}
              </p>
            </div>
          </div>

          {owner ? (
            <p className="border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
              {owner.id === currentPlayer.id
                ? `${currentPlayer.name} already owns ${property.name}.`
                : `${property.name} is owned by ${owner.name}. Rent has been paid automatically.`}
            </p>
          ) : isPendingProperty ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <button
                className="h-12 border-2 border-[#171915] bg-[#06d6a0] px-4 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                disabled={!canBuyProperty}
                onClick={buyProperty}
                type="button"
              >
                {isActing ? "Buying..." : "Buy Property"}
              </button>

              <button
                className="h-12 border-2 border-[#171915] bg-[#f7f8f4] px-4 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                disabled={!canSkipProperty}
                onClick={skipPropertyPurchase}
                type="button"
              >
                {isActing ? "Skipping..." : "Skip Purchase"}
              </button>
            </div>
          ) : (
            <p className="border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
              No owner yet. Purchase skipped for this turn.
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderPlayerCard(player: OnlineGamePlayer, playerIndex: number) {
    const isActive = playerIndex === gameState?.currentPlayerIndex;
    const isLocalPlayer = player.userId === currentUserId;

    return (
      <div
        className={`flex items-center gap-3 border-2 border-[#171915] p-3 ${
          isActive
            ? "bg-[#f9c74f] shadow-[5px_5px_0_0_#171915]"
            : "bg-[#f7f8f4]"
        }`}
        key={player.id}
      >
        <span
          aria-hidden="true"
          className="h-6 w-6 shrink-0 rounded-full border-2 border-[#171915]"
          style={{ backgroundColor: player.color }}
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-black">{player.name}</p>
          <p className="text-sm font-bold text-[#445045]">
            {formatCurrency(player.balance)}
          </p>
          {isLocalPlayer ? (
            <p className="mt-1 text-xs font-black uppercase text-[#596057]">
              You
            </p>
          ) : null}
        </div>
        {isActive ? (
          <span className="border-2 border-[#171915] bg-white px-2 py-1 text-[0.62rem] font-black uppercase">
            Current
          </span>
        ) : null}
      </div>
    );
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

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p
                className="mb-4 h-1.5 w-24 bg-[#06d6a0]"
                aria-hidden="true"
              />
              <h1 className="text-4xl font-black tracking-normal sm:text-6xl">
                Property Empire
              </h1>
            </div>
            <p className="w-fit border-2 border-[#171915] bg-white px-4 py-2 text-sm font-black shadow-[5px_5px_0_0_#43aa8b]">
              {room ? `Room: ${room.code}` : "Online Game"}
            </p>
          </div>

          {!isConfigured ? (
            <div className="border-2 border-[#171915] bg-[#ffedf2] p-4 shadow-[8px_8px_0_0_#ef476f]">
              <h2 className="text-2xl font-black">Supabase Required</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                Add the public Supabase environment variables and restart the
                app before using online games.
              </p>
            </div>
          ) : isLoading ? (
            <p className="border-2 border-[#171915] bg-white/90 p-4 text-sm font-black shadow-[6px_6px_0_0_#f9c74f]">
              Loading online game
            </p>
          ) : errorMessage && !gameState ? (
            <div className="border-2 border-[#171915] bg-[#ffedf2] p-4 shadow-[8px_8px_0_0_#ef476f]">
              <h2 className="text-2xl font-black">Online Game Error</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                {errorMessage}
              </p>
              <Link
                className="mt-5 inline-flex h-12 items-center justify-center border-2 border-[#171915] bg-[#171915] px-6 text-sm font-bold text-white shadow-[5px_5px_0_0_#f9c74f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#f9c74f]/45"
                href="/online"
              >
                Back to Online
              </Link>
            </div>
          ) : gameState ? (
            <div className="overflow-x-auto pb-4">
              <div className="grid aspect-square min-w-[620px] grid-cols-7 grid-rows-7 border-2 border-[#171915] bg-[#171915] shadow-[12px_12px_0_0_#f9c74f]">
                {ONLINE_BOARD_SPACES.map((space, index) => {
                  const styles = onlineSpaceStyles[space.type];
                  const propertyOwner = isOnlinePropertySpace(space)
                    ? getPropertyOwner(gameState, index)
                    : null;
                  const playersOnSpace = gameState.players.filter(
                    (player) => player.position === index,
                  );

                  return (
                    <div
                      className="relative flex min-h-0 flex-col justify-between border border-[#171915] p-1.5 text-[#171915]"
                      key={space.name}
                      style={{
                        ...getBoardPosition(index),
                        backgroundColor: styles.tint,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-1.5"
                        style={{ backgroundColor: styles.accent }}
                      />
                      <span className="pt-2 text-[0.66rem] font-black uppercase leading-tight sm:text-xs">
                        {space.name}
                      </span>
                      <span className="text-[0.52rem] font-bold uppercase leading-tight text-[#596057] sm:text-[0.62rem]">
                        {styles.label}
                      </span>

                      {isOnlinePropertySpace(space) ? (
                        <div className="mt-1 space-y-0.5">
                          {propertyOwner ? (
                            <span
                              className="block truncate border border-[#171915] px-1 py-0.5 text-[0.5rem] font-black uppercase leading-tight text-white sm:text-[0.58rem]"
                              title={`Owner: ${propertyOwner.name}`}
                              style={{
                                backgroundColor: propertyOwner.color,
                              }}
                            >
                              Owner: {propertyOwner.name}
                            </span>
                          ) : (
                            <span className="block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              Price {formatCurrency(space.price)}
                            </span>
                          )}
                          <span className="block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                            Rent {formatCurrency(space.rent)}
                          </span>
                        </div>
                      ) : null}

                      {playersOnSpace.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {playersOnSpace.map((player) => (
                            <span
                              aria-label={`${player.name} token`}
                              className="h-4 w-4 rounded-full border-2 border-[#171915] sm:h-5 sm:w-5"
                              key={player.id}
                              style={{ backgroundColor: player.color }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                <div
                  className="flex flex-col items-center justify-center border-2 border-[#171915] bg-[#171915] p-6 text-center text-white"
                  style={{ gridColumn: "2 / 7", gridRow: "2 / 7" }}
                >
                  <p
                    className="mb-4 h-1.5 w-24 bg-[#ef476f]"
                    aria-hidden="true"
                  />
                  <h2 className="text-4xl font-black tracking-normal sm:text-6xl">
                    Online City
                  </h2>
                  <p className="mt-4 max-w-md text-base font-bold leading-7 text-[#f7f8f4] sm:text-lg">
                    Pass or land on Grand Plaza to collect{" "}
                    {formatCurrency(CITY_LAUNCH_BONUS)}.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="space-y-5">
          <div className="border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#06d6a0] backdrop-blur">
            <h2 className="text-2xl font-black">Players</h2>

            <div className="mt-4 space-y-3">
              {gameState ? (
                gameState.players.map(renderPlayerCard)
              ) : (
                <p className="border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold">
                  Waiting for game state
                </p>
              )}
            </div>
          </div>

          <div className="border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#f9c74f] backdrop-blur">
            <h2 className="text-2xl font-black">Dice</h2>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black">
                {gameState?.lastRoll?.dieOne ?? "-"}
              </div>
              <div className="flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black">
                {gameState?.lastRoll?.dieTwo ?? "-"}
              </div>
              <div className="flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#171915] text-3xl font-black text-white">
                {gameState?.lastRoll?.total ?? "-"}
              </div>
            </div>

            <p className="mt-4 border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold leading-6 text-[#445045]">
              {errorMessage || gameState?.message || "Loading online turn"}
            </p>
          </div>

          {gameState?.hasRolledThisTurn && currentProperty
            ? renderPropertyPanel(currentProperty)
            : null}

          <div className="border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#118ab2] backdrop-blur">
            <h2 className="text-2xl font-black">Turn</h2>

            <div className="mt-4 space-y-3 border-2 border-[#171915] bg-[#f7f8f4] p-3">
              <div>
                <p className="text-xs font-black uppercase text-[#596057]">
                  Current Player
                </p>
                <p className="break-words text-xl font-black">
                  {currentPlayer?.name ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-black uppercase text-[#596057]">
                  Your Seat
                </p>
                <p className="break-words text-base font-black">
                  {localPlayer?.name ?? "Not joined"}
                </p>
              </div>
              <p className="text-sm font-bold leading-6 text-[#445045]">
                {isCurrentPlayer
                  ? hasPendingPropertyPurchase
                    ? "Buy or skip the property before ending your turn."
                    : gameState?.hasRolledThisTurn
                      ? "End your turn when ready."
                      : "Your turn to roll."
                  : currentPlayer
                    ? hasPendingPropertyPurchase
                      ? `Waiting for ${currentPlayer.name} to decide on a property.`
                      : `Waiting for ${currentPlayer.name}.`
                    : "Waiting for game state."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <button
              className="h-14 border-2 border-[#171915] bg-[#3454d1] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#3454d1]/35 disabled:cursor-not-allowed disabled:bg-[#596057] disabled:opacity-55 disabled:shadow-none"
              disabled={!canRoll}
              onClick={rollDice}
              type="button"
            >
              {isActing && !gameState?.hasRolledThisTurn
                ? "Rolling..."
                : "Roll Dice"}
            </button>

            <button
              className="h-14 border-2 border-[#171915] bg-[#06d6a0] px-6 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
              disabled={!canEndTurn}
              onClick={endTurn}
              type="button"
            >
              {isActing && gameState?.hasRolledThisTurn
                ? "Ending..."
                : "End Turn"}
            </button>

            <Link
              className="flex h-14 items-center justify-center border-2 border-[#171915] bg-[#ef476f] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
              href="/"
            >
              Exit Game
            </Link>
          </div>

          <p className="border-2 border-[#171915] bg-white/90 p-3 text-sm font-bold text-[#445045] shadow-[5px_5px_0_0_#43aa8b]">
            All players began with {formatCurrency(STARTING_BALANCE)} at Grand
            Plaza. Version {gameRow?.version ?? "-"} of the shared game is
            loaded.
          </p>

          {gameState?.boardSpaceCount !== undefined &&
          gameState.boardSpaceCount !== BOARD_SPACE_COUNT ? (
            <p className="border-2 border-[#171915] bg-[#ffedf2] p-3 text-sm font-bold text-[#445045] shadow-[5px_5px_0_0_#ef476f]">
              Board state does not match this app version.
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
