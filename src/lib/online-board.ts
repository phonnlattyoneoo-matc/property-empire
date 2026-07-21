export type OnlineSpaceType =
  | "start"
  | "property"
  | "transit"
  | "event"
  | "tax"
  | "rest"
  | "detention";

export type OnlineBoardSpace = {
  name: string;
  price?: number;
  rent?: number;
  type: OnlineSpaceType;
};

export const ONLINE_BOARD_SPACES: OnlineBoardSpace[] = [
  { name: "Grand Plaza", type: "start" },
  { name: "CoLab Court", type: "property", price: 120, rent: 12 },
  { name: "City Tax", type: "tax" },
  { name: "Pixel Row", type: "property", price: 140, rent: 14 },
  { name: "Metro Loop", type: "transit" },
  { name: "Pop-Up Market", type: "event" },
  { name: "Skyline Lofts", type: "property", price: 180, rent: 18 },
  { name: "Canal Walk", type: "property", price: 200, rent: 20 },
  { name: "Maker Lane", type: "property", price: 220, rent: 22 },
  { name: "Harbor Line", type: "transit" },
  { name: "Street Fest", type: "event" },
  { name: "Glass Tower", type: "property", price: 260, rent: 26 },
  { name: "Civic Detention", type: "detention" },
  { name: "Greenway Flats", type: "property", price: 240, rent: 24 },
  { name: "Grid Levy", type: "tax" },
  { name: "Central Rail", type: "transit" },
  { name: "Neon Arcade", type: "property", price: 280, rent: 28 },
  { name: "City Vote", type: "event" },
  { name: "Rooftop Rest", type: "rest" },
  { name: "Market Hall", type: "property", price: 320, rent: 32 },
  { name: "Riverfront", type: "property", price: 360, rent: 36 },
  { name: "Bike Hub", type: "transit" },
  { name: "Night Market", type: "event" },
  { name: "Depot Flats", type: "property", price: 300, rent: 30 },
];

export type OnlinePropertySpace = OnlineBoardSpace & {
  price: number;
  rent: number;
  type: "property";
};

export function isOnlinePropertySpace(
  space: OnlineBoardSpace,
): space is OnlinePropertySpace {
  return (
    space.type === "property" &&
    typeof space.price === "number" &&
    typeof space.rent === "number"
  );
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
