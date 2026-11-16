import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fechaNacimientoISO, formatearFechaNacimiento } from '../src/lib/fechaPreinscripcion.ts'

test('formatea y convierte fechas con orden día/mes/año', () => {
  assert.equal(formatearFechaNacimiento('05022018'), '05/02/2018')
  assert.equal(formatearFechaNacimiento('05/02/2018'), '05/02/2018')
  assert.equal(formatearFechaNacimiento('0502'), '05/02')
  assert.equal(fechaNacimientoISO('05/02/2018', new Date(2026, 10, 16)), '2018-02-05')
})

test('rechaza fechas inexistentes, incompletas y futuras', () => {
  const hoy = new Date(2026, 10, 16)
  for (const fecha of ['31/04/2020', '29/02/2023', '00/12/2018', '01/13/2018', '01/01/0000', '1/01/2018', '17/11/2026']) {
    assert.equal(fechaNacimientoISO(fecha, hoy), null, fecha)
  }
  assert.equal(fechaNacimientoISO('29/02/2024', hoy), '2024-02-29')
  assert.equal(fechaNacimientoISO('16/11/2026', hoy), '2026-11-16')
  assert.equal(fechaNacimientoISO('29/02/1900', hoy), null)
  assert.equal(fechaNacimientoISO('29/02/2000', hoy), '2000-02-29')
})
