// The screen: draws the table and turns clicks into answers for the game engine.

import { Game, aiController } from "./game.js";
import { CARD } from "./card.js";
import { closestHands, findWin } from "./matcher.js";
import { chooseTurnAction } from "./ai.js";
import { JOKER, WIND_NAMES, seededRng, tileName } from "./tiles.js";

// How long computer players think, in ms (?delay=0 in the address speeds them up).
const params = new URLSearchParams(location.search);
const AI_DELAY = Number(params.get("delay") ?? 700);
// ?seed=123 makes the deals repeatable (each next game uses the next seed).
let seed = params.has("seed") ? Number(params.get("seed")) : null;
const NAMES = ["You", "Rose", "Harriet", "Bea"];
const ARROWS = { right: "→", across: "↑", left: "←" };
const GROUP_NAMES = { 3: "Pung", 4: "Kong", 5: "Quint" };
const SCORES_KEY = "mahjong.scores";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let scores = loadScores();
let dealer = 0;
let game = null;
let pending = null; // what the game is waiting for us to decide: { kind, resolve, ... }
let selected = new Set(); // ids of selected tiles in my hand
let notice = "";

function loadScores() {
  try {
    const s = JSON.parse(localStorage.getItem(SCORES_KEY));
    if (Array.isArray(s) && s.length === 4) return s;
  } catch (_) { /* ignore */ }
  return [0, 0, 0, 0];
}
function saveScores() {
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(scores)); } catch (_) { /* ignore */ }
}

// ---------- The human player's controller ----------

function humanController(forGame) {
  // Questions from a game that was abandoned (New game) are never answered.
  const ask = (req) => new Promise((resolve) => {
    if (forGame !== game) return;
    selected.clear();
    notice = "";
    pending = { ...req, resolve };
    render();
  });
  return {
    chooseCharlestonPass: (g, seat, direction) => ask({ kind: "charleston", direction }),
    wantsSecondCharleston: () => ask({ kind: "second" }),
    chooseTurnAction: () => ask({ kind: "turn" }),
    chooseCall(g, seat, tile, discarder) {
      const opts = g.callOptions(seat, tile);
      if (!opts.mahjong && !opts.sizes.length) return Promise.resolve(null);
      return ask({ kind: "call", tile, discarder, opts });
    },
  };
}

function answer(value) {
  const p = pending;
  pending = null;
  selected.clear();
  notice = "";
  p.resolve(value);
  render();
}

// ---------- Game lifecycle ----------

function newGame() {
  pending = null;
  selected.clear();
  notice = "";
  const g = new Game({
    names: NAMES,
    dealer,
    rng: seed === null ? Math.random : seededRng(seed++),
    controllers: [null, aiController(AI_DELAY), aiController(AI_DELAY), aiController(AI_DELAY)],
    onUpdate: (current) => { if (current === game) render(); },
  });
  g.controllers[0] = humanController(g);
  game = g;
  render();
  g.run().then((result) => {
    if (g !== game) return;
    if (!result.wallGame) {
      result.payments.forEach((p, i) => { scores[i] += p; });
      saveScores();
    }
    render();
    showResult(result);
  }).catch((err) => {
    console.error(err);
    notice = `Something went wrong: ${err.message}`;
    render();
  });
}

// ---------- Tiles ----------

function tileFace(type) {
  if (type === JOKER) return ["J", "JOKER", "t-joker"];
  if (type === "F") return ["❀", "FLOWER", "t-flower"];
  if (WIND_NAMES[type]) return [type, WIND_NAMES[type].toUpperCase(), "t-wind"];
  if (type === "GD") return ["G", "GREEN", "t-bam"];
  if (type === "RD") return ["R", "RED", "t-crak"];
  if (type === "WD") return ["0", "SOAP", "t-soap"];
  const suit = { B: ["BAM", "t-bam"], C: ["CRAK", "t-crak"], D: ["DOT", "t-dot"] }[type[0]];
  return [type[1], suit[0], suit[1]];
}

function tileEl(tile, { small = false, classes = [], onClick = null } = {}) {
  const [main, sub, cls] = tileFace(tile.type);
  const e = el(onClick ? "button" : "div", ["tile", cls, small && "small", ...classes].filter(Boolean).join(" "));
  e.title = tileName(tile.type);
  e.append(el("span", "main", main), el("span", "sub", sub));
  if (onClick) {
    e.type = "button";
    e.addEventListener("click", onClick);
  }
  return e;
}

const backEl = () => el("div", "tile back small");

function exposuresEl(player) {
  const box = el("div", "exposures");
  for (const exp of player.exposures) {
    const group = el("div", "group");
    for (const t of exp.tiles) group.append(tileEl(t, { small: true }));
    box.append(group);
  }
  return box;
}

// ---------- Rendering ----------

function seatHead(p) {
  const head = el("div", "seat-head");
  head.append(el("b", null, p.name), el("span", "wind", p.wind));
  if (p.seat === game.dealer) head.append(el("span", "badge", "Dealer"));
  head.append(el("span", "score", `${scores[p.seat]} pts`));
  if (game.phase === "play" && game.turn === p.seat) head.classList.add("active");
  return head;
}

