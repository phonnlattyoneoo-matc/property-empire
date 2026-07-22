"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useSyncExternalStore } from "react";
import {
  BOARD_SPACE_COUNT,
  CITY_LAUNCH_BONUS,
  GAME_SESSION_STORAGE_KEY,
  STARTING_BALANCE,
  type GameState,
  type PlayerState,
  parseStoredGameState,
} from "@/lib/game-state";

type SpaceType =
  | "start"
  | "property"
  | "transit"
  | "event"
  | "tax"
  | "rest"
  | "detention";

type BoardSpace = {
  name: string;
  type: SpaceType;
  price?: number;
  rent?: number;
  taxAmount?: number;
};

type PurchasablePropertySpace = BoardSpace & {
  type: "property";
  price: number;
  rent: number;
};

type PurchasableTransitSpace = BoardSpace & {
  type: "transit";
  price: number;
};

type BuyableSpace = PurchasablePropertySpace | PurchasableTransitSpace;

type MoneyEventCard = {
  title: string;
  description: string;
  type: "money";
  amount: number;
};

type MoveEventCard = {
  title: string;
  description: string;
  type: "move";
  spaces: number;
};

type MoveToEventCard = {
  title: string;
  description: string;
  type: "moveTo";
  destinationPosition: number;
};

type DetentionEventCard = {
  title: string;
  description: string;
  type: "detention";
};

type EventCard =
  | MoneyEventCard
  | MoveEventCard
  | MoveToEventCard
  | DetentionEventCard;

type EventResolution = {
  balance: number;
  isDetained: boolean;
  position: number;
  result: string;
};

const GAME_STATE_EVENT = "property-empire.game-state-change";
const TRANSIT_PRICE = 200;
const TRANSIT_RENTS = [0, 25, 50, 100];

const boardSpaces: BoardSpace[] = [
  { name: "Grand Plaza", type: "start" },
  { name: "CoLab Court", type: "property", price: 120, rent: 12 },
  { name: "City Tax", type: "tax", taxAmount: 150 },
  { name: "Pixel Row", type: "property", price: 140, rent: 14 },
  { name: "Metro Loop", type: "transit", price: TRANSIT_PRICE },
  { name: "Pop-Up Market", type: "event" },
  { name: "Skyline Lofts", type: "property", price: 180, rent: 18 },
  { name: "Canal Walk", type: "property", price: 200, rent: 20 },
  { name: "Maker Lane", type: "property", price: 220, rent: 22 },
  { name: "Harbor Line", type: "transit", price: TRANSIT_PRICE },
  { name: "Street Fest", type: "event" },
  { name: "Glass Tower", type: "property", price: 260, rent: 26 },
  { name: "Civic Detention", type: "detention" },
  { name: "Greenway Flats", type: "property", price: 240, rent: 24 },
  { name: "Grid Levy", type: "tax", taxAmount: 100 },
  { name: "Central Rail", type: "transit", price: TRANSIT_PRICE },
  { name: "Neon Arcade", type: "property", price: 280, rent: 28 },
  { name: "City Vote", type: "event" },
  { name: "Rooftop Rest", type: "rest" },
  { name: "Market Hall", type: "property", price: 320, rent: 32 },
  { name: "Riverfront", type: "property", price: 360, rent: 36 },
  { name: "Bike Hub", type: "transit", price: TRANSIT_PRICE },
  { name: "Night Market", type: "event" },
  { name: "Depot Flats", type: "property", price: 300, rent: 30 },
];

const DETENTION_POSITION = boardSpaces.findIndex(
  (space) => space.name === "Civic Detention",
);

const eventDeck: EventCard[] = [
  {
    amount: 90,
    description:
      "A rooftop efficiency program sends a rebate straight to your city account.",
    title: "Rooftop Solar Rebate",
    type: "money",
  },
  {
    amount: -60,
    description:
      "Your renovation crew missed a late-night work permit deadline.",
    title: "After-Hours Permit",
    type: "money",
  },
  {
    description:
      "A protected scooter lane opens early and gets you across town fast.",
    spaces: 3,
    title: "Express Scooter Lane",
    type: "move",
  },
  {
    description:
      "Bridge maintenance reroutes traffic through side streets.",
    spaces: -2,
    title: "Bridge Detour",
    type: "move",
  },
  {
    amount: 120,
    description:
      "A weekend vendor fair drives surprise revenue to your holdings.",
    title: "Pop-Up Sales Surge",
    type: "money",
  },
  {
    amount: -80,
    description:
      "Smart-meter auditors find an old utility charge nobody budgeted for.",
    title: "Smart Meter Audit",
    type: "money",
  },
  {
    description:
      "Your startup demo goes viral and pulls you toward the entertainment district.",
    destinationPosition: 16,
    title: "Citywide App Launch",
    type: "moveTo",
  },
  {
    description:
      "A ferry captain shows you a faster route through the harbor grid.",
    destinationPosition: 9,
    title: "Harbor Shortcut",
    type: "moveTo",
  },
  {
    description:
      "A green corridor grant points your crew toward new residential blocks.",
    destinationPosition: 13,
    title: "Green Corridor Grant",
    type: "moveTo",
  },
  {
    amount: -45,
    description:
      "A sponsored night market closes with cleanup costs on your ledger.",
    title: "Late Night Cleanup",
    type: "money",
  },
  {
    amount: 75,
    description:
      "Neighborhood organizers share festival proceeds with nearby investors.",
    title: "Community Festival",
    type: "money",
  },
  {
    description:
      "A station announcement sends your group to the wrong platform.",
    spaces: -4,
    title: "Transit Mix-Up",
    type: "move",
  },
  {
    description:
      "A surprise compliance hearing pulls you away from the table.",
    title: "Civic Hold Notice",
    type: "detention",
  },
];

