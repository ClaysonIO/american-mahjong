// The screen: draws the table and turns clicks into answers for the game engine.

import { Game, aiController } from "./game.js";
import { CARD, HANDS } from "./card.js";
import { closestHands, findWin, holdings } from "./matcher.js";
import { suggestDiscard } from "./ai.js";
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
const MODE_KEY = "mahjong.mode";
const MAX_LINES = 2;

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
let mode = loadMode(); // "easy" (Easy / Learning: suggestions and tiles-to-win) or "regular"
let lines = []; // ids of the card hands (lines) you picked, at most MAX_LINES
let pickerNotice = "";
let handOrder = null; // your tiles' ids in the order you dragged them into; null = sorted
let drag = null; // the hand tile being dragged
let suppressClick = false; // the click that ends a drag isn't a tile pick

const isEasy = () => mode === "easy";
const linesSet = () => (lines.length ? new Set(lines) : null);
const tilesToWin = (d) => (d === 0 ? "complete!" : `${d} tile${d === 1 ? "" : "s"} to win`);

function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === "regular" ? "regular" : "easy"; } catch (_) { return "easy"; }
}
function saveMode() {
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* ignore */ }
}

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
  lines = [];
  handOrder = null;
  const g = new Game({
    names: NAMES,
    dealer,
    rng: seed === null ? Math.random : seededRng(seed++),
    controllers: [null, aiController(AI_DELAY), aiController(AI_DELAY), aiController(AI_DELAY)],
    onUpdate: (current) => { if (current === game) render(); },
  });
  g.controllers[0] = humanController(g);
  game = g;
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
  openPicker();
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

  if (drag) drag.stale = true; // don't rebuild the hand under a tile being dragged
  else {
    const hand = $("#hand");
    hand.replaceChildren();
    for (const t of myTiles(me)) {
      const classes = [];
      if (selected.has(t.id)) classes.push("selected");
      if (t === me.lastDrawn || me.received.includes(t)) classes.push("fresh");
      const e = tileEl(t, { classes, onClick: () => clickTile(t) });
      e.dataset.id = t.id;
      e.addEventListener("pointerdown", (ev) => startDrag(ev, e));
      hand.append(e);
    }
  }
  $("#handTools").replaceChildren(...(handOrder ? [button("Sort tiles", () => { handOrder = null; render(); })] : []));

  renderPrompt(me);
  renderLines(me);
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
    const won = findWin(me.hand, me.exposures);
    prompt.textContent = won
      ? "Mahjong! Your 14 tiles make a hand on the card. Declare it; no discard needed."
      : "Your turn: pick a tile to discard (click it twice, or select and press Discard).";
    const sel = me.hand.find((t) => selected.has(t.id));
    if (won) actions.append(button("Mahjong!", () => answer({ type: "mahjong" }), { primary: true }));
    actions.append(button("Discard", () => answer({ type: "discard", tile: sel }), { primary: !won, disabled: !sel }));
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

/** Your concealed tiles in the order you arranged them; new tiles go on the right. */
function myTiles(me) {
  if (!handOrder) return me.hand;
  const byId = new Map(me.hand.map((t) => [t.id, t]));
  const arranged = handOrder.map((id) => byId.get(id)).filter(Boolean);
  return [...arranged, ...me.hand.filter((t) => !handOrder.includes(t.id))];
}

// ---------- Dragging tiles to rearrange the hand (mouse and touch) ----------

function startDrag(ev, tile) {
  if (ev.button !== 0 || drag) return;
  const r = tile.getBoundingClientRect();
  drag = { el: tile, x: ev.clientX, y: ev.clientY, grabX: ev.clientX - r.left, grabY: ev.clientY - r.top, moved: false, stale: false };
  tile.setPointerCapture(ev.pointerId);
  tile.addEventListener("pointermove", moveDrag);
  tile.addEventListener("pointerup", endDrag);
  tile.addEventListener("pointercancel", endDrag);
}

function moveDrag(ev) {
  if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return; // still a click
  drag.moved = true;
  drag.el.classList.add("dragging");
  // Slot the tile in before the first tile the pointer is left of (or above).
  const hand = $("#hand");
  const before = [...hand.children].find((c) => {
    if (c === drag.el) return false;
    const r = c.getBoundingClientRect();
    return ev.clientY < r.top || (ev.clientY < r.bottom && ev.clientX < r.left + r.width / 2);
  });
  if (before) { if (drag.el.nextElementSibling !== before) hand.insertBefore(drag.el, before); }
  else if (hand.lastElementChild !== drag.el) hand.append(drag.el);
  // Keep it under the pointer wherever its slot is now.
  drag.el.style.transform = "";
  const r = drag.el.getBoundingClientRect();
  drag.el.style.transform = `translate(${ev.clientX - drag.grabX - r.left}px, ${ev.clientY - drag.grabY - r.top}px)`;
}

function endDrag() {
  const d = drag;
  drag = null;
  d.el.removeEventListener("pointermove", moveDrag);
  d.el.removeEventListener("pointerup", endDrag);
  d.el.removeEventListener("pointercancel", endDrag);
  d.el.classList.remove("dragging");
  d.el.style.transform = "";
  if (d.moved) {
    handOrder = [...$("#hand").children].map((c) => Number(c.dataset.id));
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    render();
  } else if (d.stale) setTimeout(render, 0); // after the click is handled
}

