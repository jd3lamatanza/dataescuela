import { useEffect, useState } from 'preact/hooks'
import { llamarDrive } from '../lib/drive'
import type { Profile } from '../lib/auth'
import { MODULES, ROLE_LABELS } from '../modules'
import { Icon } from './Icon'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, toast } from './kit'

async function capturarPantalla(): Promise<File> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Este navegador no permite capturar la pantalla. Adjuntá una imagen.')
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  try {
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = stream
    await video.play()
    if (!video.videoWidth || !video.videoHeight) throw new Error('No se pudo leer la pantalla seleccionada.')
    const escala = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * escala))
    canvas.height = Math.max(1, Math.round(video.videoHeight * escala))
    const contexto = canvas.getContext('2d')
    if (!contexto) throw new Error('No se pudo preparar la captura.')
    contexto.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75))
    if (!blob || blob.size > 2097152) throw new Error('La captura supera 2 MB. Adjuntá una imagen más pequeña.')
    return new File([blob], 'captura.jpg', { type: 'image/jpeg' })
  } finally {
    stream.getTracks().forEach((track) => track.stop())
  }
}

export function ReportarError({ user, path }: { user: Profile; path: string }) {
  const [capturando, setCapturando] = useState(false)
  const [reporte, setReporte] = useState<{ id: string; url: string; modulo: string; imagen: File | null; aviso: string } | null>(null)
  const abrir = async () => {
    const url = location.href
    const modulo = [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) =>
      m.path === '/' ? path === '/' : path === m.path || path.startsWith(`${m.path}/`))?.label ?? 'Página no encontrada'
    setCapturando(true)
    let imagen: File | null = null, aviso = ''
    try { imagen = await capturarPantalla() }
    catch (e) { aviso = e instanceof Error && e.name !== 'NotAllowedError' ? e.message : 'No se capturó la pantalla. Adjuntá una imagen para continuar.' }
    finally { setCapturando(false) }
    setReporte({ id: crypto.randomUUID(), url, modulo, imagen, aviso })
  }
  return <>
    <button type="button" class="flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
      aria-label="Reporte de error" title="Reporte de error" disabled={capturando} onClick={() => void abrir()}><Icon name="bug" /></button>
    {reporte && <Formulario user={user} reporte={reporte} onClose={() => setReporte(null)} />}
  </>
}

function Formulario({ user, reporte, onClose }: {
  user: Profile; reporte: { id: string; url: string; modulo: string; imagen: File | null; aviso: string }; onClose(): void
}) {
  const [imagen, setImagen] = useState(reporte.imagen)
  const [descripcion, setDescripcion] = useState('')
  const [error, setError] = useState(reporte.aviso)
  const [guardando, setGuardando] = useState(false)
  const [previa, setPrevia] = useState('')
  useEffect(() => {
    if (!imagen) { setPrevia(''); return }
    const url = URL.createObjectURL(imagen)
    setPrevia(url)
    return () => URL.revokeObjectURL(url)
  }, [imagen])
  const enviar = async (e: Event) => {
    e.preventDefault()
    if (!imagen || !['image/png', 'image/jpeg'].includes(imagen.type) || imagen.size < 1 || imagen.size > 2097152) {
      setError('Adjuntá una imagen PNG o JPEG de hasta 2 MB.'); return
    }
    if (!descripcion.trim()) { setError('Describí el error.'); return }
    setError(''); setGuardando(true)
    try {
      const datos = new FormData()
      datos.append('action', 'upload'); datos.append('id', reporte.id); datos.append('modulo', reporte.modulo)
      datos.append('url', reporte.url); datos.append('descripcion', descripcion.trim()); datos.append('archivo', imagen)
      await llamarDrive('reportes-error', datos)
      dispatchEvent(new Event('correo-changed')); dispatchEvent(new Event('notifs-changed'))
      toast.ok('Reporte enviado. Recibirás una confirmación por mensajes.'); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setGuardando(false) }
  }
  return <Modal title="Reporte de error" onClose={() => { if (!guardando) onClose() }} wide>
    <form class="space-y-4" onSubmit={(e) => void enviar(e)}>
      {error && <Alert tone="error">{error}</Alert>}
      <p class="text-sm text-slate-600">Revisá la imagen y la URL antes de enviar: pueden contener datos personales o información sensible. La captura se guarda en Drive y el listado requiere permiso distrital avanzado.
        {user.role === 'distrital' && ' La confirmación se enviará a la bandeja distrital compartida.'}</p>
      <div class="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <p><strong>Módulo:</strong> {reporte.modulo}</p>
        <p><strong>Usuario:</strong> {user.name} · {ROLE_LABELS[user.role]}</p>
        <p class="break-all"><strong>URL:</strong> {reporte.url}</p>
        {user.simulador && <p>Ingreso simulado por {user.simulador}.</p>}
      </div>
      {previa && <img src={previa} alt="Vista previa de la captura que se enviará" class="max-h-64 max-w-full rounded border border-slate-200 object-contain" />}
      <Lbl label={imagen ? 'Reemplazar captura (PNG o JPEG, máximo 2 MB)' : 'Adjuntar captura (PNG o JPEG, máximo 2 MB)'}>
        <input type="file" accept="image/png,image/jpeg" class={`${FIELD} py-2`} disabled={guardando}
          onChange={(e) => { setImagen(e.currentTarget.files?.[0] ?? null); setError('') }} />
      </Lbl>
      <Lbl label="Descripción del error"><textarea class={`${FIELD} py-2`} rows={5} required maxLength={4000} value={descripcion} disabled={guardando}
        onInput={(e) => setDescripcion(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Enviando…' : 'Enviar reporte'}</button></div>
    </form>
  </Modal>
}
