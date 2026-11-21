import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio() {
  let generar
  const llamadas = []
  const datos = {
    acreditacion_eventos: { nombre: 'Evento ficticio', lugar: 'Lugar', fecha: '2099-01-01', hora_inicio: '10:00', hora_fin: '11:00' },
    acreditacion_personas: { nombre: 'Persona ficticia', email: 'ejemplo@abc.gob.ar', cargo: 'Directora', escuela_id: 1, escuela_externa: null },
    acreditacion_escuelas_adicionales: [{ orden: 2, cargo: 'Docente', escuela_id: null, escuela_externa: 'Escuela externa' }],
    escuelas: { id: 1, clave: 'Escuela ficticia' },
  }
  const admin = {
    from: (tabla) => {
      const cadena = {
        select: () => cadena, eq: () => cadena,
        single: async () => ({ data: datos[tabla], error: null }),
        order: async () => ({ data: datos[tabla], error: null }),
      }
      return cadena
    },
    rpc: async (name, args) => { llamadas.push({ name, args }); return { data: [{ mime: 'image/png', base64: 'firma-fija' }], error: null } },
  }
  const source = readFileSync(new URL('../supabase/functions/_shared/acreditacion-documento.ts', import.meta.url), 'utf8')
    .replace("import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'", '')
    .replace("import { generarConstancia, type EventoConstancia, type PersonaConstancia, type FirmaConstancia } from './constancia.ts'", 'const generarConstancia = globalThis.generarConstancia')
    .replace('export async function prepararConstancia', 'globalThis.prepararConstancia = async function prepararConstancia')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const contexto = { generarConstancia: async (...args) => { generar = args; return new Uint8Array([37, 80, 68, 70]) }, Uint8Array, Promise }
  runInNewContext(js, contexto)
  return { preparar: () => contexto.prepararConstancia(admin, 'evento', 1), llamadas, get generado() { return generar } }
}

test('la constancia usa las firmas fijas del evento y todas las escuelas asociadas', async () => {
  const s = servicio()
  await s.preparar()
  assert.equal(s.llamadas[0].name, 'acreditacion_firmas_evento_datos')
  assert.equal(s.llamadas[0].args.p_evento, 'evento')
  assert.equal(s.generado[1].escuela, 'Escuela ficticia')
  assert.equal(s.generado[1].adicionales[0].escuela, 'Escuela externa')
  assert.equal(s.generado[1].adicionales[0].cargo, 'Docente')
  assert.equal(s.generado[2][0].base64, 'firma-fija')
})