function renderOpponents() {
  for (const seat of [1, 2, 3]) {
    const p = game.players[seat];
    const box = document.querySelector(`.seat[data-seat="${seat}"]`);
    box.replaceChildren(seatHead(p));
    const hidden = el("div", "hidden-hand");
    if (game.phase === "over") for (const t of p.hand) hidden.append(tileEl(t, { small: true }));
    else for (let i = 0; i < p.hand.length; i++) hidden.append(backEl());
    box.append(hidden, exposuresEl(p));
  }
}

function renderCenter() {
  $("#wallCount").textContent = `Wall: ${game.wallCount} tiles`;
  const turn = game.players[game.turn];
  $("#turnInfo").textContent =
    game.phase === "charleston" ? "Charleston" :
    game.phase === "play" ? (turn.seat === 0 ? "Your turn" : `${turn.name}'s turn`) :
    game.phase === "over" ? "Game over" : "";

  const pool = $("#discards");
  pool.replaceChildren();
  game.discards.forEach((d, i) => {
    const last = i === game.discards.length - 1 && game.phase === "play";
    pool.append(tileEl(d.tile, { small: true, classes: last ? ["last"] : [] }));
  });

  const log = $("#log");
  log.replaceChildren(...game.log.slice(-6).reverse().map((m) => el("li", null, m)));
}

function renderMe() {
  const me = game.players[0];
  const head = document.querySelector(".me .me-head");
  head.replaceChildren(...seatHead(me).childNodes);
  head.classList.toggle("active", game.phase === "play" && game.turn === 0);

  $("#myExposures").replaceChildren(...exposuresEl(me).childNodes);

  const kind = pending?.kind;
  const hand = $("#hand");
  hand.replaceChildren();
  for (const t of me.hand) {
    const classes = [];
    if (selected.has(t.id)) classes.push("selected");
    if (t === me.lastDrawn || me.received.includes(t)) classes.push("fresh");
    const clickable = kind === "charleston" || kind === "turn";
    hand.append(tileEl(t, { classes, onClick: clickable ? () => clickTile(t) : null }));
  }

  renderPrompt(me);
  renderHints(me);
}

function button(label, onClick, { primary = false, disabled = false } = {}) {
  const b = el("button", primary ? "primary" : null, label);
  b.type = "button";
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function renderPrompt(me) {
  const prompt = $("#prompt");
  const actions = $("#actions");
  prompt.replaceChildren();
  actions.replaceChildren();

  if (!pending) {
    const waiting =
      game.phase === "charleston" ? "Waiting for the others to pass…" :
      game.phase === "play" ? `${game.players[game.turn].name} is thinking…` : "";
    prompt.append(el("span", "muted", notice || waiting));
    return;
  }

  if (pending.kind === "charleston") {
    const { direction, round } = { ...game.charleston, direction: pending.direction };
    prompt.textContent = `Charleston ${round} of ${round > 3 ? 6 : 3}: choose 3 tiles to pass ${direction} ${ARROWS[direction]}`;
    actions.append(button(`Pass ${selected.size}/3 tiles`, () => {
      answer(me.hand.filter((t) => selected.has(t.id)));
    }, { primary: true, disabled: selected.size !== 3 }));
  } else if (pending.kind === "second") {
    prompt.textContent = "First Charleston done. Do a second Charleston (left, across, right)?";
    actions.append(button("Yes, keep passing", () => answer(true), { primary: true }), button("No, stop", () => answer(false)));
  } else if (pending.kind === "turn") {
    prompt.textContent = "Your turn: pick a tile to discard (click it twice, or select and press Discard).";
    const sel = me.hand.find((t) => selected.has(t.id));
    actions.append(button("Discard", () => answer({ type: "discard", tile: sel }), { primary: true, disabled: !sel }));
    if (findWin(me.hand, me.exposures)) actions.append(button("Mahjong!", () => answer({ type: "mahjong" }), { primary: true }));
    const swap = sel && findJokerSwap(sel);
    if (swap) actions.append(button(`Swap for ${swap.owner.seat === 0 ? "your" : `${swap.owner.name}'s`} joker`, () => {
      answer({ type: "swap", tile: sel, seat: swap.owner.seat, exposure: swap.exposure });
    }));
  } else if (pending.kind === "call") {
    const { tile, discarder, opts } = pending;
    prompt.append(`${game.players[discarder].name} discarded `, tileEl(tile, { small: true }), " — call it?");
    if (opts.mahjong) actions.append(button("Mahjong!", () => answer({ type: "mahjong" }), { primary: true }));
    for (const size of opts.sizes) actions.append(button(`Call for ${GROUP_NAMES[size]} (${size})`, () => answer({ type: "expose", size })));
    actions.append(button("Pass", () => answer(null)));
  }
  if (notice) prompt.append(el("div", "notice", notice));
}

