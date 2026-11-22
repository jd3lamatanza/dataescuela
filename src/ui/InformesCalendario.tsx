import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { cargarCalendarioDistrital } from '../lib/calendarioDistritalDatos'
import { leerPaginas, mostrarEventoCalendario, mostrarRegistroCalendario, sinEventosDeSalidas, type FuenteCalendario } from '../lib/calendarioDistrital'
import { leerContingencias, registrosContingencias } from '../lib/contingencias'
import { agruparPorTipo, fechaArgentina, informeEvento, informeRegistro, ordenarInforme, type EntradaInforme, type EstiloInforme } from '../lib/calendarioInforme'
import { completarInforme } from '../lib/calendarioInformeDatos'
import { buildCalendarioPdf, fechaLarga, type FormatoInforme } from '../lib/calendarioInformePdf'
import { descargar } from '../lib/download'
import { href } from '../lib/router'
import type { Evento, TipoEvento } from './Calendario'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, FIELD, Lbl, Spinner, toast } from './kit'
import { Icon, iconOr } from './Icon'
import { col } from './coloresCalendario'

interface Props {
  usuario: string
  ano: number
  mes: number
  mesNombre: string
  entradasMes: EntradaInforme[]
  ocultos: string[]
  disponible: boolean
  revision: number
  fuentes: Record<FuenteCalendario, { nombre: string } & EstiloInforme>
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
      if (tipo && mostrarEventoCalendario(tipo, ocultos, true)) entradas.push(informeEvento(evento, tipo.nombre, tipo))
    }
    for (const registro of [...extra.registros, ...registrosContingencias(contingencias)]) {
      if (mostrarRegistroCalendario(registro.fuente, ocultos)) {
        const tipo = fuentes[registro.fuente]
        entradas.push(informeRegistro(registro, tipo.nombre, tipo))
      }
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

  const grupos = agruparPorTipo(actual?.entradas ?? [])

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
          {grupos.map((grupo) => <span key={grupo[0].tipo} class={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${col(grupo[0].estilo.color).chip}`}>
            <Icon name={iconOr(grupo[0].estilo.icono)} class="size-3.5" />{grupo[0].tipo}: {grupo.length}
          </span>)}
        </div>
        {!actual.entradas.length ? <p class="text-sm text-slate-500">No hay eventos para hoy con los filtros seleccionados.</p> :
          <div class="space-y-5">{grupos.map((grupo) => <section key={grupo[0].tipo} aria-label={grupo[0].tipo}>
            <div class={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 ${col(grupo[0].estilo.color).card}`}>
              <Icon name={iconOr(grupo[0].estilo.icono)} class="size-4 shrink-0" />
              <h3 class="min-w-0 flex-1 break-words text-sm font-semibold">{grupo[0].tipo}</h3>
              <span class={`rounded-full px-2 py-0.5 text-xs font-semibold ${col(grupo[0].estilo.color).chip}`}>{grupo.length}</span>
            </div>
            <div class="space-y-2">{grupo.map((entrada) => <article key={entrada.id} class="rounded-lg border border-slate-200 bg-white p-3">
            <h4 class="break-words font-semibold text-slate-900">{entrada.titulo}</h4>
            <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {entrada.detalles.map((detalle, i) => <div key={`${detalle.etiqueta}-${i}`} class="min-w-0">
                <dt class="text-xs font-semibold text-slate-500">{detalle.etiqueta}</dt>
                <dd class="whitespace-pre-wrap break-words text-slate-700">{detalle.valor}</dd>
              </div>)}
            </dl>
            {entrada.enlace && <a class="mt-3 inline-block text-sm font-medium text-sky-700 hover:underline" href={href(entrada.enlace)}>Abrir módulo</a>}
          </article>)}</div></section>)}</div>}
      </>}
    </Card>
  </div>
}
