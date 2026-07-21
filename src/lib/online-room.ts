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
  room_id: string;
  user_id: string;
};

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