function clickTile(t) {
  if (suppressClick || (pending?.kind !== "charleston" && pending?.kind !== "turn")) return;
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

// Your picked lines under your hand. Easy / Learning mode also shows the tiles each
// line still needs and suggests a discard; Regular mode only lists the lines.
function renderLines(me) {
  const box = $("#lines");
  box.replaceChildren();
  if (game.phase === "over") return;
  const head = el("div", "lines-head");
  head.append(el("span", "lines-title", "Your lines"), button(lines.length ? "Change lines" : "Pick lines", openPicker));
  box.append(head);

  if (!lines.length) {
    box.append(el("div", "muted", isEasy()
      ? "No lines picked yet. These are closest to your tiles:"
      : "No lines picked yet. Open the card to choose up to 2."));
    if (isEasy()) for (const r of closestHands(me.hand, me.exposures, 2)) box.append(lineEl(me, r.target.hand, r));
  } else {
    for (const id of lines) {
      const hand = HANDS.find((h) => h.id === id);
      box.append(lineEl(me, hand, isEasy() ? closestHands(me.hand, me.exposures, 1, new Set([id]))[0] : null));
    }
  }

  if (isEasy() && pending?.kind === "turn" && !findWin(me.hand, me.exposures)) {
    const tile = suggestDiscard(me, linesSet()) || suggestDiscard(me);
    if (tile) box.append(el("div", "muted", `Suggested discard${lines.length ? " for your lines" : ""}: ${tileName(tile.type)}`));
  }
}

function lineEl(me, hand, best) {
  const row = el("div", "line");
  row.append(patternEl(hand.pattern), el("span", "muted", ` ${hand.value} pts${hand.note ? ` · ${hand.note}` : ""}`));
  if (!isEasy()) return row;
  if (!best) {
    row.append(el("div", "line-status", "Not possible any more: concealed hands can't have exposures."));
    return row;
  }
  row.append(el("div", "line-status", tilesToWin(best.distance)));
  const tiles = el("div", "line-tiles");
  for (const g of holdings(best.target, me.hand, me.exposures)) {
    const grp = el("span", "line-group");
    for (let i = 0; i < g.n; i++) grp.append(tileEl({ type: g.type }, { small: true, classes: i < g.have ? [] : ["missing"] }));
    tiles.append(grp);
  }
  row.append(tiles);
  return row;
}

function render() {
  if (!game) return;
  renderOpponents();
  renderCenter();
  renderMe();
  if (!$("#picker").hidden) renderPicker();
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

// ---------- Card selection ----------

function openPicker() {
  pickerNotice = "";
  $("#picker").hidden = false;
  renderPicker();
}

function closePicker() {
  $("#picker").hidden = true;
  render();
}

function toggleLine(id) {
  pickerNotice = "";
  if (lines.includes(id)) lines = lines.filter((x) => x !== id);
  else if (lines.length >= MAX_LINES) pickerNotice = `You can follow ${MAX_LINES} lines at a time. Unselect one first.`;
  else lines = [...lines, id];
  renderPicker();
}

function renderPicker() {
  if (!game) return;
  const me = game.players[0];
  $("#pickerCount").textContent = `${lines.length}/${MAX_LINES} picked`;
  $("#pickerNotice").textContent = pickerNotice;

  const hand = $("#pickerHand");
  hand.replaceChildren();
  for (const exp of me.exposures) {
    const g = el("span", "group");
    for (const t of exp.tiles) g.append(tileEl(t, { small: true }));
    hand.append(g);
  }
  for (const t of myTiles(me)) hand.append(tileEl(t, { small: true }));

  // Easy / Learning: how far each line is, and the closest few marked as suggestions.
  const ranked = isEasy() ? closestHands(me.hand, me.exposures, HANDS.length) : [];
  const distance = new Map(ranked.map((r) => [r.target.hand.id, r.distance]));
  const suggested = new Set(ranked.slice(0, 3).map((r) => r.target.hand.id));

  const list = $("#pickerList");
  list.replaceChildren();
  if (isEasy() && ranked.length) {
    list.append(el("h3", null, "Suggested for your tiles"));
    for (const r of ranked.slice(0, 3)) list.append(pickerRow(r.target.hand, distance, suggested));
  }
  for (const section of CARD) {
    list.append(el("h3", null, section.section));
    for (const hand of HANDS.filter((h) => h.section === section.section)) list.append(pickerRow(hand, distance, suggested));
  }
}

function pickerRow(hand, distance, suggested) {
  const picked = lines.indexOf(hand.id);
  const row = el("button", `card-row${picked >= 0 ? " picked" : ""}`);
  row.type = "button";
  row.setAttribute("aria-pressed", String(picked >= 0));
  row.addEventListener("click", () => toggleLine(hand.id));
  const main = el("span", "card-main");
  main.append(patternEl(hand.pattern));
  if (picked >= 0) main.append(el("span", "badge", `Line ${picked + 1}`));
  if (suggested.has(hand.id)) main.append(el("span", "badge suggest", "Suggested"));
  const info = [hand.note];
  if (isEasy()) info.push(distance.has(hand.id) ? tilesToWin(distance.get(hand.id)) : "not possible with your exposures");
  row.append(main, el("span", "card-note", info.filter(Boolean).join(" · ")), el("span", "card-value", `${hand.concealed ? "C" : "X"} ${hand.value}`));
  return row;
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
$("#cardBtn").addEventListener("click", openPicker);
$("#pickerDone").addEventListener("click", closePicker);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#picker").hidden) closePicker(); });
$("#rulesBtn").addEventListener("click", () => $("#rulesDialog").showModal());
$("#modeSelect").value = mode;
$("#modeSelect").addEventListener("change", (e) => {
  mode = e.target.value;
  saveMode();
  render();
});

newGame();

// Work offline: cache the whole game after the first visit.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline mode unavailable:", err));
}
