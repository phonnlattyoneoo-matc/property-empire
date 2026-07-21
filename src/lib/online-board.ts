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
  type: OnlineSpaceType;
};

export const ONLINE_BOARD_SPACES: OnlineBoardSpace[] = [
  { name: "Grand Plaza", type: "start" },
  { name: "CoLab Court", type: "property" },
  { name: "City Tax", type: "tax" },
  { name: "Pixel Row", type: "property" },
  { name: "Metro Loop", type: "transit" },
  { name: "Pop-Up Market", type: "event" },
  { name: "Skyline Lofts", type: "property" },
  { name: "Canal Walk", type: "property" },
  { name: "Maker Lane", type: "property" },
  { name: "Harbor Line", type: "transit" },
  { name: "Street Fest", type: "event" },
  { name: "Glass Tower", type: "property" },
  { name: "Civic Detention", type: "detention" },
  { name: "Greenway Flats", type: "property" },
  { name: "Grid Levy", type: "tax" },
  { name: "Central Rail", type: "transit" },
  { name: "Neon Arcade", type: "property" },
  { name: "City Vote", type: "event" },
  { name: "Rooftop Rest", type: "rest" },
  { name: "Market Hall", type: "property" },
  { name: "Riverfront", type: "property" },
  { name: "Bike Hub", type: "transit" },
  { name: "Night Market", type: "event" },
  { name: "Depot Flats", type: "property" },
];

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
