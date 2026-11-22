import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAccess, canAccessUser, modulesFor, modulesForUser, ROLES } from '../src/modules.ts'
import { agruparMenuDistrital } from '../src/ui/sidebarDistrital.ts'

test('el menú distrital agrupa todos los módulos una sola vez', () => {
  const modulos = modulesFor('distrital')
  const grupos = agruparMenuDistrital(modulos)
  assert.deepEqual(grupos.map((g) => g.label), ['Escuelas', 'Inspectores', 'Estadística', 'Utilidades', 'Sistema'])
  const agrupados = grupos.flatMap((g) => g.modulos.map((m) => m.id))
  assert.deepEqual([...agrupados].sort(), modulos.filter((m) => m.id !== 'inicio' && m.id !== 'mensajes').map((m) => m.id).sort())
  assert.equal(new Set(agrupados).size, agrupados.length)
  assert.ok(grupos.find((g) => g.id === 'inspectores').modulos.some((m) => m.id === 'labores-distrito'))
  assert.ok(grupos.find((g) => g.id === 'sistema').modulos.some((m) => m.id === 'usuarios-distrito'))
  assert.ok(grupos.find((g) => g.id === 'utilidades').modulos.some((m) => m.id === 'acreditacion'))
})

test('Sistema requiere permiso avanzado y Mensajes permanece accesible fuera de categorías', () => {
  const normal = { role: 'distrital', permiso_avanzado: false }
  const avanzado = { role: 'distrital', permiso_avanzado: true }
  for (const id of ['usuarios-distrito', 'simulado', 'configuracion']) {
    const m = modulesFor('distrital').find((m) => m.id === id)
    assert.equal(canAccessUser(m, normal), false)
    assert.equal(canAccessUser(m, avanzado), true)
  }
  assert.ok(!agruparMenuDistrital(modulesForUser(normal)).some((g) => g.id === 'sistema'))
  assert.ok(agruparMenuDistrital(modulesForUser(avanzado)).some((g) => g.id === 'sistema'))
  assert.ok(modulesForUser(normal).some((m) => m.id === 'mensajes'))
  assert.ok(!agruparMenuDistrital(modulesForUser(avanzado)).some((g) => g.modulos.some((m) => m.id === 'mensajes')))
  assert.ok(modulesForUser({ role: 'admin', permiso_avanzado: false }).some((m) => m.id === 'usuarios'))
})

test('Nudos está en Escuelas para Distrital y disponible también para Areal', () => {
  const m = modulesFor('distrital').find((m) => m.id === 'nudos')
  assert.ok(m)
  assert.ok(agruparMenuDistrital([m]).find((g) => g.id === 'escuelas')?.modulos.includes(m))
  for (const role of ROLES) assert.equal(canAccess(m, role), role === 'distrital' || role === 'areal')
  assert.ok(modulesFor('areal').includes(m))
})

test('Circuitos Electorales está disponible para Administrador, Distrital y Areal', () => {
  const m = modulesFor('admin').find((m) => m.id === 'circuitos-electorales')
  assert.ok(m)
  for (const role of ROLES) assert.equal(canAccess(m, role), ['admin', 'distrital', 'areal'].includes(role))
  assert.ok(agruparMenuDistrital([m]).find((g) => g.id === 'escuelas')?.modulos.includes(m))
})

test('Disposiciones está disponible para Distrital, Areal y Escolar', () => {
  const m = modulesFor('distrital').find((m) => m.id === 'disposiciones')
  assert.ok(m)
  for (const role of ROLES) assert.equal(canAccess(m, role), ['distrital', 'areal', 'escolar'].includes(role))
  assert.ok(agruparMenuDistrital([m]).find((g) => g.id === 'inspectores')?.modulos.includes(m))
})

test('Eventos Escolares aparece en Escuelas para todo usuario distrital', () => {
  for (const permiso_avanzado of [false, true]) {
    const modulos = modulesForUser({ role: 'distrital', permiso_avanzado })
    const modulo = modulos.find((m) => m.id === 'eventos-escolares')
    assert.ok(modulo)
    const grupos = agruparMenuDistrital(modulos)
    assert.ok(grupos.find((g) => g.id === 'escuelas').modulos.includes(modulo))
    assert.ok(!grupos.find((g) => g.id === 'sistema')?.modulos.includes(modulo))
  }
  for (const role of ['areal', 'escolar']) assert.ok(modulesFor(role).some((m) => m.id === 'eventos-escolares'))
})

test('Proyectos Escolares está en Escuelas para supervisión y Mis Proyectos sigue siendo escolar', () => {
  const normal = modulesForUser({ role: 'distrital', permiso_avanzado: false })
  const supervision = normal.find((m) => m.id === 'proyectos-escolares')
  assert.ok(supervision)
  assert.ok(agruparMenuDistrital(normal).find((g) => g.id === 'escuelas').modulos.includes(supervision))
  for (const role of ROLES) assert.equal(canAccess(supervision, role), ['areal', 'distrital'].includes(role))
  assert.ok(modulesFor('escolar').some((m) => m.id === 'mis-proyectos'))
  assert.ok(!modulesFor('escolar').some((m) => m.id === 'proyectos-escolares'))
})

test('un módulo distrital nuevo no desaparece del menú', () => {
  const extra = { id: 'nuevo', label: 'Nuevo', path: '/nuevo', icon: 'home', roles: ['distrital'] }
  const grupos = agruparMenuDistrital([...modulesFor('distrital'), extra])
  assert.ok(grupos.find((g) => g.id === 'sistema').modulos.includes(extra))
})
