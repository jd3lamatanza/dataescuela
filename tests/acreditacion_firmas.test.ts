import { comprobarFirmas, validarFirmas } from '../supabase/functions/_shared/firmas-seleccion.ts'
import { borrarFirma, comprobarCarpeta, descargarFirma, subirFirma, validarImagen } from '../supabase/functions/_shared/firmas-drive.ts'

Deno.test('valida la selección de firmas y detecta firmas eliminadas', () => {
  const falla = (fn: () => void) => { let error = false; try { fn() } catch { error = true }; if (!error) throw new Error('Se esperaba un error') }
  const ids = validarFirmas([1, 3])
  comprobarFirmas(ids, [{ id: 1 }, { id: 3 }])
  falla(() => comprobarFirmas(ids, [{ id: 1 }]))
  for (const invalido of [[], [1, 1], [0], [1.5], ['1'], [1, 2, 3, 4, 5, 6, 7], null]) {
    falla(() => validarFirmas(invalido))
  }
})

Deno.test('Drive guarda, lee y elimina la imagen en la carpeta indicada', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII='
  const bytes = validarImagen('image/png', png)
  const original = globalThis.fetch
  let pasos = 0
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    pasos++
    if (pasos === 1) {
      if (!url.includes('1eU2sauAJU1MSdNp27JTrbd__rCqK8ctV')) throw new Error('Carpeta incorrecta')
      return Response.json({ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } })
    }
    if (pasos === 2) {
      const body = await (init?.body as Blob).arrayBuffer()
      if (!new TextDecoder().decode(body).includes('"parents":["1eU2sauAJU1MSdNp27JTrbd__rCqK8ctV"]')) throw new Error('Destino incorrecto')
      return Response.json({ id: 'archivo-prueba' })
    }
    if (!url.includes('archivo-prueba')) throw new Error('Archivo incorrecto')
    if (pasos === 3) return new Response(Uint8Array.from(bytes))
    if (pasos === 4 && init?.method === 'DELETE') return new Response(null, { status: 204 })
    throw new Error('Petición inesperada')
  }
  try {
    await comprobarCarpeta('token-falso')
    const id = await subirFirma('token-falso', 'Firma de prueba', 'image/png', bytes)
    if (await descargarFirma('token-falso', id, 'image/png') !== png) throw new Error('Imagen alterada')
    await borrarFirma('token-falso', id)
    if (pasos !== 4) throw new Error('Faltaron operaciones')
    let fallo = false
    try { validarImagen('image/jpeg', png) } catch { fallo = true }
    if (!fallo) throw new Error('Se aceptó una imagen con tipo incorrecto')
  } finally { globalThis.fetch = original }
})