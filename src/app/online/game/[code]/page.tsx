"use client";

import { useParams, useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BOARD_SPACE_COUNT,
  CITY_LAUNCH_BONUS,
  STARTING_BALANCE,
} from "@/lib/game-state";
import {
  ONLINE_BOARD_SPACES,
  ONLINE_TRANSIT_RENTS,
  isOnlineBuyableSpace,
  isOnlinePropertySpace,
  isOnlineTaxSpace,
  isOnlineTransitSpace,
  onlineSpaceStyles,
  type OnlineBuyableSpace,
  type OnlinePropertySpace,
} from "@/lib/online-board";
import {
  parseOnlineGameStateRow,
  type OnlineGameState,
  type OnlineGamePlayer,
  type OnlineGameStateRow,
} from "@/lib/online-game-state";
import {
  sanitizeRoomCode,
  sortOnlineRoomPlayers,
  type OnlineRoom,
  type OnlineRoomPlayer,
} from "@/lib/online-room";
import {
  ONLINE_HEARTBEAT_INTERVAL_MS,
  clearOnlineSession,
  getOnlineConnectionStatus,
  getStoredOnlineSession,
  heartbeatOnlineSession,
  isPermanentOnlineSessionError,
  reconnectOnlineSession,
  saveOnlineSessionFromGameState,
  type OnlineConnectionStatus,
  type StoredOnlineSession,
} from "@/lib/online-session";
import {
  HOTEL_DEVELOPMENT_LEVEL,
  MAX_HOUSES,
  PROPERTY_GROUPS,
  getDevelopmentLabel,
  getDevelopmentSaleValue,
  getPropertyGroup,
  getPropertyRent,
  type PropertyDevelopmentLevel,
  type PropertyGroupId,
} from "@/lib/property-development";
import {
  ensureAnonymousUser,
  getSupabaseBrowserClient,
  hasSupabaseConfig,
} from "@/lib/supabase/client";
import { getSafeSupabaseErrorMessage } from "@/lib/supabase/error-message";

type BoardSide = "bottom" | "left" | "right" | "top";

type DevelopmentActionStatus = {
  canAct: boolean;
  label: string;
  nextLevel: PropertyDevelopmentLevel | null;
  reason: string | null;
};

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

function getBoardSide(index: number): BoardSide {
  if (index < 7) {
    return "bottom";
  }

  if (index < 13) {
    return "right";
  }

  if (index < 19) {
    return "top";
  }

  return "left";
}

function formatCurrency(amount: number) {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(amount);
}

function formatTransitRentTiers(separator = " / ") {
  return ONLINE_TRANSIT_RENTS.slice(1).map(formatCurrency).join(separator);
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function getSpaceOwner(gameState: OnlineGameState, position: number) {
  const ownerId = gameState.propertyOwners[String(position)];

  if (!ownerId) {
    return null;
  }

  return gameState.players.find((player) => player.id === ownerId) ?? null;
}

function getOwnedTransitCount(gameState: OnlineGameState, ownerId: string) {
  return ONLINE_BOARD_SPACES.reduce((ownedTransitCount, space, position) => {
    if (
      isOnlineTransitSpace(space) &&
      gameState.propertyOwners[String(position)] === ownerId
    ) {
      return ownedTransitCount + 1;
    }

    return ownedTransitCount;
  }, 0);
}

function getTransitRent(stationCount: number) {
  return ONLINE_TRANSIT_RENTS[
    Math.min(stationCount, ONLINE_TRANSIT_RENTS.length - 1)
  ];
}

function getPropertyDevelopmentLevel(
  gameState: OnlineGameState,
  position: number,
): PropertyDevelopmentLevel {
  return gameState.propertyDevelopments[String(position)] ?? 0;
}

function getDevelopedPropertyRent(
  gameState: OnlineGameState,
  position: number,
  property: OnlinePropertySpace,
) {
  return (
    getPropertyRent(position, getPropertyDevelopmentLevel(gameState, position)) ??
    property.rent
  );
}

function getPropertyGroupDevelopmentLevels(
  gameState: OnlineGameState,
  groupId: PropertyGroupId,
) {
  return PROPERTY_GROUPS[groupId].propertyPositions.map((position) =>
    getPropertyDevelopmentLevel(gameState, position),
  );
}

function playerOwnsPropertyGroup(
  gameState: OnlineGameState,
  playerId: string,
  groupId: PropertyGroupId,
) {
  return PROPERTY_GROUPS[groupId].propertyPositions.every((position) => {
    return gameState.propertyOwners[String(position)] === playerId;
  });
}

function getBuildActionStatus({
  gameState,
  isActing,
  isCurrentPlayer,
  isTurnTimerExpired,
  player,
  position,
  property,
}: {
  gameState: OnlineGameState;
  isActing: boolean;
  isCurrentPlayer: boolean;
  isTurnTimerExpired: boolean;
  player: OnlineGamePlayer;
  position: number;
  property: OnlinePropertySpace;
}): DevelopmentActionStatus {
  const owner = getSpaceOwner(gameState, position);
  const group = getPropertyGroup(property.groupId);
  const currentLevel = getPropertyDevelopmentLevel(gameState, position);
  const label =
    currentLevel >= MAX_HOUSES ? "Build Hotel" : "Build House";

  if (gameState.winnerPlayerId) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "The game is over.",
    };
  }

  if (!isCurrentPlayer) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Wait for your turn to build.",
    };
  }

  if (isActing) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "An online action is already being submitted.",
    };
  }

  if (isTurnTimerExpired) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "The turn timer expired.",
    };
  }

  if (player.isEliminated) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Bankrupt players cannot build.",
    };
  }

  if (gameState.isDetentionTurn || player.isDetained) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Leave detention before developing properties.",
    };
  }

  if (gameState.pendingPropertyPurchasePosition !== null) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Choose Buy or Skip before developing properties.",
    };
  }

  if (owner?.id !== player.id) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Only the owner can build here.",
    };
  }

  if (!playerOwnsPropertyGroup(gameState, player.id, property.groupId)) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: `Own every ${group.name} property to build.`,
    };
  }

  if (currentLevel >= HOTEL_DEVELOPMENT_LEVEL) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "This property already has a hotel.",
    };
  }

  if (player.balance < group.buildCost) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: `Need ${formatCurrency(group.buildCost)} available to build.`,
    };
  }

  const groupLevels = getPropertyGroupDevelopmentLevels(
    gameState,
    property.groupId,
  );

  if (currentLevel < MAX_HOUSES) {
    const lowestGroupLevel = Math.min(...groupLevels);

    if (currentLevel !== lowestGroupLevel) {
      return {
        canAct: false,
        label,
        nextLevel: null,
        reason: "Build evenly across the group first.",
      };
    }

    return {
      canAct: true,
      label,
      nextLevel: (currentLevel + 1) as PropertyDevelopmentLevel,
      reason: null,
    };
  }

  if (groupLevels.some((level) => level < MAX_HOUSES)) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Every property in the group needs 4 houses before a hotel.",
    };
  }

  return {
    canAct: true,
    label,
    nextLevel: HOTEL_DEVELOPMENT_LEVEL,
    reason: null,
  };
}

