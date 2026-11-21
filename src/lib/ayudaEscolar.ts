export interface GuiaEscolar {
  id: string
  modulo: string
  captura: string
  descripcion: string
  secciones: { titulo: string; pasos: string[] }[]
}

export const GUIAS_ESCOLARES: readonly GuiaEscolar[] = [
  {
    id: 'inicio', modulo: 'inicio', captura: 'inicio', descripcion: 'Navegación, calendario y avisos.',
    secciones: [
      { titulo: 'Moverse por DataEscuela', pasos: [
        'Elegí un módulo en el menú lateral o desde las tarjetas de Home. En el celular, abrí el menú con el botón de la esquina superior izquierda.',
        'La campana muestra notificaciones; el sobre abre Mensajes. El menú de usuario permite consultar Acerca de DataEscuela y cerrar sesión. El interruptor del menú cambia el modo claro u oscuro.',
        'Si olvidaste la contraseña, usá «¿Olvidaste tu contraseña?» en la pantalla de ingreso y seguí las indicaciones.',
      ] },
      { titulo: 'Calendario', pasos: [
        'Usá las flechas para cambiar de mes o «Hoy» para volver al mes actual. Seleccioná un día para consultar sus eventos y abrí uno para ver sus detalles.',
        'Cuando haya tipos de evento disponibles para tu rol, «Nuevo evento» permite cargarlos. Solo podés editar o eliminar los eventos propios.',
      ] },
    ],
  },
  {
    id: 'mensajes', modulo: 'mensajes', captura: 'mensajes', descripcion: 'Correo interno, adjuntos y organización.',
    secciones: [
      { titulo: 'Leer y organizar', pasos: [
        'Elegí Recibidos, Enviados, Borradores, Destacados, Archivados o Papelera. Buscá por asunto, mensaje o persona; en las carpetas de mensajes podés filtrar los no leídos o con adjuntos.',
        'Abrí un mensaje para leerlo, descargar adjuntos, responder, responder a todos o reenviar. También podés destacarlo, archivarlo, enviarlo a la papelera, restaurarlo o marcarlo como no leído según corresponda.',
        'Usá Anterior y Siguiente para recorrer los resultados.',
      ] },
      { titulo: 'Redactar y enviar', pasos: [
        'Tocá «Redactar», seleccioná uno o varios destinatarios y completá asunto y mensaje. Podés buscar destinatarios o seleccionar todos.',
        'Adjuntá archivos de hasta 5 MB cada uno. Podés quitar los adjuntos antes de enviar.',
        'Elegí «Enviar», «Guardar borrador» o «Guardar y cerrar». «Descartar» elimina el borrador y sus adjuntos; un borrador guardado puede retomarse desde Borradores.',
      ] },
    ],
  },
  {
    id: 'articulacion', modulo: 'articulacion', captura: 'articulacion', descripcion: 'Egresantes, ingresantes y seguimiento de trayectorias.',
    secciones: [
      { titulo: 'Egresantes', pasos: [
        'Elegí el ciclo y filtrá por nombre, DNI, destino, curso o PPI. «Nuevo egresante» permite cargar sus datos, destino y observaciones.',
        'Con «Importar nómina», seleccioná el reporte nominal XLS o XLSX de hasta 2 MB, revisá la previsualización y confirmá la importación de estudiantes nuevos. Se omiten bajas, DNI inválidos y registros duplicados o ya cargados. En Inicial se utiliza la letra de la sección.',
        '«Asignar destino» aplica una escuela al listado filtrado de egresantes sin ingreso confirmado; podés elegir si reemplazás destinos ya cargados. El menú de cada registro permite editarlo o eliminarlo cuando está habilitado.',
        'Los ciclos anteriores y los registros con ingreso confirmado están bloqueados para edición. Exportá los resultados con Excel o PDF.',
      ] },
      { titulo: 'Ingresantes', pasos: [
        'Elegí el ciclo de ingreso: el listado corresponde a egresantes del ciclo anterior con destino a tu escuela. Buscá, paginá o exportá en Excel y PDF.',
        'Para buscar a otra persona por DNI, usá «Buscar estudiante por DNI» y, si figura disponible, «Asignar a mi escuela». Una persona asignada a otra escuela no puede asignarse desde ese resultado.',
        'En cada ingresante marcá la documentación completa y confirmá el ingreso cuando corresponda.',
      ] },
      { titulo: 'Trayectorias', pasos: [
        'Filtrá por ciclo, estado o búsqueda para revisar destinos y confirmaciones pendientes. El menú de cada estudiante permite agregar o consultar intervenciones y registrar una inscripción fuera del distrito cuando aún no está confirmada.',
        'Los listados y las intervenciones pueden exportarse en Excel o PDF. Las pestañas disponibles dependen del nivel y modalidad de la escuela.',
      ] },
    ],
  },
  {
    id: 'estadistica', modulo: 'estadistica', captura: 'estadistica', descripcion: 'Indicadores provinciales y reportes en solo lectura.',
    secciones: [
      { titulo: 'Consultar indicadores', pasos: [
        'La información es de solo lectura y corresponde a los establecimientos asociados a tu CUE; la Jefatura actualiza las fuentes provinciales.',
        'Recorré Reporte Escolar, Matrícula PBA, Fichas de Inscripción, Salidas sin ingreso, Matrícula sin cerrar, Carga de Boletín Digital, Asistencia, Desempeño e Indicadores Comparados.',
        'Según la pestaña, utilizá búsqueda, filtros, orden, gráficos y paginación. Los filtros y las fechas disponibles dependen de los datos cargados; «Sin dato» no equivale a cero.',
        'Cuando estén disponibles, descargá las vistas con los botones Excel, PDF o PPTX. Los informes respetan los filtros seleccionados.',
      ] },
    ],
  },
  {
    id: 'acreditacion', modulo: 'acreditacion', captura: 'acreditacion', descripcion: 'Consultar acreditados y descargar constancias.',
    secciones: [
      { titulo: 'Buscar una constancia', pasos: [
        'Consultá las personas acreditadas para las escuelas de tu cuenta. Buscá por nombre, DNI, cargo o evento y, si lo necesitás, filtrá por evento.',
        'Elegí el orden, la dirección y la cantidad por página; usá la paginación para recorrer los resultados.',
        'Tocá «Constancia PDF» en la persona correspondiente. Si el botón no está disponible porque faltan firmas, la Distrital debe configurar las firmas del evento.',
        'Esta vista es de consulta: la escuela no crea eventos ni envía constancias desde este módulo.',
      ] },
    ],
  },
  {
    id: 'mapa-escolar', modulo: 'mapa-escolar', captura: 'mapa-escolar', descripcion: 'Ubicar escuelas y filtrar el mapa.',
    secciones: [
      { titulo: 'Explorar el mapa', pasos: [
        'Acercá, alejá o desplazá el mapa y tocá una marca para ver los datos de la escuela. Las marcas agrupadas indican varias escuelas cercanas.',
        'Abrí «Filtros» para elegir localidades, nivel y modalidad, o buscar por clave, nombre o dirección. Allí también se enumeran las escuelas sin coordenadas cuando las hay.',
        'El contador indica las escuelas visibles y las que no tienen coordenadas. El botón PDF abre la impresión del mapa para imprimir o guardar como PDF.',
      ] },
    ],
  },
  {
    id: 'disposiciones', modulo: 'disposiciones', captura: 'disposiciones', descripcion: 'Consultar disposiciones y probanzas de la escuela.',
    secciones: [
      { titulo: 'Buscar y ver el detalle', pasos: [
        'Buscá por docente, escuela, inspector, tipo o estado; elegí cuántos resultados mostrar y cambiá de página.',
        'Tocá «Ver detalle» para consultar los datos, el estado, las observaciones y las probanzas. Tocá el nombre de una probanza para abrirla.',
        'La vista escolar es de solo lectura y muestra las disposiciones asociadas a sus escuelas; la carga y modificación corresponden a Distrital.',
      ] },
    ],
  },
  {
    id: 'fichas', modulo: 'fichas', captura: 'fichas', descripcion: 'Datos de la escuela, directivos, orientación y ESI.',
    secciones: [
      { titulo: 'Ficha de Escuela', pasos: [
        'Los datos del padrón se muestran para consulta. En «Datos editables» completá nombre, ubicación, contacto, circuito electoral, nudo y las condiciones que correspondan.',
        'El correo es obligatorio y debe terminar en @abc.gob.ar. Tocá «Guardar cambios» para registrar la actualización.',
      ] },
      { titulo: 'Equipos y referentes', pasos: [
        'Abrí Ficha de Directivos, Ficha de Equipo de Orientación o Ficha de Referentes de ESI. Tocá «Agregar» para cargar una persona o usá el menú de su fila para editarla o eliminarla.',
        'Para directivos y orientación completá cargo, situación de revista y CUIL válido; el correo, si se informa, debe ser @abc.gob.ar. La ficha de ESI solicita DNI y permite indicar cargo, área, turno y otra escuela.',
        'Revisá los datos y guardá. La eliminación solicita confirmación.',
      ] },
    ],
  },
  {
    id: 'planta', modulo: 'planta', captura: 'planta', descripcion: 'Turnos, planes y secciones de la escuela.',
    secciones: [
      { titulo: 'Configurar y confirmar', pasos: [
        'Si la planta está habilitada, seleccioná los turnos, elegí y agregá los planes de estudio y cargá la cantidad de secciones por curso y turno.',
        'Revisá los subtotales y el total general. Tocá «Guardar planta» y confirmá las dos advertencias.',
        'Después de confirmarla, la planta queda bloqueada; para modificarla debe habilitar la edición el inspector o la Jefatura. Si faltan planes o turnos, consultá a la Jefatura.',
      ] },
    ],
  },
  {
    id: 'matricula', modulo: 'matricula', captura: 'matricula', descripcion: 'Carga mensual, confirmación e historial.',
    secciones: [
      { titulo: 'Cargar el mes', pasos: [
        'Primero debe estar configurada la planta. En «Carga del mes» verificá que el período esté abierto o que la Jefatura haya habilitado la carga de tu escuela.',
        'Completá matrícula y asistencia para cada curso y turno; usá cero cuando corresponda. En escuelas de modalidad especial también se solicita matrícula con inclusión. La asistencia no puede superar la matrícula.',
        'Tocá «Revisar y confirmar», comprobá la previsualización y elegí «Confirmar y guardar» o volvé a editar.',
      ] },
      { titulo: 'Consultar el historial', pasos: [
        'En «Historial» consultá las cargas mensuales confirmadas y sus totales. El menú de cada fila permite ver la carga y descargarla en Excel o PDF.',
      ] },
    ],
  },
  {
    id: 'salidas', modulo: 'salidas', captura: 'salidas', descripcion: 'Solicitar y seguir salidas educativas.',
    secciones: [
      { titulo: 'Crear una salida', pasos: [
        'Tocá «Nueva salida», completá título, fecha, destino y observaciones, y adjuntá la documentación en PDF.',
        'La opción de envío por correo está activada inicialmente y puede desmarcarse. Tocá «Guardar»; si se guardan los datos pero falla la subida o el correo, abrí el detalle para completar la gestión.',
      ] },
      { titulo: 'Seguimiento y documentación', pasos: [
        'Buscá por título o destino y filtrá por estado. Abrí una salida para consultar sus datos, estado, documentación y mensajes de seguimiento.',
        'Desde el detalle podés ver o descargar archivos y agregar documentación PDF mientras la salida esté habilitada. Escribí un mensaje en Seguimiento para comunicarte con la Distrital.',
      ] },
    ],
  },
  {
    id: 'eav', modulo: 'eav-escolar', captura: 'eav', descripcion: 'Activación de la Escuela de Verano y datos del directivo.',
    secciones: [
      { titulo: 'Activar y cargar directivo', pasos: [
        'Si la escuela participa, activá «Mi escuela es escuela de verano» y elegí «Cargar directivo». Completá los datos solicitados y adjuntá la documentación respaldatoria.',
        'El CUIL lleva 11 dígitos y el correo debe terminar en @abc.gob.ar. Guardá y esperá la finalización de la subida.',
        'Si se guardan los datos pero falla algún archivo, abrí «Editar» para reintentar. Podés previsualizar los documentos compatibles o descargarlos.',
        'Consultá el estado de la ficha. Mientras no esté aprobada, podés editar el directivo; el interruptor permite desactivar la condición de escuela de verano.',
      ] },
    ],
  },
]

export function buscarGuias(q: string): GuiaEscolar[] {
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
  const terminos = normalizar(q.trim()).split(/\s+/).filter(Boolean)
  return GUIAS_ESCOLARES.filter((guia) => {
    const texto = normalizar([guia.id, guia.descripcion, ...guia.secciones.flatMap((s) => [s.titulo, ...s.pasos])].join(' '))
    return terminos.every((t) => texto.includes(t))
  })
}
