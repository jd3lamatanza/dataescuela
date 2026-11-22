self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('DataEscuela', {
    body: 'Tenés una nueva notificación. Abrí la aplicación para verla.',
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-192.png', self.registration.scope).href,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope))
    if (existing) return existing.focus()
    return self.clients.openWindow(new URL('#/', self.registration.scope).href)
  })())
})
