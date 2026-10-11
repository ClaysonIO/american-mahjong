// Compares a player's tiles with every hand on the card.
//
// Every card hand is expanded into "targets": exact tile requirements for one
// choice of suits and numbers. For each target we know how many tiles must be
// real (singles and pairs) and how many may be jokers (groups of 3+), so the
// distance to a target is the number of tiles still missing.

import { HANDS, expandHand } from "./card.js";
import { TYPE_INDEX, JOKER_INDEX, NUM_TYPES, countsOf } from "./tiles.js";

export const HAND_SIZE = 14;

export const TARGETS = HANDS.flatMap((hand) =>
  expandHand(hand.pattern).map(({ groups }) => {
    const natural = new Int8Array(NUM_TYPES); // must be real tiles
    const jokerable = new Int8Array(NUM_TYPES); // may be jokers
    const groupCounts = new Map(); // "type:n" -> how many such groups (for exposures)
    for (const g of groups) {
      const t = TYPE_INDEX[g.type];
      if (g.n >= 3) {
        jokerable[t] += g.n;
        const key = `${g.type}:${g.n}`;
        groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
      } else natural[t] += g.n;
    }
    const req = [];
    for (let t = 0; t < NUM_TYPES; t++) if (natural[t] || jokerable[t]) req.push([t, natural[t], jokerable[t]]);
    return { hand, groups, req, groupCounts, singlesAndPairs: groups.every((g) => g.n < 3) };
  }),
);

/**
 * Distance from a set of concealed tiles plus exposures to every target.
 * @param counts Int8Array of concealed tile counts (jokers included at JOKER_INDEX)
 * @param exposures [{ type, size }] exposed groups (their jokers already count as the group)
 * @returns [{ target, distance }] for every target the exposures fit, unsorted
 */
export function evaluate(counts, exposures = []) {
  const jokers = counts[JOKER_INDEX];
  const expAdj = new Int8Array(NUM_TYPES);
  const expNeed = new Map();
  for (const e of exposures) {
    expAdj[TYPE_INDEX[e.type]] += e.size;
    const key = `${e.type}:${e.size}`;
    expNeed.set(key, (expNeed.get(key) || 0) + 1);
  }
  const out = [];
  for (const target of TARGETS) {
    if (exposures.length) {
      if (target.hand.concealed) continue;
      let fits = true;
      for (const [key, n] of expNeed) if ((target.groupCounts.get(key) || 0) < n) { fits = false; break; }
      if (!fits) continue;
    }
    let needNatural = 0;
    let needJoker = 0;
    for (const [t, nat, jok] of target.req) {
      const have = counts[t];
      const j = jok - expAdj[t];
      if (have < nat) {
        needNatural += nat - have;
        needJoker += j;
      } else if (have - nat < j) needJoker += j - (have - nat);
    }
    out.push({ target, distance: needNatural + Math.max(0, needJoker - jokers) });
  }
  return out;
}

/** Targets sorted closest first (ties: higher value first). */
export function rankTargets(counts, exposures = []) {
  return evaluate(counts, exposures).sort((a, b) => a.distance - b.distance || b.target.hand.value - a.target.hand.value);
}

export function bestDistance(counts, exposures = []) {
  let best = Infinity;
  for (const e of evaluate(counts, exposures)) if (e.distance < best) best = e.distance;
  return best;
}

const exposureShape = (exposures) => exposures.map((e) => ({ type: e.type, size: e.tiles ? e.tiles.length : e.size }));

/**
 * If the tiles make a hand on the card, the highest-scoring winning target, else null.
 * @param concealed array of tiles (or type strings) in the hand
 * @param exposures [{ type, tiles }] or [{ type, size }]
 */
export function findWin(concealed, exposures = []) {
  const shape = exposureShape(exposures);
  const total = concealed.length + shape.reduce((s, e) => s + e.size, 0);
  if (total !== HAND_SIZE) return null;
  let best = null;
  for (const { target, distance } of evaluate(countsOf(concealed), shape)) {
    if (distance === 0 && (!best || target.hand.value > best.hand.value)) best = target;
  }
  return best;
}

/** Closest card hands for a player, one entry per card hand (its closest variant). */
export function closestHands(concealed, exposures = [], limit = 3) {
  const ranked = rankTargets(countsOf(concealed), exposureShape(exposures));
  const out = [];
  const seen = new Set();
  for (const r of ranked) {
    if (seen.has(r.target.hand.id)) continue;
    seen.add(r.target.hand.id);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Points for a win. Discarder pays double; on a self-drawn win everyone pays double.
 * A hand with no jokers (except singles-and-pairs hands, which can't use any) doubles again.
 * @returns { value, jokerless, payments: number[4] } payments are +/- per seat
 */
export function scoreWin({ target, winner, discarder = null, usedJoker }) {
  const value = target.hand.value;
  const jokerless = !usedJoker && !target.singlesAndPairs;
  const base = jokerless ? value * 2 : value;
  const payments = [0, 0, 0, 0];
  for (let seat = 0; seat < 4; seat++) {
    if (seat === winner) continue;
    const pay = discarder === null || seat === discarder ? base * 2 : base;
    payments[seat] -= pay;
    payments[winner] += pay;
  }
  return { value, jokerless, payments };
}
