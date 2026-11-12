import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitarPosicionAviso } from '../src/ui/posicionAviso.ts'

test('mantiene el aviso dentro de la pantalla en las cuatro direcciones', () => {
  assert.deepEqual(limitarPosicionAviso({ x: -100, y: -50 }, 200, 80, 800, 600), { x: 8, y: 8 })
  assert.deepEqual(limitarPosicionAviso({ x: 900, y: 700 }, 200, 80, 800, 600), { x: 592, y: 512 })
  assert.deepEqual(limitarPosicionAviso({ x: 50, y: 60 }, 200, 80, 800, 600), { x: 50, y: 60 })
})

test('ajusta la posición tras reducir la pantalla o ampliar el aviso', () => {
  assert.deepEqual(limitarPosicionAviso({ x: 500, y: 400 }, 300, 150, 360, 500), { x: 52, y: 342 })
  assert.deepEqual(limitarPosicionAviso({ x: 20, y: 20 }, 500, 600, 360, 500), { x: 8, y: 8 })
})
