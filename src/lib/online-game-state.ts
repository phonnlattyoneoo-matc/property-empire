import {
  BOARD_SPACE_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
} from "@/lib/game-state";

export type OnlineGamePlayer = {
  id: string;
  userId: string;
  name: string;
  color: string;
  balance: number;
  position: number;
};

export type OnlineDiceRoll = {
  dieOne: number;
  dieTwo: number;
  total: number;
};

export type OnlineGameState = {
  boardSpaceCount: number;
  currentPlayerIndex: number;
  hasRolledThisTurn: boolean;
  lastRoll: OnlineDiceRoll | null;
  message: string;
  phase: "online_game";
  players: OnlineGamePlayer[];
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

  if (
    state.phase !== "online_game" ||
    state.boardSpaceCount !== BOARD_SPACE_COUNT ||
    typeof state.currentPlayerIndex !== "number" ||
    !Number.isInteger(state.currentPlayerIndex) ||
    typeof state.hasRolledThisTurn !== "boolean" ||
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

  if (lastRoll === undefined) {
    return null;
  }

  return {
    boardSpaceCount: BOARD_SPACE_COUNT,
    currentPlayerIndex: state.currentPlayerIndex,
    hasRolledThisTurn: state.hasRolledThisTurn,
    lastRoll,
    message: state.message,
    phase: "online_game",
    players,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
