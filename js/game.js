// One game of American Mahjong for four seats. The engine knows nothing about
// the screen: every decision is asked of the seat's controller (the human UI or
// a computer player), and onUpdate is called whenever something visible changes.
//
// Seats go counter-clockwise: 0 is you, 1 on your right, 2 across, 3 on your left.
// Play passes to the right (seat + 1).

import { buildWall, sortTiles, JOKER, tileName } from "./tiles.js";
import { findWin, scoreWin } from "./matcher.js";
import * as ai from "./ai.js";

export const WIND_ORDER = ["East", "South", "West", "North"];
const PASS_OFFSET = { right: 1, across: 2, left: 3 };
const FIRST_CHARLESTON = ["right", "across", "left"];
const SECOND_CHARLESTON = ["left", "across", "right"];
const GROUP_NAMES = { 3: "pung", 4: "kong", 5: "quint", 6: "sextet" };

const possessive = (name) => (name === "You" ? "your" : `${name}'s`);
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** A computer player. `delay` slows it down so people can follow along. */
export function aiController(delay = 0) {
  return {
    async chooseCharlestonPass(game, seat) {
      await sleep(delay / 2);
      return ai.chooseCharlestonPass(game.players[seat].hand);
    },
    async wantsSecondCharleston(game, seat) {
      return ai.wantsSecondCharleston(game.players[seat].hand);
    },
    async chooseTurnAction(game, seat) {
      await sleep(delay);
      return ai.chooseTurnAction(game.players[seat], game.players);
    },
    async chooseCall(game, seat, tile) {
      return ai.chooseCall(game.players[seat], tile);
    },
  };
}

export class Game {
  constructor({ controllers, names = ["You", "Rose", "Harriet", "Bea"], dealer = 0, rng = Math.random, onUpdate = () => {} }) {
    this.controllers = controllers;
    this.dealer = dealer;
    this.onUpdate = onUpdate;
    this.wall = buildWall(rng);
    this.players = names.map((name, seat) => ({
      seat,
      name,
      wind: WIND_ORDER[(seat - dealer + 4) % 4],
      hand: [],
      exposures: [], // [{ type, tiles }]
      received: [], // tiles just received in the Charleston (for highlighting)
      lastDrawn: null,
    }));
    this.discards = []; // [{ tile, seat }]
    this.phase = "deal"; // deal | charleston | play | over
    this.turn = dealer;
    this.charleston = null; // { direction, round } while passing
    this.result = null;
    this.log = [];
  }

  get wallCount() { return this.wall.length; }

  say(msg) {
    this.log.push(msg);
    this.update();
  }

  update() { this.onUpdate(this); }

  async run() {
    // Everyone starts with 13; each turn starts with a draw, and a drawn (or called)
    // 14th tile that completes a hand wins without a discard.
    for (const p of this.players) p.hand = this.wall.splice(0, 13);
    for (const p of this.players) sortTiles(p.hand);
    this.say(`Everyone has 13 tiles. East (${this.players[this.dealer].name}) draws first.`);

    this.phase = "charleston";
    await this.runCharleston();

    this.phase = "play";
    await this.play();
    this.update();
    return this.result;
  }

  async runCharleston() {
    for (const [i, direction] of FIRST_CHARLESTON.entries()) await this.pass(direction, i + 1);
    const answers = await Promise.all(this.players.map((p) => this.controllers[p.seat].wantsSecondCharleston(this, p.seat)));
    const stopper = answers.findIndex((a) => !a);
    if (stopper >= 0) {
      this.say(`${this.players[stopper].name} stopped the Charleston.`);
    } else {
      this.say("Everyone agreed to a second Charleston.");
      for (const [i, direction] of SECOND_CHARLESTON.entries()) await this.pass(direction, i + 4);
    }
    this.charleston = null;
    for (const p of this.players) p.received = [];
  }

  async pass(direction, round) {
    this.charleston = { direction, round };
    this.update();
    const picks = await Promise.all(this.players.map((p) => this.controllers[p.seat].chooseCharlestonPass(this, p.seat, direction)));
    picks.forEach((tiles, seat) => {
      const hand = this.players[seat].hand;
      const ok = tiles.length === 3 && new Set(tiles).size === 3 && tiles.every((t) => hand.includes(t) && t.type !== JOKER);
      if (!ok) throw new Error(`Seat ${seat} passed an invalid set of tiles`);
    });
    picks.forEach((tiles, seat) => { this.players[seat].hand = this.players[seat].hand.filter((t) => !tiles.includes(t)); });
    picks.forEach((tiles, seat) => {
      const to = this.players[(seat + PASS_OFFSET[direction]) % 4];
      to.hand.push(...tiles);
      to.received = tiles;
      sortTiles(to.hand);
    });
    this.say(`Charleston: everyone passed 3 tiles ${direction}.`);
  }

