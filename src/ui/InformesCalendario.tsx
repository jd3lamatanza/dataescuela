import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { cargarCalendarioDistrital } from '../lib/calendarioDistritalDatos'
import { leerPaginas, mostrarEventoCalendario, mostrarRegistroCalendario, sinEventosDeSalidas, type FuenteCalendario } from '../lib/calendarioDistrital'
import { leerContingencias, registrosContingencias } from '../lib/contingencias'
import { fechaArgentina, informeEvento, informeRegistro, ordenarInforme, type EntradaInforme } from '../lib/calendarioInforme'
import { completarInforme } from '../lib/calendarioInformeDatos'
import { buildCalendarioPdf, fechaLarga, type FormatoInforme } from '../lib/calendarioInformePdf'
import { descargar } from '../lib/download'
import { href } from '../lib/router'
import type { Evento, TipoEvento } from './Calendario'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, FIELD, Lbl, Spinner, toast } from './kit'
import { Icon } from './Icon'

interface Props {
  usuario: string
  ano: number
  mes: number
  mesNombre: string
  entradasMes: EntradaInforme[]
  ocultos: string[]
  disponible: boolean
  revision: number
  fuentes: Record<FuenteCalendario, { nombre: string }>
}

export function InformesCalendario({ usuario, ano, mes, mesNombre, entradasMes, ocultos, disponible, revision, fuentes }: Props) {
  const [formato, setFormato] = useState<FormatoInforme>('resumido')
  const [exportando, setExportando] = useState(false)
  const [hoy, setHoy] = useState(fechaArgentina)
  const filtros = JSON.stringify(ocultos)
  useEffect(() => {
    const actualizar = () => setHoy(fechaArgentina())
    const intervalo = setInterval(actualizar, 60000)
    document.addEventListener('visibilitychange', actualizar)
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', actualizar) }
  }, [])

  const informe = useAsync(async () => {
    const [eventos, tipos, extra, contingencias] = await Promise.all([
      leerPaginas<Evento>((a, b) => supabase.from('eventos').select('*').eq('fecha', hoy).order('id').range(a, b)),
      supabase.from('evento_tipos').select('*').order('id'),
      cargarCalendarioDistrital(hoy, hoy),
      leerContingencias(supabase, { busqueda: '', tipo: '', suspension: '', desde: hoy, hasta: hoy }),
    ])
    if (tipos.error) throw tipos.error
    if (!tipos.data) throw new Error('No se pudieron consultar los tipos de evento.')
    const porTipo = new Map((tipos.data as TipoEvento[]).map((t) => [t.id, t]))
    const entradas: EntradaInforme[] = []
    for (const evento of sinEventosDeSalidas(eventos, extra.eventosSalidas)) {
      const tipo = porTipo.get(evento.tipo_id)
      if (tipo && mostrarEventoCalendario(tipo, ocultos, true)) entradas.push(informeEvento(evento, tipo.nombre))
    }
    for (const registro of [...extra.registros, ...registrosContingencias(contingencias)]) {
      if (mostrarRegistroCalendario(registro.fuente, ocultos)) entradas.push(informeRegistro(registro, fuentes[registro.fuente].nombre))
    }
    return { fecha: hoy, filtros, revision, usuario, entradas: ordenarInforme(await completarInforme(entradas)) }
  }, [hoy, filtros, revision, usuario])
  const actual = informe.data?.fecha === hoy && informe.data.filtros === filtros && informe.data.revision === revision && informe.data.usuario === usuario
    ? informe.data : null

  const exportar = async () => {
    setExportando(true)
    try {
      const entradas = formato === 'analitico' ? await completarInforme(entradasMes) : entradasMes
      const pdf = await buildCalendarioPdf(ano, mes, entradas, formato)
      descargar(pdf, `calendario-${ano}-${String(mes + 1).padStart(2, '0')}-${formato}.pdf`, 'application/pdf')
    } catch (error) {
      toast.error(`No se pudo generar el PDF: ${error instanceof Error ? error.message : String(error)}`)
    } finally { setExportando(false) }
  }

  const cantidades = new Map<string, number>()
  for (const entrada of actual?.entradas ?? []) cantidades.set(entrada.tipo, (cantidades.get(entrada.tipo) ?? 0) + 1)

  return <div class="mt-4 space-y-4">
    <Card title="Exportar calendario">
      <p class="mb-3 text-sm text-slate-600">El PDF incluye todos los días de {mesNombre} y respeta los tipos activados en el calendario.</p>
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-full sm:w-64"><Lbl label="Formato del informe">
          <select class={FIELD} value={formato} onChange={(e) => setFormato(e.currentTarget.value === 'analitico' ? 'analitico' : 'resumido')}>
            <option value="resumido">Resumido</option><option value="analitico">Analítico</option>
          </select>
        </Lbl></div>
        <button type="button" class={BTN_PRIMARY} disabled={!disponible || exportando} onClick={() => void exportar()}>
          <Icon name="download" />{exportando ? 'Preparando PDF…' : 'Descargar PDF'}
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">El analítico incluye datos de origen y nombres de adjuntos, sin CUIL; los archivos se consultan en sus módulos.</p>
      {!disponible && <p class="mt-2 text-sm text-amber-700">Esperá a que se carguen todas las fuentes del calendario para exportar.</p>}
    </Card>

    <Card title="Informe analítico de hoy" action={<span class="text-xs capitalize text-slate-500">{fechaLarga(hoy)}</span>}>
      <p class="mb-3 text-sm text-slate-600">Información del día actual, según los tipos activados. Los adjuntos se consultan en sus módulos.</p>
      {informe.loading || (!actual && !informe.error) ? <Spinner /> : informe.error ? <div class="space-y-2">
        <Alert tone="error">No se pudo cargar el informe diario completo: {informe.error}</Alert>
        <button type="button" class={BTN_SECONDARY} onClick={informe.reload}>Reintentar</button>
      </div> : actual && <>
        <div class="mb-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span class="rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-800">{actual.entradas.length} eventos</span>
          {[...cantidades].map(([tipo, cantidad]) => <span key={tipo} class="rounded-full bg-slate-100 px-2 py-1">{tipo}: {cantidad}</span>)}
        </div>
        {!actual.entradas.length ? <p class="text-sm text-slate-500">No hay eventos para hoy con los filtros seleccionados.</p> :
          <div class="space-y-3">{actual.entradas.map((entrada) => <article key={entrada.id} class="rounded-lg border border-slate-200 p-3">
            <p class="text-xs font-semibold uppercase text-sky-700">{entrada.tipo}</p>
            <h3 class="mt-1 break-words font-semibold text-slate-900">{entrada.titulo}</h3>
            <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {entrada.detalles.map((detalle, i) => <div key={`${detalle.etiqueta}-${i}`} class="min-w-0">
                <dt class="text-xs font-semibold text-slate-500">{detalle.etiqueta}</dt>
                <dd class="whitespace-pre-wrap break-words text-slate-700">{detalle.valor}</dd>
              </div>)}
            </dl>
            {entrada.enlace && <a class="mt-3 inline-block text-sm font-medium text-sky-700 hover:underline" href={href(entrada.enlace)}>Abrir módulo</a>}
          </article>)}</div>}
      </>}
    </Card>
  </div>
}
