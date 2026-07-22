"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_ONLINE_PLAYERS,
  isValidRoomCode,
  normalizePlayerName,
  sanitizeRoomCode,
  sortOnlineRoomPlayers,
  type OnlineRoom,
  type OnlineRoomPlayer,
} from "@/lib/online-room";

const ONLINE_SESSION_STORAGE_KEY = "property-empire-online-session-v1";
export const ONLINE_HEARTBEAT_INTERVAL_MS = 7_000;
export const ONLINE_RECONNECTING_AFTER_MS = 12_000;
export const ONLINE_OFFLINE_AFTER_MS = 20_000;

export type OnlineConnectionStatus =
  | "Connected"
  | "Reconnecting"
  | "Offline";

export type StoredOnlineSession = {
  displayName: string;
  isHost: boolean;
  playerId: string;
  roomCode: string;
  roomId: string;
  savedAt: string;
  seatIndex: number;
  userId: string;
};

type StoredOnlineSessionEnvelope = {
  activeRoomCode: string | null;
  rooms: Record<string, StoredOnlineSession>;
};

type OnlineReconnectResult = {
  displayName: string;
  isHost: boolean;
  playerId: string;
  roomCode: string;
  roomId: string;
  roomStatus: OnlineRoom["status"];
  seatIndex: number;
  userId: string;
};

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (!isRecord(error) || typeof error.message !== "string") {
    return "";
  }

  return error.message;
}

export function isPermanentOnlineSessionError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("no longer exists") ||
    message.includes("not found") ||
    message.includes("closed") ||
    message.includes("saved online") ||
    message.includes("not joined")
  );
}

export function getOnlineConnectionStatus(
  lastSeenAt: string | null | undefined,
  nowMs: number,
): OnlineConnectionStatus {
  if (!lastSeenAt) {
    return "Offline";
  }

  const lastSeenMs = Date.parse(lastSeenAt);

  if (!Number.isFinite(lastSeenMs)) {
    return "Offline";
  }

  const elapsedMs = nowMs - lastSeenMs;

  if (elapsedMs >= ONLINE_OFFLINE_AFTER_MS) {
    return "Offline";
  }

  if (elapsedMs >= ONLINE_RECONNECTING_AFTER_MS) {
    return "Reconnecting";
  }

  return "Connected";
}

function parseStoredOnlineSession(value: unknown): StoredOnlineSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const roomCode =
    typeof value.roomCode === "string" ? sanitizeRoomCode(value.roomCode) : "";
  const displayName =
    typeof value.displayName === "string"
      ? normalizePlayerName(value.displayName)
      : "";

  if (
    !isValidRoomCode(roomCode) ||
    typeof value.roomId !== "string" ||
    value.roomId.length === 0 ||
    typeof value.playerId !== "string" ||
    value.playerId.length === 0 ||
    typeof value.userId !== "string" ||
    value.userId.length === 0 ||
    typeof value.isHost !== "boolean" ||
    typeof value.savedAt !== "string" ||
    displayName.length === 0 ||
    typeof value.seatIndex !== "number" ||
    !Number.isInteger(value.seatIndex) ||
    value.seatIndex < 0 ||
    value.seatIndex >= MAX_ONLINE_PLAYERS
  ) {
    return null;
  }

  return {
    displayName,
    isHost: value.isHost,
    playerId: value.playerId,
    roomCode,
    roomId: value.roomId,
    savedAt: value.savedAt,
    seatIndex: value.seatIndex,
    userId: value.userId,
  };
}

function readOnlineSessionEnvelope(): StoredOnlineSessionEnvelope {
  const storage = getStorage();

  if (!storage) {
    return {
      activeRoomCode: null,
      rooms: {},
    };
  }

  try {
    const parsedValue = JSON.parse(
      storage.getItem(ONLINE_SESSION_STORAGE_KEY) ?? "{}",
    );

    if (!isRecord(parsedValue) || !isRecord(parsedValue.rooms)) {
      return {
        activeRoomCode: null,
        rooms: {},
      };
    }

    const rooms: Record<string, StoredOnlineSession> = {};

    for (const [roomCode, sessionValue] of Object.entries(parsedValue.rooms)) {
      const session = parseStoredOnlineSession(sessionValue);

      if (session && session.roomCode === sanitizeRoomCode(roomCode)) {
        rooms[session.roomCode] = session;
      }
    }

    const activeRoomCode =
      typeof parsedValue.activeRoomCode === "string"
        ? sanitizeRoomCode(parsedValue.activeRoomCode)
        : null;

    return {
      activeRoomCode:
        activeRoomCode && rooms[activeRoomCode] ? activeRoomCode : null,
      rooms,
    };
  } catch {
    return {
      activeRoomCode: null,
      rooms: {},
    };
  }
}

function writeOnlineSessionEnvelope(envelope: StoredOnlineSessionEnvelope) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  const roomCodes = Object.keys(envelope.rooms);

  if (roomCodes.length === 0) {
    storage.removeItem(ONLINE_SESSION_STORAGE_KEY);
    return;
  }

  storage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(envelope));
}

export function getStoredOnlineSession(roomCode?: string) {
  const envelope = readOnlineSessionEnvelope();
  const sanitizedRoomCode =
    roomCode !== undefined ? sanitizeRoomCode(roomCode) : null;
  const selectedRoomCode = sanitizedRoomCode || envelope.activeRoomCode;

  if (!selectedRoomCode) {
    return null;
  }

  return envelope.rooms[selectedRoomCode] ?? null;
}

