/* Service worker — makes the app installable and openable offline (view-only).
   Bump CACHE when you change any shell file so devices pick it up. */
var CACHE = 'office-inventory-v1';
var SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  // Never cache the data API (Google Apps Script) — always go to network.
  if (url.indexOf('script.google.com') >= 0 || url.indexOf('googleusercontent.com') >= 0) {
    return; // default browser handling
  }
  if (e.request.method !== 'GET') return;

  // App shell & assets: cache-first, update in background.
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
