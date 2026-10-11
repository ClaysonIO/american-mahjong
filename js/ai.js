// Computer players. They pick the card hands they are closest to, keep the
// tiles those hands need and throw away the rest.

import { countsOf, JOKER, JOKER_INDEX, TYPE_INDEX, TYPES } from "./tiles.js";
import { evaluate, findWin, rankTargets } from "./matcher.js";

const exposureShape = (exposures) => exposures.map((e) => ({ type: e.type, size: e.tiles.length }));

/** How much the best few targets want each tile type (higher = keep). */
function usefulness(counts, exposures, handIds = null) {
  const ranked = rankTargets(counts, exposures, handIds).slice(0, 12);
  const score = new Float64Array(TYPES.length);
  if (!ranked.length) return score;
  const best = ranked[0].distance;
  for (const { target, distance } of ranked) {
    const w = 1 / (1 + distance - best);
    for (const [t, nat, jok] of target.req) if (counts[t]) score[t] += w * Math.min(counts[t], nat + jok);
  }
  return score;
}

/** Picks the tile type to give away, never a joker. `handIds` limits the hands aimed for. */
function worstTileType(counts, exposures, handIds = null) {
  const score = usefulness(counts, exposures, handIds);
  let pick = null;
  for (let t = 0; t < TYPES.length; t++) {
    if (!counts[t] || t === JOKER_INDEX) continue;
    counts[t]--;
    let dist = Infinity;
    for (const e of evaluate(counts, exposures, handIds)) if (e.distance < dist) dist = e.distance;
    counts[t]++;
    const keep = score[t] / counts[t];
    if (!pick || dist < pick.dist || (dist === pick.dist && keep < pick.keep)) pick = { t, dist, keep };
  }
  return pick && TYPES[pick.t];
}

/** Three tiles to pass in the Charleston (never jokers). */
export function chooseCharlestonPass(hand) {
  const counts = countsOf(hand);
  const out = [];
  const left = [...hand];
  for (let i = 0; i < 3; i++) {
    const type = worstTileType(counts, []);
    const idx = left.findIndex((t) => t.type === type);
    out.push(left.splice(idx, 1)[0]);
    counts[TYPE_INDEX[type]]--;
  }
  return out;
}

/** Keep going with the second Charleston unless the hand is already close. */
export function wantsSecondCharleston(hand) {
  return rankTargets(countsOf(hand))[0].distance >= 5;
}

/**
 * What to do on our turn (hand has 14 tiles counting exposures).
 * @returns { type: "mahjong" } | { type: "swap", tile, seat, exposure } | { type: "discard", tile }
 */
export function chooseTurnAction(player, allPlayers) {
  if (findWin(player.hand, player.exposures)) return { type: "mahjong" };

  // Swap a real tile for a joker sitting in anyone's exposure, if it doesn't hurt.
  const counts = countsOf(player.hand);
  const shape = exposureShape(player.exposures);
  const before = bestAfterDiscard(counts, shape);
  for (const other of allPlayers) {
    for (const exposure of other.exposures) {
      if (!exposure.tiles.some((t) => t.type === JOKER)) continue;
      const tile = player.hand.find((t) => t.type === exposure.type);
      if (!tile) continue;
      const i = TYPE_INDEX[exposure.type];
      counts[i]--; counts[JOKER_INDEX]++;
      const after = bestAfterDiscard(counts, shape);
      counts[i]++; counts[JOKER_INDEX]--;
      if (after <= before) return { type: "swap", tile, seat: other.seat, exposure };
    }
  }

  const type = worstTileType(counts, shape) ?? player.hand[0].type;
  return { type: "discard", tile: player.hand.find((t) => t.type === type) };
}

/**
 * The tile a player aiming for the given card hands (a Set of ids, or null for any)
 * should discard, or null when there's nothing sensible to suggest.
 */
export function suggestDiscard(player, handIds = null) {
  const counts = countsOf(player.hand);
  const shape = exposureShape(player.exposures);
  if (handIds && !evaluate(counts, shape, handIds).length) return null; // those hands are out of reach
  const type = worstTileType(counts, shape, handIds);
  return type && player.hand.find((t) => t.type === type);
}

function bestAfterDiscard(counts, shape) {
  let best = Infinity;
  for (const e of evaluate(counts, shape)) if (e.distance < best) best = e.distance;
  return best;
}

/**
 * Whether to call someone's discard.
 * @returns null | { type: "mahjong" } | { type: "expose", size }
 */
export function chooseCall(player, tile) {
  if (tile.type === JOKER) return null;
  if (findWin([...player.hand, tile], player.exposures)) return { type: "mahjong" };

  const counts = countsOf(player.hand);
  const shape = exposureShape(player.exposures);
  const now = bestAfterDiscard(counts, shape);
  const t = TYPE_INDEX[tile.type];
  const naturals = counts[t];
  const jokers = counts[JOKER_INDEX];
  let best = null;
  for (let size = 3; size <= 5; size++) {
    if (naturals + jokers < size - 1) break;
    // Expose the called tile plus our own: real tiles first, then jokers.
    const useNat = Math.min(naturals, size - 1);
    const useJok = size - 1 - useNat;
    counts[t] -= useNat; counts[JOKER_INDEX] -= useJok;
    const after = bestAfterDiscard(counts, [...shape, { type: tile.type, size }]);
    counts[t] += useNat; counts[JOKER_INDEX] += useJok;
    if (after < now && after <= 6 && (!best || after < best.after)) best = { size, after };
  }
  return best && { type: "expose", size: best.size };
}
