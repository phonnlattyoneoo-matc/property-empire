"use client";

import { useParams, useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_SPACE_COUNT,
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
  type OnlineDiceRoll,
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
type InteractionPhase = "idle" | "rolling" | "moving" | "resolving";

type DevelopmentActionStatus = {
  canAct: boolean;
  label: string;
  nextLevel: PropertyDevelopmentLevel | null;
  reason: string | null;
};

type ResultPopup = {
  accentColor: string;
  balance: number;
  explanation: string;
  id: number;
  moneyChange: number;
  resultType: string;
  title: string;
};

type RentAnimation = {
  developmentLabel: string | null;
  id: number;
  isTransit: boolean;
  ownerColor: string;
  ownerName: string;
  payingPlayerBalance: number;
  payingPlayerColor: string;
  payingPlayerName: string;
  position: number;
  propertyGroupColor: string | null;
  propertyGroupName: string | null;
  rentAmount: number;
  spaceName: string;
};

type LandingToast = {
  accentColor: string;
  id: number;
  message: string;
  title: string;
  type: string;
};

const DICE_ANIMATION_DURATION_MS = 960;
const REDUCED_DICE_ANIMATION_DURATION_MS = 180;
const DICE_ANIMATION_FRAME_MS = 72;
const TOKEN_STEP_DURATION_MS = 210;
const REDUCED_TOKEN_STEP_DURATION_MS = 70;
const RENT_ANIMATION_DURATION_MS = 2200;
const LANDING_TOAST_DURATION_MS = 3800;
const DIE_FACE_VALUES = [1, 2, 3, 4, 5, 6] as const;
const DIE_FACE_CLASS_NAMES: Record<number, string> = {
  1: "online-die-face-front",
  2: "online-die-face-right",
  3: "online-die-face-top",
  4: "online-die-face-bottom",
  5: "online-die-face-left",
  6: "online-die-face-back",
};
const DIE_PIP_POSITIONS: Record<number, string[]> = {
  1: ["center"],
  2: ["top-left", "bottom-right"],
  3: ["top-left", "center", "bottom-right"],
  4: ["top-left", "top-right", "bottom-left", "bottom-right"],
  5: ["top-left", "top-right", "center", "bottom-left", "bottom-right"],
  6: [
    "top-left",
    "top-right",
    "middle-left",
    "middle-right",
    "bottom-left",
    "bottom-right",
  ],
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

function rollDicePair(): OnlineDiceRoll {
  const dieOne = rollDie();
  const dieTwo = rollDie();

  return {
    dieOne,
    dieTwo,
    total: dieOne + dieTwo,
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getWrappedPosition(position: number) {
  return (
    ((position % BOARD_SPACE_COUNT) + BOARD_SPACE_COUNT) % BOARD_SPACE_COUNT
  );
}

function getClockwiseMovementDistance(
  startPosition: number,
  endPosition: number,
) {
  return getWrappedPosition(endPosition - startPosition);
}

function getClockwiseMovementPath(
  startPosition: number,
  endPosition: number,
) {
  const distance = getClockwiseMovementDistance(startPosition, endPosition);

  return Array.from({ length: distance }, (_, stepIndex) =>
    getWrappedPosition(startPosition + stepIndex + 1),
  );
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

function renderDiePips(value: number) {
  const safeValue = Math.min(6, Math.max(1, Math.round(value)));

  return (
    <span className="online-die-pips" aria-hidden="true">
      {DIE_PIP_POSITIONS[safeValue].map((position) => (
        <span
          className={`online-die-pip online-die-pip-${position}`}
          key={position}
        />
      ))}
    </span>
  );
}

function renderOnlineDie({
  dieIndex,
  isRolling,
  label,
  value,
}: {
  dieIndex: 1 | 2;
  isRolling: boolean;
  label: string;
  value: number;
}) {
  const safeValue = Math.min(6, Math.max(1, Math.round(value)));

  return (
    <span
      aria-label={`${label}: ${safeValue}`}
      className={`online-die online-die-${dieIndex} online-die-value-${safeValue} ${
        isRolling ? "online-die-rolling" : ""
      }`}
      role="img"
    >
      <span className="online-die-cube">
        {DIE_FACE_VALUES.map((faceValue) => (
          <span
            className={`online-die-face ${DIE_FACE_CLASS_NAMES[faceValue]}`}
            key={faceValue}
          >
            {renderDiePips(faceValue)}
          </span>
        ))}
      </span>
    </span>
  );
}

function getConfirmedRollActor({
  nextState,
  previousState,
}: {
  nextState: OnlineGameState;
  previousState: OnlineGameState;
}) {
  const previousPlayer = previousState.players[previousState.currentPlayerIndex];

  if (!previousPlayer) {
    return null;
  }

  const nextPlayer = nextState.players.find((player) => {
    return player.id === previousPlayer.id;
  });

  if (!nextPlayer) {
    return null;
  }

  return {
    nextPlayer,
    previousPlayer,
  };
}

function isConfirmedRollUpdate({
  nextState,
  previousState,
}: {
  nextState: OnlineGameState;
  previousState: OnlineGameState;
}) {
  return (
    !previousState.hasRolledThisTurn &&
    nextState.hasRolledThisTurn &&
    previousState.lastRoll === null &&
    nextState.lastRoll !== null
  );
}

function createBlockingResultPopupFromConfirmedRoll({
  nextState,
  previousState,
}: {
  nextState: OnlineGameState;
  previousState: OnlineGameState;
}): Omit<ResultPopup, "id"> | null {
  const actor = getConfirmedRollActor({ nextState, previousState });

  if (!actor) {
    return null;
  }

  const { nextPlayer, previousPlayer } = actor;
  const moneyChange = nextPlayer.balance - previousPlayer.balance;
  const basePopup = {
    balance: nextPlayer.balance,
    explanation: nextState.message,
    moneyChange,
  };

  if (nextState.winnerPlayerId) {
    const winner = nextState.players.find((player) => {
      return player.id === nextState.winnerPlayerId;
    });

    return {
      ...basePopup,
      accentColor: "#06d6a0",
      resultType: "Winner",
      title: winner ? `${winner.name} Wins` : "Winner",
    };
  }

  if (nextPlayer.isEliminated && !previousPlayer.isEliminated) {
    return {
      ...basePopup,
      accentColor: "#ef476f",
      resultType: "Bankruptcy",
      title: `${nextPlayer.name} Bankrupt`,
    };
  }

  return null;
}

function createRentAnimationFromConfirmedRoll({
  nextState,
  previousState,
}: {
  nextState: OnlineGameState;
  previousState: OnlineGameState;
}): Omit<RentAnimation, "id"> | null {
  const actor = getConfirmedRollActor({ nextState, previousState });

  if (!actor) {
    return null;
  }

  const { nextPlayer } = actor;
  const position = nextPlayer.position;
  const destination = ONLINE_BOARD_SPACES[position];

  if (!isOnlineBuyableSpace(destination)) {
    return null;
  }

  const ownerId = nextState.propertyOwners[String(position)];

  if (!ownerId || ownerId === nextPlayer.id) {
    return null;
  }

  const previousOwner = previousState.players.find((player) => {
    return player.id === ownerId;
  });
  const nextOwner = nextState.players.find((player) => {
    return player.id === ownerId;
  });

  if (!previousOwner || !nextOwner) {
    return null;
  }

  const rentAmount = nextOwner.balance - previousOwner.balance;

  if (rentAmount <= 0) {
    return null;
  }

  const propertyGroup = isOnlinePropertySpace(destination)
    ? getPropertyGroup(destination.groupId)
    : null;
  const developmentLevel = isOnlinePropertySpace(destination)
    ? getPropertyDevelopmentLevel(nextState, position)
    : 0;

  return {
    developmentLabel: isOnlinePropertySpace(destination)
      ? getDevelopmentLabel(developmentLevel)
      : null,
    isTransit: isOnlineTransitSpace(destination),
    ownerColor: nextOwner.color,
    ownerName: nextOwner.name,
    payingPlayerBalance: nextPlayer.balance,
    payingPlayerColor: nextPlayer.color,
    payingPlayerName: nextPlayer.name,
    position,
    propertyGroupColor: propertyGroup?.color ?? null,
    propertyGroupName: propertyGroup?.name ?? null,
    rentAmount,
    spaceName: destination.name,
  };
}

function createLandingToastFromConfirmedRoll({
  nextState,
  previousState,
}: {
  nextState: OnlineGameState;
  previousState: OnlineGameState;
}): Omit<LandingToast, "id"> | null {
  const actor = getConfirmedRollActor({ nextState, previousState });

  if (!actor) {
    return null;
  }

  const { nextPlayer, previousPlayer } = actor;
  const destination = ONLINE_BOARD_SPACES[nextPlayer.position];
  const normalizedMessage = nextState.message.toLowerCase();
  const hasPendingPurchase =
    nextState.pendingPropertyPurchasePosition !== null &&
    nextState.pendingPropertyPurchasePosition !== undefined;

  if (nextState.winnerPlayerId || nextPlayer.isEliminated) {
    return null;
  }

  if (nextState.lastEventCard) {
    return {
      accentColor: onlineSpaceStyles.event.accent,
      message: `${nextState.lastEventCard.description} ${nextState.lastEventCard.result}`,
      title: nextState.lastEventCard.title,
      type: "Event",
    };
  }

  if (
    isOnlineTaxSpace(destination) ||
    normalizedMessage.includes(" city tax") ||
    normalizedMessage.includes(" grid levy")
  ) {
    return {
      accentColor: onlineSpaceStyles.tax.accent,
      message: nextState.message,
      title: destination.name,
      type: "Tax",
    };
  }

  if (
    destination.type === "detention" ||
    normalizedMessage.includes("detention")
  ) {
    return {
      accentColor: onlineSpaceStyles.detention.accent,
      message: nextState.message,
      title: "Civic Detention",
      type: "Detention",
    };
  }

  if (destination.type === "rest" || normalizedMessage.includes("rooftop rest")) {
    return {
      accentColor: onlineSpaceStyles.rest.accent,
      message: nextState.message,
      title: "Rooftop Rest",
      type: "Rest Area",
    };
  }

  if (normalizedMessage.includes("city launch bonus")) {
    return {
      accentColor: onlineSpaceStyles.start.accent,
      message: nextState.message,
      title: "Grand Plaza Bonus",
      type: "Bonus",
    };
  }

  if (hasPendingPurchase || isOnlineBuyableSpace(destination)) {
    return null;
  }

  if (nextPlayer.balance !== previousPlayer.balance) {
    return {
      accentColor: onlineSpaceStyles[destination.type].accent,
      message: nextState.message,
      title: destination.name,
      type: "Result",
    };
  }

  return null;
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
  const animationSequenceRef = useRef(0);
  const dicePreviewIntervalRef = useRef<number | null>(null);
  const gameRowRef = useRef<OnlineGameStateRow | null>(null);
  const landingToastTimeoutRef = useRef<number | null>(null);
  const lastAnimatedVersionRef = useRef<number | null>(null);
  const rentAnimationTimeoutRef = useRef<number | null>(null);
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
  const [animatedDiceRoll, setAnimatedDiceRoll] =
    useState<OnlineDiceRoll | null>(null);
  const [animatedPlayerPositions, setAnimatedPlayerPositions] = useState<
    Record<string, number>
  >({});
  const [highlightedBoardPosition, setHighlightedBoardPosition] = useState<
    number | null
  >(null);
  const [interactionPhase, setInteractionPhase] =
    useState<InteractionPhase>("idle");
  const [landingToast, setLandingToast] = useState<LandingToast | null>(null);
  const [rentAnimation, setRentAnimation] = useState<RentAnimation | null>(
    null,
  );
  const [resultPopup, setResultPopup] = useState<ResultPopup | null>(null);
  const [isLoading, setIsLoading] = useState(isConfigured);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isPropertiesModalOpen, setIsPropertiesModalOpen] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isExpiringTurn, setIsExpiringTurn] = useState(false);

  const gameState = gameRow?.state ?? null;
  const isInteractionLocked =
    isActing ||
    isExpiringTurn ||
    interactionPhase !== "idle" ||
    resultPopup !== null;
  const displayedDiceRoll =
    animatedDiceRoll ??
    (interactionPhase === "rolling" ? null : gameState?.lastRoll);
  const displayedDieOne = displayedDiceRoll?.dieOne ?? 1;
  const displayedDieTwo = displayedDiceRoll?.dieTwo ?? 1;
  const isDiceRolling =
    interactionPhase === "rolling" ||
    (isActing &&
      gameState?.hasRolledThisTurn !== true &&
      !gameState?.winnerPlayerId);
  const activityEntryCount = gameState?.activityLog.length ?? 0;
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
    !isInteractionLocked;
  const canEndTurn =
    Boolean(room && gameRow && isCurrentPlayer) &&
    !isGameOver &&
    Boolean(gameState?.hasRolledThisTurn) &&
    !isDetentionTurn &&
    !hasPendingPropertyPurchase &&
    !isTurnTimerExpired &&
    !isInteractionLocked;
  const canLeaveDetention =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    !isGameOver &&
    isDetentionTurn &&
    currentPlayer!.isDetained &&
    !isTurnTimerExpired &&
    !isInteractionLocked;
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
    !isInteractionLocked;
  const canSkipPurchase =
    Boolean(room && gameRow && isCurrentPlayer && currentPlayer) &&
    !isGameOver &&
    hasPendingPropertyPurchase &&
    currentBuyableSpace !== null &&
    currentSpaceOwner === null &&
    !isDetentionTurn &&
    currentPlayer!.position === gameState?.pendingPropertyPurchasePosition &&
    !isTurnTimerExpired &&
    !isInteractionLocked;
  const canPlayAgain =
    Boolean(room && gameRow && isHost && winnerPlayer) && !isInteractionLocked;
  const diceStatusText = errorMessage
    ? errorMessage
    : !gameState
      ? "Loading the shared game."
      : isDiceRolling
        ? "Rolling the city dice."
        : canRoll
          ? "Click the dice to roll."
          : winnerPlayer
            ? `${winnerPlayer.name} has won.`
            : isDetentionTurn && isCurrentPlayer
              ? "Leave Civic Detention to miss this turn."
              : hasPendingPropertyPurchase
                ? "Resolve the purchase choice before the turn continues."
                : gameState.hasRolledThisTurn
                  ? gameState.message
                  : currentPlayer
                    ? `Waiting for ${currentPlayer.name}.`
                    : "Waiting for the shared game.";
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

  const stopDicePreview = useCallback(() => {
    if (dicePreviewIntervalRef.current !== null) {
      window.clearInterval(dicePreviewIntervalRef.current);
      dicePreviewIntervalRef.current = null;
    }
  }, []);

  const clearLandingToast = useCallback(() => {
    if (landingToastTimeoutRef.current !== null) {
      window.clearTimeout(landingToastTimeoutRef.current);
      landingToastTimeoutRef.current = null;
    }

    setLandingToast(null);
  }, []);

  const clearRentAnimation = useCallback(() => {
    if (rentAnimationTimeoutRef.current !== null) {
      window.clearTimeout(rentAnimationTimeoutRef.current);
      rentAnimationTimeoutRef.current = null;
    }

    setRentAnimation(null);
  }, []);

  const showLandingToast = useCallback((toast: Omit<LandingToast, "id">) => {
    if (landingToastTimeoutRef.current !== null) {
      window.clearTimeout(landingToastTimeoutRef.current);
    }

    setLandingToast({
      ...toast,
      id: Date.now(),
    });

    landingToastTimeoutRef.current = window.setTimeout(() => {
      setLandingToast(null);
      landingToastTimeoutRef.current = null;
    }, LANDING_TOAST_DURATION_MS);
  }, []);

  const showRentAnimation = useCallback(
    (animation: Omit<RentAnimation, "id">) => {
      if (rentAnimationTimeoutRef.current !== null) {
        window.clearTimeout(rentAnimationTimeoutRef.current);
      }

      setRentAnimation({
        ...animation,
        id: Date.now(),
      });

      rentAnimationTimeoutRef.current = window.setTimeout(() => {
        setRentAnimation(null);
        rentAnimationTimeoutRef.current = null;
      }, prefersReducedMotion() ? 900 : RENT_ANIMATION_DURATION_MS);
    },
    [],
  );

  const startDicePreview = useCallback(() => {
    stopDicePreview();
    setAnimatedDiceRoll(rollDicePair());

    dicePreviewIntervalRef.current = window.setInterval(() => {
      setAnimatedDiceRoll(rollDicePair());
    }, DICE_ANIMATION_FRAME_MS);
  }, [stopDicePreview]);

  const animateDiceRoll = useCallback(async (finalRoll: OnlineDiceRoll) => {
    stopDicePreview();
    const reducedMotion = prefersReducedMotion();
    const duration = reducedMotion
      ? REDUCED_DICE_ANIMATION_DURATION_MS
      : DICE_ANIMATION_DURATION_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt < duration) {
      const dieOne = rollDie();
      const dieTwo = rollDie();

      setAnimatedDiceRoll({ dieOne, dieTwo, total: dieOne + dieTwo });
      await wait(reducedMotion ? duration : DICE_ANIMATION_FRAME_MS);
    }

    setAnimatedDiceRoll(finalRoll);
  }, [stopDicePreview]);

  const animateTokenMovement = useCallback(
    async ({
      endPosition,
      playerId,
      sequenceId,
      startPosition,
    }: {
      endPosition: number;
      playerId: string;
      sequenceId: number;
      startPosition: number;
    }) => {
      const stepDuration = prefersReducedMotion()
        ? REDUCED_TOKEN_STEP_DURATION_MS
        : TOKEN_STEP_DURATION_MS;
      const movementPath = getClockwiseMovementPath(startPosition, endPosition);

      if (movementPath.length === 0) {
        setHighlightedBoardPosition(endPosition);
        await wait(stepDuration);
        return;
      }

      for (const position of movementPath) {
        if (animationSequenceRef.current !== sequenceId) {
          return;
        }

        setAnimatedPlayerPositions((currentPositions) => ({
          ...currentPositions,
          [playerId]: position,
        }));
        setHighlightedBoardPosition(position);
        await wait(stepDuration);
      }
    },
    [],
  );

  const animateConfirmedGameUpdate = useCallback(
    async ({
      nextRow,
      previousRow,
      sequenceId,
    }: {
      nextRow: OnlineGameStateRow;
      previousRow: OnlineGameStateRow;
      sequenceId: number;
    }) => {
      const actor = getConfirmedRollActor({
        nextState: nextRow.state,
        previousState: previousRow.state,
      });

      if (!actor || !nextRow.state.lastRoll) {
        return;
      }

      const { nextPlayer, previousPlayer } = actor;

      try {
        clearLandingToast();
        clearRentAnimation();
        setResultPopup(null);
        setInteractionPhase("rolling");
        await animateDiceRoll(nextRow.state.lastRoll);

        if (animationSequenceRef.current !== sequenceId) {
          return;
        }

        setInteractionPhase("moving");
        await animateTokenMovement({
          endPosition: nextPlayer.position,
          playerId: nextPlayer.id,
          sequenceId,
          startPosition: previousPlayer.position,
        });

        if (animationSequenceRef.current !== sequenceId) {
          return;
        }

        setInteractionPhase("resolving");
        const blockingPopup = createBlockingResultPopupFromConfirmedRoll({
          nextState: nextRow.state,
          previousState: previousRow.state,
        });

        if (blockingPopup) {
          setResultPopup({
            ...blockingPopup,
            id: Date.now(),
          });
        } else {
          const rentPresentation = createRentAnimationFromConfirmedRoll({
            nextState: nextRow.state,
            previousState: previousRow.state,
          });

          if (rentPresentation) {
            showRentAnimation(rentPresentation);
          } else {
            const toast = createLandingToastFromConfirmedRoll({
              nextState: nextRow.state,
              previousState: previousRow.state,
            });

            if (toast) {
              showLandingToast(toast);
            }
          }
        }
      } finally {
        if (animationSequenceRef.current === sequenceId) {
          setAnimatedDiceRoll(null);
          setAnimatedPlayerPositions({});
          setHighlightedBoardPosition(null);
          setInteractionPhase("idle");
        }
      }
    },
    [
      animateDiceRoll,
      animateTokenMovement,
      clearLandingToast,
      clearRentAnimation,
      showLandingToast,
      showRentAnimation,
    ],
  );

  const applyGameRowUpdate = useCallback(
    (
      nextRow: OnlineGameStateRow,
      options: { animate?: boolean } = {},
    ) => {
      const previousRow = gameRowRef.current;

      if (previousRow && nextRow.version < previousRow.version) {
        return;
      }

      const shouldAnimate =
        options.animate !== false &&
        previousRow !== null &&
        nextRow.version > previousRow.version &&
        lastAnimatedVersionRef.current !== nextRow.version &&
        isConfirmedRollUpdate({
          nextState: nextRow.state,
          previousState: previousRow.state,
        });
      const actor =
        shouldAnimate && previousRow
          ? getConfirmedRollActor({
              nextState: nextRow.state,
              previousState: previousRow.state,
            })
          : null;

      if (shouldAnimate && actor) {
        lastAnimatedVersionRef.current = nextRow.version;
        setAnimatedPlayerPositions({
          [actor.nextPlayer.id]: actor.previousPlayer.position,
        });
        setHighlightedBoardPosition(actor.previousPlayer.position);
      } else if (
        previousRow &&
        nextRow.version > previousRow.version &&
        (nextRow.state.message.toLowerCase().includes("timer expired") ||
          nextRow.state.currentPlayerIndex !==
            previousRow.state.currentPlayerIndex ||
          nextRow.state.winnerPlayerId !== previousRow.state.winnerPlayerId)
      ) {
        animationSequenceRef.current += 1;
        setAnimatedDiceRoll(null);
        setAnimatedPlayerPositions({});
        setHighlightedBoardPosition(null);
        setInteractionPhase("idle");
        clearLandingToast();
        clearRentAnimation();
        setResultPopup(null);
      }

      stopDicePreview();
      gameRowRef.current = nextRow;
      setGameRow(nextRow);
      setErrorMessage("");

      if (shouldAnimate && actor) {
        const sequenceId = animationSequenceRef.current + 1;
        animationSequenceRef.current = sequenceId;
        void animateConfirmedGameUpdate({
          nextRow,
          previousRow: previousRow!,
          sequenceId,
        });
      }
    },
    [
      animateConfirmedGameUpdate,
      clearLandingToast,
      clearRentAnimation,
      stopDicePreview,
    ],
  );

  const clearGameRowState = useCallback(() => {
    animationSequenceRef.current += 1;
    clearLandingToast();
    clearRentAnimation();
    stopDicePreview();
    gameRowRef.current = null;
    lastAnimatedVersionRef.current = null;
    setAnimatedDiceRoll(null);
    setAnimatedPlayerPositions({});
    setHighlightedBoardPosition(null);
    setInteractionPhase("idle");
    setResultPopup(null);
    setIsActivityModalOpen(false);
    setGameRow(null);
  }, [clearLandingToast, clearRentAnimation, stopDicePreview]);

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
        clearGameRowState();
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
        clearGameRowState();
        throw new Error("This online room has been closed.");
      }

      setRoom(loadedRoom);

      return loadedRoom;
    },
    [clearGameRowState, supabase],
  );

  const loadGameState = useCallback(
    async (roomId: string, options: { animate?: boolean } = {}) => {
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

      applyGameRowUpdate(parsedGameState, options);

      return parsedGameState;
    },
    [applyGameRowUpdate, supabase],
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
    return () => {
      clearLandingToast();
      clearRentAnimation();
      stopDicePreview();
    };
  }, [clearLandingToast, clearRentAnimation, stopDicePreview]);

  useEffect(() => {
    if (!isActivityModalOpen && !isPropertiesModalOpen && !resultPopup) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isActivityModalOpen) {
          setIsActivityModalOpen(false);
        }

        if (isPropertiesModalOpen) {
          setIsPropertiesModalOpen(false);
        }

        if (resultPopup) {
          setResultPopup(null);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActivityModalOpen, isPropertiesModalOpen, resultPopup]);

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
          loadGameState(loadedRoom.id, { animate: false }),
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
            clearGameRowState();
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
    clearGameRowState,
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
          clearGameRowState();
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
  }, [clearGameRowState, currentUserId, room, storedOnlineSession, supabase]);

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
          applyGameRowUpdate(parsedGameState);
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
    applyGameRowUpdate,
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
              clearGameRowState();
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
              clearGameRowState();
            }

            setErrorMessage(getSafeSupabaseErrorMessage(error));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clearGameRowState, loadGameState, loadRoom, loadRoomPlayers, room, supabase]);

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
    setInteractionPhase("rolling");
    startDicePreview();
    clearLandingToast();
    clearRentAnimation();
    setResultPopup(null);
    setErrorMessage("");

    try {
      const diceRoll = rollDicePair();
      const { data, error } = await supabase.rpc("roll_online_turn", {
        die_one: diceRoll.dieOne,
        die_two: diceRoll.dieTwo,
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

      applyGameRowUpdate(parsedGameState);
    } catch (error) {
      animationSequenceRef.current += 1;
      stopDicePreview();
      setAnimatedDiceRoll(null);
      setHighlightedBoardPosition(null);
      setInteractionPhase("idle");
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

      applyGameRowUpdate(parsedGameState);
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

      applyGameRowUpdate(parsedGameState);
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

      applyGameRowUpdate(parsedGameState);
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

      applyGameRowUpdate(parsedGameState);
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
      isActing: isInteractionLocked,
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

      applyGameRowUpdate(parsedGameState);
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
      isActing: isInteractionLocked,
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

      applyGameRowUpdate(parsedGameState);
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

  function closeActivityModal() {
    setIsActivityModalOpen(false);
  }

  function handleActivityBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeActivityModal();
    }
  }

  function handlePropertiesBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closePropertiesModal();
    }
  }

  function handleResultBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      setResultPopup(null);
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
    const baseRent = isOnlinePropertySpace(space)
      ? space.rent
      : ONLINE_TRANSIT_RENTS[1];

    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#171915]/55 px-4 py-6 backdrop-blur-sm">
        <section
          aria-labelledby="online-purchase-modal-title"
          aria-modal="true"
          className="game-popup-enter max-h-[88vh] w-full max-w-lg overflow-y-auto border-2 border-[#171915] bg-white shadow-[12px_12px_0_0_#3454d1]"
          role="dialog"
        >
          <div className="border-b-2 border-[#171915] bg-[#f7f8f4] p-4">
            <p className="text-sm font-black uppercase text-[#596057]">
              Available to buy
            </p>
            <h2
              className="mt-1 break-words text-3xl font-black leading-none"
              id="online-purchase-modal-title"
            >
              {space.name}
            </h2>
            {propertyGroup ? (
              <div className="mt-3 flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="h-5 w-16 border-2 border-[#171915]"
                  style={{ backgroundColor: propertyGroup.color }}
                />
                <span className="text-sm font-black uppercase text-[#445045]">
                  {propertyGroup.name}
                </span>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-2 border-[#171915] bg-[#f7f8f4] p-3">
                <p className="text-xs font-black uppercase text-[#596057]">
                  Price
                </p>
                <p className="text-xl font-black">
                  {formatCurrency(space.price)}
                </p>
              </div>
              <div className="border-2 border-[#171915] bg-[#f7f8f4] p-3">
                <p className="text-xs font-black uppercase text-[#596057]">
                  Base Rent
                </p>
                <p className="text-xl font-black">
                  {formatCurrency(baseRent)}
                </p>
              </div>
              <div className="col-span-2 border-2 border-[#171915] bg-[#f7f8f4] p-3">
                <p className="text-xs font-black uppercase text-[#596057]">
                  Current Balance
                </p>
                <p className="text-xl font-black">
                  {formatCurrency(currentPlayer.balance)}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="min-h-12 border-2 border-[#171915] bg-[#06d6a0] px-4 py-3 text-sm font-black text-[#171915] shadow-[5px_5px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
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
                className="min-h-12 border-2 border-[#171915] bg-white px-4 py-3 text-sm font-black text-[#171915] shadow-[5px_5px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                disabled={!canSkipPurchase}
                onClick={skipPurchase}
                type="button"
              >
                {isActing ? "Skipping..." : "Skip Purchase"}
              </button>
            </div>
          </div>
        </section>
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
              <div className="game-board relative grid aspect-square min-w-[620px] grid-cols-7 grid-rows-7 border-2 border-[#171915] bg-[#171915] shadow-[12px_12px_0_0_#f9c74f]">
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
                    (player) => {
                      const displayedPosition =
                        animatedPlayerPositions[player.id] ?? player.position;

                      return (
                        !player.isEliminated && displayedPosition === index
                      );
                    },
                  );
                  const isAnimatedStep =
                    highlightedBoardPosition === index;
                  const isRentFocus = rentAnimation?.position === index;
                  const isRentDimmed =
                    rentAnimation !== null && rentAnimation.position !== index;

                  return (
                    <div
                      className={`game-board-space relative flex min-h-0 flex-col justify-between border border-[#171915] p-1.5 text-[#171915] ${
                        isAnimatedStep ? "game-board-space-active-step" : ""
                      } ${isRentFocus ? "online-board-space-rent-focus" : ""} ${
                        isRentDimmed ? "online-board-space-dimmed" : ""
                      }`}
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
                  className="game-board-center online-board-center flex flex-col items-center justify-center border-2 border-[#171915] bg-[#171915] p-6 text-center text-white"
                  style={{ gridColumn: "2 / 7", gridRow: "2 / 7" }}
                >
                  <p
                    className="game-board-center-accent mb-4 h-1.5 w-24 bg-[#ef476f]"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-black uppercase tracking-normal text-[#cfd7ca]">
                      Online City
                    </p>
                    <h2 className="game-board-center-title text-3xl font-black tracking-normal sm:text-5xl">
                      Roll Center
                    </h2>
                  </div>

                  <button
                    aria-label={
                      canRoll
                        ? "Roll the dice"
                        : `Dice unavailable. ${diceStatusText}`
                    }
                    className={`online-dice-button mt-4 ${
                      isDiceRolling ? "online-dice-button-rolling" : ""
                    }`}
                    disabled={!canRoll}
                    onClick={rollDice}
                    type="button"
                  >
                    <span className="online-dice-stage">
                      {renderOnlineDie({
                        dieIndex: 1,
                        isRolling: isDiceRolling,
                        label: "Die one",
                        value: displayedDieOne,
                      })}
                      {renderOnlineDie({
                        dieIndex: 2,
                        isRolling: isDiceRolling,
                        label: "Die two",
                        value: displayedDieTwo,
                      })}
                    </span>
                    <span className="online-dice-total">
                      {displayedDiceRoll
                        ? `Total ${displayedDiceRoll.total}`
                        : "Tap to Roll"}
                    </span>
                  </button>

                  <p className="online-dice-status mt-4 max-w-md text-sm font-bold leading-6 text-[#f7f8f4]">
                    {diceStatusText}
                  </p>
                </div>

                {rentAnimation ? (
                  <section
                    aria-live="polite"
                    className="online-rent-presentation"
                    key={rentAnimation.id}
                  >
                    <div className="online-rent-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase text-[#596057]">
                            Rent Due
                          </p>
                          <h2 className="mt-1 break-words text-2xl font-black leading-none text-[#171915]">
                            {rentAnimation.spaceName}
                          </h2>
                        </div>
                        <p className="shrink-0 border-2 border-[#171915] bg-[#f9c74f] px-3 py-1 text-lg font-black text-[#171915]">
                          {formatCurrency(rentAnimation.rentAmount)}
                        </p>
                      </div>

                      {rentAnimation.propertyGroupName ? (
                        <div className="mt-3 flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-4 w-12 border-2 border-[#171915]"
                            style={{
                              backgroundColor:
                                rentAnimation.propertyGroupColor ?? "#f9c74f",
                            }}
                          />
                          <span className="text-xs font-black uppercase text-[#445045]">
                            {rentAnimation.propertyGroupName}
                          </span>
                        </div>
                      ) : null}

                      <div className="online-rent-flow mt-4">
                        <div className="online-rent-player">
                          <span
                            aria-hidden="true"
                            className="online-rent-token"
                            style={{
                              backgroundColor:
                                rentAnimation.payingPlayerColor,
                            }}
                          />
                          <span>
                            <span className="block text-[0.62rem] font-black uppercase text-[#596057]">
                              Paying
                            </span>
                            <span className="block break-words text-sm font-black">
                              {rentAnimation.payingPlayerName}
                            </span>
                          </span>
                        </div>

                        <div
                          aria-hidden="true"
                          className="online-rent-money-lane"
                        >
                          <span className="online-rent-chip">$</span>
                          <span className="online-rent-chip online-rent-chip-2">
                            $
                          </span>
                          <span className="online-rent-arrow">→</span>
                        </div>

                        <div className="online-rent-player">
                          <span
                            aria-hidden="true"
                            className="online-rent-token"
                            style={{
                              backgroundColor: rentAnimation.ownerColor,
                            }}
                          />
                          <span>
                            <span className="block text-[0.62rem] font-black uppercase text-[#596057]">
                              Owner
                            </span>
                            <span className="block break-words text-sm font-black">
                              {rentAnimation.ownerName}
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="border-2 border-[#171915] bg-[#f7f8f4] p-2">
                          <p className="text-[0.62rem] font-black uppercase text-[#596057]">
                            Development
                          </p>
                          <p className="text-sm font-black">
                            {rentAnimation.developmentLabel ??
                              (rentAnimation.isTransit
                                ? "Transit Station"
                                : "No buildings")}
                          </p>
                        </div>
                        <div className="border-2 border-[#171915] bg-[#f7f8f4] p-2">
                          <p className="text-[0.62rem] font-black uppercase text-[#596057]">
                            Payer Balance
                          </p>
                          <p className="text-sm font-black">
                            {formatCurrency(
                              rentAnimation.payingPlayerBalance,
                            )}
                          </p>
                        </div>
                      </div>

                      <button
                        className="mt-4 min-h-10 w-full border-2 border-[#171915] bg-[#06d6a0] px-3 py-2 text-sm font-black text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35"
                        onClick={clearRentAnimation}
                        type="button"
                      >
                        Continue
                      </button>
                    </div>
                  </section>
                ) : null}
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

              <p className="game-message border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
                {errorMessage || gameState?.message || "Loading online turn"}
              </p>
            </div>
          </div>

          <div className="game-buttons grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
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
              disabled={!gameState || !localPlayer || isInteractionLocked}
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
              className="flex h-14 items-center justify-center gap-2 border-2 border-[#171915] bg-white px-4 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#3454d1] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#3454d1]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
              disabled={!gameState}
              onClick={() => setIsActivityModalOpen(true)}
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
                <path d="M4 5h16" />
                <path d="M4 12h12" />
                <path d="M4 19h8" />
                <path d="M18 15l2 2-2 2" />
                <path d="M14 17h6" />
              </svg>
              <span>Activity</span>
              <span className="rounded-full border-2 border-[#171915] bg-[#f9c74f] px-2 py-0.5 text-xs font-black leading-none">
                {activityEntryCount}
              </span>
            </button>

            <button
              className="h-14 border-2 border-[#171915] bg-[#ef476f] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
              disabled={isInteractionLocked}
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

      {landingToast ? (
        <div className="online-landing-toast" key={landingToast.id}>
          <span
            aria-hidden="true"
            className="online-landing-toast-accent"
            style={{ backgroundColor: landingToast.accentColor }}
          />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[#596057]">
              {landingToast.type}
            </p>
            <p className="break-words text-base font-black">
              {landingToast.title}
            </p>
            <p className="mt-1 text-sm font-bold leading-5 text-[#445045]">
              {landingToast.message}
            </p>
          </div>
          <button
            className="ml-2 h-9 shrink-0 border-2 border-[#171915] bg-white px-3 text-xs font-black text-[#171915] shadow-[3px_3px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
            onClick={clearLandingToast}
            type="button"
          >
            Close
          </button>
        </div>
      ) : null}

      {gameState?.hasRolledThisTurn &&
      !isGameOver &&
      currentBuyableSpace &&
      hasPendingPropertyPurchase &&
      currentSpaceOwner === null &&
      interactionPhase === "idle" &&
      !resultPopup
        ? renderPurchasePanel(currentBuyableSpace)
        : null}

      {resultPopup ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#f7f8f4]/55 px-4 py-6 backdrop-blur-[1px]"
          onMouseDown={handleResultBackdropMouseDown}
        >
          <section
            aria-labelledby="online-landing-result-title"
            aria-modal="true"
            className="game-result-popup flex max-h-[90vh] w-full max-w-3xl flex-col border-2 border-[#171915] bg-white shadow-[12px_12px_0_0_#171915]"
            key={resultPopup.id}
            role="dialog"
          >
            <span
              aria-hidden="true"
              className="block h-2 border-b-2 border-[#171915]"
              style={{ backgroundColor: resultPopup.accentColor }}
            />
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#171915] bg-[#f7f8f4] p-5">
              <div className="min-w-0">
                <p className="text-sm font-black uppercase text-[#596057]">
                  {resultPopup.resultType}
                </p>
                <h2
                  className="mt-1 break-words text-3xl font-black leading-none"
                  id="online-landing-result-title"
                >
                  {resultPopup.title}
                </h2>
              </div>

              <button
                className="h-11 shrink-0 border-2 border-[#171915] bg-white px-4 text-sm font-black text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
                onClick={() => setResultPopup(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="game-result-popup-body flex-1 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border-2 border-[#171915] bg-[#f7f8f4] p-3">
                  <p className="text-xs font-black uppercase text-[#596057]">
                    Money Gained/Paid
                  </p>
                  <p
                    className={`text-xl font-black ${
                      resultPopup.moneyChange < 0
                        ? "text-[#ef476f]"
                        : resultPopup.moneyChange > 0
                          ? "text-[#047857]"
                          : "text-[#445045]"
                    }`}
                  >
                    {resultPopup.moneyChange > 0 ? "+" : ""}
                    {formatCurrency(resultPopup.moneyChange)}
                  </p>
                </div>

                <div className="border-2 border-[#171915] bg-[#f7f8f4] p-3">
                  <p className="text-xs font-black uppercase text-[#596057]">
                    Updated Balance
                  </p>
                  <p className="text-xl font-black">
                    {formatCurrency(resultPopup.balance)}
                  </p>
                </div>
              </div>

              <div className="mt-4 border-2 border-[#171915] bg-white p-5">
                <p className="text-xs font-black uppercase text-[#596057]">
                  What Happened
                </p>
                <p className="mt-2 text-lg font-bold leading-8 text-[#445045]">
                  {resultPopup.explanation}
                </p>
              </div>

              <button
                className="mt-4 min-h-12 w-full border-2 border-[#171915] bg-[#06d6a0] px-4 py-3 text-base font-black text-[#171915] shadow-[5px_5px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35"
                onClick={() => setResultPopup(null)}
                type="button"
              >
                Continue
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isActivityModalOpen && gameState ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#171915]/60 px-4 py-6 backdrop-blur-sm"
          onMouseDown={handleActivityBackdropMouseDown}
        >
          <section
            aria-labelledby="online-activity-title"
            aria-modal="true"
            className="game-activity-modal flex max-h-[min(90vh,760px)] w-full max-w-3xl flex-col border-2 border-[#171915] bg-white shadow-[12px_12px_0_0_#3454d1]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#171915] bg-[#f7f8f4] p-4">
              <div>
                <p className="text-sm font-black uppercase text-[#596057]">
                  Newest first
                </p>
                <h2
                  className="text-3xl font-black leading-none"
                  id="online-activity-title"
                >
                  Game Activity
                </h2>
              </div>

              <button
                className="h-11 border-2 border-[#171915] bg-white px-4 text-sm font-black text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
                onClick={closeActivityModal}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="game-activity-modal-body flex-1 space-y-3 overflow-y-auto p-4">
              {gameState.activityLog.length > 0 ? (
                gameState.activityLog.map((entry) => (
                  <article
                    className="border-2 border-[#171915] bg-[#f7f8f4] p-3"
                    key={entry.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="break-words text-base font-black">
                        {entry.playerName}
                      </p>
                      <p className="shrink-0 text-xs font-black uppercase text-[#596057]">
                        {formatActivityTime(entry.createdAt)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm font-bold leading-6 text-[#445045]">
                      {entry.message}
                    </p>
                  </article>
                ))
              ) : (
                <div className="border-2 border-[#171915] bg-[#f7f8f4] p-5">
                  <p className="text-xl font-black">No activity yet.</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#445045]">
                    Shared game activity will appear here as players take
                    actions.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

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
                              isActing: isInteractionLocked,
                              isCurrentPlayer,
                              isTurnTimerExpired,
                              player: localPlayer,
                              position,
                              property: space,
                            });
                            const sellStatus = getSellActionStatus({
                              gameState,
                              isActing: isInteractionLocked,
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
