import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modulesFor } from '../src/modules.ts'
import { agruparMenuDistrital } from '../src/ui/sidebarDistrital.ts'

test('el menú distrital agrupa todos los módulos una sola vez', () => {
  const modulos = modulesFor('distrital')
  const grupos = agruparMenuDistrital(modulos)
  assert.deepEqual(grupos.map((g) => g.label), ['Escuelas', 'Inspectores', 'Estadística', 'Sistema'])
  const agrupados = grupos.flatMap((g) => g.modulos.map((m) => m.id))
  assert.deepEqual([...agrupados].sort(), modulos.filter((m) => m.id !== 'inicio').map((m) => m.id).sort())
  assert.equal(new Set(agrupados).size, agrupados.length)
  assert.ok(grupos.find((g) => g.id === 'inspectores').modulos.some((m) => m.id === 'labores-distrito'))
  assert.ok(grupos.find((g) => g.id === 'sistema').modulos.some((m) => m.id === 'usuarios-distrito'))
})

test('un módulo distrital nuevo no desaparece del menú', () => {
  const extra = { id: 'nuevo', label: 'Nuevo', path: '/nuevo', icon: 'home', roles: ['distrital'] }
  const grupos = agruparMenuDistrital([...modulesFor('distrital'), extra])
  assert.ok(grupos.find((g) => g.id === 'sistema').modulos.includes(extra))
})
