import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { BTN_PRIMARY, BTN_SECONDARY } from './kit'

type Estado = 'comprobando' | 'activo' | 'activar' | 'bloqueado' | 'instalar' | 'incompatible' | 'error'

function esIosSinInstalar() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios && !matchMedia('(display-mode: standalone)').matches && !('standalone' in navigator && navigator.standalone)
}

function claveBytes(clave: string): Uint8Array<ArrayBuffer> {
  const base64 = clave.replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binario, (c) => c.charCodeAt(0))
}

export function NotificacionesPush({ simulando }: { simulando: boolean }) {
  const [estado, setEstado] = useState<Estado>('comprobando')
  const [clave, setClave] = useState('')
  const [registro, setRegistro] = useState<ServiceWorkerRegistration | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let vigente = true
    async function comprobar() {
      try {
        if (esIosSinInstalar()) { if (vigente) setEstado('instalar'); return }
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
          if (vigente) setEstado('incompatible')
          return
        }
        if (Notification.permission === 'denied') { if (vigente) setEstado('bloqueado'); return }
        const [sw, respuesta] = await Promise.all([
          navigator.serviceWorker.register(new URL('push-sw.js', document.baseURI)),
          supabase.rpc('push_clave_publica'),
        ])
        if (respuesta.error || typeof respuesta.data !== 'string') throw new Error(respuesta.error?.message ?? 'Clave push no disponible')
        const suscripcion = await sw.pushManager.getSubscription()
        let activo = false
        if (suscripcion) {
          const r = await supabase.rpc('push_estado', { p_endpoint: suscripcion.endpoint })
          if (r.error) throw new Error(r.error.message)
          activo = r.data === true
        }
        if (vigente) {
          setRegistro(sw)
          setClave(respuesta.data)
          setEstado(Notification.permission === 'granted' && activo ? 'activo' : 'activar')
        }
      } catch (error) {
        console.error('Error al comprobar notificaciones push:', error)
        if (vigente) setEstado('error')
      }
    }
    setEstado('comprobando')
    void comprobar()
    const alVolver = () => { if (document.visibilityState === 'visible') setRevision((n) => n + 1) }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vigente = false; document.removeEventListener('visibilitychange', alVolver) }
  }, [revision])

  const activar = async () => {
    if (!registro || !clave) return
    setOcupado(true)
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') { setEstado(permiso === 'denied' ? 'bloqueado' : 'activar'); return }
      const lista = await navigator.serviceWorker.ready
      const suscripcion = await lista.pushManager.getSubscription() ?? await lista.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: claveBytes(clave),
      })
      const r = await supabase.rpc('push_registrar', { p_endpoint: suscripcion.endpoint })
      if (r.error) throw new Error(r.error.message)
      setEstado('activo')
    } catch (error) {
      console.error('Error al activar notificaciones push:', error)
      setEstado('error')
    } finally { setOcupado(false) }
  }

  if (estado === 'comprobando' || estado === 'activo') return null
  const textos: Record<Exclude<Estado, 'comprobando' | 'activo'>, string> = {
    activar: 'Activá las notificaciones para recibir avisos incluso con la aplicación cerrada. Seguirán llegando después de cerrar sesión.',
    bloqueado: 'Las notificaciones están bloqueadas. Habilitalas en la configuración del navegador o del dispositivo y volvé a comprobar.',
    instalar: 'En iPhone o iPad, agregá DataEscuela a la pantalla de inicio y abrila desde allí para activar las notificaciones.',
    incompatible: 'Este navegador o dispositivo no admite notificaciones push. Probá con un navegador actualizado.',
    error: 'No se pudo comprobar o activar las notificaciones. Revisá la conexión e intentá nuevamente.',
  }
  return <section aria-label="Notificaciones del dispositivo" class="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
    <p class="font-semibold text-slate-900">Notificaciones en este dispositivo</p>
    <p class="mt-1">{textos[estado]}</p>
    {simulando && <p class="mt-1 text-xs">Durante el ingreso simulado, la activación corresponde a tu cuenta real.</p>}
    {estado === 'activar' && <p class="mt-1 text-xs">Si varias cuentas las activan en este dispositivo, los avisos genéricos de todas seguirán llegando al cerrar sesión.</p>}
    {estado === 'activar' && <button type="button" class={`${BTN_PRIMARY} mt-3`} disabled={ocupado} onClick={() => void activar()}>{ocupado ? 'Activando…' : 'Activar notificaciones'}</button>}
    {(estado === 'bloqueado' || estado === 'error') && <button type="button" class={`${BTN_SECONDARY} mt-3`} onClick={() => setRevision((n) => n + 1)}>Volver a comprobar</button>}
  </section>
}