export function saveOnlineSession(session: StoredOnlineSession) {
  const parsedSession = parseStoredOnlineSession(session);

  if (!parsedSession) {
    return null;
  }

  const envelope = readOnlineSessionEnvelope();

  envelope.rooms[parsedSession.roomCode] = {
    ...parsedSession,
    savedAt: new Date().toISOString(),
  };
  envelope.activeRoomCode = parsedSession.roomCode;

  writeOnlineSessionEnvelope(envelope);

  return envelope.rooms[parsedSession.roomCode];
}

export function clearOnlineSession(roomCode?: string) {
  const envelope = readOnlineSessionEnvelope();
  const sanitizedRoomCode =
    roomCode !== undefined ? sanitizeRoomCode(roomCode) : envelope.activeRoomCode;

  if (!sanitizedRoomCode) {
    return;
  }

  delete envelope.rooms[sanitizedRoomCode];

  if (envelope.activeRoomCode === sanitizedRoomCode) {
    envelope.activeRoomCode = Object.keys(envelope.rooms)[0] ?? null;
  }

  writeOnlineSessionEnvelope(envelope);
}

export function saveOnlineSessionFromPlayers(
  room: OnlineRoom,
  players: OnlineRoomPlayer[],
  userId: string,
) {
  const sortedPlayers = sortOnlineRoomPlayers(players);
  const playerIndex = sortedPlayers.findIndex((player) => {
    return player.user_id === userId;
  });
  const player = sortedPlayers[playerIndex];

  if (!player) {
    return null;
  }

  return saveOnlineSession({
    displayName: player.display_name,
    isHost: player.is_host,
    playerId: player.id,
    roomCode: room.code,
    roomId: room.id,
    savedAt: new Date().toISOString(),
    seatIndex: playerIndex,
    userId: player.user_id,
  });
}

export function saveOnlineSessionFromGameState(
  room: OnlineRoom,
  gamePlayers: Array<{
    id: string;
    name: string;
    userId: string;
  }>,
  userId: string,
) {
  const playerIndex = gamePlayers.findIndex((player) => {
    return player.userId === userId;
  });
  const player = gamePlayers[playerIndex];

  if (!player) {
    return null;
  }

  return saveOnlineSession({
    displayName: player.name,
    isHost: room.host_user_id === userId,
    playerId: player.id,
    roomCode: room.code,
    roomId: room.id,
    savedAt: new Date().toISOString(),
    seatIndex: playerIndex,
    userId: player.userId,
  });
}

function parseOnlineReconnectResult(value: unknown): OnlineReconnectResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const roomCode =
    typeof value.roomCode === "string" ? sanitizeRoomCode(value.roomCode) : "";
  const displayName =
    typeof value.displayName === "string"
      ? normalizePlayerName(value.displayName)
      : "";

  if (
    !isValidRoomCode(roomCode) ||
    typeof value.roomId !== "string" ||
    value.roomId.length === 0 ||
    typeof value.playerId !== "string" ||
    value.playerId.length === 0 ||
    typeof value.userId !== "string" ||
    value.userId.length === 0 ||
    typeof value.isHost !== "boolean" ||
    (value.roomStatus !== "waiting" &&
      value.roomStatus !== "started" &&
      value.roomStatus !== "closed") ||
    displayName.length === 0 ||
    typeof value.seatIndex !== "number" ||
    !Number.isInteger(value.seatIndex) ||
    value.seatIndex < 0 ||
    value.seatIndex >= MAX_ONLINE_PLAYERS
  ) {
    return null;
  }

  return {
    displayName,
    isHost: value.isHost,
    playerId: value.playerId,
    roomCode,
    roomId: value.roomId,
    roomStatus: value.roomStatus,
    seatIndex: value.seatIndex,
    userId: value.userId,
  };
}

export async function reconnectOnlineSession(
  supabase: SupabaseClient,
  session: StoredOnlineSession,
) {
  const { data, error } = await supabase.rpc("reconnect_online_player", {
    expected_player_id: session.playerId,
    target_room_id: session.roomId,
  });

  if (error) {
    throw error;
  }

  const reconnectResult = parseOnlineReconnectResult(data);

  if (!reconnectResult) {
    throw new Error("Saved online session could not be restored.");
  }

  const savedSession = saveOnlineSession({
    displayName: reconnectResult.displayName,
    isHost: reconnectResult.isHost,
    playerId: reconnectResult.playerId,
    roomCode: reconnectResult.roomCode,
    roomId: reconnectResult.roomId,
    savedAt: new Date().toISOString(),
    seatIndex: reconnectResult.seatIndex,
    userId: reconnectResult.userId,
  });

  if (!savedSession) {
    throw new Error("Saved online session could not be refreshed.");
  }

  return {
    ...savedSession,
    roomStatus: reconnectResult.roomStatus,
  };
}

export async function heartbeatOnlineSession(
  supabase: SupabaseClient,
  session: StoredOnlineSession,
) {
  const { error } = await supabase.rpc("heartbeat_online_player", {
    expected_player_id: session.playerId,
    target_room_id: session.roomId,
  });

  if (error) {
    throw error;
  }
}
