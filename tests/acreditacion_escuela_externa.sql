-- Ejecutar dentro de una transacción revertida.
do $$
declare evento uuid; resultado text; bloqueo boolean;
begin
  insert into public.acreditacion_eventos(nombre, lugar, fecha, hora_inicio, hora_fin, descripcion, estado)
    values ('Evento ficticio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', 'activo')
    returning id into evento;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  resultado := public.acreditacion_registrar_externa(evento, 'Persona ficticia', '99999888', 'Docente', ' Escuela externa ', 'ejemplo@abc.gob.ar');
  if resultado <> 'ok' then raise exception 'Registro externo fallido: %', resultado; end if;
  if not exists (select 1 from public.acreditacion_personas where evento_id = evento and escuela_id is null and escuela_externa = 'Escuela externa') then raise exception 'Escuela externa no almacenada'; end if;
  resultado := public.acreditacion_registrar_externa(evento, 'Persona ficticia', '99999888', 'Docente', 'Otra escuela', 'ejemplo@abc.gob.ar');
  if resultado <> 'duplicado' then raise exception 'DNI repetido permitido'; end if;
  resultado := public.acreditacion_registrar_externa(evento, 'Persona ficticia', '99999889', 'Docente', ' ', 'ejemplo@abc.gob.ar');
  if resultado <> 'invalido' then raise exception 'Escuela vacía permitida'; end if;
  resultado := public.acreditacion_registrar_externa(evento, 'Persona ficticia', '99999889', 'Docente', 'Escuela externa', 'ejemplo@example.org');
  if resultado <> 'invalido' then raise exception 'Correo ajeno permitido'; end if;
  update public.acreditacion_eventos set estado = 'finalizado' where id = evento;
  resultado := public.acreditacion_registrar_externa(evento, 'Persona ficticia', '99999889', 'Docente', 'Escuela externa', 'ejemplo@abc.gob.ar');
  if resultado <> 'cerrado' then raise exception 'Registro externo permitido en evento cerrado'; end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  bloqueo := false;
  begin perform public.acreditacion_registrar_externa(evento, 'Persona ficticia', '99999889', 'Docente', 'Escuela externa', 'ejemplo@abc.gob.ar');
  exception when others then bloqueo := true; end;
  if not bloqueo then raise exception 'Registro externo permitido sin service_role'; end if;
end $$;
