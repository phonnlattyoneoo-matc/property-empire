export const MAX_HOUSES = 4;
export const HOTEL_DEVELOPMENT_LEVEL = 5;

export type PropertyDevelopmentLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type PropertyGroupId =
  | "growth-lab"
  | "urban-makers"
  | "civic-lights"
  | "waterfront-exchange";

export type PropertyGroup = {
  buildCost: number;
  color: string;
  id: PropertyGroupId;
  name: string;
  propertyPositions: readonly number[];
};

export type PropertyRentSchedule = readonly [
  baseRent: number,
  oneHouse: number,
  twoHouses: number,
  threeHouses: number,
  fourHouses: number,
  hotel: number,
];

export type PropertyDevelopmentConfig = {
  groupId: PropertyGroupId;
  rents: PropertyRentSchedule;
};

export const PROPERTY_GROUPS = {
  "growth-lab": {
    buildCost: 50,
    color: "#b91c1c",
    id: "growth-lab",
    name: "Growth Lab",
    propertyPositions: [1, 3],
  },
  "urban-makers": {
    buildCost: 75,
    color: "#1d4ed8",
    id: "urban-makers",
    name: "Urban Makers",
    propertyPositions: [6, 7, 8],
  },
  "civic-lights": {
    buildCost: 100,
    color: "#047857",
    id: "civic-lights",
    name: "Civic Lights",
    propertyPositions: [11, 13, 16],
  },
  "waterfront-exchange": {
    buildCost: 125,
    color: "#7e22ce",
    id: "waterfront-exchange",
    name: "Waterfront Exchange",
    propertyPositions: [19, 20, 23],
  },
} as const satisfies Record<PropertyGroupId, PropertyGroup>;

export const PROPERTY_DEVELOPMENT_CONFIGS = {
  1: { groupId: "growth-lab", rents: [12, 50, 150, 330, 450, 600] },
  3: { groupId: "growth-lab", rents: [14, 60, 170, 360, 500, 650] },
  6: { groupId: "urban-makers", rents: [18, 80, 220, 480, 650, 850] },
  7: { groupId: "urban-makers", rents: [20, 90, 250, 520, 700, 900] },
  8: { groupId: "urban-makers", rents: [22, 100, 280, 560, 760, 980] },
  11: { groupId: "civic-lights", rents: [26, 120, 340, 700, 980, 1250] },
  13: { groupId: "civic-lights", rents: [24, 110, 310, 650, 900, 1150] },
  16: { groupId: "civic-lights", rents: [28, 130, 370, 760, 1060, 1350] },
  19: {
    groupId: "waterfront-exchange",
    rents: [32, 160, 450, 950, 1300, 1650],
  },
  20: {
    groupId: "waterfront-exchange",
    rents: [36, 180, 520, 1100, 1500, 1900],
  },
  23: {
    groupId: "waterfront-exchange",
    rents: [30, 150, 420, 880, 1200, 1500],
  },
} as const satisfies Record<number, PropertyDevelopmentConfig>;

export function getPropertyDevelopmentConfig(position: number) {
  return (
    PROPERTY_DEVELOPMENT_CONFIGS[
      position as keyof typeof PROPERTY_DEVELOPMENT_CONFIGS
    ] ?? null
  );
}

export function getPropertyGroup(groupId: PropertyGroupId) {
  return PROPERTY_GROUPS[groupId];
}

export function getPropertyRent(
  position: number,
  developmentLevel: PropertyDevelopmentLevel,
) {
  return getPropertyDevelopmentConfig(position)?.rents[developmentLevel] ?? null;
}

export function getDevelopmentLabel(level: PropertyDevelopmentLevel) {
  if (level === HOTEL_DEVELOPMENT_LEVEL) {
    return "Hotel";
  }

  if (level === 0) {
    return "No buildings";
  }

  return `${level} house${level === 1 ? "" : "s"}`;
}

export function getDevelopmentSaleValue(group: PropertyGroup) {
  return group.buildCost / 2;
}
