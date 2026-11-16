-- Ejecutar después del borrador de migración, dentro de una transacción revertida.
create temporary table acreditacion_test as
select (select id from public.escuelas limit 1) escuela,
       (select id from public.profiles where role = 'distrital' and active limit 1) distrital,
       (select id from public.profiles where role = 'escolar' and active limit 1) escolar;
grant select on acreditacion_test to authenticated, service_role;

insert into public.acreditacion_eventos(id, nombre, lugar, fecha, hora_inicio, hora_fin, descripcion, estado)
values ('f193756a-5e1a-4fee-9c52-01a0ce143954', 'Evento prueba', 'Lugar prueba', '2099-01-01', '10:00', '11:00', 'Prueba', 'finalizado');

insert into public.acreditacion_personas(evento_id, nombre, dni, cargo, escuela_id, email, envio_estado, constancia_enviada_en, envio_token, envio_iniciado_en)
select 'f193756a-5e1a-4fee-9c52-01a0ce143954', 'Persona prueba', dni, 'Docente', escuela,
       'prueba@abc.gob.ar', estado, enviado, token, iniciado
from acreditacion_test
cross join (values
  ('99999991', 'enviado', now(), null::uuid, null::timestamptz),
  ('99999992', 'pendiente', null, null::uuid, null::timestamptz),
  ('99999993', 'incierto', null, gen_random_uuid(), now()),
  ('99999994', 'enviando', null, gen_random_uuid(), now()),
  ('99999995', 'enviando', null, gen_random_uuid(), now() - interval '11 minutes')
) p(dni, estado, enviado, token, iniciado);

set local role authenticated;
do $$
declare t record; p record; denegado boolean := false;
begin
  select * into t from acreditacion_test;
  if t.escuela is null or t.distrital is null or t.escolar is null then raise exception 'Faltan datos de prueba'; end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.distrital::text, true);
  select * into p from public.acreditacion_progreso_envios('f193756a-5e1a-4fee-9c52-01a0ce143954');
  if (p.total, p.enviados, p.pendientes, p.en_curso, p.inciertos) <> (5, 1, 3, 1, 2) then
    raise exception 'Conteos incorrectos: %', p;
  end if;
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  begin
    perform public.acreditacion_progreso_envios('f193756a-5e1a-4fee-9c52-01a0ce143954');
  exception when others then denegado := true;
  end;
  if not denegado then raise exception 'Progreso accesible al rol escolar'; end if;
end $$;
reset role;

-- Simula que el envío en curso terminó para verificar el reintento de un incierto.
update public.acreditacion_personas set envio_estado = 'enviado', constancia_enviada_en = now(),
  envio_token = null, envio_iniciado_en = null
where evento_id = 'f193756a-5e1a-4fee-9c52-01a0ce143954' and dni = '99999994';

set local role service_role;
do $$
declare persona bigint; token uuid; estado text;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into persona from public.acreditacion_personas where dni = '99999993' and evento_id = 'f193756a-5e1a-4fee-9c52-01a0ce143954';
  token := public.acreditacion_iniciar_envio('f193756a-5e1a-4fee-9c52-01a0ce143954', persona);
  if token is null then raise exception 'No se inició el reintento'; end if;
  select envio_estado into estado from public.acreditacion_personas where id = persona;
  if estado <> 'enviando' then raise exception 'Estado incorrecto: %', estado; end if;
  perform public.acreditacion_finalizar_envio(persona, token, 'enviado');
  if not exists (select 1 from public.acreditacion_personas where id = persona and constancia_enviada_en is not null) then
    raise exception 'No se registró la confirmación del envío';
  end if;
end $$;
reset role;
