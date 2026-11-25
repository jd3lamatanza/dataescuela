-- Ejecutar las migraciones 0096 a 0100 y esta prueba dentro de una transacción revertida.
create temp table eoe_transfer_test (
  escuela_a bigint, escuela_b bigint, cuenta_a uuid, cuenta_b uuid,
  integrante_a bigint, integrante_b bigint, sesion_a uuid, sesion_b uuid,
  legajo uuid, solicitud uuid, token_acceso text, token_transferencia text, token_receptor text, archivo uuid, probanza uuid
);
grant select, update on eoe_transfer_test to authenticated, service_role;
do $$
declare
  escuela_a bigint := -9223372036854775501; escuela_b bigint := -9223372036854775502;
  cue_a text := 'tra' || substr(gen_random_uuid()::text, 1, 8);
  cue_b text := 'trb' || substr(gen_random_uuid()::text, 1, 8);
  cargo bigint := (select id from public.catalogos limit 1);
  miembro_a bigint; miembro_b bigint; cuenta_a uuid; cuenta_b uuid;
  sesion_a uuid := gen_random_uuid(); sesion_b uuid := gen_random_uuid();
begin
  insert into public.escuelas(id, cue, nombre) values (escuela_a, cue_a, 'Origen'), (escuela_b, cue_b, 'Destino'),
    (escuela_a + 1, cue_a, 'Origen duplicado');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_a + 1, cargo, 'Integrante Origen') returning id into miembro_a;
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_b, cargo, 'Integrante Destino') returning id into miembro_b;
  select id into cuenta_a from public.profiles where login = 'eoe' || cue_a;
  select id into cuenta_b from public.profiles where login = 'eoe' || cue_b;
  insert into auth.sessions(id, user_id) values (sesion_a, cuenta_a), (sesion_b, cuenta_b);
  insert into eoe_transfer_test values (escuela_a, escuela_b, cuenta_a, cuenta_b, miembro_a, miembro_b, sesion_a, sesion_b, null, null, null, null, null, null, null);
end $$;

set local role authenticated;
do $$
declare t record; leg uuid; sol uuid; respuesta jsonb; bloqueado boolean;
begin
  select * into t from eoe_transfer_test;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  perform public.eoe_pin_guardar(t.integrante_a, '123456');
  leg := public.eoe_legajo_crear('Estudiante de prueba', '70000123');
  respuesta := public.eoe_legajo_abrir(leg, t.integrante_a, '123456');
  if public.eoe_legajo_intervenir(leg, respuesta->>'token', current_date, 'Intervención de prueba', t.integrante_a, '123456') is not null then
    raise exception 'No se pudo firmar la intervención';
  end if;
  update eoe_transfer_test set legajo = leg, token_acceso = respuesta->>'token';
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  perform public.eoe_pin_guardar(t.integrante_b, '654321');
  sol := public.eoe_legajo_solicitar(t.escuela_a, '70000123', null);
  update eoe_transfer_test set solicitud = sol;
  bloqueado := false;
  begin perform public.eoe_legajo_enviar_solicitud(sol); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La solicitud no debe enviarse sin probanza'; end if;
  if has_function_privilege('authenticated', 'public.eoe_legajo_registrar_probanza(uuid,uuid,text,text,bigint,text)', 'execute') then
    raise exception 'Un cliente no debe poder registrar probanzas sin subirlas';
  end if;
end $$;

