import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { mensaje } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, Card, FIELD, Lbl, PageHeader, Spinner, TabBar, toast, type TabItem } from '../ui/kit'

interface DatosEmail {
  salidas_destino: string
  sistema_remitente: string
  respuesta: string
  nombre_remitente: string
}

const TABS: TabItem[] = [{ id: 'email', label: 'Email', icon: 'settings', color: 'sky' }]

async function cargar() {
  const { data, error } = await supabase.from('configuracion_email').select('salidas_destino,sistema_remitente,respuesta,nombre_remitente').eq('id', true).maybeSingle()
  if (error) throw error
  return data as DatosEmail | null
}

export function Configuracion() {
  const { data, error, loading, reload } = useAsync(async () => ({ valor: await cargar() }), [])
  return <>
    <PageHeader title="Configuración" subtitle="Parámetros generales del sistema" />
    <TabBar label="Configuración" items={TABS} active="email" onChange={() => {}} />
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : data && <Formulario key={JSON.stringify(data.valor)} inicial={data.valor} onGuardado={reload} />}
  </>
}

function Formulario({ inicial, onGuardado }: { inicial: DatosEmail | null; onGuardado(): void }) {
  const [f, setF] = useState<DatosEmail>(inicial ?? { salidas_destino: '', sistema_remitente: '', respuesta: '', nombre_remitente: '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const cambiar = (k: keyof DatosEmail) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })
  const guardar = async (e: Event) => {
    e.preventDefault()
    setError('')
    const valores: DatosEmail = { salidas_destino: f.salidas_destino.trim(), sistema_remitente: f.sistema_remitente.trim(), respuesta: f.respuesta.trim(), nombre_remitente: f.nombre_remitente.trim() }
    if (/[\x00-\x1f\x7f<>]/.test(valores.nombre_remitente)) { setError('El nombre del remitente contiene caracteres no permitidos.'); return }
    setGuardando(true)
    try {
      const { error: err } = await supabase.from('configuracion_email').upsert({ id: true, ...valores, updated_at: new Date().toISOString() })
      if (err) throw err
      toast.ok('Configuración de email guardada')
      onGuardado()
    } catch (err) { setError(mensaje(err)) }
    finally { setGuardando(false) }
  }
  return <Card title="Email" class="max-w-3xl">
    <p class="mb-4 text-sm text-slate-600">Estas direcciones se usan para los correos de salidas educativas y recuperación de acceso. La dirección del sistema debe ser la cuenta SMTP configurada o un alias autorizado en Gmail; este formulario no modifica las credenciales SMTP.</p>
    {!inicial && <div class="mb-4"><Alert tone="info">Aún no se guardó una configuración. Hasta entonces se usan las direcciones configuradas previamente en el servidor.</Alert></div>}
    <form onSubmit={guardar} class="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Bandeja entrante de salidas educativas"><input class={FIELD} type="email" required maxLength={254} value={f.salidas_destino} onInput={cambiar('salidas_destino')} /></Lbl>
      <Lbl label="Bandeja de sistema (remitente)"><input class={FIELD} type="email" required maxLength={254} value={f.sistema_remitente} onInput={cambiar('sistema_remitente')} /></Lbl>
      <Lbl label="Dirección de respuesta predeterminada"><input class={FIELD} type="email" required maxLength={254} value={f.respuesta} onInput={cambiar('respuesta')} /></Lbl>
      <Lbl label="Nombre del remitente"><input class={FIELD} required maxLength={120} value={f.nombre_remitente} onInput={cambiar('nombre_remitente')} /></Lbl>
      <div class="flex justify-end"><button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar configuración'}</button></div>
    </form>
  </Card>
}
