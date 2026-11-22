import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

const compilar = (ruta) => ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const dataUrl = (codigo) => `data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`
const modeloUrl = dataUrl(compilar('../src/lib/calendarioInforme.ts'))
const modelo = await import(modeloUrl)
const pdfUrl = dataUrl(compilar('../src/lib/calendarioInformePdf.ts')
  .replace("'pdf-lib'", JSON.stringify(import.meta.resolve('pdf-lib')))
  .replace("'./calendarioInforme'", JSON.stringify(modeloUrl)))
const { buildCalendarioPdf } = await import(pdfUrl)

function textoPdf(bytes) {
  const proceso = spawnSync('pdftotext', ['-layout', '-', '-'], { input: bytes, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (proceso.error) throw proceso.error
  assert.equal(proceso.status, 0, proceso.stderr)
  return proceso.stdout
}

test('fechas incluyen todos los días del mes y usan la fecha argentina', () => {
  assert.equal(modelo.fechasDelMes(2024, 1).length, 29)
  assert.equal(modelo.fechasDelMes(2026, 1).length, 28)
  assert.equal(modelo.fechasDelMes(2026, 11).at(-1), '2026-12-31')
  assert.equal(modelo.fechaArgentina(new Date('2026-03-01T01:00:00Z')), '2026-02-28')
})

test('omite CUIL incluso en formatos habituales de texto libre', () => {
  const protegido = modelo.protegerCuil('CUIL20-12345678-9; 27 12.345.678 9; 20123456789; 201234567890')
  assert.equal(protegido, 'CUIL[CUIL omitido]; [CUIL omitido]; [CUIL omitido]; 201234567890')
})

test('el PDF mensual agrupa por día, distingue formatos y no trunca descripciones largas', async () => {
  const entrada = modelo.informeEvento({
    id: 1, fecha: '2026-02-03', tipo_id: 1, nombre: 'Reunión especial',
    hora: '09:30:00', lugar: 'Escuela', autor: 'Ana', rol: 'distrital', para_roles: ['areal'],
    descripcion: 'Descripción pública', cue: '12345678', created_at: '2026-02-01',
  }, 'Agenda')
  const marcador = 'FINAL_INFORME_LARGO'
  entrada.detalles.push({ etiqueta: 'Acuerdos', valor: `${'Texto de acuerdo largo. '.repeat(700)}${marcador}` })
  entrada.detalles.push({ etiqueta: 'Observaciones', valor: 'CUIL 20-12345678-9 y emoji 🏫' })
  const resumido = textoPdf(await buildCalendarioPdf(2026, 1, [entrada], 'resumido'))
  const analitico = textoPdf(await buildCalendarioPdf(2026, 1, [entrada], 'analitico'))
  assert.match(resumido, /Reunión especial/)
  assert.match(resumido, /Descripción pública/)
  assert.doesNotMatch(resumido, /FINAL_INFORME_LARGO/)
  assert.match(analitico, /FINAL_INFORME_LARGO/)
  assert.match(analitico, /CUIL omitido/)
  assert.doesNotMatch(analitico, /20-12345678-9/)
  assert.match(analitico, /U\+1F3EB/)
  assert.ok(analitico.indexOf('domingo, 1 de febrero') < analitico.indexOf('martes, 3 de febrero'))
  assert.match(analitico, /sábado, 28 de febrero/)
  assert.match(analitico, /Página 2 de/)
})

test('ordena cada día por tipo y presenta grupos coloreados en ambos informes PDF', async () => {
  const crear = (id, fecha, nombre, tipo, color) => modelo.informeEvento({
    id, fecha, nombre, tipo_id: id, rol: 'distrital', autor: 'Ana', para_roles: [], descripcion: '',
  }, tipo, { color, icono: 'calendar' })
  const entradas = [
    crear(1, '2026-02-03', 'Alfa salida', 'Salida', 'green'),
    crear(2, '2026-02-03', 'Zulu agenda', 'Agenda', 'blue'),
    crear(3, '2026-02-03', 'Beta agenda', 'Agenda', 'blue'),
    crear(4, '2026-02-04', 'Alfa agenda', 'Agenda', 'blue'),
  ]
  const ordenadas = modelo.ordenarInforme(entradas)
  assert.deepEqual(ordenadas.map((e) => e.id), ['evento-3', 'evento-2', 'evento-1', 'evento-4'])
  assert.deepEqual(modelo.agruparPorTipo(ordenadas.slice(0, 3)).map((g) => [g[0].tipo, g.length]), [['Agenda', 2], ['Salida', 1]])
  assert.equal(ordenadas[0].estilo.color, 'blue')
  for (const formato of ['resumido', 'analitico']) {
    const bytes = await buildCalendarioPdf(2026, 1, entradas, formato)
    const texto = textoPdf(bytes)
    assert.match(texto, /Agenda · 2 eventos/)
    assert.match(texto, /Salida · 1 evento/)
    assert.ok(texto.indexOf('Beta agenda') < texto.indexOf('Zulu agenda'))
    assert.ok(texto.indexOf('Zulu agenda') < texto.indexOf('Alfa salida'))
    assert.ok(texto.indexOf('Alfa salida') < texto.indexOf('Alfa agenda'))
    const pdf = await PDFDocument.load(bytes)
    const streams = pdf.getPages().flatMap((page) => {
      const contents = page.node.Contents()
      const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
      return refs.map((ref) => pdf.context.lookup(ref)).filter((stream) => stream instanceof PDFRawStream)
        .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('utf8'))
    }).join('\n')
    assert.match(streams, /0\.91 0\.94 1 rg/)
    assert.match(streams, /0\.9 0\.97 0\.91 rg/)
  }
})

function cargador(filas) {
  const seleccionados = []
  const consultas = []
  const supabase = { from(tabla) {
    let valores = [], columna = '', inicio = 0, fin = 0
    const query = {
      select(campos) { seleccionados.push({ tabla, campos }); return query },
      in(col, ids) { columna = col; valores = ids.map(String); return query },
      order() { return query },
      range(a, b) { inicio = a; fin = b; return query },
      overrideTypes() { return query },
      then(resolve) {
        consultas.push({ tabla, inicio, fin })
        const datos = (filas[tabla] ?? []).filter((fila) => valores.includes(String(fila[columna]))).slice(inicio, fin + 1)
        return Promise.resolve({ data: datos, error: null }).then(resolve)
      },
    }
    return query
  } }
  const codigo = compilar('../src/lib/calendarioInformeDatos.ts')
    .replace("import { supabase } from './supabase';", 'const supabase = globalThis.supabase;')
    .replace("import { leerPaginas } from './calendarioDistrital';", 'const leerPaginas = globalThis.leerPaginas;')
    .replace("import { campo } from './calendarioInforme';", 'const campo = globalThis.campo;')
    .replace('export async function completarInforme', 'async function completarInforme') + '\nglobalThis.completarInforme = completarInforme;'
  const contexto = { supabase, campo: modelo.campo, leerPaginas: async (pagina) => {
    const filas = []
    for (let i = 0; ; i += 500) {
      const resultado = await pagina(i, i + 499)
      if (resultado.error) throw new Error(resultado.error.message)
      filas.push(...resultado.data)
      if (resultado.data.length < 500) return filas
    }
  } }
  runInNewContext(codigo, contexto)
  return { completar: contexto.completarInforme, seleccionados, consultas }
}

test('el informe analítico consulta datos permitidos y pagina adjuntos sin incluir CUIL', async () => {
  const archivos = Array.from({ length: 501 }, (_, i) => ({ salida_id: 7, nombre: `archivo-${i}.pdf` }))
  const servicio = cargador({
    salidas: [{ id: 7, cue: '99999999', observaciones: 'CUID 20-12345678-9', enviar_mail: false, mail_enviado_at: null, created_at: '2026-01-01', updated_at: '2026-01-02' }],
    salida_archivos: archivos,
    salida_mensajes: [{ salida_id: 7, autor: 'María', rol: 'escolar', texto: 'Detalle del mensaje', created_at: '2026-01-03', estado: { nombre: 'Revisada' } }],
  })
  const entrada = modelo.informeRegistro({ id: 'salida-7', fuente: 'salida', fecha: '2026-01-03', nombre: 'Visita', descripcion: 'Escuela', enlace: '/salidas-distrito' }, 'Salida')
  const [resultado] = await servicio.completar([entrada])
  const texto = resultado.detalles.map((c) => c.valor).join('\n')
  assert.match(texto, /archivo-500\.pdf/)
  assert.match(texto, /Detalle del mensaje/)
  assert.match(texto, /CUIL omitido/)
  assert.doesNotMatch(texto, /20-12345678-9/)
  assert.ok(servicio.consultas.some((c) => c.tabla === 'salida_archivos' && c.inicio === 500))
  assert.ok(servicio.seleccionados.every((q) => !/\bcuil\b|\bdni\b/i.test(q.campos)))
})

test('un registro inaccesible produce un error y no un informe incompleto', async () => {
  const servicio = cargador({})
  const entrada = modelo.informeRegistro({ id: 'labor-7', fuente: 'labor', fecha: '2026-01-03', nombre: 'Visita', descripcion: '', enlace: '/labores-distrito' }, 'Labor')
  await assert.rejects(() => servicio.completar([entrada]), /No se pudo acceder a todos los registros de labores/)
})

test('distingue equipos directivos y de orientación con el mismo identificador', async () => {
  const servicio = cargador({
    equipo_directivo: [{ id: 8, email: 'directivo@example.test', cargo_base: 'Directivo', cargo: null, revista: null }],
    equipo_orientacion: [{ id: 8, email: 'orientacion@example.test', cargo: { nombre: 'Orientador' }, revista: null }],
  })
  const registros = ['Equipo directivo', 'Equipo de orientación'].map((tipo) => modelo.informeRegistro({
    id: `posesion-${tipo}-8`, fuente: 'posesion', fecha: '2026-01-03', nombre: tipo, descripcion: '', enlace: '/plantas',
  }, 'Toma de posesión'))
  const resultados = await servicio.completar(registros)
  assert.ok(resultados[0].detalles.some((c) => c.valor === 'directivo@example.test'))
  assert.ok(resultados[1].detalles.some((c) => c.valor === 'orientacion@example.test'))
  assert.ok(!resultados[1].detalles.some((c) => c.valor === 'directivo@example.test'))
})
