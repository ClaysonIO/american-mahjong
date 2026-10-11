// The card: the list of hands you may win with.
//
// The official National Mah Jongg League card is copyrighted and changes every
// year, so this is an original practice card written in the same notation.
//
// Notation (one token per group, separated by spaces):
//   F             flower              N E W S   winds
//   1-9           a number            0         Soap (White Dragon) used as zero
//   X Y Z Q       any number, and the next three consecutive numbers (X+1, X+2, X+3)
//   D             the dragon that matches the token's suit
//   a / b / c     suffix naming a suit; different letters are different suits
// A token made of one repeated character is a group (pair, pung, kong, quint...),
// e.g. "222a" is a pung of 2s. A token of different characters is singles,
// e.g. "2026a" is a 2, a Soap, a 2 and a 6 of one suit.
// Jokers may stand in for any tile in a group of 3 or more, never in a pair or single.
// Concealed hands (c: true) may not call discards except for the winning tile.

export const CARD = [
  {
    section: "2026",
    hands: [
      { p: "FFFF 2026a 222b 222c", v: 25, note: "Any 3 suits" },
      { p: "222a 0000 222b 6666c", v: 25, note: "Any 3 suits" },
      { p: "FF 2026a 2026b DDDDc", v: 30, note: "Any 3 suits" },
      { p: "NN EE 2026a WW SS 22b", v: 50, c: true, note: "Any 2 suits" },
      { p: "FF 2026a 2026b 2026c", v: 50, c: true, note: "3 suits" },
    ],
  },
  {
    section: "2468",
    hands: [
      { p: "222a 4444a 666a 8888a", v: 25, note: "Any 1 suit" },
      { p: "22a 444a 66b 888b DDDDc", v: 25, note: "Any 3 suits" },
      { p: "FF 2222a 44b 66b 8888c", v: 25, note: "Any 3 suits" },
      { p: "FFF 2222a 4444b 888c", v: 25, note: "Any 3 suits" },
      { p: "FF 2468a 2468b 2468c", v: 50, c: true, note: "3 suits" },
    ],
  },
  {
    section: "Any Like Numbers",
    hands: [
      { p: "FF XXXXa XXXXb XXXXc", v: 25, note: "Any number, 3 suits" },
      { p: "FFFF XXXa DDa XXXb DDb", v: 30, note: "Any number, any 2 suits" },
      { p: "XXXa XXXb XXXXc DDDDa", v: 25, note: "Any number, 3 suits" },
    ],
  },
  {
    section: "Quints",
    hands: [
      { p: "FF XXXXXa YYYYa ZZZa", v: 40, note: "Any 3 consecutive numbers, 1 suit" },
      { p: "XXXXXa NNNN YYYYYb", v: 45, note: "Any 2 consecutive numbers, any wind" },
      { p: "FFFFF XXXXa DDDDDa", v: 40, note: "Any number, matching dragon" },
    ],
  },
  {
    section: "Consecutive Run",
    hands: [
      { p: "FF XXXa YYYYa ZZZa QQa", v: 25, note: "Any 4 consecutive numbers, 1 suit" },
      { p: "XXXa YYYYa XXXb YYYYb", v: 25, note: "Any 2 consecutive numbers, 2 suits" },
      { p: "XXXXa YYYYb ZZZZc DDa", v: 25, note: "Any 3 consecutive numbers, 3 suits" },
      { p: "XYZa XXXXb YYYYc ZZZc", v: 30, note: "Any 3 consecutive numbers, 3 suits" },
      { p: "XXa YYa ZZa QQa XXb YYb ZZb", v: 50, c: true, note: "Consecutive pairs, 2 suits" },
    ],
  },
  {
    section: "13579",
    hands: [
      { p: "111a 333a 5555a 7777a", v: 25, note: "Any 1 suit" },
      { p: "11a 333a 55b 777b 9999c", v: 25, note: "Any 3 suits" },
      { p: "FFFF 5555a 7777b 99c", v: 30, note: "Any 3 suits" },
      { p: "FF 13579a 13579b DDc", v: 50, c: true, note: "Any 3 suits" },
    ],
  },
  {
    section: "Winds - Dragons",
    hands: [
      { p: "NNNN EEE WWW SSSS", v: 25 },
      { p: "FF NNN EEEE WWW SS", v: 25 },
      { p: "NN EEE WWW SS DDDDa", v: 30, note: "Any dragon" },
      { p: "FF DDDDa DDDDb DDDDc", v: 30, note: "All 3 dragons" },
      { p: "NEWS DDDa DDDb DDDDc", v: 30, note: "All 3 dragons" },
    ],
  },
  {
    section: "369",
    hands: [
      { p: "FFFF 333a 6666a 999a", v: 25, note: "Any 1 suit" },
      { p: "FF 333a 666b 999c DDDa", v: 25, note: "Any 3 suits" },
      { p: "FF 3333a 66b 66c 9999a", v: 30, note: "Any 3 suits" },
    ],
  },
  {
    section: "Singles and Pairs",
    hands: [
      { p: "NN EE WW SS XXa XXb XXc", v: 50, c: true, note: "Any like numbers" },
      { p: "FF XXa YYa ZZa XXb YYb ZZb", v: 50, c: true, note: "Any 3 consecutive numbers, 2 suits" },
    ],
  },
];

