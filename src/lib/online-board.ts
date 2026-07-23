import type { PropertyGroupId } from "@/lib/property-development";

export type OnlineSpaceType =
  | "start"
  | "property"
  | "transit"
  | "event"
  | "tax"
  | "rest"
  | "detention";

export type OnlineBoardSpace = {
  groupId?: PropertyGroupId;
  name: string;
  price?: number;
  rent?: number;
  taxAmount?: number;
  type: OnlineSpaceType;
};

export const ONLINE_TRANSIT_PRICE = 200;
export const ONLINE_TRANSIT_RENTS = [0, 25, 50, 100];

export const ONLINE_BOARD_SPACES: OnlineBoardSpace[] = [
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
  { name: "Metro Loop", type: "transit", price: ONLINE_TRANSIT_PRICE },
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
  { name: "Harbor Line", type: "transit", price: ONLINE_TRANSIT_PRICE },
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
  { name: "Central Rail", type: "transit", price: ONLINE_TRANSIT_PRICE },
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
  { name: "Bike Hub", type: "transit", price: ONLINE_TRANSIT_PRICE },
  { name: "Night Market", type: "event" },
  {
    groupId: "waterfront-exchange",
    name: "Depot Flats",
    type: "property",
    price: 300,
    rent: 30,
  },
];

export type OnlinePropertySpace = OnlineBoardSpace & {
  groupId: PropertyGroupId;
  price: number;
  rent: number;
  type: "property";
};

export function isOnlinePropertySpace(
  space: OnlineBoardSpace,
): space is OnlinePropertySpace {
  return (
    space.type === "property" &&
    typeof space.groupId === "string" &&
    typeof space.price === "number" &&
    typeof space.rent === "number"
  );
}

export type OnlineTransitSpace = OnlineBoardSpace & {
  price: number;
  type: "transit";
};

export type OnlineBuyableSpace = OnlinePropertySpace | OnlineTransitSpace;

export function isOnlineTransitSpace(
  space: OnlineBoardSpace,
): space is OnlineTransitSpace {
  return space.type === "transit" && typeof space.price === "number";
}

export function isOnlineBuyableSpace(
  space: OnlineBoardSpace,
): space is OnlineBuyableSpace {
  return isOnlinePropertySpace(space) || isOnlineTransitSpace(space);
}

export type OnlineTaxSpace = OnlineBoardSpace & {
  taxAmount: number;
  type: "tax";
};

export function isOnlineTaxSpace(
  space: OnlineBoardSpace,
): space is OnlineTaxSpace {
  return space.type === "tax" && typeof space.taxAmount === "number";
}

export const onlineSpaceStyles: Record<
  OnlineSpaceType,
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
