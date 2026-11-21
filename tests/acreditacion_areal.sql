create temporary table acreditacion_areal_test as
select (select id from public.profiles where role = 'areal' and active order by id limit 1) a,
       (select id from public.profiles where role = 'areal' and active order by id offset 1 limit 1) b,
       (select p.id from public.profiles p where p.role = 'distrital' and p.active and p.permiso_avanzado limit 1) distrital,
       (select id from public.profiles where role = 'escolar' and active limit 1) escolar,
       (select id from public.escuelas limit 1) escuela,
       null::uuid evento, null::uuid ajeno, null::bigint firma;
grant select, update on acreditacion_areal_test to authenticated, service_role;

delete from public.simulaciones where actor_id = (select distrital from acreditacion_areal_test);

do $$
declare t record; v_firma bigint;
begin
  select * into t from acreditacion_areal_test;
  if t.a is null or t.b is null or t.distrital is null or t.escolar is null or t.escuela is null then raise exception 'Faltan datos de prueba'; end if;
  insert into public.acreditacion_firmas(nombre, mime, contenido, propietario_id)
    values ('Firma ficticia', 'image/png', decode('89504e470d0a1a0a', 'hex'), t.a) returning id into v_firma;
  update acreditacion_areal_test set firma = v_firma;
  begin
    insert into public.acreditacion_firmas(nombre, mime, contenido, propietario_id)
      values ('Firma duplicada ficticia', 'image/png', decode('89504e470d0a1a0a', 'hex'), t.a);
    raise exception 'Se aceptó una segunda firma del inspector';
  exception when unique_violation then null; end;
  insert into public.acreditacion_firmas(nombre, mime, contenido, propietario_id) values
    ('Firma distrital ficticia 1', 'image/png', decode('89504e470d0a1a0a', 'hex'), null),
    ('Firma distrital ficticia 2', 'image/png', decode('89504e470d0a1a0a', 'hex'), null);
end $$;

set local role service_role;
do $$
declare t record; v_evento uuid; bloqueado boolean; firma jsonb := '[{"nombre":"Firma ficticia","mime":"image/png","base64":"iVBORw0KGgo="}]';
begin
  select * into t from acreditacion_areal_test;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if (select count(*) from public.acreditacion_firmas_usuario(t.a, array[t.firma])) <> 1
    or (select count(*) from public.acreditacion_firmas_usuario(t.b, array[t.firma])) <> 0
    or (select count(*) from public.acreditacion_firmas_usuario(t.distrital, array[t.firma])) <> 0 then raise exception 'Las firmas no están aisladas'; end if;
  bloqueado := false;
  begin perform public.acreditacion_guardar_evento_firmado(null, 'Evento ficticio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', firma, t.b);
  exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se creó un evento sin firma propia'; end if;
  v_evento := public.acreditacion_guardar_evento_firmado(null, 'Evento ficticio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', firma, t.a);
  update acreditacion_areal_test set evento = v_evento;
  perform public.acreditacion_guardar_evento_firmado(v_evento, 'Evento editado', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', null, t.a);
end $$;
reset role;

insert into public.acreditacion_firmas(nombre, mime, contenido, propietario_id)
select 'Firma segunda ficticia', 'image/png', decode('89504e470d0a1a0a', 'hex'), b from acreditacion_areal_test;

set local role service_role;
do $$
declare t record; bloqueado boolean;
begin
  select * into t from acreditacion_areal_test;
  bloqueado := false;
  begin perform public.acreditacion_guardar_evento_firmado(t.evento, 'Cambio indebido', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', null, t.b);
  exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Otro inspector editó el evento'; end if;
  perform public.acreditacion_guardar_evento_firmado(t.evento, 'Cambio distrital', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', null, t.distrital);
end $$;
reset role;

insert into public.acreditacion_eventos(nombre, lugar, fecha, hora_inicio, hora_fin, descripcion, autor_id)
select 'Evento ajeno ficticio', 'Lugar ficticio', '2099-01-02', '10:00', '11:00', 'Prueba', b from acreditacion_areal_test;
update acreditacion_areal_test set ajeno = (select id from public.acreditacion_eventos where nombre = 'Evento ajeno ficticio' and fecha = '2099-01-02');
insert into public.acreditacion_personas(evento_id, nombre, dni, cargo, escuela_id, email)
select evento, 'Persona ficticia', '99999888', 'Docente', escuela, 'ejemplo@abc.gob.ar' from acreditacion_areal_test;

set local role authenticated;
do $$
declare t record; bloqueado boolean;
begin
  select * into t from acreditacion_areal_test;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.a::text, true);
  if (select count(*) from public.acreditacion_eventos where id in (t.evento, t.ajeno)) <> 2 then raise exception 'No se ven todos los eventos'; end if;
  if (select count(*) from public.acreditacion_areal_personas(t.evento) where nombre = 'Persona ficticia' and escuela->>'id' is not null) <> 1 then raise exception 'No se ven acreditados y escuela'; end if;
  perform public.acreditacion_estado_evento(t.evento, 'activo');
  bloqueado := false;
  begin perform public.acreditacion_estado_evento(t.ajeno, 'activo'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se modificó estado de evento ajeno'; end if;
  perform set_config('request.jwt.claim.sub', t.b::text, true);
  bloqueado := false;
  begin perform public.acreditacion_estado_evento(t.evento, 'finalizado'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Otro inspector modificó el evento'; end if;
  perform set_config('request.jwt.claim.sub', t.a::text, true);
  bloqueado := false;
  begin perform public.acreditacion_eliminar_evento(t.evento); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se eliminó evento con acreditados'; end if;
  bloqueado := false;
  begin perform public.acreditacion_progreso_envios(t.evento); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'El inspector accedió a envíos'; end if;
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  bloqueado := false;
  begin perform * from public.acreditacion_areal_personas(t.evento); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Una escuela accedió al listado areal'; end if;
  perform set_config('request.jwt.claim.sub', t.distrital::text, true);
  perform public.simular_iniciar(t.a);
  if public.eff_uid() <> t.a or public.app_role() <> 'areal' then raise exception 'No se inició la simulación'; end if;
  perform public.acreditacion_estado_evento(t.evento, 'finalizado');
  bloqueado := false;
  begin perform public.acreditacion_estado_evento(t.ajeno, 'activo'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'La simulación modificó un evento ajeno'; end if;
  perform public.acreditacion_estado_evento(t.evento, 'activo');
  perform public.simular_salir();
end $$;
reset role;

update public.profiles set active = false where id = (select a from acreditacion_areal_test);
set local role authenticated;
do $$
declare t record; bloqueado boolean := false;
begin
  select * into t from acreditacion_areal_test;
  perform set_config('request.jwt.claim.sub', t.a::text, true);
  begin perform public.acreditacion_estado_evento(t.evento, 'finalizado'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Un usuario inactivo gestionó un evento'; end if;
end $$;
reset role;
update public.profiles set active = true where id = (select a from acreditacion_areal_test);

delete from public.acreditacion_firmas where id = (select firma from acreditacion_areal_test);
set local role authenticated;
do $$
declare t record; bloqueado boolean := false;
begin
  select * into t from acreditacion_areal_test;
  perform set_config('request.jwt.claim.sub', t.a::text, true);
  begin perform public.acreditacion_estado_evento(t.evento, 'finalizado'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se gestionó evento sin firma propia'; end if;
end $$;
reset role;
