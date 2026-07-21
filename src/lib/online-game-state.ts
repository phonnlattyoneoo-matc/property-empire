import {
  BOARD_SPACE_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from "@/lib/game-state";
import {
  ONLINE_BOARD_SPACES,
  isOnlinePropertySpace,
} from "@/lib/online-board";

export type OnlineGamePlayer = {
  id: string;
  userId: string;
  name: string;
  color: string;
  balance: number;
  isDetained: boolean;
  position: number;
};

export type OnlineDiceRoll = {
  dieOne: number;
  dieTwo: number;
  total: number;
};

export type OnlineResolvedEventCard = {
  title: string;
  description: string;
  result: string;
};

export type OnlinePropertyOwners = Record<string, string>;

export type OnlineGameState = {
  boardSpaceCount: number;
  currentPlayerIndex: number;
  hasRolledThisTurn: boolean;
  isDetentionTurn: boolean;
  lastEventCard: OnlineResolvedEventCard | null;
  lastRoll: OnlineDiceRoll | null;
  message: string;
  pendingPropertyPurchasePosition: number | null;
  phase: "online_game";
  players: OnlineGamePlayer[];
  propertyOwners: OnlinePropertyOwners;
};

export type OnlineGameStateRow = {
  room_id: string;
  state: OnlineGameState;
  updated_at: string;
  updated_by: string;
  version: number;
};

export function parseOnlineGameStateRow(
  row: unknown,
): OnlineGameStateRow | null {
  if (!isRecord(row)) {
    return null;
  }

  if (
    typeof row.room_id !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.updated_by !== "string" ||
    typeof row.version !== "number" ||
    !Number.isInteger(row.version) ||
    row.version < 0
  ) {
    return null;
  }

  const state = parseOnlineGameState(row.state);

  if (!state) {
    return null;
  }

  return {
    room_id: row.room_id,
    state,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    version: row.version,
  };
}

function parseOnlineGameState(state: unknown): OnlineGameState | null {
  if (!isRecord(state)) {
    return null;
  }

  const isDetentionTurn =
    state.isDetentionTurn === undefined ? false : state.isDetentionTurn;

  if (
    state.phase !== "online_game" ||
    state.boardSpaceCount !== BOARD_SPACE_COUNT ||
    typeof state.currentPlayerIndex !== "number" ||
    !Number.isInteger(state.currentPlayerIndex) ||
    typeof state.hasRolledThisTurn !== "boolean" ||
    typeof isDetentionTurn !== "boolean" ||
    typeof state.message !== "string" ||
    !Array.isArray(state.players)
  ) {
    return null;
  }

  if (
    state.players.length < MIN_PLAYERS ||
    state.players.length > MAX_PLAYERS ||
    state.currentPlayerIndex < 0 ||
    state.currentPlayerIndex >= state.players.length
  ) {
    return null;
  }

  const players: OnlineGamePlayer[] = [];

  for (const player of state.players) {
    const parsedPlayer = parseOnlineGamePlayer(player);

    if (!parsedPlayer) {
      return null;
    }

    players.push(parsedPlayer);
  }

  const lastRoll = parseOnlineDiceRoll(state.lastRoll);
  const lastEventCard = parseOnlineResolvedEventCard(state.lastEventCard);
  const propertyOwners = parseOnlinePropertyOwners(
    state.propertyOwners,
    players,
  );
  const pendingPropertyPurchasePosition =
    parsePendingPropertyPurchasePosition(
      state.pendingPropertyPurchasePosition,
    );

  if (
    lastRoll === undefined ||
    lastEventCard === undefined ||
    !propertyOwners ||
    pendingPropertyPurchasePosition === undefined
  ) {
    return null;
  }

  const currentPlayer = players[state.currentPlayerIndex];

  if (
    isDetentionTurn &&
    (!currentPlayer.isDetained ||
      state.hasRolledThisTurn ||
      pendingPropertyPurchasePosition !== null)
  ) {
    return null;
  }

  return {
    boardSpaceCount: BOARD_SPACE_COUNT,
    currentPlayerIndex: state.currentPlayerIndex,
    hasRolledThisTurn: state.hasRolledThisTurn,
    isDetentionTurn,
    lastEventCard,
    lastRoll,
    message: state.message,
    pendingPropertyPurchasePosition,
    phase: "online_game",
    players,
    propertyOwners,
  };
}

function parseOnlineGamePlayer(player: unknown): OnlineGamePlayer | null {
  if (!isRecord(player)) {
    return null;
  }

  if (
    typeof player.id !== "string" ||
    typeof player.userId !== "string" ||
    typeof player.name !== "string" ||
    player.name.trim().length === 0 ||
    typeof player.color !== "string" ||
    (player.isDetained !== undefined &&
      typeof player.isDetained !== "boolean") ||
    typeof player.balance !== "number" ||
    !Number.isFinite(player.balance) ||
    typeof player.position !== "number" ||
    !Number.isInteger(player.position) ||
    player.position < 0 ||
    player.position >= BOARD_SPACE_COUNT
  ) {
    return null;
  }

  return {
    balance: player.balance,
    color: player.color,
    id: player.id,
    isDetained: player.isDetained === true,
    name: player.name.trim(),
    position: player.position,
    userId: player.userId,
  };
}

function parseOnlineDiceRoll(roll: unknown) {
  if (roll === null) {
    return null;
  }

  if (!isRecord(roll)) {
    return undefined;
  }

  if (
    typeof roll.dieOne !== "number" ||
    !Number.isInteger(roll.dieOne) ||
    roll.dieOne < 1 ||
    roll.dieOne > 6 ||
    typeof roll.dieTwo !== "number" ||
    !Number.isInteger(roll.dieTwo) ||
    roll.dieTwo < 1 ||
    roll.dieTwo > 6 ||
    typeof roll.total !== "number" ||
    !Number.isInteger(roll.total) ||
    roll.total !== roll.dieOne + roll.dieTwo
  ) {
    return undefined;
  }

  return {
    dieOne: roll.dieOne,
    dieTwo: roll.dieTwo,
    total: roll.total,
  };
}

function parseOnlineResolvedEventCard(eventCard: unknown) {
  if (eventCard === undefined || eventCard === null) {
    return null;
  }

  if (!isRecord(eventCard)) {
    return undefined;
  }

  if (
    typeof eventCard.title !== "string" ||
    typeof eventCard.description !== "string" ||
    typeof eventCard.result !== "string" ||
    eventCard.title.trim().length === 0 ||
    eventCard.description.trim().length === 0 ||
    eventCard.result.trim().length === 0
  ) {
    return undefined;
  }

  return {
    description: eventCard.description,
    result: eventCard.result,
    title: eventCard.title,
  };
}

function parseOnlinePropertyOwners(
  propertyOwners: unknown,
  players: OnlineGamePlayer[],
): OnlinePropertyOwners | null {
  if (propertyOwners === undefined) {
    return {};
  }

  if (!isRecord(propertyOwners)) {
    return null;
  }

  const playerIds = new Set(players.map((player) => player.id));
  const parsedPropertyOwners: OnlinePropertyOwners = {};

  for (const [position, ownerId] of Object.entries(propertyOwners)) {
    const numericPosition = Number(position);
    const boardSpace = ONLINE_BOARD_SPACES[numericPosition];

    if (
      !Number.isInteger(numericPosition) ||
      numericPosition < 0 ||
      numericPosition >= BOARD_SPACE_COUNT ||
      !boardSpace ||
      !isOnlinePropertySpace(boardSpace) ||
      typeof ownerId !== "string" ||
      !playerIds.has(ownerId)
    ) {
      return null;
    }

    parsedPropertyOwners[position] = ownerId;
  }

  return parsedPropertyOwners;
}

function parsePendingPropertyPurchasePosition(position: unknown) {
  if (position === undefined || position === null) {
    return null;
  }

  if (
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0 ||
    position >= BOARD_SPACE_COUNT ||
    !isOnlinePropertySpace(ONLINE_BOARD_SPACES[position])
  ) {
    return undefined;
  }

  return position;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
