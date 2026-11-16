-- Ejecutar dentro de una transacción revertida después del borrador de migración.
create temporary table acreditacion_eventos_test as
select (select id from public.escuelas limit 1) escuela,
       (select id from public.profiles where role = 'distrital' and active limit 1) distrital,
       (select id from public.profiles where role = 'escolar' and active limit 1) escolar;
grant select on acreditacion_eventos_test to authenticated, service_role;

set local role authenticated;
do $$
declare t record; evento uuid; resultado text; bloqueado boolean;
begin
  select * into t from acreditacion_eventos_test;
  if t.escuela is null or t.distrital is null or t.escolar is null then raise exception 'Faltan datos de prueba'; end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  bloqueado := false;
  begin perform public.acreditacion_guardar_evento(null, 'Evento ficticio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba');
  exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Rol escolar puede crear eventos'; end if;
  perform set_config('request.jwt.claim.sub', t.distrital::text, true);
  evento := public.acreditacion_guardar_evento(null, 'Evento ficticio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba');
  perform public.acreditacion_estado_evento(evento, 'activo');
  resultado := public.acreditacion_registrar(evento, 'Persona ficticia', '99999888', 'Docente', t.escuela, 'ejemplo@abc.gob.ar', false);
  if resultado <> 'ok' then raise exception 'Registro manual fallido: %', resultado; end if;
  resultado := public.acreditacion_registrar(evento, 'Persona ficticia', '99999888', 'Docente', t.escuela, 'ejemplo@abc.gob.ar', false);
  if resultado <> 'duplicado' then raise exception 'DNI repetido permitido'; end if;
  resultado := public.acreditacion_registrar(evento, 'Persona ficticia', '99999889', 'Docente', t.escuela, 'ejemplo@example.org', false);
  if resultado <> 'invalido' then raise exception 'Correo ajeno permitido'; end if;
  bloqueado := false;
  begin perform public.acreditacion_eliminar_evento(evento); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se eliminó evento con acreditados'; end if;
  perform public.acreditacion_estado_evento(evento, 'finalizado');
  bloqueado := false;
  begin perform public.acreditacion_guardar_evento(evento, 'Cambio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba');
  exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se editó evento finalizado'; end if;
  perform public.acreditacion_estado_evento(evento, 'activo');
  perform public.acreditacion_estado_evento(evento, 'finalizado');
end $$;
reset role;