function getSellActionStatus({
  gameState,
  isActing,
  isCurrentPlayer,
  isTurnTimerExpired,
  player,
  position,
  property,
}: {
  gameState: OnlineGameState;
  isActing: boolean;
  isCurrentPlayer: boolean;
  isTurnTimerExpired: boolean;
  player: OnlineGamePlayer;
  position: number;
  property: OnlinePropertySpace;
}): DevelopmentActionStatus {
  const owner = getSpaceOwner(gameState, position);
  const currentLevel = getPropertyDevelopmentLevel(gameState, position);
  const label =
    currentLevel === HOTEL_DEVELOPMENT_LEVEL ? "Sell Hotel" : "Sell House";

  if (gameState.winnerPlayerId) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "The game is over.",
    };
  }

  if (!isCurrentPlayer) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Wait for your turn to sell.",
    };
  }

  if (isActing) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "An online action is already being submitted.",
    };
  }

  if (isTurnTimerExpired) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "The turn timer expired.",
    };
  }

  if (player.isEliminated) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Bankrupt players cannot sell buildings.",
    };
  }

  if (gameState.isDetentionTurn || player.isDetained) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Leave detention before selling buildings.",
    };
  }

  if (gameState.pendingPropertyPurchasePosition !== null) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Choose Buy or Skip before selling buildings.",
    };
  }

  if (owner?.id !== player.id) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Only the owner can sell buildings here.",
    };
  }

  if (currentLevel === 0) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "No buildings to sell.",
    };
  }

  const groupLevels = getPropertyGroupDevelopmentLevels(
    gameState,
    property.groupId,
  );
  const highestGroupLevel = Math.max(...groupLevels);

  if (currentLevel !== highestGroupLevel) {
    return {
      canAct: false,
      label,
      nextLevel: null,
      reason: "Sell from the most-developed properties first.",
    };
  }

  return {
    canAct: true,
    label,
    nextLevel:
      currentLevel === HOTEL_DEVELOPMENT_LEVEL
        ? MAX_HOUSES
        : ((currentLevel - 1) as PropertyDevelopmentLevel),
    reason: null,
  };
}

function getNextDevelopmentLevel(level: PropertyDevelopmentLevel) {
  if (level >= HOTEL_DEVELOPMENT_LEVEL) {
    return null;
  }

  return (level + 1) as PropertyDevelopmentLevel;
}

function getOwnershipProgress(ownedPropertyCount: number, groupSize: number) {
  return ownedPropertyCount === groupSize
    ? "Complete group"
    : `Own ${ownedPropertyCount} of ${groupSize}`;
}

