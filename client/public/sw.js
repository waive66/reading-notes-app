const CACHE_NAME = 'reading-notes-v1'
const urlsToCache = ['/', '/index.html']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  )
})

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) {
    return fetch(event.request)
  }
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  )
})
