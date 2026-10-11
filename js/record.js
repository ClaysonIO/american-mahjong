// Saving games.
//
// A game is fully determined by its seed (the deal) and the human player's
// decisions: the computer players have no randomness. So the game in progress is
// saved as { seed, dealer, decisions } and restored after a page refresh by
// replaying those decisions. Finished games are also saved as a snapshot of the
// final table, so reviewing them doesn't depend on replaying.

import { JOKER } from "./tiles.js";

/** Bump when a change to the rules or the computer players would make old records replay differently. */
export const RECORD_VERSION = 1;

const byIds = (hand, ids) => ids.map((id) => {
  const tile = hand.find((t) => t.id === id);
  if (!tile) throw new Error(`Saved game doesn't match: tile ${id} isn't in the hand`);
  return tile;
});

/** A decision as plain JSON. Called before the engine applies it. */
export function encode(kind, value, game, seat) {
  if (kind === "charleston") return { c: value.map((t) => t.id) };
  if (kind === "second") return { s: !!value };
  if (kind === "turn") {
    if (value.type === "discard") return { d: value.tile.id };
    if (value.type === "mahjong") return { m: 1 };
    if (value.type === "swap") {
      return { w: value.tile.id, seat: value.seat, ex: game.players[value.seat].exposures.indexOf(value.exposure) };
    }
  }
  if (kind === "call") return value ? (value.type === "mahjong" ? { m: 1 } : { e: value.size }) : { p: 1 };
  throw new Error(`Can't save a ${kind} decision`);
}

/** Turns a saved decision back into what the engine expects, checking it still fits the game. */
export function decode(kind, d, game, seat) {
  const hand = game.players[seat].hand;
  if (kind === "charleston" && Array.isArray(d.c) && d.c.length === 3) {
    const tiles = byIds(hand, d.c);
    if (tiles.some((t) => t.type === JOKER)) throw new Error("Saved game doesn't match: a joker was passed");
    return tiles;
  }
  if (kind === "second" && "s" in d) return d.s;
  if (kind === "turn") {
    if ("d" in d) return { type: "discard", tile: byIds(hand, [d.d])[0] };
    if ("m" in d) return { type: "mahjong" };
    if ("w" in d) {
      const exposure = game.players[d.seat]?.exposures[d.ex];
      const [tile] = byIds(hand, [d.w]);
      if (!exposure || exposure.type !== tile.type) throw new Error("Saved game doesn't match: bad joker swap");
      return { type: "swap", tile, seat: d.seat, exposure };
    }
  }
  if (kind === "call") {
    if ("p" in d) return null;
    if ("m" in d) return { type: "mahjong" };
    if ("e" in d) return { type: "expose", size: d.e };
  }
  throw new Error(`Saved game doesn't match: expected a ${kind} decision`);
}

/**
 * A controller for the recorded seat. It first answers from `replay` (saved
 * decisions); once those run out it asks `decide(kind, game, seat, args)` and
 * reports each new decision to `onRecord`. `onLive` is called once, when the
 * replay is over and the first live decision is needed.
 */
export function recordedController({ decide, replay = [], onRecord = () => {}, onLive = () => {} }) {
  let next = 0;
  let live = false;
  const step = async (kind, game, seat, args) => {
    if (next < replay.length) return decode(kind, replay[next++], game, seat);
    if (!live) { live = true; onLive(); }
    const value = await decide(kind, game, seat, args);
    onRecord(encode(kind, value, game, seat));
    return value;
  };
  return {
    get replaying() { return next < replay.length; },
    chooseCharlestonPass: (g, s, direction) => step("charleston", g, s, { direction }),
    wantsSecondCharleston: (g, s) => step("second", g, s, {}),
    chooseTurnAction: (g, s) => step("turn", g, s, {}),
    // Only discards you could do something with are asked about (and recorded).
    chooseCall(g, s, tile, discarder) {
      const opts = g.callOptions(s, tile);
      if (!opts.mahjong && !opts.sizes.length) return Promise.resolve(null);
      return step("call", g, s, { tile, discarder, opts });
    },
  };
}

/** Everything needed to review a finished game, as plain JSON. */
export function snapshot(game, { mode, lines, seed, decisions, startedAt }) {
  const r = game.result;
  return {
    v: RECORD_VERSION,
    startedAt,
    endedAt: new Date().toISOString(),
    mode,
    seed,
    dealer: game.dealer,
    lines,
    decisions,
    result: r.wallGame
      ? { wallGame: true }
      : {
        winner: r.winner,
        pattern: r.target.hand.pattern,
        value: r.value,
        selfDrawn: r.selfDrawn,
        discarder: r.discarder,
        jokerless: r.jokerless,
        payments: r.payments,
      },
    players: game.players.map((p) => ({
      name: p.name,
      wind: p.wind,
      hand: p.hand.map((t) => t.type),
      exposures: p.exposures.map((e) => e.tiles.map((t) => t.type)),
    })),
    discards: game.discards.map((d) => ({ type: d.tile.type, seat: d.seat })),
    log: [...game.log],
  };
}
