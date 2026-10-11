// Tile types of an American Mahjong set (152 tiles):
//   3 suits (Bam, Crak, Dot) 1-9 x4, 4 winds x4, 3 dragons x4, 8 flowers, 8 jokers.
// Each dragon belongs to a suit: Green -> Bam, Red -> Crak, White ("Soap") -> Dot.
// Soap also stands for the zero in year hands (2026).

export const SUITS = ["B", "C", "D"];
export const SUIT_NAMES = { B: "Bam", C: "Crak", D: "Dot" };
export const WINDS = ["N", "E", "W", "S"];
export const WIND_NAMES = { N: "North", E: "East", W: "West", S: "South" };
export const DRAGON_OF_SUIT = { B: "GD", C: "RD", D: "WD" };
export const DRAGON_NAMES = { GD: "Green Dragon", RD: "Red Dragon", WD: "Soap (White Dragon)" };
export const FLOWER = "F";
export const JOKER = "J";
export const SOAP = "WD";

export const TYPES = [
  ...SUITS.flatMap((s) => Array.from({ length: 9 }, (_, i) => `${s}${i + 1}`)),
  ...WINDS,
  "GD", "RD", "WD",
  FLOWER,
  JOKER,
];
export const TYPE_INDEX = Object.fromEntries(TYPES.map((t, i) => [t, i]));
export const NUM_TYPES = TYPES.length;
export const JOKER_INDEX = TYPE_INDEX[JOKER];

export const isSuited = (type) => SUITS.includes(type[0]) && type.length === 2 && type[1] >= "1" && type[1] <= "9";

export function tileName(type) {
  if (type === JOKER) return "Joker";
  if (type === FLOWER) return "Flower";
  if (WIND_NAMES[type]) return WIND_NAMES[type];
  if (DRAGON_NAMES[type]) return DRAGON_NAMES[type];
  return `${type[1]} ${SUIT_NAMES[type[0]]}`;
}

/** All 152 tiles, each `{ id, type }`, in a fresh shuffled order. */
export function buildWall(rng = Math.random) {
  const tiles = [];
  let id = 0;
  for (const type of TYPES) {
    const copies = type === FLOWER || type === JOKER ? 8 : 4;
    for (let i = 0; i < copies; i++) tiles.push({ id: id++, type });
  }
  return shuffle(tiles, rng);
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function sortTiles(tiles) {
  return tiles.sort((a, b) => TYPE_INDEX[a.type] - TYPE_INDEX[b.type] || a.id - b.id);
}

/** Count of each tile type (indexed like TYPES) for an array of tiles or type strings. */
export function countsOf(tiles) {
  const counts = new Int8Array(NUM_TYPES);
  for (const t of tiles) counts[TYPE_INDEX[typeof t === "string" ? t : t.type]]++;
  return counts;
}

/** Small seeded RNG (mulberry32), handy for tests and replays. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