set local role service_role;
do $$
declare t record; reserva uuid; bloqueado boolean; v_archivo uuid; v_probanza uuid;
begin
  select * into t from eoe_transfer_test;
  reserva := gen_random_uuid();
  if public.eoe_drive_reservar('legajo', t.legajo, reserva)->>'estado' <> 'reservada'
    or public.eoe_drive_reservar('legajo', t.legajo, gen_random_uuid())->>'estado' <> 'ocupada'
    or not public.eoe_drive_confirmar('legajo', t.legajo, reserva, 'carpeta_legajo_123') then
    raise exception 'La reserva de carpeta no protege las cargas simultáneas';
  end if;
  bloqueado := false;
  begin
    perform public.eoe_drive_registrar('legajo', t.legajo, t.token_acceso, t.cuenta_b, t.sesion_b,
      'carpeta_legajo_123', 'documento_prueba_123', 'documento.pdf', 'application/pdf', 100);
  exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La receptora no debe registrar documentos antes de la transferencia'; end if;
  bloqueado := false;
  begin
    perform public.eoe_drive_registrar('legajo', t.legajo, t.token_acceso, t.cuenta_a, t.sesion_b,
      'carpeta_legajo_123', 'documento_prueba_123', 'documento.pdf', 'application/pdf', 100);
  exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Otra sesión no debe registrar archivos con el token'; end if;
  perform public.eoe_drive_iniciar('legajo', t.legajo, t.token_acceso, t.cuenta_a, t.sesion_a,
    'documento_prueba_123', 'documento.pdf', 'application/pdf', 100);
  v_archivo := public.eoe_drive_registrar('legajo', t.legajo, t.token_acceso, t.cuenta_a, t.sesion_a,
    'carpeta_legajo_123', 'documento_prueba_123', 'documento.pdf', 'application/pdf', 100);
  perform public.eoe_drive_registrar('legajo', t.legajo, t.token_acceso, t.cuenta_a, t.sesion_a,
    'carpeta_legajo_123', 'documento_prueba_123', 'documento.pdf', 'application/pdf', 100);
  reserva := gen_random_uuid();
  perform public.eoe_drive_reservar('solicitud', t.solicitud, reserva);
  if not public.eoe_drive_confirmar('solicitud', t.solicitud, reserva, 'carpeta_solicitud_123') then raise exception 'No se confirmó la carpeta de probanzas'; end if;
  perform public.eoe_drive_iniciar('solicitud', t.solicitud, null, t.cuenta_b, t.sesion_b,
    'prueba_archivo_123', 'prueba.pdf', 'application/pdf', 100);
  v_probanza := public.eoe_drive_registrar('solicitud', t.solicitud, null, t.cuenta_b, t.sesion_b,
    'carpeta_solicitud_123', 'prueba_archivo_123', 'prueba.pdf', 'application/pdf', 100);
  update eoe_transfer_test set archivo = v_archivo, probanza = v_probanza;
  perform public.eoe_drive_iniciar('legajo', t.legajo, t.token_acceso, t.cuenta_a, t.sesion_a,
    'pendiente_legajo_123', 'pendiente.pdf', 'application/pdf', 200);
  perform public.eoe_drive_iniciar('solicitud', t.solicitud, null, t.cuenta_b, t.sesion_b,
    'pendiente_prueba_123', 'pendiente.pdf', 'application/pdf', 200);
  perform public.eoe_drive_registrar('solicitud', t.solicitud, null, t.cuenta_b, t.sesion_b,
    'carpeta_solicitud_123', 'prueba_archivo_123', 'prueba.pdf', 'application/pdf', 100);
end $$;

