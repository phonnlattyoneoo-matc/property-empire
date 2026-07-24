export const BOARD_V2_SPACE_COUNT = 40;
export const BOARD_V2_GRID_SIZE = 11;

export type BoardV2SpaceType =
  | "go"
  | "property"
  | "transit"
  | "utility"
  | "event"
  | "community"
  | "tax"
  | "jail"
  | "free-parking"
  | "go-to-jail";

export type BoardV2Icon =
  | "GO"
  | "BLDG"
  | "RAIL"
  | "UTIL"
  | "EVENT"
  | "CITY"
  | "TAX"
  | "JAIL"
  | "PARK"
  | "GOTO";

export type BoardV2ColorGroupId =
  | "growth-lab"
  | "urban-makers"
  | "civic-lights"
  | "waterfront-exchange"
  | "culture-grid"
  | "green-circuit"
  | "commerce-heights"
  | "apex-district";

export type BoardV2ColorGroup = {
  color: string;
  id: BoardV2ColorGroupId;
  name: string;
};

export type BoardV2HouseRent = readonly [
  oneHouse: number,
  twoHouses: number,
  threeHouses: number,
  fourHouses: number,
];

type BoardV2SpaceBase = {
  color: string;
  description: string;
  icon: BoardV2Icon;
  id: string;
  index: number;
  title: string;
  type: BoardV2SpaceType;
};

export type BoardV2PropertySpace = BoardV2SpaceBase & {
  baseRent: number;
  colorGroup: BoardV2ColorGroupId;
  hotelRent: number;
  houseRent: BoardV2HouseRent;
  name: string;
  purchasePrice: number;
  type: "property";
};

export type BoardV2TransitSpace = BoardV2SpaceBase & {
  purchasePrice: number;
  type: "transit";
};

export type BoardV2UtilitySpace = BoardV2SpaceBase & {
  purchasePrice: number;
  type: "utility";
};

export type BoardV2TaxSpace = BoardV2SpaceBase & {
  amount: number;
  type: "tax";
};

export type BoardV2SpecialSpace = BoardV2SpaceBase & {
  type:
    | "go"
    | "event"
    | "community"
    | "jail"
    | "free-parking"
    | "go-to-jail";
};

export type BoardV2Space =
  | BoardV2PropertySpace
  | BoardV2TransitSpace
  | BoardV2UtilitySpace
  | BoardV2TaxSpace
  | BoardV2SpecialSpace;

export const BOARD_V2_COLOR_GROUPS = {
  "growth-lab": {
    color: "#b91c1c",
    id: "growth-lab",
    name: "Growth Lab",
  },
  "urban-makers": {
    color: "#1d4ed8",
    id: "urban-makers",
    name: "Urban Makers",
  },
  "civic-lights": {
    color: "#047857",
    id: "civic-lights",
    name: "Civic Lights",
  },
  "waterfront-exchange": {
    color: "#7e22ce",
    id: "waterfront-exchange",
    name: "Waterfront Exchange",
  },
  "culture-grid": {
    color: "#c2410c",
    id: "culture-grid",
    name: "Culture Grid",
  },
  "green-circuit": {
    color: "#0e7490",
    id: "green-circuit",
    name: "Green Circuit",
  },
  "commerce-heights": {
    color: "#a16207",
    id: "commerce-heights",
    name: "Commerce Heights",
  },
  "apex-district": {
    color: "#be185d",
    id: "apex-district",
    name: "Apex District",
  },
} as const satisfies Record<BoardV2ColorGroupId, BoardV2ColorGroup>;