const NUMBER_OFFSETS = { X: 0, Y: 1, Z: 2, Q: 3 };
const HONORS = new Set(["F", "N", "E", "W", "S"]);

/**
 * Parses a pattern string into groups: [{ sym, suit, n }]
 * where sym is one of F N E W S D 0 1-9 X Y Z Q and suit is "a" | "b" | "c" | null.
 */
export function parsePattern(str) {
  const groups = [];
  for (const token of str.trim().split(/\s+/)) {
    const m = /^([FNEWSD0-9XYZQ]+)([abc])?$/.exec(token);
    if (!m) throw new Error(`Bad token "${token}" in "${str}"`);
    const [, body, suit = null] = m;
    const syms = [...body];
    for (const sym of syms) {
      const needsSuit = sym === "D" || /[1-9XYZQ]/.test(sym);
      if (needsSuit && !suit) throw new Error(`Token "${token}" in "${str}" needs a suit letter`);
      if (HONORS.has(sym) && suit) throw new Error(`Token "${token}" in "${str}" can't have a suit`);
    }
    if (syms.every((s) => s === syms[0])) groups.push({ sym: syms[0], suit, n: syms.length });
    else for (const sym of syms) groups.push({ sym, suit, n: 1 });
  }
  return groups;
}

function permutations(items, k) {
  if (k === 0) return [[]];
  const out = [];
  items.forEach((item, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const p of permutations(rest, k - 1)) out.push([item, ...p]);
  });
  return out;
}

function symToType(sym, suit, x) {
  if (HONORS.has(sym)) return sym;
  if (sym === "0") return "WD";
  if (sym === "D") return { B: "GD", C: "RD", D: "WD" }[suit];
  const num = sym in NUMBER_OFFSETS ? x + NUMBER_OFFSETS[sym] : Number(sym);
  return `${suit}${num}`;
}

/**
 * All concrete ways to make a hand: each picks real suits for a/b/c and a real
 * number for X. Returns [{ groups: [{ type, n }], key }] without duplicates.
 */
export function expandHand(pattern) {
  const groups = parsePattern(pattern);
  const suitVars = [...new Set(groups.map((g) => g.suit).filter(Boolean))];
  const maxOffset = Math.max(-1, ...groups.filter((g) => g.sym in NUMBER_OFFSETS).map((g) => NUMBER_OFFSETS[g.sym]));
  const xs = maxOffset < 0 ? [0] : Array.from({ length: 9 - maxOffset }, (_, i) => i + 1);
  const seen = new Map();
  for (const perm of permutations(["B", "C", "D"], suitVars.length)) {
    const suitOf = Object.fromEntries(suitVars.map((v, i) => [v, perm[i]]));
    for (const x of xs) {
      const concrete = groups.map((g) => ({ type: symToType(g.sym, suitOf[g.suit], x), n: g.n }));
      const key = concrete.map((g) => `${g.type}x${g.n}`).sort().join(" ");
      if (!seen.has(key)) seen.set(key, { groups: concrete, key });
    }
  }
  return [...seen.values()];
}

/** Flat list of all hands with section and an id. */
export const HANDS = CARD.flatMap((section, si) =>
  section.hands.map((h, hi) => ({
    id: `${si}-${hi}`,
    section: section.section,
    pattern: h.p,
    value: h.v,
    concealed: !!h.c,
    note: h.note || "",
  })),
);
