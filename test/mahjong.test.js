import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDS, parsePattern, expandHand } from "../js/card.js";
import { findWin, bestDistance, scoreWin, TARGETS, closestHands, holdings } from "../js/matcher.js";
import { suggestDiscard } from "../js/ai.js";
import { countsOf, buildWall, seededRng, TYPES } from "../js/tiles.js";
import { Game, aiController } from "../js/game.js";

const tiles = (s) => s.trim().split(/\s+/);

test("every hand on the card has 14 tiles and can be built from one set", () => {
  const available = countsOf(buildWall());
  for (const hand of HANDS) {
    assert.equal(parsePattern(hand.pattern).reduce((s, g) => s + g.n, 0), 14, hand.pattern);
    for (const { groups } of expandHand(hand.pattern)) {
      const natural = {};
      for (const g of groups) if (g.n < 3) natural[g.type] = (natural[g.type] || 0) + g.n;
      for (const [type, n] of Object.entries(natural)) {
        assert.ok(n <= available[TYPES.indexOf(type)], `${hand.pattern} needs ${n} real ${type}`);
      }
    }
  }
});

test("pattern parsing: groups vs singles", () => {
  assert.deepEqual(parsePattern("FF 2026a"), [
    { sym: "F", suit: null, n: 2 },
    { sym: "2", suit: "a", n: 1 },
    { sym: "0", suit: "a", n: 1 },
    { sym: "2", suit: "a", n: 1 },
    { sym: "6", suit: "a", n: 1 },
  ]);
  assert.throws(() => parsePattern("222"), /needs a suit/);
});

test("recognises a natural winning hand", () => {
  // 222a 4444a 666a 8888a in Dots
  const hand = tiles("D2 D2 D2 D4 D4 D4 D4 D6 D6 D6 D8 D8 D8 D8");
  const win = findWin(hand);
  assert.ok(win);
  assert.equal(win.hand.pattern, "222a 4444a 666a 8888a");
});

test("jokers fill groups but not pairs or singles", () => {
  // FF 2222a 44b 66b 8888c with jokers in the kongs
  assert.ok(findWin(tiles("F F B2 B2 J J C4 C4 C6 C6 D8 D8 D8 J")));
  // Joker standing in for one of the flower pair is not allowed
  assert.equal(findWin(tiles("F J B2 B2 J J C4 C4 C6 C6 D8 D8 D8 J")), null);
});

test("year hand uses Soap as zero", () => {
  // FF 2026a 2026b DDDDc as Bam 2026, Dot 2026 and four Red dragons (Crak)
  const hand = tiles("F F B2 WD B2 B6 D2 WD D2 D6 RD RD RD RD");
  assert.ok(findWin(hand));
});

test("exposures must match a group in the hand and rule out concealed hands", () => {
  const exposures = [{ type: "D8", size: 4 }];
  assert.ok(findWin(tiles("D2 D2 D2 D4 D4 D4 D4 D6 D6 D6"), exposures));
  // A pung of 8s doesn't fit 8888a
  assert.equal(findWin(tiles("D2 D2 D2 D4 D4 D4 D4 D6 D6 D6 D8"), [{ type: "D8", size: 3 }]), null);
  // Concealed hand NN EE WW SS XXa XXb XXc can't be won with an exposure
  assert.equal(findWin(tiles("N N E E W W S S B5 B5 C5 C5"), [{ type: "D5", size: 3 }]), null);
});

test("distance counts missing tiles", () => {
  const hand = tiles("D2 D2 D2 D4 D4 D4 D4 D6 D6 D6 D8 D8 N");
  assert.equal(bestDistance(countsOf(hand)), 2);
});

test("scoring: discarder pays double, self-draw everyone double, jokerless doubles", () => {
  const target = TARGETS.find((t) => t.hand.pattern === "222a 4444a 666a 8888a");
  assert.deepEqual(scoreWin({ target, winner: 0, discarder: 2, usedJoker: true }).payments, [100, -25, -50, -25]);
  assert.deepEqual(scoreWin({ target, winner: 1, discarder: null, usedJoker: true }).payments, [-50, 150, -50, -50]);
  assert.deepEqual(scoreWin({ target, winner: 0, discarder: 3, usedJoker: false }).payments, [200, -50, -50, -100]);
});