function renderDevelopmentMarkers(level: PropertyDevelopmentLevel) {
  if (level === 0) {
    return null;
  }

  const label = getDevelopmentLabel(level);

  if (level === HOTEL_DEVELOPMENT_LEVEL) {
    return (
      <div
        aria-label={label}
        className="game-development-markers mt-1 flex"
        title={label}
      >
        <span className="h-3 w-6 border border-[#171915] bg-[#f8961e]" />
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className="game-development-markers mt-1 flex flex-wrap gap-0.5"
      title={label}
    >
      {Array.from({ length: level }).map((_, houseIndex) => (
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 border border-[#171915] bg-[#06d6a0]"
          key={houseIndex}
        />
      ))}
    </div>
  );
}

function getNotFoundMessage(error: { code?: string } | null) {
  return error?.code === "PGRST116"
    ? "This room no longer exists or your saved seat is no longer available."
    : "";
}

function getConnectionStatusClassName(status: OnlineConnectionStatus) {
  if (status === "Connected") {
    return "bg-[#e7fbf4] text-[#171915]";
  }

  if (status === "Reconnecting") {
    return "bg-[#fff1de] text-[#171915]";
  }

  return "bg-[#ffedf2] text-[#171915]";
}

function formatTurnTimer(remainingSeconds: number | null) {
  if (remainingSeconds === null) {
    return "--:--";
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatActivityTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isExpectedTimerExpirationRace(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";

  return (
    message.includes("Game state changed") ||
    message.includes("has not expired") ||
    message.includes("already finished")
  );
}

export default function OnlineGamePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = sanitizeRoomCode(params.code ?? "");
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const isConfigured = hasSupabaseConfig();
  const [currentUserId, setCurrentUserId] = useState("");
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<OnlineRoomPlayer[]>([]);
  const [gameRow, setGameRow] = useState<OnlineGameStateRow | null>(null);
  const [storedOnlineSession, setStoredOnlineSession] =
    useState<StoredOnlineSession | null>(null);
  const [presenceNowMs, setPresenceNowMs] = useState(() => Date.now());
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(isConfigured);
  const [isPropertiesModalOpen, setIsPropertiesModalOpen] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isExpiringTurn, setIsExpiringTurn] = useState(false);

  const gameState = gameRow?.state ?? null;
  const winnerPlayer =
    gameState?.players.find((player) => player.id === gameState.winnerPlayerId) ??
    null;
  const isGameOver = winnerPlayer !== null;
  const currentPlayer =
    gameState?.players[gameState.currentPlayerIndex] ?? null;
  const currentSpace = currentPlayer
    ? ONLINE_BOARD_SPACES[currentPlayer.position]
    : null;
  const currentBuyableSpace =
    currentSpace && isOnlineBuyableSpace(currentSpace)
      ? currentSpace
      : null;
  const currentSpaceOwner =
    gameState && currentPlayer && currentBuyableSpace
      ? getSpaceOwner(gameState, currentPlayer.position)
      : null;
  const hasPendingPropertyPurchase =
    gameState?.pendingPropertyPurchasePosition !== null &&
    gameState?.pendingPropertyPurchasePosition !== undefined;
  const isDetentionTurn = gameState?.isDetentionTurn === true;
  const localPlayer = gameState?.players.find((player) => {
    return player.userId === currentUserId;
  });
  const localPlayerIndex =
    gameState?.players.findIndex((player) => player.userId === currentUserId) ??
    -1;
  const localSeatNumber =
    storedOnlineSession?.seatIndex !== undefined
      ? storedOnlineSession.seatIndex + 1
      : localPlayerIndex >= 0
        ? localPlayerIndex + 1
        : null;
  const isCurrentPlayer =
    currentPlayer !== null && currentPlayer.userId === currentUserId;
  const isHost =
    room !== null && currentUserId.length > 0 && room.host_user_id === currentUserId;
  const turnDeadlineMs = gameState?.turnDeadlineAt
    ? Date.parse(gameState.turnDeadlineAt)
    : null;
  const hasActiveTurnTimer =
    turnDeadlineMs !== null &&
    Number.isFinite(turnDeadlineMs) &&
    winnerPlayer === null;
  const remainingTurnSeconds = hasActiveTurnTimer
    ? Math.max(0, Math.ceil((turnDeadlineMs! - presenceNowMs) / 1_000))
    : null;
  const isTurnTimerExpired =
    hasActiveTurnTimer && remainingTurnSeconds === 0;
  const turnTimerProgress =
    remainingTurnSeconds === null
      ? 0
      : Math.max(0, Math.min(100, (remainingTurnSeconds / 60) * 100));
  const canRoll =
    Boolean(room && gameRow && isCurrentPlayer) &&
    !isGameOver &&
    !gameState?.hasRolledThisTurn &&
    !isDetentionTurn &&
    !hasPendingPropertyPurchase &&
    !isTurnTimerExpired &&
    !isExpiringTurn &&
    !isActing;
  const canEndTurn =
    Boolean(room && gameRow && isCurrentPlayer) &&
    !isGameOver &&
    Boolean(gameState?.hasRolledThisTurn) &&
    !isDetentionTurn &&
    !hasPendingPropertyPurchase &&
    !isTurnTimerExpired &&
    !isExpiringTurn &&
    !isActing;
  const canLeaveDetention =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    !isGameOver &&
    isDetentionTurn &&
    currentPlayer!.isDetained &&
    !isTurnTimerExpired &&
    !isExpiringTurn &&
    !isActing;
  const canBuySpace =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    !isGameOver &&
    hasPendingPropertyPurchase &&
    currentBuyableSpace !== null &&
    currentSpaceOwner === null &&
    !isDetentionTurn &&
    currentPlayer!.position === gameState?.pendingPropertyPurchasePosition &&
    currentPlayer!.balance >= currentBuyableSpace.price &&
    !isTurnTimerExpired &&
    !isExpiringTurn &&
    !isActing;
  const canSkipPurchase =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    !isGameOver &&
    hasPendingPropertyPurchase &&
    currentBuyableSpace !== null &&
    currentSpaceOwner === null &&
    !isDetentionTurn &&
    currentPlayer!.position === gameState?.pendingPropertyPurchasePosition &&
    !isTurnTimerExpired &&
    !isExpiringTurn &&
    !isActing;
  const canPlayAgain =
    Boolean(room && gameRow && isHost && winnerPlayer) && !isActing;
  const ownedPropertyGroups =
    gameState && localPlayer
      ? Object.values(PROPERTY_GROUPS)
          .map((group) => {
            const properties: {
              position: number;
              space: OnlinePropertySpace;
            }[] = [];

            for (const position of group.propertyPositions) {
              const space = ONLINE_BOARD_SPACES[position];

              if (
                isOnlinePropertySpace(space) &&
                gameState.propertyOwners[String(position)] === localPlayer.id
              ) {
                properties.push({ position, space });
              }
            }

            return {
              group,
              ownershipProgress: getOwnershipProgress(
                properties.length,
                group.propertyPositions.length,
              ),
              properties,
            };
          })
          .filter((propertyGroup) => propertyGroup.properties.length > 0)
      : [];
  const ownedPropertyCount = ownedPropertyGroups.reduce(
    (propertyCount, propertyGroup) => {
      return propertyCount + propertyGroup.properties.length;
    },
    0,
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

      const notFoundMessage = getNotFoundMessage(error);

      if (notFoundMessage) {
        clearOnlineSession(code);
        setRoom(null);
        setGameRow(null);
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
        setRoom(null);
        setGameRow(null);
        throw new Error("This online room has been closed.");
      }

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

  const loadRoomPlayers = useCallback(
    async (roomId: string) => {
      if (!supabase) {
        return null;
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

      setRoomPlayers(sortedPlayers);

      return sortedPlayers;
    },
    [supabase],
  );

  useEffect(() => {
    if (!isPropertiesModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPropertiesModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPropertiesModalOpen]);

  useEffect(() => {
    if (!supabase || !isConfigured) {
      return;
    }

    let isActive = true;
    const activeSupabase = supabase;

    async function loadOnlineGame() {
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

          setStoredOnlineSession(reconnectedSession);
        }

        const loadedRoom = await loadRoom(roomCode);

        if (!loadedRoom || !isActive) {
          return;
        }

        setCurrentUserId(user.id);

        if (loadedRoom.status !== "started") {
          router.replace(`/online/room/${loadedRoom.code}`);
          return;
        }

        const [loadedGameState] = await Promise.all([
          loadGameState(loadedRoom.id),
          loadRoomPlayers(loadedRoom.id),
        ]);

        if (!loadedGameState || !isActive) {
          return;
        }

        const savedSession = saveOnlineSessionFromGameState(
          loadedRoom,
          loadedGameState.state.players,
          user.id,
        );

        if (!savedSession) {
          clearOnlineSession(roomCode);
          throw new Error(
            "This browser is not joined to this online game. Return to the lobby and join the room again.",
          );
        }

        setStoredOnlineSession(savedSession);
      } catch (error) {
        if (isActive) {
          if (isPermanentOnlineSessionError(error)) {
            clearOnlineSession(roomCode);
            setStoredOnlineSession(null);
            setRoom(null);
            setGameRow(null);
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

    void loadOnlineGame();

    return () => {
      isActive = false;
    };
  }, [
    isConfigured,
    loadGameState,
    loadRoom,
    loadRoomPlayers,
    roomCode,
    router,
    supabase,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPresenceNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (
      !supabase ||
      !room ||
      !storedOnlineSession ||
      storedOnlineSession.roomId !== room.id ||
      storedOnlineSession.userId !== currentUserId
    ) {
      return;
    }

    let isActive = true;
    const activeSession = storedOnlineSession;

    async function sendHeartbeat() {
      try {
        await heartbeatOnlineSession(supabase!, activeSession);
        setPresenceNowMs(Date.now());
      } catch (error) {
        if (!isActive) {
          return;
        }

        if (isPermanentOnlineSessionError(error)) {
          clearOnlineSession(activeSession.roomCode);
          setStoredOnlineSession(null);
          setRoom(null);
          setGameRow(null);
          setRoomPlayers([]);
          setErrorMessage(getSafeSupabaseErrorMessage(error));
        }
      }
    }

    void sendHeartbeat();

    const heartbeatIntervalId = window.setInterval(
      () => void sendHeartbeat(),
      ONLINE_HEARTBEAT_INTERVAL_MS,
    );

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", sendHeartbeat);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatIntervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", sendHeartbeat);
    };
  }, [currentUserId, room, storedOnlineSession, supabase]);

  useEffect(() => {
    if (
      !supabase ||
      !room ||
      !gameRow ||
      !gameState ||
      !gameState.turnDeadlineAt ||
      winnerPlayer ||
      !isTurnTimerExpired ||
      isExpiringTurn
    ) {
      return;
    }

    let isActive = true;
    const activeSupabase = supabase;
    const activeRoomId = room.id;
    const expectedVersion = gameRow.version;

    async function expireTurn() {
      setIsExpiringTurn(true);

      try {
        const { data, error } = await activeSupabase.rpc(
          "expire_online_turn",
          {
            expected_version: expectedVersion,
            target_room_id: activeRoomId,
          },
        );

        if (error) {
          throw error;
        }

        const parsedGameState = parseOnlineGameStateRow(data);

        if (!parsedGameState) {
          throw new Error("Online game state is invalid after timer expiry.");
        }

        if (isActive) {
          setGameRow(parsedGameState);
          setErrorMessage("");
        }
      } catch (error) {
        if (!isActive) {
          return;
        }

        if (!isExpectedTimerExpirationRace(error)) {
          setErrorMessage(getSafeSupabaseErrorMessage(error));
        }

        await loadGameState(activeRoomId).catch(() => undefined);
      } finally {
        if (isActive) {
          setIsExpiringTurn(false);
        }
      }
    }

    void expireTurn();

    return () => {
      isActive = false;
    };
  }, [
    gameRow,
    gameState,
    isExpiringTurn,
    isTurnTimerExpired,
    loadGameState,
    room,
    supabase,
    winnerPlayer,
  ]);

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
            if (isPermanentOnlineSessionError(error)) {
              clearOnlineSession(room.code);
              setStoredOnlineSession(null);
              setRoom(null);
              setGameRow(null);
            }

            setErrorMessage(getSafeSupabaseErrorMessage(error));
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `room_id=eq.${room.id}`,
          schema: "public",
          table: "room_players",
        },
        () => {
          void loadRoomPlayers(room.id).catch((error: unknown) => {
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
            if (isPermanentOnlineSessionError(error)) {
              clearOnlineSession(room.code);
              setStoredOnlineSession(null);
              setRoom(null);
              setGameRow(null);
            }

            setErrorMessage(getSafeSupabaseErrorMessage(error));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadGameState, loadRoom, loadRoomPlayers, room, supabase]);

  useEffect(() => {
    if (room && room.status !== "started") {
      router.replace(`/online/room/${room.code}`);
    }
  }, [room, router]);

  function exitGame() {
    clearOnlineSession(room?.code ?? roomCode);
    router.push("/");
  }

  function returnToLobby() {
    clearOnlineSession(room?.code ?? roomCode);
    router.push("/online");
  }

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

  async function leaveDetention() {
    if (!supabase || !room || !gameRow || !canLeaveDetention) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("leave_online_detention", {
        expected_version: gameRow.version,
        target_room_id: room.id,
      });

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error(
          "Online game state is invalid after leaving detention.",
        );
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  async function buySpace() {
    if (
      !supabase ||
      !room ||
      !gameRow ||
      !currentBuyableSpace ||
      gameState?.pendingPropertyPurchasePosition === null ||
      gameState?.pendingPropertyPurchasePosition === undefined ||
      !canBuySpace
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

  async function skipPurchase() {
    if (
      !supabase ||
      !room ||
      !gameRow ||
      !currentBuyableSpace ||
      gameState?.pendingPropertyPurchasePosition === null ||
      gameState?.pendingPropertyPurchasePosition === undefined ||
      !canSkipPurchase
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

  async function buildDevelopment(position: number) {
    if (!supabase || !room || !gameRow || !gameState || !localPlayer) {
      return;
    }

    const space = ONLINE_BOARD_SPACES[position];

    if (!isOnlinePropertySpace(space)) {
      return;
    }

    const buildStatus = getBuildActionStatus({
      gameState,
      isActing,
      isCurrentPlayer,
      isTurnTimerExpired,
      player: localPlayer,
      position,
      property: space,
    });

    if (!buildStatus.canAct) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "build_online_property_development",
        {
          expected_version: gameRow.version,
          property_position: position,
          target_room_id: room.id,
        },
      );

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid after building.");
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  async function sellDevelopment(position: number) {
    if (!supabase || !room || !gameRow || !gameState || !localPlayer) {
      return;
    }

    const space = ONLINE_BOARD_SPACES[position];

    if (!isOnlinePropertySpace(space)) {
      return;
    }

    const sellStatus = getSellActionStatus({
      gameState,
      isActing,
      isCurrentPlayer,
      isTurnTimerExpired,
      player: localPlayer,
      position,
      property: space,
    });

    if (!sellStatus.canAct) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "sell_online_property_development",
        {
          expected_version: gameRow.version,
          property_position: position,
          target_room_id: room.id,
        },
      );

      if (error) {
        throw error;
      }

      const parsedGameState = parseOnlineGameStateRow(data);

      if (!parsedGameState) {
        throw new Error("Online game state is invalid after selling.");
      }

      setGameRow(parsedGameState);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  async function playAgain() {
    if (!supabase || !room || !gameRow || !canPlayAgain) {
      return;
    }

    setIsActing(true);
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("restart_online_room", {
        expected_version: gameRow.version,
        target_room_id: room.id,
      });

      if (error) {
        throw error;
      }

      router.push(`/online/room/${room.code}`);
    } catch (error) {
      setErrorMessage(getSafeSupabaseErrorMessage(error));
      await loadGameState(room.id).catch(() => undefined);
    } finally {
      setIsActing(false);
    }
  }

  function closePropertiesModal() {
    setIsPropertiesModalOpen(false);
  }

  function handlePropertiesBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closePropertiesModal();
    }
  }

  function renderPurchasePanel(space: OnlineBuyableSpace) {
    if (!gameState || !currentPlayer) {
      return null;
    }

    const isTransit = isOnlineTransitSpace(space);
    const propertyGroup = isOnlinePropertySpace(space)
      ? getPropertyGroup(space.groupId)
      : null;
    const propertyDevelopmentLevel = isOnlinePropertySpace(space)
      ? getPropertyDevelopmentLevel(gameState, currentPlayer.position)
      : 0;
    const propertyRent = isOnlinePropertySpace(space)
      ? getDevelopedPropertyRent(gameState, currentPlayer.position, space)
      : 0;
    const isPendingPurchase =
      gameState.pendingPropertyPurchasePosition === currentPlayer.position;
    const owner = currentSpaceOwner;
    const transitRent =
      isTransit && owner
        ? getTransitRent(getOwnedTransitCount(gameState, owner.id))
        : ONLINE_TRANSIT_RENTS[1];
    const rentLabel = isTransit ? "Transit Rent" : "Rent";
    const rentValue = isOnlinePropertySpace(space)
      ? formatCurrency(propertyRent)
      : owner
        ? formatCurrency(transitRent)
        : formatTransitRentTiers();

    return (
      <div className="game-panel game-action-panel game-shadow-blue border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#3454d1] backdrop-blur">
        <h2 className="text-2xl font-black">
          {isTransit ? "Transit" : "Property"}
        </h2>

        <div className="mt-4 space-y-3 border-2 border-[#171915] bg-[#f7f8f4] p-3">
          <div>
            <p className="text-sm font-black uppercase text-[#596057]">
              Space
            </p>
            <p className="break-words text-xl font-black">{space.name}</p>
            {propertyGroup ? (
              <div className="mt-2 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-12 border-2 border-[#171915]"
                  style={{ backgroundColor: propertyGroup.color }}
                />
                <span className="text-xs font-black uppercase text-[#445045]">
                  {propertyGroup.name}
                </span>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                Price
              </p>
              <p className="text-lg font-black">
                {formatCurrency(space.price)}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-[#596057]">
                {rentLabel}
              </p>
              <p className="text-lg font-black">{rentValue}</p>
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
                ? isOnlinePropertySpace(space)
                  ? `${currentPlayer.name} already owns ${space.name} with ${getDevelopmentLabel(
                      propertyDevelopmentLevel,
                    )}.`
                  : `${currentPlayer.name} already owns ${space.name}.`
                : isTransit
                  ? `${space.name} is owned by ${owner.name}. ${currentPlayer.name} paid ${formatCurrency(
                      transitRent,
                    )} transit rent.`
                  : `${space.name} is owned by ${owner.name}. ${currentPlayer.name} paid ${formatCurrency(
                      propertyRent,
                    )} rent with ${getDevelopmentLabel(
                      propertyDevelopmentLevel,
                    )}.`}
            </p>
          ) : isPendingPurchase ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <button
                className="h-12 border-2 border-[#171915] bg-[#06d6a0] px-4 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                disabled={!canBuySpace}
                onClick={buySpace}
                type="button"
              >
                {isActing
                  ? "Buying..."
                  : isTransit
                    ? "Buy Transit"
                    : "Buy Property"}
              </button>

              <button
                className="h-12 border-2 border-[#171915] bg-[#f7f8f4] px-4 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                disabled={!canSkipPurchase}
                onClick={skipPurchase}
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
    const isActive =
      !player.isEliminated && playerIndex === gameState?.currentPlayerIndex;
    const isLocalPlayer = player.userId === currentUserId;
    const roomPlayer = roomPlayers.find((candidatePlayer) => {
      return candidatePlayer.id === player.id;
    });
    const connectionStatus = getOnlineConnectionStatus(
      roomPlayer?.last_seen_at,
      presenceNowMs,
    );

    return (
      <div
        className={`game-player-card flex items-center gap-3 border-2 border-[#171915] p-3 ${
          player.isEliminated
            ? "bg-[#ffedf2] opacity-80"
            : isActive
            ? "bg-[#f9c74f] shadow-[5px_5px_0_0_#171915]"
            : "bg-[#f7f8f4]"
        }`}
        key={player.id}
      >
        <span
          aria-hidden="true"
          className="game-player-token h-6 w-6 shrink-0 rounded-full border-2 border-[#171915]"
          style={{ backgroundColor: player.color }}
        />
        <div className="min-w-0 flex-1">
          <p className="game-player-name break-words text-base font-black">
            {player.name}
          </p>
          <p className="game-player-meta text-sm font-bold text-[#445045]">
            {formatCurrency(player.balance)}
          </p>
          {isLocalPlayer ? (
            <p className="game-player-meta mt-1 text-xs font-black uppercase text-[#596057]">
              You
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isActive ? (
            <span className="game-status-badge border-2 border-[#171915] bg-white px-2 py-1 text-[0.62rem] font-black uppercase">
              Current
            </span>
          ) : null}
          <span
            className={`game-status-badge border-2 border-[#171915] px-2 py-1 text-[0.62rem] font-black uppercase ${getConnectionStatusClassName(
              connectionStatus,
            )}`}
          >
            {connectionStatus}
          </span>
          {player.isDetained ? (
            <span className="game-status-badge border-2 border-[#171915] bg-[#ffedf2] px-2 py-1 text-[0.62rem] font-black uppercase">
              Detained
            </span>
          ) : null}
          {player.isEliminated ? (
            <span className="game-status-badge border-2 border-[#171915] bg-[#171915] px-2 py-1 text-[0.62rem] font-black uppercase text-white">
              Bankrupt
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <main className="game-screen online-game-screen relative min-h-screen overflow-hidden bg-[#f7f8f4] px-5 py-8 text-[#171915] sm:px-8 sm:py-12">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.05)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.05)_1px,transparent_1px)] bg-[size:44px_44px]"
      />
      <div
        aria-hidden="true"
        className="absolute -left-40 top-20 h-[440px] w-[440px] rotate-45 border-[16px] border-[#171915] opacity-[0.04]"
      />

      <section className="game-shell relative z-10 mx-auto grid w-full max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="game-board-column">
          <div className="game-header mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p
                className="game-title-accent mb-4 h-1.5 w-24 bg-[#06d6a0]"
                aria-hidden="true"
              />
              <h1 className="game-title text-4xl font-black tracking-normal sm:text-6xl">
                Property Empire
              </h1>
            </div>
            <p className="game-status-pill w-fit border-2 border-[#171915] bg-white px-4 py-2 text-sm font-black shadow-[5px_5px_0_0_#43aa8b]">
              {room ? `Room: ${room.code}` : "Online Game"}
            </p>
          </div>

          {winnerPlayer ? (
            <div className="game-panel game-action-panel game-winner-panel game-shadow-green mb-6 border-2 border-[#171915] bg-[#e7fbf4] p-5 shadow-[10px_10px_0_0_#06d6a0]">
              <p className="text-sm font-black uppercase text-[#596057]">
                Winner
              </p>
              <h2 className="mt-2 break-words text-4xl font-black tracking-normal sm:text-5xl">
                {winnerPlayer.name}
              </h2>
              <p className="mt-3 text-lg font-bold text-[#445045]">
                Final balance: {formatCurrency(winnerPlayer.balance)}
              </p>
              {isHost ? (
                <button
                  className="mt-5 h-12 border-2 border-[#171915] bg-[#06d6a0] px-6 text-sm font-black text-[#171915] shadow-[6px_6px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
                  disabled={!canPlayAgain}
                  onClick={playAgain}
                  type="button"
                >
                  {isActing ? "Resetting..." : "Play Again"}
                </button>
              ) : (
                <p className="mt-5 border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
                  Waiting for the host to start a new lobby.
                </p>
              )}
            </div>
          ) : null}

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
              {isReconnecting ? "Reconnecting..." : "Loading online game"}
            </p>
          ) : errorMessage && !gameState ? (
            <div className="border-2 border-[#171915] bg-[#ffedf2] p-4 shadow-[8px_8px_0_0_#ef476f]">
              <h2 className="text-2xl font-black">Online Game Error</h2>
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
          ) : gameState ? (
            <div className="game-board-scroll overflow-x-auto pb-4">
              <div className="game-board grid aspect-square min-w-[620px] grid-cols-7 grid-rows-7 border-2 border-[#171915] bg-[#171915] shadow-[12px_12px_0_0_#f9c74f]">
                {ONLINE_BOARD_SPACES.map((space, index) => {
                  const styles = onlineSpaceStyles[space.type];
                  const propertyGroup = isOnlinePropertySpace(space)
                    ? getPropertyGroup(space.groupId)
                    : null;
                  const developmentLevel = isOnlinePropertySpace(space)
                    ? getPropertyDevelopmentLevel(gameState, index)
                    : 0;
                  const propertyRent = isOnlinePropertySpace(space)
                    ? getDevelopedPropertyRent(gameState, index, space)
                    : 0;
                  const spaceOwner = isOnlineBuyableSpace(space)
                    ? getSpaceOwner(gameState, index)
                    : null;
                  const ownerFlagSide = getBoardSide(index);
                  const transitRent =
                    isOnlineTransitSpace(space) && spaceOwner
                      ? getTransitRent(
                          getOwnedTransitCount(gameState, spaceOwner.id),
                        )
                      : ONLINE_TRANSIT_RENTS[1];
                  const playersOnSpace = gameState.players.filter(
                    (player) =>
                      !player.isEliminated && player.position === index,
                  );

                  return (
                    <div
                      className="game-board-space relative flex min-h-0 flex-col justify-between border border-[#171915] p-1.5 text-[#171915]"
                      key={space.name}
                      style={{
                        ...getBoardPosition(index),
                        backgroundColor: styles.tint,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="game-board-accent absolute inset-x-0 top-0 h-1.5"
                        style={{
                          backgroundColor: propertyGroup?.color ?? styles.accent,
                        }}
                      />
                      <span className="game-board-space-name pt-2 text-[0.66rem] font-black uppercase leading-tight sm:text-xs">
                        {space.name}
                      </span>
                      <span className="game-board-space-label text-[0.52rem] font-bold uppercase leading-tight text-[#596057] sm:text-[0.62rem]">
                        {styles.label}
                      </span>
                      {propertyGroup ? (
                        <span
                          className="game-board-space-meta mt-1 block truncate border border-[#171915] px-1 py-0.5 text-[0.48rem] font-black uppercase leading-tight text-white sm:text-[0.55rem]"
                          style={{ backgroundColor: propertyGroup.color }}
                          title={propertyGroup.name}
                        >
                          {propertyGroup.name}
                        </span>
                      ) : null}

                      {isOnlineBuyableSpace(space) ? (
                        <div className="mt-1 space-y-0.5">
                          <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                            Price {formatCurrency(space.price)}
                          </span>
                          <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                            {isOnlineTransitSpace(space)
                              ? `Rent ${
                                  spaceOwner
                                    ? formatCurrency(transitRent)
                                    : formatTransitRentTiers("/")
                                }`
                              : `Rent ${formatCurrency(propertyRent)}`}
                          </span>
                          {isOnlinePropertySpace(space) && spaceOwner ? (
                            <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              {getDevelopmentLabel(developmentLevel)}
                            </span>
                          ) : null}
                          {isOnlineTransitSpace(space) && spaceOwner ? (
                            <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              {getOwnedTransitCount(gameState, spaceOwner.id)}{" "}
                              station
                              {getOwnedTransitCount(gameState, spaceOwner.id) ===
                              1
                                ? ""
                                : "s"}
                            </span>
                          ) : null}
                        </div>
                      ) : isOnlineTaxSpace(space) ? (
                        <div className="game-board-space-meta mt-1 text-[0.55rem] font-black leading-tight text-[#445045] sm:text-[0.62rem]">
                          Pay {formatCurrency(space.taxAmount)}
                        </div>
                      ) : null}

                      {isOnlinePropertySpace(space)
                        ? renderDevelopmentMarkers(developmentLevel)
                        : null}

                      {isOnlineBuyableSpace(space) && spaceOwner ? (
                        <span
                          aria-label={`Owned by ${spaceOwner.name}`}
                          className={`game-board-owner-flag game-board-owner-flag-${ownerFlagSide}`}
                          role="img"
                          style={
                            {
                              "--owner-flag-color": spaceOwner.color,
                            } as CSSProperties
                          }
                          title={`Owned by ${spaceOwner.name}`}
                        />
                      ) : null}

                      {playersOnSpace.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {playersOnSpace.map((player) => (
                            <span
                              aria-label={`${player.name} token`}
                              className="game-board-token h-4 w-4 rounded-full border-2 border-[#171915] sm:h-5 sm:w-5"
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
                  className="game-board-center flex flex-col items-center justify-center border-2 border-[#171915] bg-[#171915] p-6 text-center text-white"
                  style={{ gridColumn: "2 / 7", gridRow: "2 / 7" }}
                >
                  <p
                    className="game-board-center-accent mb-4 h-1.5 w-24 bg-[#ef476f]"
                    aria-hidden="true"
                  />
                  <h2 className="game-board-center-title text-4xl font-black tracking-normal sm:text-6xl">
                    Online City
                  </h2>
                  <p className="game-board-center-copy mt-4 max-w-md text-base font-bold leading-7 text-[#f7f8f4] sm:text-lg">
                    Pass or land on Grand Plaza to collect{" "}
                    {formatCurrency(CITY_LAUNCH_BONUS)}.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="game-sidebar online-game-sidebar space-y-5">
          <div className="game-panel game-players-panel game-shadow-green border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#06d6a0] backdrop-blur">
            <h2 className="game-panel-title text-2xl font-black">Players</h2>

            <div className="game-players-list mt-4 space-y-3">
              {gameState ? (
                gameState.players.map(renderPlayerCard)
              ) : (
                <p className="border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold">
                  Waiting for game state
                </p>
              )}
            </div>
          </div>

          <div className="game-panel game-activity-panel game-shadow-blue border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#3454d1] backdrop-blur">
            <h2 className="game-panel-title text-2xl font-black">Game Activity</h2>

            <div className="game-activity-list mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {gameState && gameState.activityLog.length > 0 ? (
                gameState.activityLog.map((entry) => (
                  <div
                    className="game-activity-entry border-2 border-[#171915] bg-[#f7f8f4] p-3"
                    key={entry.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="break-words text-sm font-black">
                        {entry.playerName}
                      </p>
                      <p className="shrink-0 text-xs font-black uppercase text-[#596057]">
                        {formatActivityTime(entry.createdAt)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm font-bold leading-6 text-[#445045]">
                      {entry.message}
                    </p>
                  </div>
                ))
              ) : (
                <p className="border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold">
                  Waiting for activity
                </p>
              )}
            </div>
          </div>

          <div className="game-panel game-dice-panel game-shadow-yellow border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#f9c74f] backdrop-blur">
            <h2 className="game-panel-title text-2xl font-black">Dice</h2>

            <div className="game-dice-grid mt-4 grid grid-cols-3 gap-3">
              <div className="game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black">
                {gameState?.lastRoll?.dieOne ?? "-"}
              </div>
              <div className="game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black">
                {gameState?.lastRoll?.dieTwo ?? "-"}
              </div>
              <div className="game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#171915] text-3xl font-black text-white">
                {gameState?.lastRoll?.total ?? "-"}
              </div>
            </div>

            <p className="game-message mt-4 border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold leading-6 text-[#445045]">
              {errorMessage || gameState?.message || "Loading online turn"}
            </p>
          </div>

          {gameState?.hasRolledThisTurn &&
          !isGameOver &&
          currentBuyableSpace &&
          !gameState.lastEventCard
            ? renderPurchasePanel(currentBuyableSpace)
            : null}

          {gameState?.lastEventCard ? (
            <div className="game-panel game-action-panel game-shadow-orange border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#f8961e] backdrop-blur">
              <h2 className="text-2xl font-black">Event</h2>

              <div className="mt-4 space-y-3 border-2 border-[#171915] bg-[#fff1de] p-3">
                <div>
                  <p className="text-sm font-black uppercase text-[#596057]">
                    Card
                  </p>
                  <p className="break-words text-xl font-black">
                    {gameState.lastEventCard.title}
                  </p>
                </div>

                <p className="border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
                  {gameState.lastEventCard.description}
                </p>

                <div>
                  <p className="text-xs font-black uppercase text-[#596057]">
                    Result
                  </p>
                  <p className="mt-1 border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
                    {gameState.lastEventCard.result}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="game-panel game-turn-panel game-shadow-cyan border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#118ab2] backdrop-blur">
            <h2 className="game-panel-title text-2xl font-black">Turn</h2>

            <div className="mt-4 space-y-3 border-2 border-[#171915] bg-[#f7f8f4] p-3">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase text-[#596057]">
                    Turn Timer
                  </p>
                  <span
                    className={`border-2 border-[#171915] px-2 py-1 text-xs font-black uppercase ${
                      isTurnTimerExpired
                        ? "bg-[#ffedf2]"
                        : hasActiveTurnTimer
                          ? "bg-[#e7fbf4]"
                          : "bg-white"
                    }`}
                  >
                    {isTurnTimerExpired
                      ? isExpiringTurn
                        ? "Resolving"
                        : "Expired"
                      : hasActiveTurnTimer
                        ? "Live"
                        : "Paused"}
                  </span>
                </div>
                <p className="mt-1 text-3xl font-black">
                  {formatTurnTimer(remainingTurnSeconds)}
                </p>
                <div className="mt-2 h-3 border-2 border-[#171915] bg-white">
                  <div
                    className="h-full bg-[#06d6a0] transition-[width] duration-500"
                    style={{ width: `${turnTimerProgress}%` }}
                  />
                </div>
              </div>

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
                  {localPlayer?.name ??
                    storedOnlineSession?.displayName ??
                    "Not joined"}
                </p>
                {localSeatNumber ? (
                  <p className="mt-1 text-xs font-black uppercase text-[#596057]">
                    Seat {localSeatNumber}
                  </p>
                ) : null}
              </div>
              <p className="text-sm font-bold leading-6 text-[#445045]">
                {winnerPlayer
                  ? `${winnerPlayer.name} has won the game.`
                  : isCurrentPlayer
                    ? isDetentionTurn
                      ? "Leave Civic Detention to miss this turn."
                      : hasPendingPropertyPurchase
                        ? "Buy or skip the space before ending your turn."
                        : gameState?.hasRolledThisTurn
                          ? "End your turn when ready."
                          : "Your turn to roll."
                    : currentPlayer
                      ? isDetentionTurn
                        ? `Waiting for ${currentPlayer.name} to leave Civic Detention.`
                        : hasPendingPropertyPurchase
                          ? `Waiting for ${currentPlayer.name} to decide on a space.`
                          : `Waiting for ${currentPlayer.name}.`
                      : "Waiting for game state."}
              </p>
            </div>
          </div>

          <div className="game-buttons grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
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

            {isDetentionTurn ? (
              <button
                className="h-14 border-2 border-[#171915] bg-[#f9c74f] px-6 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#f9c74f]/45 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
                disabled={!canLeaveDetention}
                onClick={leaveDetention}
                type="button"
              >
                {isActing ? "Leaving..." : "Leave Detention"}
              </button>
            ) : null}

            <button
              className="flex h-14 items-center justify-center gap-2 border-2 border-[#171915] bg-white px-4 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
              disabled={!gameState || !localPlayer || isActing}
              onClick={() => setIsPropertiesModalOpen(true)}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeLinecap="square"
                strokeLinejoin="miter"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path d="M4 20V9l8-5 8 5v11" />
                <path d="M8 20v-6h8v6" />
                <path d="M7 10h2" />
                <path d="M15 10h2" />
              </svg>
              <span>My Properties</span>
              <span className="rounded-full border-2 border-[#171915] bg-[#f9c74f] px-2 py-0.5 text-xs font-black leading-none">
                {ownedPropertyCount}
              </span>
            </button>

            <button
              className="h-14 border-2 border-[#171915] bg-[#ef476f] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
              onClick={exitGame}
              type="button"
            >
              Exit Game
            </button>
          </div>

          <p className="game-footer border-2 border-[#171915] bg-white/90 p-3 text-sm font-bold text-[#445045] shadow-[5px_5px_0_0_#43aa8b]">
            All players began with {formatCurrency(STARTING_BALANCE)} at Grand
            Plaza. Version {gameRow?.version ?? "-"} of the shared game is
            loaded.
          </p>

          {gameState?.boardSpaceCount !== undefined &&
          gameState.boardSpaceCount !== BOARD_SPACE_COUNT ? (
            <p className="game-footer border-2 border-[#171915] bg-[#ffedf2] p-3 text-sm font-bold text-[#445045] shadow-[5px_5px_0_0_#ef476f]">
              Board state does not match this app version.
            </p>
          ) : null}
        </aside>
      </section>

      {isPropertiesModalOpen && gameState && localPlayer ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#171915]/60 px-4 py-6 backdrop-blur-sm"
          onMouseDown={handlePropertiesBackdropMouseDown}
        >
          <section
            aria-labelledby="online-my-properties-title"
            aria-modal="true"
            className="game-properties-modal flex max-h-[min(88vh,760px)] w-full max-w-5xl flex-col border-2 border-[#171915] bg-white shadow-[12px_12px_0_0_#06d6a0]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#171915] bg-[#f7f8f4] p-4">
              <div>
                <p className="text-sm font-black uppercase text-[#596057]">
                  {localPlayer.name}
                </p>
                <h2
                  className="text-3xl font-black leading-none"
                  id="online-my-properties-title"
                >
                  My Properties
                </h2>
              </div>

              <button
                className="h-11 border-2 border-[#171915] bg-white px-4 text-sm font-black text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
                onClick={closePropertiesModal}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="game-properties-modal-body flex-1 overflow-y-auto p-4">
              {ownedPropertyGroups.length === 0 ? (
                <div className="border-2 border-[#171915] bg-[#f7f8f4] p-5">
                  <p className="text-xl font-black">
                    No properties owned yet.
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#445045]">
                    Buy a property during your online turn to start developing
                    a color group.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {ownedPropertyGroups.map(
                    ({ group, ownershipProgress, properties }) => (
                      <section
                        className="border-2 border-[#171915] bg-[#f7f8f4]"
                        key={group.id}
                      >
                        <div className="flex flex-col gap-3 border-b-2 border-[#171915] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="break-words text-xl font-black">
                              {group.name}
                            </p>
                            <p className="mt-1 text-xs font-black uppercase text-[#596057]">
                              {ownershipProgress}
                            </p>
                          </div>
                          <span
                            aria-hidden="true"
                            className="h-5 w-full border-2 border-[#171915] sm:w-20"
                            style={{ backgroundColor: group.color }}
                          />
                        </div>

                        <div className="grid gap-3 p-3 lg:grid-cols-2">
                          {properties.map(({ position, space }) => {
                            const level = getPropertyDevelopmentLevel(
                              gameState,
                              position,
                            );
                            const nextLevel = getNextDevelopmentLevel(level);
                            const currentRent = getDevelopedPropertyRent(
                              gameState,
                              position,
                              space,
                            );
                            const nextRent =
                              nextLevel === null
                                ? null
                                : getPropertyRent(position, nextLevel);
                            const buildStatus = getBuildActionStatus({
                              gameState,
                              isActing,
                              isCurrentPlayer,
                              isTurnTimerExpired,
                              player: localPlayer,
                              position,
                              property: space,
                            });
                            const sellStatus = getSellActionStatus({
                              gameState,
                              isActing,
                              isCurrentPlayer,
                              isTurnTimerExpired,
                              player: localPlayer,
                              position,
                              property: space,
                            });

                            return (
                              <article
                                className="border-2 border-[#171915] bg-white p-3"
                                key={space.name}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="break-words text-lg font-black">
                                      {space.name}
                                    </p>
                                    <p className="mt-1 text-xs font-black uppercase text-[#596057]">
                                      {group.name}
                                    </p>
                                  </div>
                                  <span
                                    aria-hidden="true"
                                    className="h-5 w-12 shrink-0 border-2 border-[#171915]"
                                    style={{ backgroundColor: group.color }}
                                  />
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-[#445045]">
                                  <p>
                                    <span className="block text-xs font-black uppercase text-[#596057]">
                                      Development
                                    </span>
                                    {getDevelopmentLabel(level)}
                                  </p>
                                  <p>
                                    <span className="block text-xs font-black uppercase text-[#596057]">
                                      Current Rent
                                    </span>
                                    {formatCurrency(currentRent)}
                                  </p>
                                  <p>
                                    <span className="block text-xs font-black uppercase text-[#596057]">
                                      Next Rent
                                    </span>
                                    {nextRent === null
                                      ? "Maxed"
                                      : formatCurrency(nextRent)}
                                  </p>
                                  <p>
                                    <span className="block text-xs font-black uppercase text-[#596057]">
                                      Build Cost
                                    </span>
                                    {formatCurrency(group.buildCost)}
                                  </p>
                                  <p>
                                    <span className="block text-xs font-black uppercase text-[#596057]">
                                      Sell Value
                                    </span>
                                    {formatCurrency(
                                      getDevelopmentSaleValue(group),
                                    )}
                                  </p>
                                  <p>
                                    <span className="block text-xs font-black uppercase text-[#596057]">
                                      Ownership
                                    </span>
                                    {ownershipProgress}
                                  </p>
                                </div>

                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <button
                                    className="min-h-11 border-2 border-[#171915] bg-[#06d6a0] px-3 py-2 text-sm font-black text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                                    disabled={!buildStatus.canAct}
                                    onClick={() => buildDevelopment(position)}
                                    type="button"
                                  >
                                    {isActing ? "Submitting..." : buildStatus.label}
                                  </button>

                                  <button
                                    className="min-h-11 border-2 border-[#171915] bg-white px-3 py-2 text-sm font-black text-[#171915] shadow-[4px_4px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                                    disabled={!sellStatus.canAct}
                                    onClick={() => sellDevelopment(position)}
                                    type="button"
                                  >
                                    {isActing ? "Submitting..." : sellStatus.label}
                                  </button>
                                </div>

                                {buildStatus.reason || sellStatus.reason ? (
                                  <div className="mt-3 space-y-2 text-xs font-bold leading-5 text-[#596057]">
                                    {buildStatus.reason ? (
                                      <p>Build unavailable: {buildStatus.reason}</p>
                                    ) : null}
                                    {sellStatus.reason ? (
                                      <p>Sell unavailable: {sellStatus.reason}</p>
                                    ) : null}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ),
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
