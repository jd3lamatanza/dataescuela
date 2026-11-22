import { supabase } from './supabase'
import { leerPaginas, type RegistroCalendario } from './calendarioDistrital'
import { campo, type CampoInforme, type EntradaInforme } from './calendarioInforme'

type Id = string | number
type Resultado<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
type Escuela = { clave: string | null; nombre: string | null } | null
type Archivo = { nombre: string }
type Catalogo = { nombre: string } | null
type Acreditacion = { id: string; creado_en: string; firmas_configuradas: boolean }
type Acreditado = { evento_id: string; nombre: string; email: string; cargo: string; escuela_externa: string | null; escuela: Escuela; envio_estado: string; constancia_enviada_en: string | null; adicionales: { cargo: string; escuela_externa: string | null; escuela: Escuela }[] }
type Salida = { id: number; cue: string; observaciones: string | null; enviar_mail: boolean; mail_enviado_at: string | null; created_at: string; updated_at: string }
type MensajeSalida = { salida_id: number; autor: string; rol: string; texto: string; created_at: string; estado: Catalogo }
type ArchivoSalida = Archivo & { salida_id: number }
type Labor = { id: number; acuerdos: string | null; equipo: boolean; escuela_historica: string | null; acuerdos_pendientes_historicos: string | null; tipo: Catalogo; dimension: Catalogo }
type InspectorLabor = { labor_id: number; nombre: string }
type ArchivoLabor = Archivo & { labor_id: number }
type Disposicion = { id: number; inspector: string; email_jefatura: string; docente_nombre: string; docente_email: string; cargo_cubrir: string; revista_cubrir: string; tipo: string; motivo: string; fecha_designacion: string; numero_designacion: string; escuela_cubrir_clave: string; escuela_cubrir_nombre: string; escuela_base_clave: string; escuela_base_nombre: string; escuela_base_fuera_distrital: boolean; cargo_base: string; revista_base: string; fecha_desde: string; observaciones: string; estado: string; usuario: string; fecha_registro: string; actualizada: string }
type ArchivoDisposicion = Archivo & { disposicion_id: number }
type Equipo = { id: number; email: string | null; cargo: Catalogo; revista: Catalogo }
type Directivo = Equipo & { cargo_base: string | null }
type Inspector = { id: number; email: string | null; nivel_o_modalidad: string | null; situacion_revista: string | null; cargo_base: string | null; escuelas_asignadas: string[] }
type Periodo = { id: number; ciclo: number; mes: number; fecha_apertura: string; fecha_cierre: string; carga: boolean }

async function porIds<T>(ids: readonly Id[], consulta: (ids: Id[], desde: number, hasta: number) => Resultado<T>): Promise<T[]> {
  const unicos = [...new Set(ids)]
  const todos: T[] = []
  for (let i = 0; i < unicos.length; i += 100) {
    const grupo = unicos.slice(i, i + 100)
    todos.push(...await leerPaginas<T>((desde, hasta) => consulta(grupo, desde, hasta)))
  }
  return todos
}

function identificador(registro: RegistroCalendario): string {
  const valor = registro.fuente === 'acreditacion' ? registro.id.slice('acreditacion-'.length)
    : registro.fuente === 'posesion' ? registro.id.split('-').at(-1) ?? ''
      : registro.id.split('-')[1] ?? ''
  if (registro.fuente === 'acreditacion' ? !/^[0-9a-f-]{36}$/i.test(valor) : !/^\d+$/.test(valor)) {
    throw new Error(`No se pudo identificar el registro de ${registro.fuente}.`)
  }
  return valor
}

function comprobar<T extends { id: Id }>(ids: readonly Id[], filas: T[], nombre: string): Map<string, T> {
  const mapa = new Map(filas.map((fila) => [String(fila.id), fila]))
  if (ids.some((id) => !mapa.has(String(id)))) throw new Error(`No se pudo acceder a todos los registros de ${nombre}. Actualizá el calendario y reintentá.`)
  return mapa
}

const nombres = (xs: Archivo[]) => xs.map((x) => x.nombre).join('\n')
const escuela = (e: Escuela, externa: string | null) => e ? [e.clave, e.nombre].filter(Boolean).join(' · ') : externa ?? ''
const campos = (...datos: [string, string | number | boolean | null | undefined][]) => datos.flatMap(([etiqueta, valor]) => campo(etiqueta, valor))

