import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio({ ancho = 400, alto = 3000, tamano = 1000, falloRecurso = false, iframe = false, pngInvalido = false } = {}) {
  let opciones, redibujos = 0
  const crearCanvas = (w, h) => ({
    width: w, height: h,
    toBlob: (callback, tipo) => {
      assert.equal(tipo, 'image/png')
      callback(pngInvalido ? null : new Blob([new Uint8Array(Math.max(1, Math.ceil(tamano * (w * h) / (ancho * alto))))], { type: tipo }))
    },
    getContext: () => ({ drawImage: () => { redibujos++ } }),
  })
  const document = {
    documentElement: { scrollWidth: ancho, scrollHeight: alto, clientWidth: ancho, clientHeight: 800 },
    body: { scrollWidth: ancho, scrollHeight: alto },
    querySelectorAll: () => iframe ? [{ getBoundingClientRect: () => ({ width: 100, height: 100 }) }] : [],
    createElement: () => {
      let w = 0, h = 0
      return {
        get width() { return w }, set width(v) { w = v },
        get height() { return h }, set height(v) { h = v },
        getContext: () => ({ drawImage: () => { redibujos++ } }),
        toBlob: (callback, tipo) => crearCanvas(w, h).toBlob(callback, tipo),
      }
    },
  }
  const source = readFileSync(new URL('../src/lib/capturaPagina.ts', import.meta.url), 'utf8')
    .replace("await import('html2canvas-pro')", '({ default: globalThis.render })')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  runInNewContext(js, {
    exports, document, window: { innerWidth: ancho, innerHeight: 800 }, File, Blob, Uint8Array,
    render: async (_body, opts) => {
      opciones = opts
      if (falloRecurso) opts.onError(new Error('recurso'))
      return crearCanvas(Math.floor(ancho * opts.scale), Math.floor(alto * opts.scale))
    },
  })
  return { capturar: exports.capturarPagina, opciones: () => opciones, redibujos: () => redibujos }
}

test('captura toda la altura de la página en PNG sin selector de pantalla', async () => {
  const s = servicio()
  const r = await s.capturar()
  assert.equal(s.opciones().width, 400)
  assert.equal(s.opciones().height, 3000)
  assert.equal(s.opciones().windowHeight, 800)
  assert.equal(s.opciones().scale, 1)
  assert.equal(r.imagen.type, 'image/png')
  assert.equal(r.imagen.name, 'captura.png')
  assert.equal(r.reducida, false)
  assert.equal(r.recursosIncompletos, false)
})

test('reduce el PNG completo cuando supera 2 MB y advierte si faltan recursos', async () => {
  const s = servicio({ tamano: 5 * 1024 * 1024, falloRecurso: true })
  const r = await s.capturar()
  assert.ok(r.imagen.size <= 2 * 1024 * 1024)
  assert.ok(s.redibujos() > 0)
  assert.equal(r.reducida, true)
  assert.equal(r.recursosIncompletos, true)
  assert.equal((await servicio({ iframe: true }).capturar()).recursosIncompletos, true)
})

test('limita el área y los lados del lienzo sin recortar páginas extensas', async () => {
  const s = servicio({ ancho: 1200, alto: 30000 })
  const r = await s.capturar()
  assert.equal(s.opciones().height, 30000)
  assert.equal(s.opciones().width, 1200)
  assert.ok(s.opciones().scale * 30000 <= 16384)
  assert.ok(s.opciones().scale ** 2 * 1200 * 30000 <= 12_000_000)
  assert.equal(r.reducida, true)
})

test('informa si el navegador no puede generar el PNG', async () => {
  await assert.rejects(servicio({ pngInvalido: true }).capturar(), /No se pudo generar la imagen PNG/)
})
