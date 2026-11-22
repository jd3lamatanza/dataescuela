import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAccess, canAccessUser, modulesFor, modulesForUser, ROLES } from '../src/modules.ts'
import { agruparMenuDistrital, ordenarMenu } from '../src/ui/sidebarDistrital.ts'
import { ESTILOS_CATEGORIAS, ESTILOS_MODULOS, ESTILO_TEMA } from '../src/ui/sidebarMenu.ts'

test('el menú distrital agrupa todos los módulos una sola vez', () => {
  const modulos = modulesFor('distrital')
  const grupos = agruparMenuDistrital(modulos)
  assert.deepEqual(grupos.map((g) => g.label), ['Escuelas', 'Estadística', 'Inspectores', 'Sistema', 'Utilidades'])
  const agrupados = grupos.flatMap((g) => g.modulos.map((m) => m.id))
  assert.deepEqual([...agrupados].sort(), modulos.filter((m) => m.id !== 'inicio' && m.id !== 'mensajes').map((m) => m.id).sort())
  assert.equal(new Set(agrupados).size, agrupados.length)
  assert.ok(grupos.find((g) => g.id === 'inspectores').modulos.some((m) => m.id === 'labores-distrito'))
  assert.ok(grupos.find((g) => g.id === 'sistema').modulos.some((m) => m.id === 'usuarios-distrito'))
  assert.ok(grupos.find((g) => g.id === 'utilidades').modulos.some((m) => m.id === 'acreditacion'))
})

test('todos los menús se ordenan alfabéticamente sin cambiar los módulos originales', () => {
  for (const role of ROLES) {
    const modulos = modulesForUser({ role, permiso_avanzado: true })
    const ordenados = ordenarMenu([...modulos, { label: 'Modo oscuro' }])
    assert.deepEqual(ordenados.map((x) => x.label), ordenados.map((x) => x.label).toSorted((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })))
    assert.deepEqual(modulos, modulesForUser({ role, permiso_avanzado: true }))
  }
  for (const grupo of agruparMenuDistrital(modulesForUser({ role: 'distrital', permiso_avanzado: true }))) {
    const labels = grupo.modulos.map((m) => m.label)
    assert.deepEqual(labels, labels.toSorted((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })))
  }
})

test('cada opción visible tiene ícono y colores propios en ambos temas', () => {
  for (const role of ROLES) {
    const modulos = modulesForUser({ role, permiso_avanzado: true })
    const estilos = modulos.map((m) => {
      assert.ok(ESTILOS_MODULOS[m.id], `Falta estilo para ${m.id}`)
      return ESTILOS_MODULOS[m.id]
    })
    estilos.push(ESTILO_TEMA)
    if (role === 'distrital') estilos.push(...agruparMenuDistrital(modulos).map((g) => ESTILOS_CATEGORIAS[g.id]))
    for (const atributo of ['icon', 'claro', 'oscuro']) {
      const valores = estilos.map((e) => e[atributo])
      assert.equal(new Set(valores).size, valores.length, `${role}: ${atributo} repetido`)
    }
  }
})

test('los íconos mantienen contraste sobre el menú y la opción activa', () => {
  const luminancia = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((parte) => {
      const v = parseInt(parte, 16) / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const estilos = [...Object.values(ESTILOS_MODULOS), ...Object.values(ESTILOS_CATEGORIAS), ESTILO_TEMA]
  for (const estilo of estilos) for (const [tema, fondo] of [['claro', '#f8fafc'], ['claro', '#f0f9ff'], ['oscuro', '#172235'], ['oscuro', '#173653']]) {
    const a = luminancia(estilo[tema]), b = luminancia(fondo)
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3, `${estilo.icon}: contraste insuficiente en ${tema}`)
  }
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