const spaceStyles: Record<
  SpaceType,
  { accent: string; label: string; tint: string }
> = {
  start: { accent: "#06d6a0", label: "Start", tint: "#e7fbf4" },
  property: { accent: "#3454d1", label: "Property", tint: "#eef1ff" },
  transit: { accent: "#118ab2", label: "Transit", tint: "#e8f7fc" },
  event: { accent: "#f8961e", label: "Event", tint: "#fff1de" },
  tax: { accent: "#ef476f", label: "Tax", tint: "#ffedf2" },
  rest: { accent: "#43aa8b", label: "Rest Area", tint: "#edf8f4" },
  detention: {
    accent: "#171915",
    label: "Detention Center",
    tint: "#f1f1ed",
  },
};

let cachedGameStateRaw: string | null | undefined;
let cachedGameStateSnapshot: GameState | null = null;

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

function isPurchasableProperty(
  space: BoardSpace,
): space is PurchasablePropertySpace {
  return (
    space.type === "property" &&
    typeof space.price === "number" &&
    typeof space.rent === "number"
  );
}

function isPurchasableTransit(
  space: BoardSpace,
): space is PurchasableTransitSpace {
  return space.type === "transit" && typeof space.price === "number";
}

function isBuyableSpace(space: BoardSpace): space is BuyableSpace {
  return isPurchasableProperty(space) || isPurchasableTransit(space);
}

function isTaxSpace(
  space: BoardSpace,
): space is BoardSpace & { type: "tax"; taxAmount: number } {
  return space.type === "tax" && typeof space.taxAmount === "number";
}

function getWrappedPosition(position: number) {
  return (
    ((position % BOARD_SPACE_COUNT) + BOARD_SPACE_COUNT) % BOARD_SPACE_COUNT
  );
}

function getClockwiseMoveResult(currentPosition: number, spaces: number) {
  const positionTotal = currentPosition + spaces;

  return {
    position: getWrappedPosition(positionTotal),
    receivesLaunchBonus: positionTotal >= BOARD_SPACE_COUNT,
  };
}

function getCounterClockwiseMoveResult(currentPosition: number, spaces: number) {
  return {
    position: getWrappedPosition(currentPosition - spaces),
    receivesLaunchBonus: currentPosition > 0 && spaces >= currentPosition,
  };
}

function getDirectMoveResult(
  currentPosition: number,
  destinationPosition: number,
) {
  return {
    position: destinationPosition,
    receivesLaunchBonus:
      currentPosition !== destinationPosition &&
      (destinationPosition === 0 || destinationPosition < currentPosition),
  };
}

function getNegativeBalanceWarning(playerName: string, balance: number) {
  return balance < 0
    ? ` Warning: ${playerName}'s balance is now below $0.`
    : "";
}

function getDetentionTurnMessage(playerName: string) {
  return `${playerName} is detained at Civic Detention and must miss this turn.`;
}

function drawEventCard() {
  return eventDeck[Math.floor(Math.random() * eventDeck.length)];
}

function resolveEventCard({
  currentBalance,
  currentPlayerName,
  currentPosition,
  eventCard,
}: {
  currentBalance: number;
  currentPlayerName: string;
  currentPosition: number;
  eventCard: EventCard;
}): EventResolution {
  if (eventCard.type === "money") {
    const balance = currentBalance + eventCard.amount;
    const result =
      eventCard.amount >= 0
        ? `${currentPlayerName} received ${formatCurrency(eventCard.amount)}.`
        : `${currentPlayerName} paid ${formatCurrency(
            Math.abs(eventCard.amount),
          )}.`;

    return {
      balance,
      isDetained: false,
      position: currentPosition,
      result: `${result}${getNegativeBalanceWarning(
        currentPlayerName,
        balance,
      )}`,
    };
  }

  if (eventCard.type === "detention") {
    return {
      balance: currentBalance,
      isDetained: true,
      position: DETENTION_POSITION,
      result: `${currentPlayerName} was sent directly to Civic Detention and will miss their next turn.`,
    };
  }

  if (eventCard.type === "moveTo") {
    const moveResult = getDirectMoveResult(
      currentPosition,
      eventCard.destinationPosition,
    );
    const destination = boardSpaces[moveResult.position];
    const balance =
      currentBalance +
      (moveResult.receivesLaunchBonus ? CITY_LAUNCH_BONUS : 0);
    const launchBonusMessage = moveResult.receivesLaunchBonus
      ? ` ${currentPlayerName} collected a ${formatCurrency(
          CITY_LAUNCH_BONUS,
        )} City Launch Bonus.`
      : "";

    return {
      balance,
      isDetained: false,
      position: moveResult.position,
      result: `${currentPlayerName} moved directly to ${destination.name}.${launchBonusMessage}${getNegativeBalanceWarning(
        currentPlayerName,
        balance,
      )}`,
    };
  }

  const spaces = Math.abs(eventCard.spaces);
  const moveResult =
    eventCard.spaces >= 0
      ? getClockwiseMoveResult(currentPosition, spaces)
      : getCounterClockwiseMoveResult(currentPosition, spaces);
  const direction = eventCard.spaces >= 0 ? "forward" : "backward";
  const destination = boardSpaces[moveResult.position];
  const balance =
    currentBalance + (moveResult.receivesLaunchBonus ? CITY_LAUNCH_BONUS : 0);
  const launchBonusMessage = moveResult.receivesLaunchBonus
    ? ` ${currentPlayerName} collected a ${formatCurrency(
        CITY_LAUNCH_BONUS,
      )} City Launch Bonus.`
    : "";

  return {
    balance,
    isDetained: false,
    position: moveResult.position,
    result: `${currentPlayerName} moved ${direction} ${spaces} spaces to ${destination.name}.${launchBonusMessage}${getNegativeBalanceWarning(
      currentPlayerName,
      balance,
    )}`,
  };
}