export const BOARD_V2_SPACES = [
  {
    color: "#06d6a0",
    description: "Launch a new circuit of the city from Property Empire Plaza.",
    icon: "GO",
    id: "go",
    index: 0,
    title: "GO",
    type: "go",
  },
  {
    baseRent: 8,
    color: BOARD_V2_COLOR_GROUPS["growth-lab"].color,
    colorGroup: "growth-lab",
    description: "Flexible studios built for the city's newest founders.",
    hotelRent: 550,
    houseRent: [40, 110, 250, 380],
    icon: "BLDG",
    id: "colab-court",
    index: 1,
    name: "CoLab Court",
    purchasePrice: 100,
    title: "CoLab Court",
    type: "property",
  },
  {
    color: "#f9c74f",
    description: "Draw from the Community deck and resolve a citywide update.",
    icon: "CITY",
    id: "neighborhood-grant",
    index: 2,
    title: "Neighborhood Grant",
    type: "community",
  },
  {
    baseRent: 10,
    color: BOARD_V2_COLOR_GROUPS["growth-lab"].color,
    colorGroup: "growth-lab",
    description: "A compact mixed-use block with a thriving creative scene.",
    hotelRent: 600,
    houseRent: [45, 125, 280, 420],
    icon: "BLDG",
    id: "pixel-row",
    index: 3,
    name: "Pixel Row",
    purchasePrice: 120,
    title: "Pixel Row",
    type: "property",
  },
  {
    amount: 150,
    color: "#ef476f",
    description: "Contribute to roads, parks, and shared city services.",
    icon: "TAX",
    id: "city-tax",
    index: 4,
    title: "City Tax",
    type: "tax",
  },
  {
    color: "#118ab2",
    description: "A rapid circular line connecting the central districts.",
    icon: "RAIL",
    id: "metro-loop",
    index: 5,
    purchasePrice: 200,
    title: "Metro Loop",
    type: "transit",
  },
  {
    baseRent: 12,
    color: BOARD_V2_COLOR_GROUPS["urban-makers"].color,
    colorGroup: "urban-makers",
    description: "High-density homes above independent design workshops.",
    hotelRent: 700,
    houseRent: [55, 150, 340, 480],
    icon: "BLDG",
    id: "skyline-lofts",
    index: 6,
    name: "Skyline Lofts",
    purchasePrice: 140,
    title: "Skyline Lofts",
    type: "property",
  },
  {
    color: "#f8961e",
    description: "Draw an Event card from the city calendar.",
    icon: "EVENT",
    id: "pop-up-market",
    index: 7,
    title: "Pop-Up Market",
    type: "event",
  },
  {
    baseRent: 14,
    color: BOARD_V2_COLOR_GROUPS["urban-makers"].color,
    colorGroup: "urban-makers",
    description: "Waterfront workspaces lining a restored industrial canal.",
    hotelRent: 760,
    houseRent: [60, 170, 370, 520],
    icon: "BLDG",
    id: "canal-walk",
    index: 8,
    name: "Canal Walk",
    purchasePrice: 150,
    title: "Canal Walk",
    type: "property",
  },
  {
    baseRent: 16,
    color: BOARD_V2_COLOR_GROUPS["urban-makers"].color,
    colorGroup: "urban-makers",
    description: "A lively avenue for fabricators, studios, and small shops.",
    hotelRent: 820,
    houseRent: [65, 190, 410, 560],
    icon: "BLDG",
    id: "maker-lane",
    index: 9,
    name: "Maker Lane",
    purchasePrice: 160,
    title: "Maker Lane",
    type: "property",
  },
  {
    color: "#171915",
    description: "Visit the civic complex without interrupting your route.",
    icon: "JAIL",
    id: "civic-detention",
    index: 10,
    title: "Jail / Just Visiting",
    type: "jail",
  },
  {
    baseRent: 18,
    color: BOARD_V2_COLOR_GROUPS["civic-lights"].color,
    colorGroup: "civic-lights",
    description: "Apartments facing the city's newest linear park.",
    hotelRent: 900,
    houseRent: [80, 220, 480, 680],
    icon: "BLDG",
    id: "greenway-flats",
    index: 11,
    name: "Greenway Flats",
    purchasePrice: 180,
    title: "Greenway Flats",
    type: "property",
  },
  {
    color: "#43aa8b",
    description: "A neighborhood energy provider powered by city rooftops.",
    icon: "UTIL",
    id: "solar-utility",
    index: 12,
    purchasePrice: 150,
    title: "Solar Utility",
    type: "utility",
  },
  {
    baseRent: 20,
    color: BOARD_V2_COLOR_GROUPS["civic-lights"].color,
    colorGroup: "civic-lights",
    description: "A reflective office landmark beside the civic gardens.",
    hotelRent: 980,
    houseRent: [90, 250, 520, 720],
    icon: "BLDG",
    id: "glass-tower",
    index: 13,
    name: "Glass Tower",
    purchasePrice: 190,
    title: "Glass Tower",
    type: "property",
  },
  {
    baseRent: 22,
    color: BOARD_V2_COLOR_GROUPS["civic-lights"].color,
    colorGroup: "civic-lights",
    description: "An all-hours entertainment district glowing after sunset.",
    hotelRent: 1050,
    houseRent: [100, 280, 570, 780],
    icon: "BLDG",
    id: "neon-arcade",
    index: 14,
    name: "Neon Arcade",
    purchasePrice: 200,
    title: "Neon Arcade",
    type: "property",
  },
  {
    color: "#118ab2",
    description: "A waterside rail line serving the maker and harbor wards.",
    icon: "RAIL",
    id: "harbor-line",
    index: 15,
    purchasePrice: 200,
    title: "Harbor Line",
    type: "transit",
  },
  {
    baseRent: 24,
    color: BOARD_V2_COLOR_GROUPS["waterfront-exchange"].color,
    colorGroup: "waterfront-exchange",
    description: "Converted warehouse homes beside the old freight depot.",
    hotelRent: 1160,
    houseRent: [110, 310, 650, 880],
    icon: "BLDG",
    id: "depot-flats",
    index: 16,
    name: "Depot Flats",
    purchasePrice: 220,
    title: "Depot Flats",
    type: "property",
  },
  {
    color: "#f9c74f",
    description: "Draw from the Community deck and share in local progress.",
    icon: "CITY",
    id: "civic-fund",
    index: 17,
    title: "Civic Fund",
    type: "community",
  },
  {
    baseRent: 26,
    color: BOARD_V2_COLOR_GROUPS["waterfront-exchange"].color,
    colorGroup: "waterfront-exchange",
    description: "A grand food hall anchoring the river commerce district.",
    hotelRent: 1240,
    houseRent: [120, 340, 700, 940],
    icon: "BLDG",
    id: "market-hall",
    index: 18,
    name: "Market Hall",
    purchasePrice: 230,
    title: "Market Hall",
    type: "property",
  },
  {
    baseRent: 28,
    color: BOARD_V2_COLOR_GROUPS["waterfront-exchange"].color,
    colorGroup: "waterfront-exchange",
    description: "Premium towers and promenades along the restored river edge.",
    hotelRent: 1320,
    houseRent: [130, 370, 760, 1000],
    icon: "BLDG",
    id: "riverfront",
    index: 19,
    name: "Riverfront",
    purchasePrice: 240,
    title: "Riverfront",
    type: "property",
  },
  {
    color: "#06d6a0",
    description: "Pause in the central mobility plaza with no immediate effect.",
    icon: "PARK",
    id: "free-parking",
    index: 20,
    title: "Free Parking",
    type: "free-parking",
  },
  {
    baseRent: 30,
    color: BOARD_V2_COLOR_GROUPS["culture-grid"].color,
    colorGroup: "culture-grid",
    description: "Gallery-lined terraces overlooking the public art walk.",
    hotelRent: 1450,
    houseRent: [140, 400, 820, 1100],
    icon: "BLDG",
    id: "gallery-steps",
    index: 21,
    name: "Gallery Steps",
    purchasePrice: 260,
    title: "Gallery Steps",
    type: "property",
  },
  {
    color: "#f8961e",
    description: "Draw an Event card during the city's annual street festival.",
    icon: "EVENT",
    id: "street-fest",
    index: 22,
    title: "Street Fest",
    type: "event",
  },
  {
    baseRent: 32,
    color: BOARD_V2_COLOR_GROUPS["culture-grid"].color,
    colorGroup: "culture-grid",
    description: "Studios and venues built around a landmark recording hall.",
    hotelRent: 1540,
    houseRent: [150, 430, 880, 1160],
    icon: "BLDG",
    id: "soundstage-avenue",
    index: 23,
    name: "Soundstage Avenue",
    purchasePrice: 270,
    title: "Soundstage Avenue",
    type: "property",
  },
  {
    baseRent: 34,
    color: BOARD_V2_COLOR_GROUPS["culture-grid"].color,
    colorGroup: "culture-grid",
    description: "A bright public square surrounded by theaters and cafes.",
    hotelRent: 1630,
    houseRent: [160, 460, 940, 1230],
    icon: "BLDG",
    id: "lantern-square",
    index: 24,
    name: "Lantern Square",
    purchasePrice: 280,
    title: "Lantern Square",
    type: "property",
  },
  {
    color: "#118ab2",
    description: "The main rail interchange linking every transit corridor.",
    icon: "RAIL",
    id: "central-rail",
    index: 25,
    purchasePrice: 200,
    title: "Central Rail",
    type: "transit",
  },
  {
    baseRent: 36,
    color: BOARD_V2_COLOR_GROUPS["green-circuit"].color,
    colorGroup: "green-circuit",
    description: "Net-zero homes with broad terraces and solar canopies.",
    hotelRent: 1760,
    houseRent: [170, 500, 1000, 1320],
    icon: "BLDG",
    id: "solar-terrace",
    index: 26,
    name: "Solar Terrace",
    purchasePrice: 300,
    title: "Solar Terrace",
    type: "property",
  },
  {
    baseRent: 38,
    color: BOARD_V2_COLOR_GROUPS["green-circuit"].color,
    colorGroup: "green-circuit",
    description: "A garden-centered neighborhood with a shared market court.",
    hotelRent: 1860,
    houseRent: [180, 530, 1060, 1390],
    icon: "BLDG",
    id: "orchard-commons",
    index: 27,
    name: "Orchard Commons",
    purchasePrice: 310,
    title: "Orchard Commons",
    type: "property",
  },
  {
    color: "#43aa8b",
    description: "The smart electrical network balancing demand citywide.",
    icon: "UTIL",
    id: "gridworks",
    index: 28,
    purchasePrice: 150,
    title: "GridWorks",
    type: "utility",
  },
  {
    baseRent: 40,
    color: BOARD_V2_COLOR_GROUPS["green-circuit"].color,
    colorGroup: "green-circuit",
    description: "Residences woven through parks, paths, and urban wetlands.",
    hotelRent: 1960,
    houseRent: [190, 560, 1120, 1460],
    icon: "BLDG",
    id: "parkline-residences",
    index: 29,
    name: "Parkline Residences",
    purchasePrice: 320,
    title: "Parkline Residences",
    type: "property",
  },
  {
    color: "#171915",
    description: "Move directly to Civic Detention when future rules are enabled.",
    icon: "GOTO",
    id: "go-to-jail",
    index: 30,
    title: "Go To Jail",
    type: "go-to-jail",
  },
  {
    baseRent: 42,
    color: BOARD_V2_COLOR_GROUPS["commerce-heights"].color,
    colorGroup: "commerce-heights",
    description: "A prestigious address for fast-growing city ventures.",
    hotelRent: 2100,
    houseRent: [200, 600, 1200, 1580],
    icon: "BLDG",
    id: "venture-boulevard",
    index: 31,
    name: "Venture Boulevard",
    purchasePrice: 340,
    title: "Venture Boulevard",
    type: "property",
  },
  {
    baseRent: 44,
    color: BOARD_V2_COLOR_GROUPS["commerce-heights"].color,
    colorGroup: "commerce-heights",
    description: "A landmark plaza where finance and technology firms meet.",
    hotelRent: 2200,
    houseRent: [210, 630, 1260, 1660],
    icon: "BLDG",
    id: "exchange-square",
    index: 32,
    name: "Exchange Square",
    purchasePrice: 350,
    title: "Exchange Square",
    type: "property",
  },
  {
    color: "#f9c74f",
    description: "Draw from the Community deck and invest in shared prosperity.",
    icon: "CITY",
    id: "community-build",
    index: 33,
    title: "Community Build",
    type: "community",
  },
  {
    baseRent: 46,
    color: BOARD_V2_COLOR_GROUPS["commerce-heights"].color,
    colorGroup: "commerce-heights",
    description: "A signature tower at the center of the business skyline.",
    hotelRent: 2300,
    houseRent: [220, 660, 1320, 1740],
    icon: "BLDG",
    id: "meridian-tower",
    index: 34,
    name: "Meridian Tower",
    purchasePrice: 360,
    title: "Meridian Tower",
    type: "property",
  },
  {
    color: "#118ab2",
    description: "An express mobility hub for bikes, trams, and city shuttles.",
    icon: "RAIL",
    id: "bike-hub",
    index: 35,
    purchasePrice: 200,
    title: "Bike Hub",
    type: "transit",
  },
  {
    color: "#f8961e",
    description: "Draw an Event card as the city votes on its next initiative.",
    icon: "EVENT",
    id: "city-vote",
    index: 36,
    title: "City Vote",
    type: "event",
  },
  {
    baseRent: 50,
    color: BOARD_V2_COLOR_GROUPS["apex-district"].color,
    colorGroup: "apex-district",
    description: "Luxury residences floating above the city cloud line.",
    hotelRent: 2450,
    houseRent: [250, 720, 1480, 1940],
    icon: "BLDG",
    id: "cloudview-penthouse",
    index: 37,
    name: "Cloudview Penthouse",
    purchasePrice: 380,
    title: "Cloudview Penthouse",
    type: "property",
  },
  {
    amount: 100,
    color: "#ef476f",
    description: "Support maintenance of the connected city energy network.",
    icon: "TAX",
    id: "grid-levy",
    index: 38,
    title: "Grid Levy",
    type: "tax",
  },
  {
    baseRent: 60,
    color: BOARD_V2_COLOR_GROUPS["apex-district"].color,
    colorGroup: "apex-district",
    description: "The city's most exclusive address at the top of the skyline.",
    hotelRent: 2700,
    houseRent: [300, 800, 1650, 2150],
    icon: "BLDG",
    id: "horizon-crown",
    index: 39,
    name: "Horizon Crown",
    purchasePrice: 400,
    title: "Horizon Crown",
    type: "property",
  },
] as const satisfies readonly BoardV2Space[];

