import { descargar, XLSX_MIME } from './download'
import { buildPdf, buildXlsx, type Table } from './export'
import { driveLink } from './labores'
import type { Labor } from '../pages/Labores'

/** Exporta el listado filtrado; cada probanza incluye su enlace de Drive (abre solo para quienes tienen acceso a la carpeta). */
export async function descargarListado(tipo: 'xlsx' | 'pdf', rows: Labor[], periodo: string) {
  const tabla: Table = {
    title: 'Labores de inspectores',
    subtitle: `${rows.length} labor(es)${periodo ? ` · ${periodo}` : ''}`,
    headers: ['Fecha', 'Inspector', 'Evento', 'Lugar', 'Tipo', 'Dimensión', 'Motivo', 'Equipo', 'Acuerdos', 'Probanzas (enlaces)'],
    widths: [10, 16, 14, 10, 10, 14, 22, 14, 24, 40],
    rows: rows.map((l) => [
      l.fecha.split('-').reverse().join('/'), l.autor, l.evento?.nombre ?? '', l.lugar?.nombre ?? '', l.tipo?.nombre ?? '', l.dimension?.nombre ?? '', l.motivo,
      l.equipo ? l.participantes.map((p) => p.nombre).join(', ') || 'Sí' : 'No', l.acuerdos ?? '',
      l.archivos.map((a) => `${a.nombre}: ${driveLink(a.drive_file_id)}`).join('  '),
    ]),
  }
  const name = `labores-${new Date().toISOString().slice(0, 10)}`
  if (tipo === 'xlsx') descargar(buildXlsx(tabla, 'Labores'), `${name}.xlsx`, XLSX_MIME)
  else descargar(await buildPdf(tabla), `${name}.pdf`, 'application/pdf')
}
