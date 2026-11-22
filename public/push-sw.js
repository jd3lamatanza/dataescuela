self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let title = 'DataEscuela'
  let body = 'Tenés una nueva notificación o mensaje. Abrí la aplicación para verlo.'
  if (event.data) {
    try {
      const data = event.data.json()
      if (!data || typeof data.titulo !== 'string' || !data.titulo.trim()) throw new Error('Título push inválido')
      title = data.titulo.trim().slice(0, 180)
      body = 'Abrí DataEscuela para ver los detalles.'
    } catch (error) {
      console.error('No se pudo interpretar el aviso push:', error)
    }
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
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