  async play() {
    let seat = this.dealer;
    let drew = true; // whether this turn starts with a draw (not after calling a discard)
    let calledFrom = null;
    for (;;) {
      const p = this.players[seat];
      this.turn = seat;
      if (drew) {
        if (!this.wall.length) {
          this.result = { wallGame: true };
          this.phase = "over";
          this.say("The wall is empty: wall game, nobody wins.");
          return;
        }
        const tile = this.wall.shift();
        p.hand.push(tile);
        sortTiles(p.hand);
        p.lastDrawn = tile;
      }
      this.update();

      const discard = await this.takeTurn(p, drew ? null : calledFrom);
      p.lastDrawn = null;
      if (this.phase === "over") return;

      this.discards.push({ tile: discard, seat });
      this.say(`${p.name} discarded ${tileName(discard.type)}.`);

      const call = await this.collectCalls(seat, discard);
      if (!call) {
        seat = (seat + 1) % 4;
        drew = true;
        calledFrom = null;
        continue;
      }
      this.discards.pop();
      const caller = this.players[call.seat];
      if (call.type === "mahjong") {
        caller.hand.push(discard);
        sortTiles(caller.hand);
        this.win(caller, findWin(caller.hand, caller.exposures), seat);
        return;
      }
      this.expose(caller, discard, call.size);
      seat = call.seat;
      drew = false;
      calledFrom = call.from;
    }
  }

  /** Asks the player what to do until they discard (or win). Returns the discarded tile. */
  async takeTurn(p, calledFrom) {
    for (;;) {
      const action = await this.controllers[p.seat].chooseTurnAction(this, p.seat);
      if (action.type === "mahjong") {
        const target = findWin(p.hand, p.exposures);
        if (target) {
          this.win(p, target, calledFrom);
          return null;
        }
        this.say(`${p.name}: that isn't a hand on the card yet.`);
      } else if (action.type === "swap") {
        this.swapJoker(p, action.tile, this.players[action.seat], action.exposure);
      } else if (action.type === "discard") {
        const i = p.hand.indexOf(action.tile);
        if (i < 0) throw new Error(`${p.name} discarded a tile they don't have`);
        return p.hand.splice(i, 1)[0];
      }
    }
  }

  /** What `seat` could do with someone else's discard. */
  callOptions(seat, tile) {
    const p = this.players[seat];
    if (tile.type === JOKER) return { mahjong: false, sizes: [] };
    const naturals = p.hand.filter((t) => t.type === tile.type).length;
    const jokers = p.hand.filter((t) => t.type === JOKER).length;
    return {
      mahjong: !!findWin([...p.hand, tile], p.exposures),
      sizes: [3, 4, 5].filter((n) => naturals + jokers >= n - 1),
    };
  }

  async collectCalls(discarder, tile) {
    if (tile.type === JOKER) return null;
    const order = [1, 2, 3].map((k) => (discarder + k) % 4); // nearest in turn order first
    const answers = await Promise.all(order.map((seat) => this.controllers[seat].chooseCall(this, seat, tile, discarder)));
    const valid = order
      .map((seat, i) => ({ ...answers[i], seat, from: discarder }))
      .filter((c) => {
        if (!c.type) return false;
        const opts = this.callOptions(c.seat, tile);
        return c.type === "mahjong" ? opts.mahjong : opts.sizes.includes(c.size);
      });
    return valid.find((c) => c.type === "mahjong") || valid[0] || null;
  }

  expose(p, tile, size) {
    const mine = [];
    for (const t of p.hand) if (mine.length < size - 1 && t.type === tile.type) mine.push(t);
    for (const t of p.hand) if (mine.length < size - 1 && t.type === JOKER) mine.push(t);
    p.hand = p.hand.filter((t) => !mine.includes(t));
    p.exposures.push({ type: tile.type, tiles: [tile, ...mine] });
    this.say(`${p.name} called ${tileName(tile.type)} and exposed a ${GROUP_NAMES[size]}.`);
  }

  swapJoker(p, tile, owner, exposure) {
    const ji = exposure.tiles.findIndex((t) => t.type === JOKER);
    if (tile.type !== exposure.type || ji < 0 || !p.hand.includes(tile) || !owner.exposures.includes(exposure)) {
      throw new Error("Invalid joker swap");
    }
    const joker = exposure.tiles[ji];
    exposure.tiles[ji] = tile;
    p.hand.splice(p.hand.indexOf(tile), 1, joker);
    sortTiles(p.hand);
    const whose = owner === p ? "own" : possessive(owner.name);
    this.say(`${p.name} swapped ${tileName(tile.type)} for a joker from ${whose} exposure.`);
  }

  win(p, target, discarder) {
    const usedJoker = [...p.hand, ...p.exposures.flatMap((e) => e.tiles)].some((t) => t.type === JOKER);
    const score = scoreWin({ target, winner: p.seat, discarder, usedJoker });
    this.result = { winner: p.seat, target, discarder, selfDrawn: discarder === null, ...score };
    this.phase = "over";
    const how = discarder === null ? "self-drawn" : `on ${possessive(this.players[discarder].name)} discard`;
    this.say(`Mahjong for ${p.name}, ${how}, with "${target.hand.pattern}".`);
  }
}
