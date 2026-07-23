"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  BOARD_SPACE_COUNT,
  CITY_LAUNCH_BONUS,
  GAME_SESSION_STORAGE_KEY,
  STARTING_BALANCE,
  type DiceRoll,
  type GameState,
  type PlayerState,
  parseStoredGameState,
} from "@/lib/game-state";
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
  groupId?: PropertyGroupId;
  price?: number;
  rent?: number;
  taxAmount?: number;
};

type PurchasablePropertySpace = BoardSpace & {
  groupId: PropertyGroupId;
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

type InteractionPhase = "idle" | "rolling" | "moving" | "resolving";

type ResultPopup = {
  accentColor: string;
  balance: number;
  explanation: string;
  id: number;
  moneyChange: number;
  resultType: string;
  title: string;
};

type BoardSide = "bottom" | "left" | "right" | "top";

const GAME_STATE_EVENT = "property-empire.game-state-change";
const TRANSIT_PRICE = 200;
const TRANSIT_RENTS = [0, 25, 50, 100];
const DICE_ANIMATION_DURATION_MS = 960;
const REDUCED_DICE_ANIMATION_DURATION_MS = 180;
const DICE_ANIMATION_FRAME_MS = 72;
const TOKEN_STEP_DURATION_MS = 210;
const REDUCED_TOKEN_STEP_DURATION_MS = 70;

const boardSpaces: BoardSpace[] = [
  { name: "Grand Plaza", type: "start" },
  {
    groupId: "growth-lab",
    name: "CoLab Court",
    type: "property",
    price: 120,
    rent: 12,
  },
  { name: "City Tax", type: "tax", taxAmount: 150 },
  {
    groupId: "growth-lab",
    name: "Pixel Row",
    type: "property",
    price: 140,
    rent: 14,
  },
  { name: "Metro Loop", type: "transit", price: TRANSIT_PRICE },
  { name: "Pop-Up Market", type: "event" },
  {
    groupId: "urban-makers",
    name: "Skyline Lofts",
    type: "property",
    price: 180,
    rent: 18,
  },
  {
    groupId: "urban-makers",
    name: "Canal Walk",
    type: "property",
    price: 200,
    rent: 20,
  },
  {
    groupId: "urban-makers",
    name: "Maker Lane",
    type: "property",
    price: 220,
    rent: 22,
  },
  { name: "Harbor Line", type: "transit", price: TRANSIT_PRICE },
  { name: "Street Fest", type: "event" },
  {
    groupId: "civic-lights",
    name: "Glass Tower",
    type: "property",
    price: 260,
    rent: 26,
  },
  { name: "Civic Detention", type: "detention" },
  {
    groupId: "civic-lights",
    name: "Greenway Flats",
    type: "property",
    price: 240,
    rent: 24,
  },
  { name: "Grid Levy", type: "tax", taxAmount: 100 },
  { name: "Central Rail", type: "transit", price: TRANSIT_PRICE },
  {
    groupId: "civic-lights",
    name: "Neon Arcade",
    type: "property",
    price: 280,
    rent: 28,
  },
  { name: "City Vote", type: "event" },
  { name: "Rooftop Rest", type: "rest" },
  {
    groupId: "waterfront-exchange",
    name: "Market Hall",
    type: "property",
    price: 320,
    rent: 32,
  },
  {
    groupId: "waterfront-exchange",
    name: "Riverfront",
    type: "property",
    price: 360,
    rent: 36,
  },
  { name: "Bike Hub", type: "transit", price: TRANSIT_PRICE },
  { name: "Night Market", type: "event" },
  {
    groupId: "waterfront-exchange",
    name: "Depot Flats",
    type: "property",
    price: 300,
    rent: 30,
  },
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

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getClockwiseMovementPath(currentPosition: number, spaces: number) {
  return Array.from({ length: spaces }, (_, stepIndex) =>
    getWrappedPosition(currentPosition + stepIndex + 1),
  );
}

function isPurchasableProperty(
  space: BoardSpace,
): space is PurchasablePropertySpace {
  return (
    space.type === "property" &&
    typeof space.groupId === "string" &&
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

function getPropertyDevelopmentLevel(
  gameState: GameState,
  position: number,
): PropertyDevelopmentLevel {
  return gameState.propertyDevelopments[String(position)] ?? 0;
}

function getDevelopedPropertyRent(
  gameState: GameState,
  position: number,
  property: PurchasablePropertySpace,
) {
  return (
    getPropertyRent(position, getPropertyDevelopmentLevel(gameState, position)) ??
    property.rent
  );
}

function getPropertyGroupDevelopmentLevels(
  gameState: GameState,
  groupId: PropertyGroupId,
) {
  return PROPERTY_GROUPS[groupId].propertyPositions.map((position) =>
    getPropertyDevelopmentLevel(gameState, position),
  );
}

function playerOwnsPropertyGroup(
  gameState: GameState,
  playerId: string,
  groupId: PropertyGroupId,
) {
  return PROPERTY_GROUPS[groupId].propertyPositions.every((position) => {
    return gameState.propertyOwners[String(position)] === playerId;
  });
}

type DevelopmentActionStatus = {
  canAct: boolean;
  label: string;
  nextLevel: PropertyDevelopmentLevel | null;
  reason: string | null;
};

function getBuildActionStatus({
  gameState,
  player,
  position,
  property,
}: {
  gameState: GameState;
  player: PlayerState;
  position: number;
  property: PurchasablePropertySpace;
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
  player,
  position,
}: {
  gameState: GameState;
  player: PlayerState;
  position: number;
}): DevelopmentActionStatus {
  const space = boardSpaces[position];

  if (!isPurchasableProperty(space)) {
    return {
      canAct: false,
      label: "Sell House",
      nextLevel: null,
      reason: "Only properties can have buildings.",
    };
  }

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
    space.groupId,
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

function releasePlayerDevelopments(
  propertyDevelopments: GameState["propertyDevelopments"],
  propertyOwners: GameState["propertyOwners"],
  ownerId: string,
) {
  const remainingDevelopments: GameState["propertyDevelopments"] = {};

  for (const [position, developmentLevel] of Object.entries(
    propertyDevelopments,
  )) {
    if (propertyOwners[position] !== ownerId) {
      remainingDevelopments[position] = developmentLevel;
    }
  }

  return remainingDevelopments;
}

function getLandingSpaceMessage({
  currentPlayerName,
  developmentLevel,
  destination,
  destinationOwnerName,
  ownedTransitCount,
  owesRent,
  rentPayment,
  resultingBalance,
}: {
  currentPlayerName: string;
  developmentLevel: PropertyDevelopmentLevel;
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
    )}. Rent is ${formatCurrency(rentPayment)}.`;
  }

  if (!owesRent) {
    const developmentMessage =
      developmentLevel > 0
        ? ` It has ${getDevelopmentLabel(developmentLevel)}.`
        : "";

    return ` ${currentPlayerName} already owns ${destination.name}.${developmentMessage}`;
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
    rentPayment,
  )} rent to ${destinationOwnerName} with ${getDevelopmentLabel(
    developmentLevel,
  )}.${negativeBalanceWarning}`;
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
  const interactionLockRef = useRef(false);
  const [animatedDiceRoll, setAnimatedDiceRoll] = useState<DiceRoll | null>(
    null,
  );
  const [animatedPlayerPositions, setAnimatedPlayerPositions] = useState<
    Record<string, number>
  >({});
  const [highlightedBoardPosition, setHighlightedBoardPosition] = useState<
    number | null
  >(null);
  const [interactionPhase, setInteractionPhase] =
    useState<InteractionPhase>("idle");
  const [isPropertiesModalOpen, setIsPropertiesModalOpen] = useState(false);
  const [resultPopup, setResultPopup] = useState<ResultPopup | null>(null);
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

  const isInteractionLocked = interactionPhase !== "idle";

  function showResultPopup({
    accentColor,
    balance,
    explanation,
    moneyChange,
    resultType,
    title,
  }: Omit<ResultPopup, "id">) {
    setResultPopup({
      accentColor,
      balance,
      explanation,
      id: Date.now(),
      moneyChange,
      resultType,
      title,
    });
  }

  async function animateDiceRoll(finalRoll: DiceRoll) {
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
  }

  async function animateTokenMovement(player: PlayerState, spaces: number) {
    const stepDuration = prefersReducedMotion()
      ? REDUCED_TOKEN_STEP_DURATION_MS
      : TOKEN_STEP_DURATION_MS;

    for (const position of getClockwiseMovementPath(player.position, spaces)) {
      setAnimatedPlayerPositions((currentPositions) => ({
        ...currentPositions,
        [player.id]: position,
      }));
      setHighlightedBoardPosition(position);
      await wait(stepDuration);
    }
  }

  async function rollDice() {
    if (
      !gameState ||
      interactionLockRef.current ||
      gameState.hasRolledThisTurn ||
      gameState.winnerPlayerId
    ) {
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

    interactionLockRef.current = true;
    setInteractionPhase("rolling");
    setResultPopup(null);

    const dieOne = rollDie();
    const dieTwo = rollDie();
    const total = dieOne + dieTwo;
    const finalRoll = { dieOne, dieTwo, total };
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

    try {
      await animateDiceRoll(finalRoll);
      setInteractionPhase("moving");
      await animateTokenMovement(currentPlayer, total);
      setInteractionPhase("resolving");

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
        lastRoll: finalRoll,
        message: `${rollMessage} ${currentPlayer.name} paid ${formatCurrency(
          destination.taxAmount,
        )} ${destination.name}.${getNegativeBalanceWarning(
          currentPlayer.name,
          updatedCurrentPlayerBalance,
        )}`,
        pendingPropertyPurchasePosition: null,
        players,
      });
      showResultPopup({
        accentColor: spaceStyles.tax.accent,
        balance: updatedCurrentPlayerBalance,
        explanation: `${rollMessage} ${currentPlayer.name} paid ${formatCurrency(
          destination.taxAmount,
        )}.${getNegativeBalanceWarning(
          currentPlayer.name,
          updatedCurrentPlayerBalance,
        )}`,
        moneyChange: updatedCurrentPlayerBalance - currentPlayer.balance,
        resultType: "Tax",
        title: destination.name,
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
        lastRoll: finalRoll,
        message: `${eventRollMessage} Event: ${eventCard.title}. ${eventResolution.result}`,
        pendingPropertyPurchasePosition: null,
        players,
      });
      showResultPopup({
        accentColor: spaceStyles.event.accent,
        balance: eventResolution.balance,
        explanation: `${eventRollMessage} ${eventCard.description} ${eventResolution.result}`,
        moneyChange: eventResolution.balance - currentPlayer.balance,
        resultType: "Event",
        title: eventCard.title,
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
        lastRoll: finalRoll,
        message: `${rollMessage} ${currentPlayer.name} is visiting Civic Detention and will not miss their next turn.`,
        pendingPropertyPurchasePosition: null,
        players,
      });
      showResultPopup({
        accentColor: spaceStyles.detention.accent,
        balance: updatedCurrentPlayerBalance,
        explanation: `${rollMessage} ${currentPlayer.name} is visiting and will not miss their next turn.`,
        moneyChange: updatedCurrentPlayerBalance - currentPlayer.balance,
        resultType: "Detention",
        title: destination.name,
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
        lastRoll: finalRoll,
        message: `${rollMessage} ${currentPlayer.name} is taking a break at Rooftop Rest.`,
        pendingPropertyPurchasePosition: null,
        players,
      });
      showResultPopup({
        accentColor: spaceStyles.rest.accent,
        balance: updatedCurrentPlayerBalance,
        explanation: `${rollMessage} ${currentPlayer.name} is taking a break.`,
        moneyChange: updatedCurrentPlayerBalance - currentPlayer.balance,
        resultType: "Rest Area",
        title: destination.name,
      });

      return;
    }

    const destinationOwner = getSpaceOwner(gameState, diceMoveResult.position);
    const ownedTransitCount =
      isPurchasableTransit(destination) && destinationOwner
        ? getOwnedTransitCount(gameState, destinationOwner.id)
        : 0;
    const destinationDevelopmentLevel = isPurchasableProperty(destination)
      ? getPropertyDevelopmentLevel(gameState, diceMoveResult.position)
      : 0;
    const destinationPropertyRent = isPurchasableProperty(destination)
      ? getDevelopedPropertyRent(
          gameState,
          diceMoveResult.position,
          destination,
        )
      : 0;
    const rentPayment = (() => {
      if (!destinationOwner || destinationOwner.id === currentPlayer.id) {
        return 0;
      }

      if (isPurchasableProperty(destination)) {
        return destinationPropertyRent;
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
      developmentLevel: destinationDevelopmentLevel,
      destination,
      destinationOwnerName: destinationOwner?.name,
      ownedTransitCount,
      owesRent,
      rentPayment: isPurchasableProperty(destination)
        ? destinationPropertyRent
        : rentPayment,
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
      lastRoll: finalRoll,
      message: `${rollMessage}${spaceMessage}`,
      pendingPropertyPurchasePosition,
      players,
    });
    if (pendingPropertyPurchasePosition === null) {
      const popupTitle = (() => {
        if (destination.type === "start") {
          return destination.name;
        }

        if (owesRent) {
          return destination.name;
        }

        if (destinationOwner) {
          return "Already Owned";
        }

        return destination.name;
      })();
      const popupMessage =
        spaceMessage.trim().length > 0
          ? spaceMessage.trim()
          : diceMoveResult.receivesLaunchBonus
            ? `${currentPlayer.name} collected a ${formatCurrency(
                CITY_LAUNCH_BONUS,
              )} City Launch Bonus.`
            : `${currentPlayer.name} landed on ${destination.name}.`;

      showResultPopup({
        accentColor: spaceStyles[destination.type].accent,
        balance: updatedCurrentPlayerBalance,
        explanation: `${rollMessage} ${popupMessage}`,
        moneyChange: updatedCurrentPlayerBalance - currentPlayer.balance,
        resultType:
          destination.type === "start"
            ? "Bonus"
            : owesRent
              ? "Rent"
              : isPurchasableTransit(destination)
                ? "Transit"
                : "Property",
        title: popupTitle,
      });
    } else if (diceMoveResult.receivesLaunchBonus) {
      showResultPopup({
        accentColor: spaceStyles.start.accent,
        balance: updatedCurrentPlayerBalance,
        explanation: `${rollMessage} ${currentPlayer.name} can decide whether to buy ${destination.name}.`,
        moneyChange: updatedCurrentPlayerBalance - currentPlayer.balance,
        resultType: "Bonus",
        title: "Grand Plaza Bonus",
      });
    }
    } finally {
      interactionLockRef.current = false;
      setAnimatedDiceRoll(null);
      setAnimatedPlayerPositions({});
      setHighlightedBoardPosition(null);
      setInteractionPhase("idle");
    }
  }

  function endTurn() {
    if (
      !gameState ||
      interactionLockRef.current ||
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
    if (
      !gameState ||
      interactionLockRef.current ||
      gameState.winnerPlayerId ||
      !gameState.isDetentionTurn
    ) {
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
      interactionLockRef.current ||
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
      interactionLockRef.current ||
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

  function buildDevelopment(position: number) {
    if (!gameState || interactionLockRef.current) {
      return;
    }

    const space = boardSpaces[position];
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (!isPurchasableProperty(space)) {
      return;
    }

    const buildStatus = getBuildActionStatus({
      gameState,
      player: currentPlayer,
      position,
      property: space,
    });

    if (!buildStatus.canAct || buildStatus.nextLevel === null) {
      return;
    }

    const group = getPropertyGroup(space.groupId);
    const players = gameState.players.map((player, index) =>
      index === gameState.currentPlayerIndex
        ? { ...player, balance: player.balance - group.buildCost }
        : player,
    );
    const propertyDevelopments: GameState["propertyDevelopments"] = {
      ...gameState.propertyDevelopments,
      [String(position)]: buildStatus.nextLevel,
    };
    const developmentName =
      buildStatus.nextLevel === HOTEL_DEVELOPMENT_LEVEL ? "a hotel" : "a house";

    saveGameState({
      ...gameState,
      message: `${currentPlayer.name} built ${developmentName} on ${
        space.name
      } for ${formatCurrency(group.buildCost)}. Rent is now ${formatCurrency(
        getPropertyRent(position, buildStatus.nextLevel) ?? space.rent,
      )}.`,
      players,
      propertyDevelopments,
    });
  }

  function sellDevelopment(position: number) {
    if (!gameState || interactionLockRef.current) {
      return;
    }

    const space = boardSpaces[position];
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (!isPurchasableProperty(space)) {
      return;
    }

    const sellStatus = getSellActionStatus({
      gameState,
      player: currentPlayer,
      position,
    });

    if (!sellStatus.canAct || sellStatus.nextLevel === null) {
      return;
    }

    const group = getPropertyGroup(space.groupId);
    const saleValue = getDevelopmentSaleValue(group);
    const currentLevel = getPropertyDevelopmentLevel(gameState, position);
    const soldDevelopmentName =
      currentLevel === HOTEL_DEVELOPMENT_LEVEL ? "a hotel" : "a house";
    const players = gameState.players.map((player, index) =>
      index === gameState.currentPlayerIndex
        ? { ...player, balance: player.balance + saleValue }
        : player,
    );
    const propertyDevelopments: GameState["propertyDevelopments"] = {
      ...gameState.propertyDevelopments,
    };

    if (sellStatus.nextLevel === 0) {
      delete propertyDevelopments[String(position)];
    } else {
      propertyDevelopments[String(position)] = sellStatus.nextLevel;
    }

    saveGameState({
      ...gameState,
      message: `${currentPlayer.name} sold ${soldDevelopmentName} from ${
        space.name
      } for ${formatCurrency(saleValue)}. Rent is now ${formatCurrency(
        getPropertyRent(position, sellStatus.nextLevel) ?? space.rent,
      )}.`,
      players,
      propertyDevelopments,
    });
  }

  function declareBankruptcy() {
    if (
      !gameState ||
      interactionLockRef.current ||
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
    const releasedPropertyDevelopments = releasePlayerDevelopments(
      gameState.propertyDevelopments,
      gameState.propertyOwners,
      currentPlayer.id,
    );
    const releaseMessage = `${currentPlayer.name}'s properties, transit stations, and buildings are now unowned.`;

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
      propertyDevelopments: releasedPropertyDevelopments,
      propertyOwners: releasedPropertyOwners,
      winnerPlayerId: winnerPlayer?.id ?? null,
    });
  }

  function playAgain() {
    clearGameState();
    router.push("/setup");
  }

  function exitGame() {
    if (interactionLockRef.current) {
      return;
    }

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
  const displayedDiceRoll = animatedDiceRoll ?? gameState.lastRoll;
  const pendingPurchase =
    gameState.pendingPropertyPurchasePosition === null
      ? null
      : boardSpaces[gameState.pendingPropertyPurchasePosition];
  const pendingPurchaseSpace =
    pendingPurchase && isBuyableSpace(pendingPurchase)
      ? pendingPurchase
      : null;
  const pendingPurchaseGroup =
    pendingPurchaseSpace && isPurchasableProperty(pendingPurchaseSpace)
      ? getPropertyGroup(pendingPurchaseSpace.groupId)
      : null;
  const pendingPurchaseBaseRent =
    pendingPurchaseSpace && isPurchasableProperty(pendingPurchaseSpace)
      ? pendingPurchaseSpace.rent
      : pendingPurchaseSpace && isPurchasableTransit(pendingPurchaseSpace)
        ? TRANSIT_RENTS[1]
        : 0;
  const canBuyPendingPurchase =
    !winnerPlayer &&
    !isInteractionLocked &&
    !currentPlayer.isEliminated &&
    pendingPurchaseSpace !== null &&
    currentPlayer.balance >= pendingPurchaseSpace.price;
  const canEndTurn =
    !winnerPlayer &&
    !isInteractionLocked &&
    !currentPlayer.isEliminated &&
    gameState.hasRolledThisTurn &&
    gameState.pendingPropertyPurchasePosition === null &&
    !gameState.isDetentionTurn;
  const isBankruptcyPending = canEndTurn && currentPlayer.balance < 0;
  const canLeaveDetention =
    !winnerPlayer &&
    !isInteractionLocked &&
    gameState.isDetentionTurn &&
    currentPlayer.isDetained &&
    !currentPlayer.isEliminated;
  const ownedPropertyGroups = Object.values(PROPERTY_GROUPS)
    .map((group) => {
      const properties: { position: number; space: PurchasablePropertySpace }[] =
        [];

      for (const position of group.propertyPositions) {
        const space = boardSpaces[position];

        if (
          isPurchasableProperty(space) &&
          gameState.propertyOwners[String(position)] === currentPlayer.id
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
    .filter((propertyGroup) => propertyGroup.properties.length > 0);
  const ownedPropertyCount = ownedPropertyGroups.reduce(
    (propertyCount, propertyGroup) => {
      return propertyCount + propertyGroup.properties.length;
    },
    0,
  );

  function closePropertiesModal() {
    setIsPropertiesModalOpen(false);
  }

  function handlePropertiesBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closePropertiesModal();
    }
  }

  return (
    <main className="game-screen local-game-screen relative min-h-screen overflow-hidden bg-[#f7f8f4] px-4 py-6 text-[#171915] sm:px-8 sm:py-8">
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
                const propertyGroup = isPurchasableProperty(space)
                  ? getPropertyGroup(space.groupId)
                  : null;
                const developmentLevel = isPurchasableProperty(space)
                  ? getPropertyDevelopmentLevel(gameState, index)
                  : 0;
                const propertyRent = isPurchasableProperty(space)
                  ? getDevelopedPropertyRent(gameState, index, space)
                  : 0;
                const spaceOwner = isBuyableSpace(space)
                  ? getSpaceOwner(gameState, index)
                  : undefined;
                const ownerFlagSide = getBoardSide(index);
                const spaceOwnerTransitCount =
                  isPurchasableTransit(space) && spaceOwner
                    ? getOwnedTransitCount(gameState, spaceOwner.id)
                    : 0;
                const playersOnSpace = gameState.players.filter(
                  (player) => {
                    const playerPosition =
                      animatedPlayerPositions[player.id] ?? player.position;

                    return !player.isEliminated && playerPosition === index;
                  },
                );

                return (
                  <div
                    className={`game-board-space relative flex min-h-0 flex-col justify-between border border-[#171915] p-1.5 text-[#171915] ${
                      highlightedBoardPosition === index
                        ? "game-board-space-active-step"
                        : ""
                    }`}
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

                    {isBuyableSpace(space) && spaceOwner ? (
                      <div className="mt-1 space-y-0.5">
                        {isPurchasableProperty(space) ? (
                          <>
                            <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              Rent {formatCurrency(propertyRent)}
                            </span>
                            <span className="game-board-space-meta block text-[0.5rem] font-black leading-tight text-[#445045] sm:text-[0.58rem]">
                              {getDevelopmentLabel(developmentLevel)}
                            </span>
                          </>
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
                          Rent {formatCurrency(propertyRent)}
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

                    {isPurchasableProperty(space)
                      ? renderDevelopmentMarkers(developmentLevel)
                      : null}

                    {isBuyableSpace(space) && spaceOwner ? (
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

        <aside className="game-sidebar local-game-sidebar space-y-5">
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
              <div
                className={`game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black ${
                  interactionPhase === "rolling" ? "game-dice-tumbling" : ""
                }`}
              >
                {displayedDiceRoll?.dieOne ?? "-"}
              </div>
              <div
                className={`game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#f7f8f4] text-3xl font-black ${
                  interactionPhase === "rolling" ? "game-dice-tumbling" : ""
                }`}
              >
                {displayedDiceRoll?.dieTwo ?? "-"}
              </div>
              <div
                className={`game-dice-cell flex aspect-square items-center justify-center border-2 border-[#171915] bg-[#171915] text-3xl font-black text-white ${
                  interactionPhase === "rolling" ? "game-dice-tumbling" : ""
                }`}
              >
                {displayedDiceRoll?.total ?? "-"}
              </div>
            </div>

            <p
              className="game-message mt-4 border-2 border-[#171915] bg-[#f7f8f4] p-3 text-sm font-bold leading-6 text-[#445045]"
              data-testid="game-message"
            >
              {gameState.message}
            </p>
          </div>

          {isBankruptcyPending ? (
            <div
              className="game-panel game-warning-panel game-shadow-red border-2 border-[#171915] bg-[#ffedf2] p-4 shadow-[8px_8px_0_0_#ef476f]"
              data-testid="bankruptcy-warning"
            >
              <h2 className="text-2xl font-black">Bankruptcy Warning</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-[#445045]">
                {currentPlayer.name} is below $0. Declaring bankruptcy will
                eliminate them and release every property and transit station
                they own. Any houses or hotels on those properties will be
                removed.
              </p>
            </div>
          ) : null}

          <div className="game-buttons grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <button
              className="h-14 border-2 border-[#171915] bg-[#3454d1] px-6 text-base font-bold text-white shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#3454d1]/35 disabled:cursor-not-allowed disabled:bg-[#596057] disabled:opacity-55 disabled:shadow-none"
              disabled={
                Boolean(winnerPlayer) ||
                isInteractionLocked ||
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
              className="flex h-14 items-center justify-center gap-2 border-2 border-[#171915] bg-white px-4 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:opacity-70 disabled:shadow-none"
              disabled={isInteractionLocked}
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
            Plaza.
          </p>
        </aside>
      </section>

      {pendingPurchaseSpace && !resultPopup ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#171915]/55 px-4 py-6 backdrop-blur-sm">
          <section
            aria-labelledby="purchase-modal-title"
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
                id="purchase-modal-title"
              >
                {pendingPurchaseSpace.name}
              </h2>
              {pendingPurchaseGroup ? (
                <div className="mt-3 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="h-5 w-16 border-2 border-[#171915]"
                    style={{ backgroundColor: pendingPurchaseGroup.color }}
                  />
                  <span className="text-sm font-black uppercase text-[#445045]">
                    {pendingPurchaseGroup.name}
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
                    {formatCurrency(pendingPurchaseSpace.price)}
                  </p>
                </div>
                <div className="border-2 border-[#171915] bg-[#f7f8f4] p-3">
                  <p className="text-xs font-black uppercase text-[#596057]">
                    Base Rent
                  </p>
                  <p className="text-xl font-black">
                    {formatCurrency(pendingPurchaseBaseRent)}
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
                  disabled={!canBuyPendingPurchase}
                  onClick={buySpace}
                  type="button"
                >
                  Buy
                </button>

                <button
                  className="min-h-12 border-2 border-[#171915] bg-white px-4 py-3 text-sm font-black text-[#171915] shadow-[5px_5px_0_0_#ef476f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                  disabled={isInteractionLocked}
                  onClick={skipPurchase}
                  type="button"
                >
                  Skip
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {resultPopup ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#f7f8f4]/55 px-4 py-6 backdrop-blur-[1px]">
          <section
            aria-labelledby="landing-result-title"
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
                  id="landing-result-title"
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

      {isPropertiesModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#171915]/60 px-4 py-6 backdrop-blur-sm"
          onMouseDown={handlePropertiesBackdropMouseDown}
        >
          <section
            aria-labelledby="my-properties-title"
            aria-modal="true"
            className="game-properties-modal flex max-h-[min(88vh,760px)] w-full max-w-5xl flex-col border-2 border-[#171915] bg-white shadow-[12px_12px_0_0_#06d6a0]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#171915] bg-[#f7f8f4] p-4">
              <div>
                <p className="text-sm font-black uppercase text-[#596057]">
                  {currentPlayer.name}
                </p>
                <h2
                  className="text-3xl font-black leading-none"
                  id="my-properties-title"
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
                    Buy a property during your turn to start developing a color
                    group.
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
                              player: currentPlayer,
                              position,
                              property: space,
                            });
                            const sellStatus = getSellActionStatus({
                              gameState,
                              player: currentPlayer,
                              position,
                            });
                            const saleValue = getDevelopmentSaleValue(group);

                            return (
                              <article
                                className="border-2 border-[#171915] bg-white p-3"
                                key={space.name}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h3 className="break-words text-lg font-black leading-tight">
                                      {space.name}
                                    </h3>
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

                                <div className="mt-3 grid grid-cols-2 gap-3 text-sm font-bold text-[#445045]">
                                  <p>
                                    <span className="block text-[0.68rem] font-black uppercase text-[#596057]">
                                      Current Development
                                    </span>
                                    {getDevelopmentLabel(level)}
                                  </p>
                                  <p>
                                    <span className="block text-[0.68rem] font-black uppercase text-[#596057]">
                                      Current Rent
                                    </span>
                                    {formatCurrency(currentRent)}
                                  </p>
                                  <p>
                                    <span className="block text-[0.68rem] font-black uppercase text-[#596057]">
                                      Next Rent
                                    </span>
                                    {nextRent === null
                                      ? "Maxed"
                                      : formatCurrency(nextRent)}
                                  </p>
                                  <p>
                                    <span className="block text-[0.68rem] font-black uppercase text-[#596057]">
                                      Build Cost
                                    </span>
                                    {formatCurrency(group.buildCost)}
                                  </p>
                                  <p>
                                    <span className="block text-[0.68rem] font-black uppercase text-[#596057]">
                                      Sell Value
                                    </span>
                                    {formatCurrency(saleValue)}
                                  </p>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3">
                                  <button
                                    className="min-h-12 border-2 border-[#171915] bg-[#06d6a0] px-3 py-2 text-sm font-black leading-tight text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                                    disabled={
                                      isInteractionLocked ||
                                      !buildStatus.canAct
                                    }
                                    onClick={() => buildDevelopment(position)}
                                    title={
                                      buildStatus.reason ??
                                      `${buildStatus.label} for ${formatCurrency(
                                        group.buildCost,
                                      )}`
                                    }
                                    type="button"
                                  >
                                    {buildStatus.label}
                                  </button>

                                  <button
                                    className="min-h-12 border-2 border-[#171915] bg-[#f9c74f] px-3 py-2 text-sm font-black leading-tight text-[#171915] shadow-[4px_4px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#f9c74f]/45 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                                    disabled={
                                      isInteractionLocked ||
                                      !sellStatus.canAct
                                    }
                                    onClick={() => sellDevelopment(position)}
                                    title={
                                      sellStatus.reason ??
                                      `${sellStatus.label} for ${formatCurrency(
                                        saleValue,
                                      )}`
                                    }
                                    type="button"
                                  >
                                    {sellStatus.label}
                                  </button>
                                </div>

                                {buildStatus.reason || sellStatus.reason ? (
                                  <div className="mt-3 space-y-1 border-2 border-[#171915] bg-[#f7f8f4] p-2 text-xs font-bold leading-snug text-[#445045]">
                                    {buildStatus.reason ? (
                                      <p>
                                        Build unavailable: {buildStatus.reason}
                                      </p>
                                    ) : null}
                                    {sellStatus.reason ? (
                                      <p>
                                        Sell unavailable: {sellStatus.reason}
                                      </p>
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