function findJokerSwap(tile) {
  for (const owner of game.players) {
    for (const exposure of owner.exposures) {
      if (exposure.type === tile.type && exposure.tiles.some((t) => t.type === JOKER)) return { owner, exposure };
    }
  }
  return null;
}

function clickTile(t) {
  notice = "";
  if (pending.kind === "charleston") {
    if (selected.has(t.id)) selected.delete(t.id);
    else if (t.type === JOKER) notice = "Jokers can't be passed.";
    else if (selected.size < 3) selected.add(t.id);
  } else if (pending.kind === "turn") {
    if (selected.has(t.id)) return answer({ type: "discard", tile: t });
    selected = new Set([t.id]);
  }
  render();
}

function renderHints(me) {
  const box = $("#hints");
  box.replaceChildren();
  if (!$("#hintsToggle").checked || game.phase === "over") return;
  box.append(el("div", "hints-title", "Closest hands on the card"));
  for (const { target, distance } of closestHands(me.hand, me.exposures, 3)) {
    const row = el("div", "hint");
    row.append(patternEl(target.hand.pattern), el("span", "muted", ` ${target.hand.value} pts · ${distance === 0 ? "complete!" : `${distance} tile${distance > 1 ? "s" : ""} away`}`));
    const tiles = el("div", "hint-tiles");
    for (const g of target.groups) {
      const grp = el("span", "hint-group");
      for (let i = 0; i < g.n; i++) grp.append(tileEl({ type: g.type }, { small: true }));
      tiles.append(grp);
    }
    row.append(tiles);
    box.append(row);
  }
  if (pending?.kind === "turn") {
    const action = chooseTurnAction(me, game.players);
    if (action.type === "discard") box.append(el("div", "muted", `A computer player would discard: ${tileName(action.tile.type)}`));
  }
}

function render() {
  if (!game) return;
  renderOpponents();
  renderCenter();
  renderMe();
}

// ---------- The card ----------

function patternEl(pattern) {
  const line = el("span", "pattern");
  for (const token of pattern.split(" ")) {
    const m = /^(.*?)([abc])?$/.exec(token);
    line.append(el("span", m[2] ? `s-${m[2]}` : "s-honor", m[1]), " ");
  }
  return line;
}

function renderCard() {
  const list = $("#cardList");
  list.replaceChildren();
  for (const section of CARD) {
    list.append(el("h3", null, section.section));
    for (const h of section.hands) {
      const row = el("div", "card-row");
      row.append(patternEl(h.p), el("span", "card-note", h.note || ""), el("span", "card-value", `${h.c ? "C" : "X"} ${h.v}`));
      list.append(row);
    }
  }
}

// ---------- Result ----------

function showResult(result) {
  const body = $("#resultBody");
  body.replaceChildren();
  if (result.wallGame) {
    body.append(el("h2", null, "Wall game"), el("p", null, "The wall ran out and nobody made a hand."));
  } else {
    const winner = game.players[result.winner];
    body.append(el("h2", null, winner.seat === 0 ? "Mahjong! You win!" : `Mahjong! ${winner.name} wins`));
    const how = result.selfDrawn ? "Self-drawn — everyone pays double." : `On ${game.players[result.discarder].name}'s discard — the discarder pays double.`;
    const p = el("p");
    p.append(patternEl(result.target.hand.pattern), ` worth ${result.value}. ${how}`);
    if (result.jokerless) p.append(" No jokers — doubled!");
    body.append(p);
  }
  const table = el("div", "reveal");
  for (const pl of game.players) {
    const row = el("div", "reveal-row");
    const pay = result.wallGame ? 0 : result.payments[pl.seat];
    row.append(el("b", null, `${pl.name} (${pay > 0 ? "+" : ""}${pay}, total ${scores[pl.seat]})`));
    const tiles = el("div", "reveal-tiles");
    for (const exp of pl.exposures) {
      const g = el("span", "group");
      for (const t of exp.tiles) g.append(tileEl(t, { small: true }));
      tiles.append(g);
    }
    for (const t of pl.hand) tiles.append(tileEl(t, { small: true }));
    row.append(tiles);
    table.append(row);
  }
  body.append(table);
  $("#resultDialog").showModal();
}

// ---------- Wiring ----------

$("#newGameBtn").addEventListener("click", () => {
  if (game && game.phase !== "over" && !confirm("Abandon this game and deal a new one?")) return;
  newGame();
});
$("#nextGameBtn").addEventListener("click", () => {
  dealer = (dealer + 1) % 4; // the deal passes to the right
  setTimeout(newGame, 0);
});
$("#cardBtn").addEventListener("click", () => { $("#cardPanel").hidden = !$("#cardPanel").hidden; });
$("#cardClose").addEventListener("click", () => { $("#cardPanel").hidden = true; });
$("#rulesBtn").addEventListener("click", () => $("#rulesDialog").showModal());
$("#hintsToggle").addEventListener("change", render);

renderCard();
newGame();

// Work offline: cache the whole game after the first visit.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline mode unavailable:", err));
}
