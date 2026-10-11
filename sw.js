// Service worker: keeps a copy of every file so the game works offline.
// The deploy workflow replaces BUILD with the commit, so each deploy gets a
// fresh cache and the old one is removed.
const BUILD = "dev";
const CACHE = `mahjong-${BUILD}`;
const FILES = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "js/ai.js",
  "js/card.js",
  "js/game.js",
  "js/matcher.js",
  "js/tiles.js",
  "js/ui.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mahjong-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cached copy first (instant and offline), the network only for anything not cached.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