function getSpaceOwner(gameState: GameState, position: number) {
  const ownerId = gameState.propertyOwners[String(position)];

  if (!ownerId) {
    return undefined;
  }

  return gameState.players.find((player) => player.id === ownerId);
}

function getOwnedTransitCount(gameState: GameState, ownerId: string) {
  return boardSpaces.reduce((ownedTransitCount, space, position) => {
    if (
      isPurchasableTransit(space) &&
      gameState.propertyOwners[String(position)] === ownerId
    ) {
      return ownedTransitCount + 1;
    }

    return ownedTransitCount;
  }, 0);
}

function getTransitRent(stationCount: number) {
  return TRANSIT_RENTS[Math.min(stationCount, TRANSIT_RENTS.length - 1)];
}

function getActivePlayers(players: PlayerState[]) {
  return players.filter((player) => !player.isEliminated);
}

function getWinnerPlayer(gameState: GameState) {
  if (!gameState.winnerPlayerId) {
    return undefined;
  }

  return gameState.players.find(
    (player) => player.id === gameState.winnerPlayerId,
  );
}

function getNextActivePlayerIndex(players: PlayerState[], currentIndex: number) {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const nextIndex = (currentIndex + offset) % players.length;

    if (!players[nextIndex].isEliminated) {
      return nextIndex;
    }
  }

  return currentIndex;
}

function getTurnStartMessage(player: PlayerState) {
  return player.isDetained
    ? getDetentionTurnMessage(player.name)
    : `${player.name}'s turn. Roll the dice.`;
}

function releasePlayerHoldings(
  propertyOwners: GameState["propertyOwners"],
  ownerId: string,
) {
  return Object.fromEntries(
    Object.entries(propertyOwners).filter(([, currentOwnerId]) => {
      return currentOwnerId !== ownerId;
    }),
  );
}

function getLandingSpaceMessage({
  currentPlayerName,
  destination,
  destinationOwnerName,
  ownedTransitCount,
  owesRent,
  rentPayment,
  resultingBalance,
}: {
  currentPlayerName: string;
  destination: BoardSpace;
  destinationOwnerName?: string;
  ownedTransitCount: number;
  owesRent: boolean;
  rentPayment: number;
  resultingBalance: number;
}) {
  if (!isBuyableSpace(destination)) {
    return "";
  }

  if (!destinationOwnerName) {
    if (isPurchasableTransit(destination)) {
      return ` ${destination.name} is available for ${formatCurrency(
        destination.price,
      )}. Transit rent starts at ${formatCurrency(TRANSIT_RENTS[1])}.`;
    }

    return ` ${destination.name} is available for ${formatCurrency(
      destination.price,
    )}. Rent is ${formatCurrency(destination.rent)}.`;
  }

  if (!owesRent) {
    return ` ${currentPlayerName} already owns ${destination.name}.`;
  }

  const negativeBalanceWarning =
    resultingBalance < 0
      ? ` Warning: ${currentPlayerName}'s balance is now below $0.`
      : "";

  if (isPurchasableTransit(destination)) {
    return ` ${destination.name} is owned by ${destinationOwnerName}. ${currentPlayerName} paid ${formatCurrency(
      rentPayment,
    )} transit rent to ${destinationOwnerName} because ${destinationOwnerName} owns ${ownedTransitCount} station${
      ownedTransitCount === 1 ? "" : "s"
    }.${negativeBalanceWarning}`;
  }

  if (!isPurchasableProperty(destination)) {
    return "";
  }

  return ` ${destination.name} is owned by ${destinationOwnerName}. ${currentPlayerName} paid ${formatCurrency(
    destination.rent,
  )} rent to ${destinationOwnerName}.${negativeBalanceWarning}`;
}

function subscribeToGameState(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(GAME_STATE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(GAME_STATE_EVENT, onStoreChange);
  };
}

function getGameStateSnapshot() {
  const rawGameState = sessionStorage.getItem(GAME_SESSION_STORAGE_KEY);

  if (rawGameState === cachedGameStateRaw) {
    return cachedGameStateSnapshot;
  }

  cachedGameStateRaw = rawGameState;
  cachedGameStateSnapshot = parseStoredGameState(rawGameState);

  return cachedGameStateSnapshot;
}

function saveGameState(gameState: GameState) {
  sessionStorage.setItem(GAME_SESSION_STORAGE_KEY, JSON.stringify(gameState));
  window.dispatchEvent(new Event(GAME_STATE_EVENT));
}

function clearGameState() {
  sessionStorage.removeItem(GAME_SESSION_STORAGE_KEY);
}

