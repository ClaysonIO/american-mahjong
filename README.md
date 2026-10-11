# American Mahjong

A single-player American Mahjong game in the browser: you play against three
computer players (Rose, Harriet and Bea). Plain HTML, CSS and JavaScript
modules, with no build step and no dependencies.

```sh
npm start   # then open http://localhost:8080
npm test    # rules, scoring, offline file list and 40 computer-only games
```

It's a static site with nothing to build and no outside resources (no CDNs, fonts or
analytics). Any static file server works. Opening `index.html` straight from disk doesn't
work, because browsers don't load ES modules from `file://`.

## Play online, then offline

On every push to `main`, `.github/workflows/pages.yml` runs the tests and publishes
the game to GitHub Pages at **https://claysonio.github.io/american-mahjong/**.

One-time setup: in the repository's **Settings → Pages**, set **Source** to
**GitHub Actions**. To deploy without a push, run the workflow from the Actions tab.

After the first visit, a service worker (`sw.js`) keeps a copy of every file, so the
game loads and plays with no connection. Browsers also offer to install it as an app
(**Install** in Chrome/Edge, **Add to Home Screen** on iPhone). Each deploy stamps
`sw.js` with the commit, which replaces the cached copy. A new version reaches a player
one visit late: the first visit after a deploy downloads it in the background, and the
next visit uses it. When you add a file to the game, add it to the `FILES` list in `sw.js`; a test
fails if you forget.

URL options: `?delay=0` makes the computer players move instantly (default 700 ms),
and `?seed=42` makes the deals repeatable.

## What's in a game

- The full 152-tile set: Bam, Crak and Dot 1–9, winds, dragons (Green goes with Bam,
  Red with Crak, Soap with Dot; Soap is also the 0 in year hands), 8 flowers and 8 jokers.
- **Charleston:** right, across, left, then an optional second Charleston
  (left, across, right) that any player can stop. Jokers can't be passed.
- **Play:** everyone is dealt 13 tiles and East draws first. Each turn you draw and
  discard, unless the tile you draw completes a hand: then it's Mahjong with no discard.
- **Lines:** after the deal, the card opens with your tiles fixed at the top and the card
  scrolling underneath. Pick up to 2 lines (hands) to aim for; the **Card** button
  changes them at any time.
- **Arranging tiles:** drag tiles in your hand (mouse or touch) to put them in any order;
  new tiles arrive on the right, and **Sort tiles** puts the hand back in order.
- **Calling:** call a discard to expose a pung, kong or quint (jokers fill in), or to win.
  Mahjong beats an exposure; otherwise the player next in turn wins the call.
  Concealed hands only take a discard to win.
- **Joker swaps:** on your turn, trade the real tile for a joker in anyone's exposure.
- **Scoring:** the hand's value from each player. The discarder pays double,
  on a self-drawn win everyone pays double, and a hand with no jokers doubles again.
  Scores are kept across games in the browser.
- **Modes** (top of the screen, remembered):
  - **Easy / Learning** marks the lines closest to your tiles as *Suggested*, shows how
    many tiles each line needs to win and which ones you're missing, and suggests a discard
    that fits your lines.
  - **Regular** shows the card and the lines you picked, with no suggestions or counts.

Left out to keep it basic: blind passes, the courtesy pass, dead hands and
challenges, and the betting that some tables use.

Player feedback and what was done about it is kept in [`docs/feedback/`](docs/feedback/).

## The card

`js/card.js` holds the hands. The official National Mah Jongg League card is
copyrighted and changes every year, so this is an **original practice card** in
the same style (2026, 2468, Like Numbers, Quints, Runs, 13579, Winds-Dragons, 369,
Singles and Pairs). Hands are written in a compact notation, described at the
top of the file, e.g. `FF 2026a 2026b DDDDc` or `FF XXXa YYYYa ZZZa QQa`. To use
your own card, edit the list. The tests check that every hand has 14 tiles and can
be built from one set.

## Code

| File | What it does |
| --- | --- |
| `js/tiles.js` | Tile types, the wall, sorting, a seeded random number generator |
| `js/card.js` | The card, its notation parser, expanding each hand into every suit/number choice |
| `js/matcher.js` | Distance from any set of tiles to every hand, win detection, scoring |
| `js/ai.js` | Computer players: Charleston passes, discards, calls, joker swaps |
| `js/game.js` | The game engine (deal, Charleston, turns, calls). It asks each seat's controller for decisions, so it doesn't depend on the UI |
| `js/ui.js` | Rendering and the human player's controller |

The computer players work out how far their tiles are from every way of making
every hand on the card (455 combinations). They keep the tiles that the closest
hands need and discard the rest. They call a discard only when exposing it brings
them closer to a hand that allows exposures.

## License

MIT, see [LICENSE](LICENSE).
