export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const BOARD_SPACE_COUNT = 24;
export const STARTING_BALANCE = 1500;
export const CITY_LAUNCH_BONUS = 200;
export const GAME_SESSION_STORAGE_KEY = "property-empire.game-state";

export const PLAYER_TOKEN_COLORS = ["#ef476f", "#3454d1", "#06d6a0", "#f8961e"];

export type PlayerState = {
  id: string;
  name: string;
  balance: number;
  color: string;
  isDetained: boolean;
  isEliminated: boolean;
  position: number;
};

export type DiceRoll = {
  dieOne: number;
  dieTwo: number;
  total: number;
};

export type PropertyOwners = Record<string, string>;

export type ResolvedEventCard = {
  title: string;
  description: string;
  result: string;
};

export type GameState = {
  players: PlayerState[];
  currentPlayerIndex: number;
  lastRoll: DiceRoll | null;
  lastEventCard: ResolvedEventCard | null;
  hasRolledThisTurn: boolean;
  isDetentionTurn: boolean;
  pendingPropertyPurchasePosition: number | null;
  propertyOwners: PropertyOwners;
  message: string;
  winnerPlayerId: string | null;
};

export function createGameState(playerNames: string[]): GameState {
  return {
    currentPlayerIndex: 0,
    hasRolledThisTurn: false,
    isDetentionTurn: false,
    lastEventCard: null,
    lastRoll: null,
    message: `${playerNames[0]} starts at Grand Plaza.`,
    pendingPropertyPurchasePosition: null,
    players: playerNames.map((playerName, index) => ({
      balance: STARTING_BALANCE,
      color: PLAYER_TOKEN_COLORS[index],
      id: `player-${index + 1}`,
      isDetained: false,
      isEliminated: false,
      name: playerName,
      position: 0,
    })),
    propertyOwners: {},
    winnerPlayerId: null,
  };
}

export function parsePlayerNames(playerNames: string[]) {
  const trimmedPlayerNames = playerNames.map((playerName) => playerName.trim());

  if (
    trimmedPlayerNames.length < MIN_PLAYERS ||
    trimmedPlayerNames.length > MAX_PLAYERS ||
    trimmedPlayerNames.some((playerName) => playerName.length === 0)
  ) {
    return null;
  }

  return trimmedPlayerNames;
}

export function parseStoredGameState(rawGameState: string | null): GameState | null {
  if (!rawGameState) {
    return null;
  }

  try {
    const parsedData: unknown = JSON.parse(rawGameState);

    if (!isRecord(parsedData)) {
      return null;
    }

    const players = Array.isArray(parsedData.players)
      ? parsedData.players
      : [];

    const currentPlayerIndex = parsedData.currentPlayerIndex;
    const hasRolledThisTurn = parsedData.hasRolledThisTurn;
    const isDetentionTurn =
      parsedData.isDetentionTurn === undefined
        ? false
        : parsedData.isDetentionTurn;
    const message = parsedData.message;

    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      return null;
    }

    if (
      typeof currentPlayerIndex !== "number" ||
      !Number.isInteger(currentPlayerIndex) ||
      currentPlayerIndex < 0 ||
      currentPlayerIndex >= players.length ||
      typeof hasRolledThisTurn !== "boolean" ||
      typeof isDetentionTurn !== "boolean" ||
      typeof message !== "string"
    ) {
      return null;
    }

    const parsedPlayers: PlayerState[] = [];

    for (const player of players) {
      const parsedPlayer = parsePlayerState(player);

      if (!parsedPlayer) {
        return null;
      }

      parsedPlayers.push(parsedPlayer);
    }

    const parsedRoll = parseDiceRoll(parsedData.lastRoll);
    const parsedEventCard = parseResolvedEventCard(parsedData.lastEventCard);
    const parsedWinnerPlayerId = parseWinnerPlayerId(
      parsedData.winnerPlayerId,
      parsedPlayers,
    );

    if (
      parsedRoll === undefined ||
      parsedEventCard === undefined ||
      parsedWinnerPlayerId === undefined
    ) {
      return null;
    }

    const parsedPropertyOwners = parsePropertyOwners(
      parsedData.propertyOwners,
      parsedPlayers,
    );
    const pendingPropertyPurchasePosition = parsePendingPropertyPurchasePosition(
      parsedData.pendingPropertyPurchasePosition,
    );

    if (
      !parsedPropertyOwners ||
      pendingPropertyPurchasePosition === undefined
    ) {
      return null;
    }

    const activePlayers = parsedPlayers.filter(
      (player) => !player.isEliminated,
    );
    const currentPlayer = parsedPlayers[currentPlayerIndex];
    const winnerPlayerId =
      parsedWinnerPlayerId ??
      (activePlayers.length === 1 ? activePlayers[0].id : null);

    if (activePlayers.length === 0) {
      return null;
    }

    if (
      winnerPlayerId !== null &&
      (activePlayers.length !== 1 ||
        activePlayers[0].id !== winnerPlayerId ||
        currentPlayer.id !== winnerPlayerId ||
        hasRolledThisTurn ||
        isDetentionTurn ||
        pendingPropertyPurchasePosition !== null)
    ) {
      return null;
    }

    if (
      winnerPlayerId === null &&
      (activePlayers.length < 2 ||
        currentPlayer.isEliminated ||
        (isDetentionTurn &&
          (!currentPlayer.isDetained ||
            hasRolledThisTurn ||
            pendingPropertyPurchasePosition !== null)))
    ) {
      return null;
    }

    return {
      currentPlayerIndex,
      hasRolledThisTurn,
      isDetentionTurn,
      lastEventCard: parsedEventCard,
      lastRoll: parsedRoll,
      message,
      pendingPropertyPurchasePosition,
      players: parsedPlayers,
      propertyOwners: parsedPropertyOwners,
      winnerPlayerId,
    };
  } catch {
    return null;
  }
}

