import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULES, canAccess, modulesFor } from '../src/modules.ts'
import { agruparMenuDistrital } from '../src/ui/sidebarDistrital.ts'
import { remitente, validarConfiguracion } from '../supabase/functions/_shared/configuracion-email.ts'

const config = { salidas_destino: 'salidas@example.org', sistema_remitente: 'sistema@example.org', respuesta: 'respuesta@example.org', nombre_remitente: 'Dirección Distrital' }

test('Configuración está disponible solo para distrital en Sistema', () => {
  const m = MODULES.find((m) => m.id === 'configuracion')
  assert.ok(m)
  assert.equal(canAccess(m, 'distrital'), true)
  for (const rol of ['areal', 'escolar', 'admin', 'regional']) assert.equal(canAccess(m, rol), false)
  assert.ok(agruparMenuDistrital(modulesFor('distrital')).find((g) => g.id === 'sistema').modulos.includes(m))
})

test('construye remitente y rechaza direcciones o cabeceras inválidas', () => {
  assert.equal(remitente(config), 'Dirección Distrital <sistema@example.org>')
  assert.doesNotThrow(() => validarConfiguracion(config))
  for (const key of ['salidas_destino', 'sistema_remitente', 'respuesta']) {
    assert.throws(() => validarConfiguracion({ ...config, [key]: 'no es correo' }))
    assert.throws(() => validarConfiguracion({ ...config, [key]: 'a@example.org\nBcc: otro@example.org' }))
    assert.throws(() => validarConfiguracion({ ...config, [key]: 'a\x01@example.org' }))
  }
  assert.throws(() => validarConfiguracion({ ...config, nombre_remitente: 'X\nBcc: otro@example.org' }))
  assert.throws(() => validarConfiguracion({ ...config, nombre_remitente: 'X <otro@example.org>' }))
})
