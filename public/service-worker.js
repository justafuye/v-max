const CACHE_NAME = 'vmax-app-v4'
const APP_SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('vmax-app-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) return response
          const copy = response.clone()
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(APP_SHELL, copy))
            .then(() => response)
        })
        .catch(async () => {
          const cachedPage = await caches.match(APP_SHELL)
          if (cachedPage) return cachedPage
          return Response.error()
        }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse
      return fetch(request).then((response) => {
        if (!response.ok || response.type !== 'basic') return response
        const copy = response.clone()
        return caches.open(CACHE_NAME)
          .then((cache) => cache.put(request, copy))
          .then(() => response)
      })
    }),
  )
})
