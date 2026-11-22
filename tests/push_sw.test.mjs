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
    registration: {
      scope: 'https://example.test/dataescuela/',
      showNotification: async (title, options) => { avisos.push({ title, options }) },
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => { abiertos.push(url) },
    },
  }
  runInNewContext(readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8'), { self, URL })
  const dispatch = async (name, extra = {}) => {
    let task
    handlers[name]({ ...extra, waitUntil: (promise) => { task = promise } })
    await task
  }
  return { dispatch, avisos, abiertos }
}

test('cada push muestra un aviso genérico sin información privada', async () => {
  const sw = worker()
  await sw.dispatch('push', { data: { text: () => 'contenido privado' } })
  await sw.dispatch('push')
  assert.equal(sw.avisos.length, 2)
  assert.equal(sw.avisos[0].title, 'DataEscuela')
  assert.doesNotMatch(sw.avisos[0].options.body, /privado/)
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
