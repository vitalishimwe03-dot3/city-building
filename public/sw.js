const CACHE_VERSION = 'citybuilding-v2';
const STATIC_CACHE = CACHE_VERSION + '-static';
const PAGE_CACHE = CACHE_VERSION + '-pages';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.json',
  '/css/style.css',
  '/css/admin-dashboard.css',
  '/css/pwa.css',
  '/js/theme.js',
  '/js/site.js',
  '/js/pwa.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/images/logo.png'
];

const PRIVATE_PREFIXES = ['/admin', '/api', '/billing', '/account', '/login', '/signup', '/logout', '/auth'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key.indexOf('citybuilding-') === 0 && key !== STATIC_CACHE && key !== PAGE_CACHE;
        }).map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isPrivate(url) {
  return PRIVATE_PREFIXES.some(function (prefix) {
    return url.pathname === prefix || url.pathname.indexOf(prefix + '/') === 0;
  });
}

function isStatic(pathname) {
  return /^\/(css|js|icons|images|fonts)\//.test(pathname);
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivate(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        const copy = response.clone();
        caches.open(PAGE_CACHE).then(function (cache) { cache.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match(OFFLINE_URL);
        });
      })
    );
    return;
  }

  if (isStatic(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        const network = fetch(request).then(function (response) {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
  }
});
