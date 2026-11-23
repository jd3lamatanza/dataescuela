const MAX_BYTES = 2 * 1024 * 1024
const MAX_PIXELES = 12_000_000
const MAX_LADO = 16384

const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen PNG.')), 'image/png')
})

export async function capturarPagina(): Promise<{ imagen: File; reducida: boolean; recursosIncompletos: boolean }> {
  const { default: html2canvas } = await import('html2canvas-pro')
  const raiz = document.documentElement
  const cuerpo = document.body
  const ancho = Math.max(raiz.scrollWidth, cuerpo.scrollWidth, raiz.clientWidth)
  const alto = Math.max(raiz.scrollHeight, cuerpo.scrollHeight, raiz.clientHeight)
  const escala = Math.min(1, MAX_LADO / ancho, MAX_LADO / alto, Math.sqrt(MAX_PIXELES / (ancho * alto)))
  let recursosIncompletos = Array.from(document.querySelectorAll('iframe')).some((marco) => {
    const rect = marco.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  let canvas = await html2canvas(cuerpo, {
    width: ancho, height: alto, windowWidth: window.innerWidth, windowHeight: window.innerHeight,
    scrollX: 0, scrollY: 0, scale: escala, backgroundColor: null, useCORS: true,
    normalizeDom: false, logging: false, onError: () => { recursosIncompletos = true },
  })
  if (!canvas.width || !canvas.height) throw new Error('La página es demasiado grande para capturarla en este dispositivo.')
  let blob = await png(canvas)
  let reducida = escala < 1
  for (let intento = 0; blob.size > MAX_BYTES && intento < 6; intento++) {
    const factor = Math.min(0.9, Math.sqrt(MAX_BYTES / blob.size) * 0.9)
    const siguiente = document.createElement('canvas')
    siguiente.width = Math.max(1, Math.floor(canvas.width * factor))
    siguiente.height = Math.max(1, Math.floor(canvas.height * factor))
    const contexto = siguiente.getContext('2d')
    if (!contexto) throw new Error('No se pudo ajustar el tamaño de la captura.')
    contexto.drawImage(canvas, 0, 0, siguiente.width, siguiente.height)
    canvas = siguiente
    blob = await png(canvas)
    reducida = true
  }
  if (blob.size > MAX_BYTES) throw new Error('No se pudo ajustar la captura al límite de 2 MB.')
  return { imagen: new File([blob], 'captura.png', { type: 'image/png' }), reducida, recursosIncompletos }
}
