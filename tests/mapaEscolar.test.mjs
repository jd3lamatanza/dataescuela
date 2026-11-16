import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colorNivel, coordenadasValidas, filtrarMapa, LOCALIDADES_MAPA, rectangulosSolapados } from '../src/lib/mapaEscolar.ts'
import { MODULES, ROLES, canAccess, modulesFor } from '../src/modules.ts'
import { agruparMenuDistrital } from '../src/ui/sidebarDistrital.ts'

const escuela = { id: 1, clave: '0069EP0001', nombre: 'Escuela Sol', tipo: 'EP', numero: 1, nivel: 'Primario', modalidad: 'Común', localidad: 'González Catán', calle: 'San Martín', nu_calle: 10, te: null, latitud: -34.78, longitud: -58.64 }

test('el mapa filtra localidades, nivel, modalidad y búsqueda', () => {
  const datos = [escuela, { ...escuela, id: 2, localidad: 'Virrey del Pino', nivel: 'Inicial' }, { ...escuela, id: 3, localidad: 'Otra' }]
  assert.deepEqual(filtrarMapa(datos, LOCALIDADES_MAPA, '', '', '').map((e) => e.id), [1, 2])
  assert.deepEqual(filtrarMapa(datos, ['González Catán'], 'Primario', 'Común', 'san martín').map((e) => e.id), [1])
  assert.equal(filtrarMapa(datos, [], '', '', '').length, 0)
  assert.equal(filtrarMapa(datos, LOCALIDADES_MAPA, 'Secundario', '', '').length, 0)
})

test('reconoce coordenadas válidas sin confundir ceros con ausencia', () => {
  assert.equal(coordenadasValidas(escuela), true)
  assert.equal(coordenadasValidas({ ...escuela, latitud: 0, longitud: 0 }), true)
  assert.equal(coordenadasValidas({ ...escuela, latitud: null }), false)
  assert.equal(coordenadasValidas({ ...escuela, latitud: 91 }), false)
  assert.equal(coordenadasValidas({ ...escuela, longitud: NaN }), false)
  assert.notEqual(colorNivel('Primario'), colorNivel('Inicial'))
})

test('el módulo está disponible en todos los roles y aparece en Utilidades distritales', () => {
  const m = MODULES.find((m) => m.id === 'mapa-escolar')
  assert.ok(m)
  for (const role of ROLES) {
    assert.equal(canAccess(m, role), true, role)
    assert.ok(modulesFor(role).includes(m), role)
  }
  assert.ok(agruparMenuDistrital([m]).find((c) => c.id === 'utilidades')?.modulos.includes(m))
})

test('detecta etiquetas superpuestas pero permite bordes contiguos', () => {
  const a = { left: 0, right: 20, top: 0, bottom: 10 }
  assert.equal(rectangulosSolapados(a, { left: 19, right: 30, top: 2, bottom: 12 }), true)
  assert.equal(rectangulosSolapados(a, { left: 20, right: 30, top: 2, bottom: 12 }), false)
  assert.equal(rectangulosSolapados(a, { left: 0, right: 20, top: 10, bottom: 20 }), false)
})