set local role authenticated;
do $$
declare t record; preparado jsonb; bloqueado boolean; detalle jsonb; otro uuid;
begin
  select * into t from eoe_transfer_test;
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  if (select count(*) from public.eoe_drive_listar('solicitud', t.solicitud, null)) <> 1 then raise exception 'Reintentar el registro no debe duplicar la probanza'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  bloqueado := false;
  begin perform public.eoe_drive_listar('solicitud', t.solicitud, null); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'El origen no debe ver una solicitud en borrador'; end if;
  if (select count(*) from public.eoe_drive_listar('legajo', t.legajo, t.token_acceso)) <> 1 then raise exception 'Reintentar el registro no debe duplicar el documento'; end if;
  if public.eoe_drive_archivo('legajo', t.archivo, t.token_acceso)->>'drive_file_id' <> 'documento_prueba_123' then raise exception 'La escuela debe poder descargar su documento'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  bloqueado := false;
  begin perform public.eoe_drive_listar('legajo', t.legajo, t.token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La receptora no debe ver documentos antes de la transferencia'; end if;
  perform public.eoe_legajo_enviar_solicitud(t.solicitud);
  bloqueado := false;
  begin perform public.eoe_legajo_preparar_transferencia(t.solicitud, t.legajo, t.integrante_b, '654321'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La receptora no debe aprobar su propia solicitud'; end if;
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(t.legajo, t.token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La receptora no debe abrir antes de la transferencia'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.eoe_legajo_solicitudes() where id = t.solicitud and estado = 'pendiente') then raise exception 'El origen no ve la solicitud'; end if;
  if not exists (select 1 from public.eoe_drive_listar('solicitud', t.solicitud, null) where nombre = 'prueba.pdf') then raise exception 'El origen debe ver la probanza'; end if;
  if public.eoe_drive_archivo('solicitud', t.probanza, null)->>'drive_file_id' <> 'prueba_archivo_123' then raise exception 'El origen debe poder descargar la probanza'; end if;
  otro := public.eoe_legajo_crear('Otro estudiante', '70000124');
  bloqueado := false;
  begin perform public.eoe_legajo_preparar_transferencia(t.solicitud, otro, t.integrante_a, '123456'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe transferirse un legajo con DNI distinto'; end if;
  preparado := public.eoe_legajo_preparar_transferencia(t.solicitud, t.legajo, t.integrante_a, '000000');
  if preparado->>'error' is null then raise exception 'No debe aceptar PIN incorrecto'; end if;
  preparado := public.eoe_legajo_preparar_transferencia(t.solicitud, t.legajo, t.integrante_a, '123456');
  if preparado->>'token' is null then raise exception 'No se preparó la transferencia'; end if;
  update eoe_transfer_test set token_transferencia = preparado->>'token';
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  bloqueado := false;
  begin perform public.eoe_legajo_confirmar_transferencia(t.solicitud, preparado->>'token'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La receptora no debe confirmar usando el token del origen'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  bloqueado := false;
  begin perform public.eoe_legajo_confirmar_transferencia(t.solicitud, 'token incorrecto'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Debe exigir la segunda confirmación autorizada'; end if;
  perform public.eoe_legajo_confirmar_transferencia(t.solicitud, preparado->>'token');
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(t.legajo, t.token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado or exists (select 1 from public.eoe_legajos_listar() where id = t.legajo) then raise exception 'El origen perdió el acceso al transferir'; end if;
  bloqueado := false;
  begin perform public.eoe_drive_listar('legajo', t.legajo, t.token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'El origen no debe ver los documentos después de transferir'; end if;
  bloqueado := false;
  begin perform public.eoe_drive_archivo('legajo', t.archivo, t.token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'El origen no debe descargar documentos después de transferir'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.eoe_legajos_listar() where id = t.legajo) then raise exception 'La receptora debe recibir el legajo'; end if;
  preparado := public.eoe_legajo_abrir(t.legajo, t.integrante_b, '654321');
  update eoe_transfer_test set token_receptor = preparado->>'token';
  detalle := public.eoe_legajo_detalle(t.legajo, preparado->>'token');
  if not exists (select 1 from public.eoe_drive_listar('legajo', t.legajo, preparado->>'token') where nombre = 'documento.pdf') then raise exception 'La receptora debe recibir los documentos'; end if;
  if not exists (select 1 from public.eoe_drive_pendientes('legajo', t.legajo, preparado->>'token') where drive_file_id = 'pendiente_legajo_123') then raise exception 'Las cargas pendientes deben seguir al legajo'; end if;
  if not exists (select 1 from public.eoe_drive_pendientes('solicitud', t.solicitud, null) where drive_file_id = 'pendiente_prueba_123') then raise exception 'La receptora debe poder recuperar una probanza pendiente'; end if;
  if jsonb_array_length(detalle->'intervenciones') <> 1
    or detalle->'intervenciones'->0->>'firmante_nombre' <> 'Integrante Origen' then
    raise exception 'La transferencia debe conservar la intervención y su firma';
  end if;
  if not exists (select 1 from jsonb_array_elements(detalle->'auditoria') a where a->>'accion' = 'transferencia') then
    raise exception 'Falta el registro de transferencia';
  end if;
end $$;

set local role service_role;
do $$
declare t record; bloqueado boolean := false;
begin
  select * into t from eoe_transfer_test;
  begin
    perform public.eoe_drive_registrar('legajo', t.legajo, t.token_acceso, t.cuenta_a, t.sesion_a,
      'carpeta_legajo_123', 'documento_tardio_123', 'tardio.pdf', 'application/pdf', 100);
  exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'El origen no debe registrar documentos después de transferir'; end if;
  perform public.eoe_drive_registrar('legajo', t.legajo, t.token_receptor, t.cuenta_b, t.sesion_b,
    'carpeta_legajo_123', 'pendiente_legajo_123', 'pendiente.pdf', 'application/pdf', 200);
  perform public.eoe_drive_registrar('solicitud', t.solicitud, null, t.cuenta_b, t.sesion_b,
    'carpeta_solicitud_123', 'pendiente_prueba_123', 'pendiente.pdf', 'application/pdf', 200);
  bloqueado := false;
  begin
    perform public.eoe_drive_iniciar('solicitud', t.solicitud, null, t.cuenta_b, t.sesion_b,
      'nueva_prueba_123', 'nueva.pdf', 'application/pdf', 100);
  exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No deben iniciarse nuevas probanzas tras enviar la solicitud'; end if;
end $$;
