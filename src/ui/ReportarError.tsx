import { useEffect, useState } from 'preact/hooks'
import { llamarDrive } from '../lib/drive'
import { capturarPagina } from '../lib/capturaPagina'
import type { Profile } from '../lib/auth'
import { MODULES, ROLE_LABELS } from '../modules'
import { Icon } from './Icon'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, toast } from './kit'

export function ReportarError({ user, path }: { user: Profile; path: string }) {
  const [capturando, setCapturando] = useState(false)
  const [reporte, setReporte] = useState<{ id: string; url: string; modulo: string; imagen: File; reducida: boolean; recursosIncompletos: boolean } | null>(null)
  const abrir = async () => {
    const url = location.href
    const modulo = [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) =>
      m.path === '/' ? path === '/' : path === m.path || path.startsWith(`${m.path}/`))?.label ?? 'Página no encontrada'
    setCapturando(true)
    try {
      const captura = await capturarPagina()
      setReporte({ id: crypto.randomUUID(), url, modulo, ...captura })
    } catch (e) {
      toast.error(`No se pudo capturar la página: ${e instanceof Error ? e.message : String(e)}`)
    }
    finally { setCapturando(false) }
  }
  return <>
    <button type="button" class="flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
      aria-label={capturando ? 'Capturando página' : 'Reporte de error'} title="Reporte de error" aria-busy={capturando} disabled={capturando} onClick={() => void abrir()}><Icon name="bug" /></button>
    {reporte && <Formulario user={user} reporte={reporte} onClose={() => setReporte(null)} />}
  </>
}

function Formulario({ user, reporte, onClose }: {
  user: Profile; reporte: { id: string; url: string; modulo: string; imagen: File; reducida: boolean; recursosIncompletos: boolean }; onClose(): void
}) {
  const [descripcion, setDescripcion] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [previa, setPrevia] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(reporte.imagen)
    setPrevia(url)
    return () => URL.revokeObjectURL(url)
  }, [reporte.imagen])
  const enviar = async (e: Event) => {
    e.preventDefault()
    if (!descripcion.trim()) { setError('Describí el error.'); return }
    setError(''); setGuardando(true)
    try {
      const datos = new FormData()
      datos.append('action', 'upload'); datos.append('id', reporte.id); datos.append('modulo', reporte.modulo)
      datos.append('url', reporte.url); datos.append('descripcion', descripcion.trim()); datos.append('archivo', reporte.imagen)
      await llamarDrive('reportes-error', datos)
      dispatchEvent(new Event('correo-changed')); dispatchEvent(new Event('notifs-changed'))
      toast.ok('Reporte enviado. Recibirás una confirmación por mensajes.'); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setGuardando(false) }
  }
  return <Modal title="Reporte de error" onClose={() => { if (!guardando) onClose() }} wide>
    <form class="space-y-4" onSubmit={(e) => void enviar(e)}>
      {error && <Alert tone="error">{error}</Alert>}
      {reporte.recursosIncompletos && <Alert tone="warning">Algunos elementos externos o archivos incrustados podrían no aparecer en la captura. Revisá la vista previa antes de enviar.</Alert>}
      {reporte.reducida && <Alert tone="info">La imagen se redujo para poder guardar la página completa en un solo PNG.</Alert>}
      <p class="text-sm text-slate-600">Revisá la imagen y la URL antes de enviar: pueden contener datos personales o información sensible. La captura se guarda en Drive y el listado requiere permiso distrital avanzado.
        {user.role === 'distrital' && ' La confirmación se enviará a la bandeja distrital compartida.'}</p>
      <div class="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <p><strong>Módulo:</strong> {reporte.modulo}</p>
        <p><strong>Usuario:</strong> {user.name} · {ROLE_LABELS[user.role]}</p>
        <p class="break-all"><strong>URL:</strong> {reporte.url}</p>
        {user.simulador && <p>Ingreso simulado por {user.simulador}.</p>}
      </div>
      {previa && <img src={previa} alt="Vista previa de la captura que se enviará" class="max-h-64 max-w-full rounded border border-slate-200 object-contain" />}
      {previa && <a class={BTN_SECONDARY} href={previa} target="_blank" rel="noopener noreferrer">Ampliar captura</a>}
      <Lbl label="Descripción del error"><textarea class={`${FIELD} py-2`} rows={5} required maxLength={4000} value={descripcion} disabled={guardando}
        onInput={(e) => setDescripcion(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Enviando…' : 'Enviar reporte'}</button></div>
    </form>
  </Modal>
}