export default function GamePage() {
  const router = useRouter();
  const gameState = useSyncExternalStore(
    subscribeToGameState,
    getGameStateSnapshot,
    () => undefined,
  );

  useEffect(() => {
    if (gameState === null) {
      router.replace("/setup");
    }
  }, [gameState, router]);

  function rollDice() {
    if (!gameState || gameState.hasRolledThisTurn || gameState.winnerPlayerId) {
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (
      gameState.isDetentionTurn ||
      currentPlayer.isDetained ||
      currentPlayer.isEliminated
    ) {
      return;
    }

    const dieOne = rollDie();
    const dieTwo = rollDie();
    const total = dieOne + dieTwo;
    const diceMoveResult = getClockwiseMoveResult(
      currentPlayer.position,
      total,
    );
    const destination = boardSpaces[diceMoveResult.position];
    const launchBonusText = diceMoveResult.receivesLaunchBonus
      ? `, and collected a ${formatCurrency(
          CITY_LAUNCH_BONUS,
        )} City Launch Bonus`
      : "";
    const rollMessage = `${currentPlayer.name} rolled ${dieOne} and ${dieTwo} for ${total}, moved to ${destination.name}${launchBonusText}.`;
    let updatedCurrentPlayerBalance =
      currentPlayer.balance +
      (diceMoveResult.receivesLaunchBonus ? CITY_LAUNCH_BONUS : 0);

    if (isTaxSpace(destination)) {
      updatedCurrentPlayerBalance -= destination.taxAmount;

      const players = gameState.players.map((player, index) =>
        index === gameState.currentPlayerIndex
          ? {
              ...player,
              balance: updatedCurrentPlayerBalance,
              position: diceMoveResult.position,
            }
          : player,
      );

      saveGameState({
        ...gameState,
        hasRolledThisTurn: true,
        lastEventCard: null,
        lastRoll: { dieOne, dieTwo, total },
        message: `${rollMessage} ${currentPlayer.name} paid ${formatCurrency(
          destination.taxAmount,
        )} ${destination.name}.${getNegativeBalanceWarning(
          currentPlayer.name,
          updatedCurrentPlayerBalance,
        )}`,
        pendingPropertyPurchasePosition: null,
        players,
      });

      return;
    }

    if (destination.type === "event") {
      const eventCard = drawEventCard();
      const eventStartsWithLaunchBonus = eventCard.type !== "detention";
      const eventStartingBalance =
        currentPlayer.balance +
        (eventStartsWithLaunchBonus && diceMoveResult.receivesLaunchBonus
          ? CITY_LAUNCH_BONUS
          : 0);
      const eventRollMessage = eventStartsWithLaunchBonus
        ? rollMessage
        : `${currentPlayer.name} rolled ${dieOne} and ${dieTwo} for ${total}, moved to ${destination.name}.`;
      const eventResolution = resolveEventCard({
        currentBalance: eventStartingBalance,
        currentPlayerName: currentPlayer.name,
        currentPosition: diceMoveResult.position,
        eventCard,
      });
      const players = gameState.players.map((player, index) =>
        index === gameState.currentPlayerIndex
          ? {
              ...player,
              balance: eventResolution.balance,
              isDetained: eventResolution.isDetained,
              position: eventResolution.position,
            }
          : player,
      );

      saveGameState({
        ...gameState,
        hasRolledThisTurn: true,
        lastEventCard: {
          description: eventCard.description,
          result: eventResolution.result,
          title: eventCard.title,
        },
        lastRoll: { dieOne, dieTwo, total },
        message: `${eventRollMessage} Event: ${eventCard.title}. ${eventResolution.result}`,
        pendingPropertyPurchasePosition: null,
        players,
      });

      return;
    }

    if (destination.type === "detention") {
      const players = gameState.players.map((player, index) =>
        index === gameState.currentPlayerIndex
          ? {
              ...player,
              balance: updatedCurrentPlayerBalance,
              position: diceMoveResult.position,
            }
          : player,
      );

      saveGameState({
        ...gameState,
        hasRolledThisTurn: true,
        lastEventCard: null,
        lastRoll: { dieOne, dieTwo, total },
        message: `${rollMessage} ${currentPlayer.name} is visiting Civic Detention and will not miss their next turn.`,
        pendingPropertyPurchasePosition: null,
        players,
      });

      return;
    }

    if (destination.type === "rest") {
      const players = gameState.players.map((player, index) =>
        index === gameState.currentPlayerIndex
          ? {
              ...player,
              balance: updatedCurrentPlayerBalance,
              position: diceMoveResult.position,
            }
          : player,
      );

      saveGameState({
        ...gameState,
        hasRolledThisTurn: true,
        lastEventCard: null,
        lastRoll: { dieOne, dieTwo, total },
        message: `${rollMessage} ${currentPlayer.name} is taking a break at Rooftop Rest.`,
        pendingPropertyPurchasePosition: null,
        players,
      });

      return;
    }

    const destinationOwner = getSpaceOwner(gameState, diceMoveResult.position);
    const ownedTransitCount =
      isPurchasableTransit(destination) && destinationOwner
        ? getOwnedTransitCount(gameState, destinationOwner.id)
        : 0;
    const rentPayment = (() => {
      if (!destinationOwner || destinationOwner.id === currentPlayer.id) {
        return 0;
      }

      if (isPurchasableProperty(destination)) {
        return destination.rent;
      }

      if (isPurchasableTransit(destination)) {
        return getTransitRent(ownedTransitCount);
      }

      return 0;
    })();
    const rentOwnerId =
      rentPayment > 0 && destinationOwner ? destinationOwner.id : undefined;
    const owesRent = rentPayment > 0 && rentOwnerId !== undefined;
    const pendingPropertyPurchasePosition =
      isBuyableSpace(destination) && !destinationOwner
        ? diceMoveResult.position
        : null;

    if (owesRent) {
      updatedCurrentPlayerBalance -= rentPayment;
    }

    const spaceMessage = getLandingSpaceMessage({
      currentPlayerName: currentPlayer.name,
      destination,
      destinationOwnerName: destinationOwner?.name,
      ownedTransitCount,
      owesRent,
      rentPayment,
      resultingBalance: updatedCurrentPlayerBalance,
    });

    const players = gameState.players.map((player, index) =>
      index === gameState.currentPlayerIndex
        ? {
            ...player,
            balance: updatedCurrentPlayerBalance,
            position: diceMoveResult.position,
          }
        : owesRent && player.id === rentOwnerId
          ? {
              ...player,
              balance: player.balance + rentPayment,
            }
          : player,
    );

    saveGameState({
      ...gameState,
      hasRolledThisTurn: true,
      lastEventCard: null,
      lastRoll: { dieOne, dieTwo, total },
      message: `${rollMessage}${spaceMessage}`,
      pendingPropertyPurchasePosition,
      players,
    });
  }

  function endTurn() {
    if (
      !gameState ||
      gameState.winnerPlayerId ||
      !gameState.hasRolledThisTurn ||
      gameState.pendingPropertyPurchasePosition !== null ||
      gameState.isDetentionTurn
    ) {
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (currentPlayer.isEliminated) {
      return;
    }

    if (currentPlayer.balance < 0) {
      declareBankruptcy();
      return;
    }

    const nextPlayerIndex = getNextActivePlayerIndex(
      gameState.players,
      gameState.currentPlayerIndex,
    );
    const nextPlayer = gameState.players[nextPlayerIndex];
    const isNextPlayerDetained = nextPlayer.isDetained;

    saveGameState({
      ...gameState,
      currentPlayerIndex: nextPlayerIndex,
      hasRolledThisTurn: false,
      isDetentionTurn: isNextPlayerDetained,
      lastEventCard: null,
      lastRoll: null,
      message: getTurnStartMessage(nextPlayer),
      pendingPropertyPurchasePosition: null,
    });
  }

  function leaveDetention() {
    if (!gameState || gameState.winnerPlayerId || !gameState.isDetentionTurn) {
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (!currentPlayer.isDetained) {
      return;
    }

    const players = gameState.players.map((player, index) =>
      index === gameState.currentPlayerIndex
        ? { ...player, isDetained: false }
        : player,
    );
    const nextPlayerIndex = getNextActivePlayerIndex(
      players,
      gameState.currentPlayerIndex,
    );
    const nextPlayer = players[nextPlayerIndex];
    const isNextPlayerDetained = nextPlayer.isDetained;

    saveGameState({
      ...gameState,
      currentPlayerIndex: nextPlayerIndex,
      hasRolledThisTurn: false,
      isDetentionTurn: isNextPlayerDetained,
      lastEventCard: null,
      lastRoll: null,
      message: isNextPlayerDetained
        ? `${currentPlayer.name} left Civic Detention after missing one turn. ${getDetentionTurnMessage(
            nextPlayer.name,
          )}`
        : `${currentPlayer.name} left Civic Detention after missing one turn. ${nextPlayer.name}'s turn. Roll the dice.`,
      pendingPropertyPurchasePosition: null,
      players,
    });
  }

  function buySpace() {
    if (
      !gameState ||
      gameState.winnerPlayerId ||
      gameState.pendingPropertyPurchasePosition === null
    ) {
      return;
    }

    const position = gameState.pendingPropertyPurchasePosition;
    const space = boardSpaces[position];
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (
      !isBuyableSpace(space) ||
      getSpaceOwner(gameState, position) ||
      currentPlayer.isEliminated ||
      currentPlayer.balance < space.price
    ) {
      return;
    }

    const players = gameState.players.map((player, index) =>
      index === gameState.currentPlayerIndex
        ? { ...player, balance: player.balance - space.price }
        : player,
    );

    saveGameState({
      ...gameState,
      message: `${currentPlayer.name} bought ${space.name} for ${formatCurrency(
        space.price,
      )}.`,
      pendingPropertyPurchasePosition: null,
      players,
      propertyOwners: {
        ...gameState.propertyOwners,
        [String(position)]: currentPlayer.id,
      },
    });
  }

  function skipPurchase() {
    if (
      !gameState ||
      gameState.winnerPlayerId ||
      gameState.pendingPropertyPurchasePosition === null
    ) {
      return;
    }

    const space = boardSpaces[gameState.pendingPropertyPurchasePosition];

    if (!isBuyableSpace(space)) {
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (currentPlayer.isEliminated) {
      return;
    }

    saveGameState({
      ...gameState,
      message: `${currentPlayer.name} skipped buying ${space.name}.`,
      pendingPropertyPurchasePosition: null,
    });
  }

  function declareBankruptcy() {
    if (
      !gameState ||
      gameState.winnerPlayerId ||
      !gameState.hasRolledThisTurn ||
      gameState.pendingPropertyPurchasePosition !== null ||
      gameState.isDetentionTurn
    ) {
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (currentPlayer.isEliminated || currentPlayer.balance >= 0) {
      return;
    }

    const players = gameState.players.map((player, index) =>
      index === gameState.currentPlayerIndex
        ? { ...player, isDetained: false, isEliminated: true }
        : player,
    );
    const activePlayers = getActivePlayers(players);
    const winnerPlayer = activePlayers.length === 1 ? activePlayers[0] : null;
    const nextPlayerIndex = winnerPlayer
      ? players.findIndex((player) => player.id === winnerPlayer.id)
      : getNextActivePlayerIndex(players, gameState.currentPlayerIndex);
    const nextPlayer = players[nextPlayerIndex];
    const releasedPropertyOwners = releasePlayerHoldings(
      gameState.propertyOwners,
      currentPlayer.id,
    );
    const releaseMessage = `${currentPlayer.name}'s properties and transit stations are now unowned.`;

    saveGameState({
      ...gameState,
      currentPlayerIndex: nextPlayerIndex,
      hasRolledThisTurn: false,
      isDetentionTurn: winnerPlayer ? false : nextPlayer.isDetained,
      lastEventCard: null,
      lastRoll: null,
      message: winnerPlayer
        ? `${currentPlayer.name} declared bankruptcy and is eliminated. ${releaseMessage} ${winnerPlayer.name} wins Property Empire with ${formatCurrency(
            winnerPlayer.balance,
          )}.`
        : `${currentPlayer.name} declared bankruptcy and is eliminated. ${releaseMessage} ${getTurnStartMessage(
            nextPlayer,
          )}`,
      pendingPropertyPurchasePosition: null,
      players,
      propertyOwners: releasedPropertyOwners,
      winnerPlayerId: winnerPlayer?.id ?? null,
    });
  }

  function playAgain() {
    clearGameState();
    router.push("/setup");
  }

  function exitGame() {
    clearGameState();
    router.push("/");
  }

  if (!gameState) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7f8f4] px-6 py-16 text-[#171915]">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.05)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.05)_1px,transparent_1px)] bg-[size:44px_44px]"
        />
        <p className="relative z-10 border-2 border-[#171915] bg-white px-6 py-4 text-lg font-black shadow-[8px_8px_0_0_#f9c74f]">
          Preparing Game
        </p>
      </main>
    );
  }

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const winnerPlayer = getWinnerPlayer(gameState);
  const pendingPurchase =
    gameState.pendingPropertyPurchasePosition === null
      ? null
      : boardSpaces[gameState.pendingPropertyPurchasePosition];
  const landedSpace = gameState.hasRolledThisTurn
    ? boardSpaces[currentPlayer.position]
    : null;
  const landedSpaceOwner =
    landedSpace && isBuyableSpace(landedSpace)
      ? getSpaceOwner(gameState, currentPlayer.position)
      : undefined;
  const landedOwnerTransitCount =
    landedSpace &&
    isPurchasableTransit(landedSpace) &&
    landedSpaceOwner !== undefined
      ? getOwnedTransitCount(gameState, landedSpaceOwner.id)
      : 0;
  const landedTransitRent = getTransitRent(landedOwnerTransitCount);
  const showPurchasePanel =
    !winnerPlayer &&
    !currentPlayer.isEliminated &&
    gameState.hasRolledThisTurn &&
    gameState.lastEventCard === null &&
    landedSpace !== null &&
    isBuyableSpace(landedSpace);
  const canBuyPendingPurchase =
    !winnerPlayer &&
    !currentPlayer.isEliminated &&
    pendingPurchase !== null &&
    isBuyableSpace(pendingPurchase) &&
    currentPlayer.balance >= pendingPurchase.price;
  const canEndTurn =
    !winnerPlayer &&
    !currentPlayer.isEliminated &&
    gameState.hasRolledThisTurn &&
    gameState.pendingPropertyPurchasePosition === null &&
    !gameState.isDetentionTurn;
  const isBankruptcyPending = canEndTurn && currentPlayer.balance < 0;
  const canLeaveDetention =
    !winnerPlayer &&
    gameState.isDetentionTurn &&
    currentPlayer.isDetained &&
    !currentPlayer.isEliminated;

  return (
    <main className="game-screen relative min-h-screen overflow-hidden bg-[#f7f8f4] px-4 py-6 text-[#171915] sm:px-8 sm:py-8">
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
                className="game-title-accent mb-4 h-1.5 w-24 bg-[#ef476f]"
                aria-hidden="true"
              />
              <h1 className="game-title text-4xl font-black tracking-normal sm:text-6xl">
                Property Empire
              </h1>
            </div>
            <p className="game-status-pill w-fit border-2 border-[#171915] bg-white px-4 py-2 text-sm font-black shadow-[5px_5px_0_0_#43aa8b]">
              {winnerPlayer
                ? `Winner: ${winnerPlayer.name}`
                : `Current: ${currentPlayer.name}`}
            </p>
          </div>

          {winnerPlayer ? (
            <div
              className="game-action-panel game-winner-panel game-shadow-yellow mb-6 border-2 border-[#171915] bg-[#171915] p-6 text-white shadow-[12px_12px_0_0_#f9c74f] sm:p-8"
              data-testid="winner-panel"
            >
              <p
                className="game-title-accent mb-4 h-1.5 w-24 bg-[#06d6a0]"
                aria-hidden="true"
              />
              <h2 className="game-title text-4xl font-black tracking-normal sm:text-6xl">
                {winnerPlayer.name} Wins
              </h2>
              <p className="mt-4 text-lg font-bold text-[#f7f8f4] sm:text-2xl">
                Final balance: {formatCurrency(winnerPlayer.balance)}
              </p>
              <button
                className="mt-6 h-12 border-2 border-white bg-[#06d6a0] px-6 text-sm font-black text-[#171915] shadow-[6px_6px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/40"
                onClick={playAgain}
                type="button"
              >
                Play Again
              </button>
            </div>
          ) : null}

          <div className="game-board-scroll overflow-x-auto pb-4">
            <div className="game-board grid aspect-square min-w-[620px] grid-cols-7 grid-rows-7 border-2 border-[#171915] bg-[#171915] shadow-[12px_12px_0_0_#f9c74f]">
              {boardSpaces.map((space, index) => {
                const styles = spaceStyles[space.type];
                const spaceOwner = isBuyableSpace(space)
                  ? getSpaceOwner(gameState, index)
                  : undefined;
                const spaceOwnerTransitCount =
                  isPurchasableTransit(space) && spaceOwner
                    ? getOwnedTransitCount(gameState, spaceOwner.id)
                    : 0;
                const playersOnSpace = gameState.players.filter(
                  (player) =>
                    !player.isEliminated && player.position === index,
                );

                return (
                  <div
                    className="game-board-space relative flex min-h-0 flex-col justify-between border border-[#171915] p-1.5 text-[#171915]"
                    data-testid={`board-space-${index}`}
                    key={space.name}
                    style={{
                      ...getBoardPosition(index),
                      backgroundColor: styles.tint,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="game-board-accent absolute inset-x-0 top-0 h-1.5"
                      style={{ backgroundColor: styles.accent }}
                    />
                    <span className="game-board-space-name pt-2 text-[0.66rem] font-black uppercase leading-tight sm:text-xs">
                      {space.name}
                    </span>
                    <span className="game-board-space-label text-[0.52rem] font-bold uppercase leading-tight text-[#596057] sm:text-[0.62rem]">
                      {styles.label}
                    </span>

                    {isBuyableSpace(space) && spaceOwner ? (
                      <div className="mt-1 space-y-0.5">
                        <span
                          className="game-board-space-meta block truncate border border-[#171915] px-1 py-0.5 text-[0.5rem] font-black uppercase leading-tight text-white sm:text-[0.58rem]"
                          title={`Owner: ${spaceOwner.name}`}
                          style={{ backgroundColor: spaceOwner.color }}
                        >
                          Owner: {spaceOwner.name}
                        </span>
                        {isPurchasableProperty(space) ? (
                          <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                            Rent {formatCurrency(space.rent)}
                          </span>
                        ) : (
                          <>
                            <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              Price {formatCurrency(space.price)}
                            </span>
                            <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              Rent{" "}
                              {formatCurrency(
                                getTransitRent(spaceOwnerTransitCount),
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    ) : isPurchasableProperty(space) ? (
                      <div className="game-board-space-meta mt-1 text-[0.55rem] font-black leading-tight text-[#445045] sm:text-[0.62rem]">
                        <span className="block">
                          Price {formatCurrency(space.price)}
                        </span>
                        <span className="block">
                          Rent {formatCurrency(space.rent)}
                        </span>
                      </div>
                    ) : isPurchasableTransit(space) ? (
                      <div className="game-board-space-meta mt-1 text-[0.55rem] font-black leading-tight text-[#445045] sm:text-[0.62rem]">
                        <span className="block">
                          Price {formatCurrency(space.price)}
                        </span>
                        <span className="block">
                          Rent {formatCurrency(TRANSIT_RENTS[1])}+
                        </span>
                      </div>
                    ) : isTaxSpace(space) ? (
                      <div className="game-board-space-meta mt-1 text-[0.55rem] font-black leading-tight text-[#445045] sm:text-[0.62rem]">
                        Pay {formatCurrency(space.taxAmount)}
                      </div>
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
                  City Launch
                </h2>
                <p className="game-board-center-copy mt-4 max-w-md text-base font-bold leading-7 text-[#f7f8f4] sm:text-lg">
                  Pass or land on Grand Plaza to collect{" "}
                  {formatCurrency(CITY_LAUNCH_BONUS)}.
                </p>
              </div>
            </div>
          </div>
        </div>

        <aside className="game-sidebar space-y-5">
          <div className="game-panel game-players-panel game-shadow-green border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#06d6a0] backdrop-blur">
            <h2 className="game-panel-title text-2xl font-black">Players</h2>

            <div className="game-players-list mt-4 space-y-3">
              {gameState.players.map((player, playerIndex) => {
                const isCurrentActivePlayer =
                  !winnerPlayer &&
                  !player.isEliminated &&
                  playerIndex === gameState.currentPlayerIndex;

                return (
                  <div
                    className={`game-player-card flex items-center gap-3 border-2 border-[#171915] p-3 ${
                      player.isEliminated
                        ? "bg-[#e7e8e1] opacity-80"
                        : isCurrentActivePlayer
                          ? "bg-[#f9c74f] shadow-[5px_5px_0_0_#171915]"
                          : "bg-[#f7f8f4]"
                    }`}
                    data-testid={`player-card-${playerIndex + 1}`}
                    key={player.id}
                  >
                    <span
                      aria-hidden="true"
                      className="game-player-token h-6 w-6 shrink-0 rounded-full border-2 border-[#171915]"
                      style={{
                        backgroundColor: player.isEliminated
                          ? "#c6cbbf"
                          : player.color,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="game-player-name break-words text-base font-black">
                        {player.name}
                      </p>
                      <p className="game-player-meta text-sm font-bold text-[#445045]">
                        {formatCurrency(player.balance)}
                      </p>
                      {player.isEliminated ? (
                        <p className="game-player-meta mt-1 text-xs font-black uppercase text-[#ef476f]">
                          Bankrupt
                        </p>
                      ) : player.balance < 0 ? (
                        <p className="game-player-meta mt-1 text-xs font-black uppercase text-[#ef476f]">
                          Negative balance
                        </p>
                      ) : null}
                      {player.isDetained && !player.isEliminated ? (
                        <p className="game-player-meta mt-1 text-xs font-black uppercase text-[#171915]">
                          Detained
                        </p>
                      ) : null}
                    </div>
                    {isCurrentActivePlayer ? (
                      <span className="game-status-badge border-2 border-[#171915] bg-white px-2 py-1 text-[0.62rem] font-black uppercase">
                        Current
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="game-panel game-dice-panel game-shadow-yellow border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#f9c74f] backdrop-blur">
            <h2 className="game-panel-title text-2xl font-black">Dice</h2>

            <div className="game-dice-grid mt-4 grid grid-cols-3 gap-3">
              <div className="game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black">
                {gameState.lastRoll?.dieOne ?? "-"}
              </div>
              <div className="game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black">
                {gameState.lastRoll?.dieTwo ?? "-"}
              </div>
              <div className="game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#171915] text-3xl font-black text-white">
                {gameState.lastRoll?.total ?? "-"}
              </div>
            </div>

            <p
              className="game-message mt-4 border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold leading-6 text-[#445045]"
              data-testid="game-message"
            >
              {gameState.message}
            </p>
          </div>

          {gameState.lastEventCard ? (
            <div
              className="game-panel game-action-panel game-shadow-orange border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#f8961e] backdrop-blur"
              data-testid="event-panel"
            >
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

          {showPurchasePanel && landedSpace && isBuyableSpace(landedSpace) ? (
            <div className="game-panel game-action-panel game-shadow-blue border-2 border-[#171915] bg-white/90 p-4 shadow-[8px_8px_0_0_#3454d1] backdrop-blur">
              <h2 className="text-2xl font-black">
                {isPurchasableTransit(landedSpace) ? "Transit" : "Property"}
              </h2>

              <div className="mt-4 space-y-3 border-2 border-[#171915] bg-[#f7f8f4] p-3">
                <div>
                  <p className="text-sm font-black uppercase text-[#596057]">
                    Space
                  </p>
                  <p className="break-words text-xl font-black">
                    {landedSpace.name}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-[#596057]">
                      Price
                    </p>
                    <p className="text-lg font-black">
                      {formatCurrency(landedSpace.price)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase text-[#596057]">
                      {isPurchasableTransit(landedSpace)
                        ? "Transit Rent"
                        : "Rent"}
                    </p>
                    <p className="text-lg font-black">
                      {isPurchasableProperty(landedSpace)
                        ? formatCurrency(landedSpace.rent)
                        : landedSpaceOwner
                          ? formatCurrency(landedTransitRent)
                          : `${formatCurrency(TRANSIT_RENTS[1])}+`}
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

                {landedSpaceOwner ? (
                  <p className="border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
                    {landedSpaceOwner.id === currentPlayer.id
                      ? `${currentPlayer.name} already owns ${landedSpace.name}.`
                      : isPurchasableProperty(landedSpace)
                        ? `${landedSpace.name} is owned by ${landedSpaceOwner.name}. ${currentPlayer.name} paid ${formatCurrency(
                            landedSpace.rent,
                          )} rent.`
                        : `${landedSpace.name} is owned by ${landedSpaceOwner.name}. ${currentPlayer.name} paid ${formatCurrency(
                            landedTransitRent,
                          )} transit rent.`}
                  </p>
                ) : gameState.pendingPropertyPurchasePosition === null ? (
                  <p className="border-2 border-[#171915] bg-white p-3 text-sm font-bold leading-6 text-[#445045]">
                    No owner yet. Purchase skipped for this turn.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <button
                      className="h-12 border-2 border-[#171915] bg-[#06d6a0] px-4 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                      disabled={!canBuyPendingPurchase}
                      onClick={buySpace}
                      type="button"
                    >
                      {isPurchasableTransit(landedSpace)
                        ? "Buy Transit"
                        : "Buy Property"}
                    </button>

                    <button
                      className="h-12 border-2 border-[#171915] bg-[#f7f8f4] px-4 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35"
                      onClick={skipPurchase}
                      type="button"
                    >
                      Skip Purchase
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isBankruptcyPending ? (
            <div
              className="game-panel game-warning-panel game-shadow-red border-2 border-[#171915] bg-[#ffedf2] p-4 shadow-[8px_8px_0_0_#ef476f]"
              data-testid="bankruptcy-warning"
            >
              <h2 className="text-2xl font-black">Bankruptcy Warning</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                {currentPlayer.name} is below $0. Declaring bankruptcy will
                eliminate them and release every property and transit station
                they own.
              </p>
            </div>
          ) : null}

          <div className="game-buttons grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <button
              className="h-14 border-2 border-[#171915] bg-[#3454d1] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#3454d1]/35 disabled:cursor-not-allowed disabled:bg-[#596057] disabled:opacity-55 disabled:shadow-none"
              disabled={
                Boolean(winnerPlayer) ||
                gameState.hasRolledThisTurn ||
                gameState.isDetentionTurn ||
                currentPlayer.isDetained ||
                currentPlayer.isEliminated
              }
              onClick={rollDice}
              type="button"
            >
              Roll Dice
            </button>

            {gameState.isDetentionTurn ? (
              <button
                className="h-14 border-2 border-[#171915] bg-[#f9c74f] px-6 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#f9c74f]/50 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
                disabled={!canLeaveDetention}
                onClick={leaveDetention}
                type="button"
              >
                Leave Detention
              </button>
            ) : null}

            <button
              className={`h-14 border-2 border-[#171915] px-6 text-base font-bold shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none ${
                isBankruptcyPending
                  ? "bg-[#ef476f] text-white focus:ring-4 focus:ring-[#ef476f]/35"
                  : "bg-[#06d6a0] text-[#171915] focus:ring-4 focus:ring-[#06d6a0]/35"
              }`}
              disabled={!canEndTurn}
              onClick={endTurn}
              type="button"
            >
              {isBankruptcyPending ? "Declare Bankruptcy" : "End Turn"}
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
            Plaza.
          </p>
        </aside>
      </section>
    </main>
  );
}