function parsePlayerState(player: unknown): PlayerState | null {
  if (!isRecord(player)) {
    return null;
  }

  if (
    typeof player.id !== "string" ||
    typeof player.name !== "string" ||
    player.name.trim().length === 0 ||
    typeof player.color !== "string" ||
    (player.isDetained !== undefined &&
      typeof player.isDetained !== "boolean") ||
    (player.isEliminated !== undefined &&
      typeof player.isEliminated !== "boolean") ||
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
    isEliminated: player.isEliminated === true,
    name: player.name.trim(),
    position: player.position,
  };
}

function parsePropertyOwners(
  propertyOwners: unknown,
  players: PlayerState[],
): PropertyOwners | null {
  if (propertyOwners === undefined) {
    return {};
  }

  if (!isRecord(propertyOwners)) {
    return null;
  }

  const playersById = new Map(players.map((player) => [player.id, player]));
  const parsedPropertyOwners: PropertyOwners = {};

  for (const [position, ownerId] of Object.entries(propertyOwners)) {
    const numericPosition = Number(position);
    const owner = typeof ownerId === "string" ? playersById.get(ownerId) : null;

    if (
      !Number.isInteger(numericPosition) ||
      numericPosition < 0 ||
      numericPosition >= BOARD_SPACE_COUNT ||
      typeof ownerId !== "string" ||
      !owner ||
      owner.isEliminated
    ) {
      return null;
    }

    parsedPropertyOwners[position] = ownerId;
  }

  return parsedPropertyOwners;
}

function parseWinnerPlayerId(
  winnerPlayerId: unknown,
  players: PlayerState[],
): string | null | undefined {
  if (winnerPlayerId === undefined || winnerPlayerId === null) {
    return null;
  }

  if (typeof winnerPlayerId !== "string") {
    return undefined;
  }

  return players.some((player) => player.id === winnerPlayerId)
    ? winnerPlayerId
    : undefined;
}

function parsePendingPropertyPurchasePosition(position: unknown) {
  if (position === undefined || position === null) {
    return null;
  }

  if (
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0 ||
    position >= BOARD_SPACE_COUNT
  ) {
    return undefined;
  }

  return position;
}

function parseDiceRoll(roll: unknown): DiceRoll | null | undefined {
  if (roll === null) {
    return null;
  }

  if (!isRecord(roll)) {
    return undefined;
  }

  if (
    typeof roll.dieOne !== "number" ||
    typeof roll.dieTwo !== "number" ||
    typeof roll.total !== "number" ||
    !Number.isInteger(roll.dieOne) ||
    !Number.isInteger(roll.dieTwo) ||
    !Number.isInteger(roll.total) ||
    roll.dieOne < 1 ||
    roll.dieOne > 6 ||
    roll.dieTwo < 1 ||
    roll.dieTwo > 6 ||
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

function parseResolvedEventCard(
  eventCard: unknown,
): ResolvedEventCard | null | undefined {
  if (eventCard === undefined || eventCard === null) {
    return null;
  }

  if (!isRecord(eventCard)) {
    return undefined;
  }

  if (
    typeof eventCard.title !== "string" ||
    eventCard.title.trim().length === 0 ||
    typeof eventCard.description !== "string" ||
    eventCard.description.trim().length === 0 ||
    typeof eventCard.result !== "string" ||
    eventCard.result.trim().length === 0
  ) {
    return undefined;
  }

  return {
    description: eventCard.description.trim(),
    result: eventCard.result.trim(),
    title: eventCard.title.trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
