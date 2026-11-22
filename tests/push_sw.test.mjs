import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function worker(windows = []) {
  const handlers = {}
  const avisos = []
  const abiertos = []
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    skipWaiting: async () => { activaciones.push('instalado') },
    registration: {
      scope: 'https://example.test/dataescuela/',
      showNotification: async (title, options) => { avisos.push({ title, options }) },
    },
    clients: {
      claim: async () => { activaciones.push('activo') },
      matchAll: async () => windows,
      openWindow: async (url) => { abiertos.push(url) },
    },
  }
  const errores = []
  const activaciones = []
  runInNewContext(readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8'), { self, URL, console: { error: (...args) => errores.push(args) } })
  const dispatch = async (name, extra = {}) => {
    let task
    handlers[name]({ ...extra, waitUntil: (promise) => { task = promise } })
    await task
  }
  return { dispatch, avisos, abiertos, errores, activaciones }
}

test('el service worker actualizado toma control sin esperar el cierre de pestañas', async () => {
  const sw = worker()
  await sw.dispatch('install')
  await sw.dispatch('activate')
  assert.deepEqual(sw.activaciones, ['instalado', 'activo'])
})

test('muestra el tipo y origen del aviso cifrado, sin exponer otros datos', async () => {
  const sw = worker()
  await sw.dispatch('push', { data: { json: () => ({ titulo: 'Nueva labor de Inspector Ejemplo', cuerpo: 'Contenido privado' }) } })
  assert.equal(sw.avisos[0].title, 'Nueva labor de Inspector Ejemplo')
  assert.doesNotMatch(sw.avisos[0].options.body, /privado/)
})

test('los avisos antiguos y datos inválidos muestran una notificación genérica', async () => {
  const sw = worker()
  await sw.dispatch('push')
  await sw.dispatch('push', { data: { json: () => { throw new Error('Inválido') } } })
  assert.equal(sw.avisos.length, 2)
  assert.equal(sw.avisos[0].title, 'DataEscuela')
  assert.match(sw.avisos[0].options.body, /notificación o mensaje/)
  assert.equal(sw.avisos[1].title, 'DataEscuela')
  assert.equal(sw.errores.length, 1)
})

test('al pulsar reutiliza la ventana abierta o abre el inicio', async () => {
  let enfocado = false
  let cerrado = false
  const sw = worker([{ url: 'https://example.test/dataescuela/#/otro', focus: async () => { enfocado = true } }])
  await sw.dispatch('notificationclick', { notification: { close: () => { cerrado = true } } })
  assert.equal(cerrado, true)
  assert.equal(enfocado, true)
  assert.equal(sw.abiertos.length, 0)
  const sinVentana = worker()
  await sinVentana.dispatch('notificationclick', { notification: { close() {} } })
  assert.equal(sinVentana.abiertos[0], 'https://example.test/dataescuela/#/')
})
