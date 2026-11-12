import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const inicio = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(inicio, 'El tema debe inicializarse antes de mostrar la aplicación')

function iniciar(valor, falla = false) {
  const clases = new Set()
  const avisos = []
  runInNewContext(inicio, {
    localStorage: { getItem: (clave) => {
      assert.equal(clave, 'dw-theme')
      if (falla) throw new Error('almacenamiento no disponible')
      return valor
    } },
    document: { documentElement: { classList: { add: (clase) => clases.add(clase) } } },
    console: { warn: (aviso) => avisos.push(aviso) },
  })
  return { oscuro: clases.has('dark'), avisos }
}

test('el modo inicial es claro salvo que se haya guardado oscuro', () => {
  for (const valor of [null, 'light', 'desconocido']) assert.equal(iniciar(valor).oscuro, false)
  assert.equal(iniciar('dark').oscuro, true)
})

test('si no se puede leer el almacenamiento se conserva el modo claro y se avisa', () => {
  const resultado = iniciar(null, true)
  assert.equal(resultado.oscuro, false)
  assert.equal(resultado.avisos.length, 1)
})