test("computer-only games run to completion with consistent tile counts", async () => {
  let wins = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const game = new Game({
      controllers: [0, 1, 2, 3].map(() => aiController(0)),
      rng: seededRng(seed),
      dealer: seed % 4,
      onUpdate: (g) => {
        const total = g.wall.length + g.discards.length
          + g.players.reduce((s, p) => s + p.hand.length + p.exposures.reduce((a, e) => a + e.tiles.length, 0), 0);
        assert.equal(total, 152);
      },
    });
    const result = await game.run();
    assert.ok(result);
    if (!result.wallGame) {
      wins++;
      const w = game.players[result.winner];
      assert.ok(findWin(w.hand, w.exposures));
      // The 14th tile wins without a discard.
      assert.equal(w.hand.length + w.exposures.reduce((a, e) => a + e.tiles.length, 0), 14);
      assert.equal(result.payments.reduce((a, b) => a + b, 0), 0);
    }
  }
  assert.ok(wins >= 10, `expected the computer to win a fair share of games, got ${wins}/40`);
});

test("the service worker caches every file of the site for offline play", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const sw = await readFile(new URL("sw.js", root), "utf8");
  const cached = new Set(JSON.parse(`[${/const FILES = \[([^\]]*)\]/.exec(sw)[1].replace(/,\s*$/, "")}]`));
  const site = ["index.html", "style.css", "manifest.webmanifest"];
  for (const dir of ["js", "icons"]) for (const f of await readdir(new URL(dir, root))) site.push(`${dir}/${f}`);
  for (const f of site) assert.ok(cached.has(f), `sw.js doesn't cache ${f}`);
  for (const f of cached) if (f !== "./") assert.ok(site.includes(f), `sw.js caches missing file ${f}`);
});

test("everyone is dealt 13 tiles and East draws first", async () => {
  const seen = [];
  const ai = aiController(0);
  const spy = (seat) => ({
    ...ai,
    async chooseCharlestonPass(g, s, dir) {
      if (!seen.length) seen.push(g.players.map((p) => p.hand.length));
      return ai.chooseCharlestonPass(g, s, dir);
    },
    async chooseTurnAction(g, s) {
      if (seen.length === 1) seen.push({ seat, size: g.players[s].hand.length, drawn: !!g.players[s].lastDrawn, wall: g.wallCount });
      return ai.chooseTurnAction(g, s);
    },
  });
  const game = new Game({ controllers: [0, 1, 2, 3].map(spy), rng: seededRng(5), dealer: 2 });
  await game.run();
  assert.deepEqual(seen[0], [13, 13, 13, 13]);
  assert.deepEqual(seen[1], { seat: 2, size: 14, drawn: true, wall: 152 - 52 - 1 });
});

test("lines: closest hands limited to picked lines, and which tiles are held", () => {
  const hand = tiles("D2 D2 D2 D4 D4 D4 D6 D6 J N N E W");
  const id = TARGETS.find((t) => t.hand.pattern === "222a 4444a 666a 8888a").hand.id;
  const [best] = closestHands(hand, [], 1, new Set([id]));
  assert.equal(best.target.hand.id, id);
  // has 2,2,2 4,4,4 6,6 + joker; needs one 4 (joker fills it), one 6 and four 8s
  assert.equal(best.distance, 5);
  const held = holdings(best.target, hand).map((g) => `${g.type}:${g.have}/${g.n}`);
  assert.deepEqual(held, ["D2:3/3", "D4:4/4", "D6:2/3", "D8:0/4"]);
});

test("suggested discard keeps the tiles the picked lines need", () => {
  const hand = tiles("D2 D2 D2 D4 D4 D4 D6 D6 J N N E W S").map((type, id) => ({ id, type }));
  const id = TARGETS.find((t) => t.hand.pattern === "222a 4444a 666a 8888a").hand.id;
  const tile = suggestDiscard({ hand, exposures: [] }, new Set([id]));
  assert.ok(["N", "E", "W", "S"].includes(tile.type), `discarded ${tile.type}`);
});