/** Carga datos del módulo de origen solo para las entradas visibles y falla si faltan datos. */
export async function completarInforme(entradas: readonly EntradaInforme[]): Promise<EntradaInforme[]> {
  const registros = entradas.flatMap((e) => e.registro ? [e.registro] : [])
  const ids = (fuente: RegistroCalendario['fuente']) => registros.filter((r) => r.fuente === fuente).map(identificador)
  const acreditaciones = ids('acreditacion'), salidas = ids('salida'), labores = ids('labor')
  const disposiciones = ids('disposicion'), periodos = ids('matricula')
  const directivos = registros.filter((r) => r.fuente === 'posesion' && r.id.startsWith('posesion-Equipo directivo-')).map(identificador)
  const orientacion = registros.filter((r) => r.fuente === 'posesion' && r.id.startsWith('posesion-Equipo de orientación-')).map(identificador)
  const inspectores = registros.filter((r) => r.fuente === 'posesion' && r.id.startsWith('posesion-inspector-')).map(identificador)

  const [ac, personas, sa, saArch, saMsg, la, laInsp, laArch, di, diArch, pe, ed, eo, ins] = await Promise.all([
    porIds<Acreditacion>(acreditaciones, (v, a, b) => supabase.from('acreditacion_eventos').select('id,creado_en,firmas_configuradas').in('id', v).order('id').range(a, b)),
    porIds<Acreditado>(acreditaciones, (v, a, b) => supabase.from('acreditacion_personas').select('evento_id,nombre,email,cargo,escuela_externa,envio_estado,constancia_enviada_en,escuela:escuelas(clave,nombre),adicionales:acreditacion_escuelas_adicionales(cargo,escuela_externa,escuela:escuelas(clave,nombre))').in('evento_id', v).order('id').range(a, b).overrideTypes<Acreditado[], { merge: false }>()),
    porIds<Salida>(salidas, (v, a, b) => supabase.from('salidas').select('id,cue,observaciones,enviar_mail,mail_enviado_at,created_at,updated_at').in('id', v).order('id').range(a, b)),
    porIds<ArchivoSalida>(salidas, (v, a, b) => supabase.from('salida_archivos').select('salida_id,nombre').in('salida_id', v).order('id').range(a, b)),
    porIds<MensajeSalida>(salidas, (v, a, b) => supabase.from('salida_mensajes').select('salida_id,autor,rol,texto,created_at,estado:salida_estados(nombre)').in('salida_id', v).order('id').range(a, b).overrideTypes<MensajeSalida[], { merge: false }>()),
    porIds<Labor>(labores, (v, a, b) => supabase.from('labores').select('id,acuerdos,equipo,escuela_historica,acuerdos_pendientes_historicos,tipo:catalogos!labores_tipo_id_fkey(nombre),dimension:catalogos!labores_dimension_id_fkey(nombre)').in('id', v).order('id').range(a, b).overrideTypes<Labor[], { merge: false }>()),
    porIds<InspectorLabor>(labores, (v, a, b) => supabase.from('labor_inspectores').select('labor_id,nombre').in('labor_id', v).order('labor_id').order('user_id').range(a, b)),
    porIds<ArchivoLabor>(labores, (v, a, b) => supabase.from('labor_archivos').select('labor_id,nombre').in('labor_id', v).order('id').range(a, b)),
    porIds<Disposicion>(disposiciones, (v, a, b) => supabase.from('disposiciones').select('id,inspector,email_jefatura,docente_nombre,docente_email,cargo_cubrir,revista_cubrir,tipo,motivo,fecha_designacion,numero_designacion,escuela_cubrir_clave,escuela_cubrir_nombre,escuela_base_clave,escuela_base_nombre,escuela_base_fuera_distrital,cargo_base,revista_base,fecha_desde,observaciones,estado,usuario,fecha_registro,actualizada').in('id', v).order('id').range(a, b)),
    porIds<ArchivoDisposicion>(disposiciones, (v, a, b) => supabase.from('disposicion_archivos').select('disposicion_id,nombre').in('disposicion_id', v).order('id').range(a, b)),
    porIds<Periodo>(periodos, (v, a, b) => supabase.from('carga_activa').select('id,ciclo,mes,fecha_apertura,fecha_cierre,carga').in('id', v).order('id').range(a, b)),
    porIds<Directivo>(directivos, (v, a, b) => supabase.from('equipo_directivo').select('id,email,cargo_base,cargo:catalogos!equipo_directivo_cargo_id_fkey(nombre),revista:catalogos!equipo_directivo_revista_id_fkey(nombre)').in('id', v).order('id').range(a, b).overrideTypes<Directivo[], { merge: false }>()),
    porIds<Equipo>(orientacion, (v, a, b) => supabase.from('equipo_orientacion').select('id,email,cargo:catalogos!equipo_orientacion_cargo_id_fkey(nombre),revista:catalogos!equipo_orientacion_revista_id_fkey(nombre)').in('id', v).order('id').range(a, b).overrideTypes<Equipo[], { merge: false }>()),
    porIds<Inspector>(inspectores, (v, a, b) => supabase.from('inspectores').select('id,email,nivel_o_modalidad,situacion_revista,cargo_base,escuelas_asignadas').in('id', v).order('id').range(a, b)),
  ])
  const ma = comprobar(acreditaciones, ac, 'acreditación'), ms = comprobar(salidas, sa, 'salidas'), ml = comprobar(labores, la, 'labores')
  const md = comprobar(disposiciones, di, 'disposiciones'), mp = comprobar(periodos, pe, 'matrícula')
  const med = comprobar(directivos, ed, 'equipo directivo'), meo = comprobar(orientacion, eo, 'equipo de orientación'), mi = comprobar(inspectores, ins, 'inspectores')

  return entradas.map((entrada) => {
    const r = entrada.registro
    if (!r || r.fuente === 'contingencia' || r.fuente === 'evento-escolar') return entrada
    const id = identificador(r)
    let extra: CampoInforme[] = []
    if (r.fuente === 'acreditacion') {
      const x = ma.get(id)!
      extra = campos(['Fecha de creación', x.creado_en], ['Firmas configuradas', x.firmas_configuradas])
      for (const p of personas.filter((p) => p.evento_id === id)) {
        const escuelas = [{ cargo: p.cargo, escuela: p.escuela, escuela_externa: p.escuela_externa }, ...p.adicionales]
        extra.push(...campos(['Acreditado', p.nombre], ['Correo', p.email],
          ['Escuelas y cargos', escuelas.map((e) => `${escuela(e.escuela, e.escuela_externa)} · ${e.cargo}`).join('\n')],
          ['Estado de constancia', p.envio_estado], ['Constancia enviada', p.constancia_enviada_en]))
      }
      if (!personas.some((p) => p.evento_id === id)) extra.push(...campo('Acreditados', 'Ninguno'))
    } else if (r.fuente === 'salida') {
      const x = ms.get(id)!
      extra = campos(['CUE', x.cue], ['Observaciones', x.observaciones], ['Enviar correo', x.enviar_mail],
        ['Correo enviado', x.mail_enviado_at], ['Creada', x.created_at], ['Actualizada', x.updated_at],
        ['Documentación', nombres(saArch.filter((a) => String(a.salida_id) === id)) || 'Sin archivos'])
      for (const m of saMsg.filter((m) => String(m.salida_id) === id)) {
        extra.push(...campos(['Mensaje', `${m.autor} · ${m.rol} · ${m.created_at}${m.estado ? ` · ${m.estado.nombre}` : ''}\n${m.texto}`]))
      }
    } else if (r.fuente === 'labor') {
      const x = ml.get(id)!
      extra = campos(['Tipo', x.tipo?.nombre], ['Dimensión', x.dimension?.nombre], ['Labor de equipo', x.equipo],
        ['Participantes', laInsp.filter((p) => String(p.labor_id) === id).map((p) => p.nombre).join(', ')],
        ['Escuela histórica', x.escuela_historica], ['Acuerdos', x.acuerdos], ['Acuerdos pendientes', x.acuerdos_pendientes_historicos],
        ['Probanzas', nombres(laArch.filter((a) => String(a.labor_id) === id)) || 'Sin archivos'])
    } else if (r.fuente === 'disposicion') {
      const x = md.get(id)!
      extra = campos(['Inspector', x.inspector], ['Correo de jefatura', x.email_jefatura], ['Docente', x.docente_nombre],
        ['Correo del docente', x.docente_email], ['Escuela a cubrir', `${x.escuela_cubrir_clave} · ${x.escuela_cubrir_nombre}`],
        ['Cargo a cubrir', x.cargo_cubrir], ['Revista a cubrir', x.revista_cubrir], ['Tipo', x.tipo], ['Motivo', x.motivo],
        ['Fecha de designación', x.fecha_designacion], ['Número de designación', x.numero_designacion],
        ['Escuela base', `${x.escuela_base_clave} · ${x.escuela_base_nombre}${x.escuela_base_fuera_distrital ? ' (fuera de la Distrital)' : ''}`],
        ['Cargo base', x.cargo_base], ['Revista base', x.revista_base], ['Fecha desde', x.fecha_desde],
        ['Observaciones', x.observaciones], ['Estado', x.estado], ['Usuario', x.usuario], ['Fecha de registro', x.fecha_registro],
        ['Actualizada', x.actualizada], ['Probanzas', nombres(diArch.filter((a) => String(a.disposicion_id) === id)) || 'Sin archivos'])
    } else if (r.fuente === 'matricula') {
      const x = mp.get(id)!
      extra = campos(['Ciclo', x.ciclo], ['Mes', x.mes], ['Apertura', x.fecha_apertura], ['Cierre', x.fecha_cierre], ['Carga habilitada', x.carga])
    } else if (r.id.startsWith('posesion-inspector-')) {
      const x = mi.get(id)!
      extra = campos(['Correo', x.email], ['Nivel o modalidad', x.nivel_o_modalidad], ['Situación de revista', x.situacion_revista],
        ['Cargo base', x.cargo_base], ['Escuelas asignadas', x.escuelas_asignadas.join(', ')])
    } else {
      const directo = r.id.startsWith('posesion-Equipo directivo-') ? med.get(id) : undefined
      const x = directo ?? meo.get(id)!
      extra = campos(['Correo', x.email], ['Cargo', x.cargo?.nombre], ['Revista', x.revista?.nombre],
        ['Cargo base', directo?.cargo_base])
    }
    return { ...entrada, detalles: [...entrada.detalles, ...extra] }
  })
}
