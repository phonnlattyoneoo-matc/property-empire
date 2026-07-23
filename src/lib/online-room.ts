export const MIN_ONLINE_PLAYERS = 2;
export const MAX_ONLINE_PLAYERS = 4;
export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type OnlineRoom = {
  code: string;
  created_at: string;
  host_user_id: string;
  id: string;
  max_players: number;
  status: "waiting" | "started" | "closed";
};

export type OnlineRoomPlayer = {
  display_name: string;
  id: string;
  is_host: boolean;
  joined_at: string;
  last_seen_at: string;
  room_id: string;
  user_id: string;
};

type RealtimeRowPayload = {
  eventType?: string;
  new?: unknown;
  old?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function generateRoomCode() {
  const values = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(values);

  return Array.from(values, (value) => {
    return ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length];
  }).join("");
}

export function sanitizeRoomCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function normalizePlayerName(value: string) {
  return value.trim().slice(0, 24);
}

export function isValidRoomCode(value: string) {
  return /^[A-Z0-9]{6}$/.test(value);
}

export function sortOnlineRoomPlayers(players: OnlineRoomPlayer[]) {
  return [...players].sort((firstPlayer, secondPlayer) => {
    const joinedAtComparison = firstPlayer.joined_at.localeCompare(
      secondPlayer.joined_at,
    );

    if (joinedAtComparison !== 0) {
      return joinedAtComparison;
    }

    return firstPlayer.id.localeCompare(secondPlayer.id);
  });
}

export function parseOnlineRoom(row: unknown): OnlineRoom | null {
  if (!isRecord(row)) {
    return null;
  }

  if (
    typeof row.id !== "string" ||
    typeof row.code !== "string" ||
    !isValidRoomCode(sanitizeRoomCode(row.code)) ||
    typeof row.host_user_id !== "string" ||
    typeof row.max_players !== "number" ||
    !Number.isInteger(row.max_players) ||
    row.max_players < MIN_ONLINE_PLAYERS ||
    row.max_players > MAX_ONLINE_PLAYERS ||
    (row.status !== "waiting" &&
      row.status !== "started" &&
      row.status !== "closed") ||
    typeof row.created_at !== "string"
  ) {
    return null;
  }

  return {
    code: sanitizeRoomCode(row.code),
    created_at: row.created_at,
    host_user_id: row.host_user_id,
    id: row.id,
    max_players: row.max_players,
    status: row.status,
  };
}

export function parseOnlineRoomPlayer(row: unknown): OnlineRoomPlayer | null {
  if (!isRecord(row)) {
    return null;
  }

  if (
    typeof row.id !== "string" ||
    typeof row.room_id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.display_name !== "string" ||
    row.display_name.trim().length === 0 ||
    typeof row.is_host !== "boolean" ||
    typeof row.joined_at !== "string" ||
    typeof row.last_seen_at !== "string"
  ) {
    return null;
  }

  return {
    display_name: normalizePlayerName(row.display_name),
    id: row.id,
    is_host: row.is_host,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    room_id: row.room_id,
    user_id: row.user_id,
  };
}

function getRealtimeRowId(row: unknown) {
  if (!isRecord(row) || typeof row.id !== "string") {
    return null;
  }

  return row.id;
}

export function mergeOnlineRoomPlayerRealtimePayload(
  players: OnlineRoomPlayer[],
  payload: RealtimeRowPayload,
) {
  if (payload.eventType === "DELETE") {
    const deletedPlayerId = getRealtimeRowId(payload.old);

    if (!deletedPlayerId) {
      return null;
    }

    return sortOnlineRoomPlayers(
      players.filter((player) => player.id !== deletedPlayerId),
    );
  }

  const changedPlayer = parseOnlineRoomPlayer(payload.new);

  if (!changedPlayer) {
    return null;
  }

  return sortOnlineRoomPlayers([
    ...players.filter((player) => player.id !== changedPlayer.id),
    changedPlayer,
  ]);
}