export const BOARD_V2_EXPECTED_DISTRIBUTION = {
  community: 3,
  event: 3,
  "free-parking": 1,
  go: 1,
  "go-to-jail": 1,
  jail: 1,
  property: 22,
  tax: 2,
  transit: 4,
  utility: 2,
} as const satisfies Record<BoardV2SpaceType, number>;

export type BoardV2Side = "bottom" | "left" | "right" | "top";

export type BoardV2GridPosition = {
  column: number;
  row: number;
  side: BoardV2Side;
};

export const BOARD_V2_CENTER_GRID_AREA = {
  gridColumn: "2 / 11",
  gridRow: "2 / 11",
} as const;

export function getBoardV2GridPosition(index: number): BoardV2GridPosition {
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_V2_SPACE_COUNT) {
    throw new RangeError(`Board V2 index must be between 0 and 39. Received ${index}.`);
  }

  if (index <= 10) {
    return { column: BOARD_V2_GRID_SIZE - index, row: 11, side: "bottom" };
  }

  if (index <= 20) {
    return { column: 1, row: 21 - index, side: "left" };
  }

  if (index <= 30) {
    return { column: index - 19, row: 1, side: "top" };
  }

  return { column: 11, row: index - 29, side: "right" };
}

export function isBoardV2Property(
  space: BoardV2Space,
): space is BoardV2PropertySpace {
  return space.type === "property";
}
