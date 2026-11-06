import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULES, canAccess, modulesFor } from '../src/modules.ts'

test('Estadística está disponible en navegación y ruta para escolar, areal y distrital', () => {
  const modulo = MODULES.find((m) => m.id === 'estadistica')
  assert.ok(modulo)
  assert.equal(modulo.path, '/estadistica')
  for (const rol of ['escolar', 'areal', 'distrital']) {
    assert.equal(canAccess(modulo, rol), true)
    assert.ok(modulesFor(rol).includes(modulo))
  }
  for (const rol of ['admin', 'regional']) assert.equal(canAccess(modulo, rol), false)
})
