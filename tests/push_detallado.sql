-- Ejecutar junto con la migración en una transacción revertida.
create temporary table push_detalle_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id limit 1) escolar,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 1 limit 1) areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 2 limit 1) ajeno,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 3 limit 1) distrital,
  gen_random_uuid()::text token, null::bigint salida, null::bigint notif;
grant select, update on push_detalle_test to authenticated;
do $$ begin
  if exists (select 1 from push_detalle_test where escolar is null or areal is null or ajeno is null or distrital is null) then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
update public.profiles set role = 'escolar', active = true, permiso_avanzado = false, cue = 'cue-' || (select token from push_detalle_test) where id = (select escolar from push_detalle_test);
update public.profiles set role = 'areal', active = true, permiso_avanzado = false where id in (select areal from push_detalle_test union all select ajeno from push_detalle_test);
update public.profiles set role = 'distrital', active = true where id = (select distrital from push_detalle_test);
insert into public.escuelas(cue, clave, tipo, numero, nombre)
select 'cue-' || token, 'clave-' || token, 'EP', 999, 'Escuela de prueba' from push_detalle_test;
insert into public.inspectores(user_id,cuil,nombre,escuelas_asignadas)
select areal, 'asignado-' || token, 'Inspector de prueba', array['clave-' || token] from push_detalle_test
union all select ajeno, 'ajeno-' || token, 'Inspector ajeno', array['otra-' || token] from push_detalle_test;
insert into public.push_suscripciones(user_id, endpoint)
select v.id, 'https://fcm.googleapis.com/fcm/send/test-detalle-' || t.token || '-' || v.id
from push_detalle_test t cross join lateral (values (t.escolar), (t.areal), (t.ajeno), (t.distrital)) v(id);

select set_config('request.jwt.claim.sub', (select areal::text from push_detalle_test), true);
set local role authenticated;
do $$
declare t record; pub text; secreto text; rechazado boolean := false;
begin
  select * into t from push_detalle_test;
  pub := translate(rtrim(replace(encode(decode('04' || repeat('01', 64), 'hex'), 'base64'), E'\n', ''), '='), '+/', '-_');
  secreto := translate(rtrim(encode(decode(repeat('02', 16), 'hex'), 'base64'), '='), '+/', '-_');
  perform public.push_registrar_claves('https://fcm.googleapis.com/fcm/send/test-detalle-' || t.token || '-' || t.areal, pub, secreto);
  begin perform public.push_registrar_claves('https://fcm.googleapis.com/fcm/send/test-detalle-' || t.token || '-' || t.areal, 'invalida', secreto);
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Acepta claves inválidas'; end if;
  rechazado := false;
  begin perform * from public.push_suscripciones; exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Las claves son visibles para authenticated'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.push_suscripciones s join push_detalle_test t on t.areal = s.user_id where s.endpoint like '%test-detalle-' || t.token || '%' and s.p256dh is not null and s.auth_key is not null)
    or exists (select 1 from public.push_suscripciones s join push_detalle_test t on t.ajeno = s.user_id where s.endpoint like '%test-detalle-' || t.token || '%' and s.p256dh is not null)
    then raise exception 'Registro de claves no está aislado por usuario'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select escolar::text from push_detalle_test), true);
set local role authenticated;
update push_detalle_test set salida = public.salida_crear('Salida de prueba', '2026-12-01', 'Museo', null, false);
reset role;
do $$ declare t record; begin
  select * into t from push_detalle_test;
  if (select count(*) from public.notifications where user_id in (t.areal, t.distrital) and title = 'Nueva salida educativa de EP 999 Escuela de prueba') <> 2 then
    raise exception 'No se avisó al areal asignado y al distrital';
  end if;
  if exists (select 1 from public.notifications where user_id in (t.escolar, t.ajeno) and title = 'Nueva salida educativa de EP 999 Escuela de prueba') then
    raise exception 'Se avisó a la escuela o al inspector ajeno';
  end if;
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
    join public.notifications n on n.id = c.evento_id and c.origen = 'notificacion'
    where s.endpoint like '%test-detalle-' || t.token || '%' and n.title = 'Nueva salida educativa de EP 999 Escuela de prueba'
      and c.titulo = n.title) <> 2 then raise exception 'No se encoló el título de la salida'; end if;
end $$;
insert into public.notifications(user_id, title, body)
select distrital, 'Nueva labor de inspector', 'Inspector Ejemplo: texto privado' from push_detalle_test;
insert into public.notifications(user_id, title, body)
select distrital, 'Nueva contingencia', 'EP 999 Escuela de prueba · motivo privado' from push_detalle_test;
insert into public.notifications(user_id, title, body)
select distrital, 'Directivo de EAV pendiente de aprobación', 'EP 999 Escuela de prueba: nombre privado' from push_detalle_test;
insert into public.notifications(user_id, title, body)
select distrital, 'Estudiante asignado a una escuela destino', 'Nombre privado (DNI privado) fue asignado a Escuela destino' from push_detalle_test;
do $$ begin
  if not exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id join push_detalle_test t on t.distrital = s.user_id
      where s.endpoint like '%test-detalle-' || t.token || '%' and c.titulo = 'Nueva labor de Inspector Ejemplo')
    or not exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id join push_detalle_test t on t.distrital = s.user_id
      where s.endpoint like '%test-detalle-' || t.token || '%' and c.titulo = 'Nueva contingencia de EP 999 Escuela de prueba')
    or not exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id join push_detalle_test t on t.distrital = s.user_id
      where s.endpoint like '%test-detalle-' || t.token || '%' and c.titulo = 'Directivo de EAV pendiente de aprobación de EP 999 Escuela de prueba')
    or not exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id join push_detalle_test t on t.distrital = s.user_id
      where s.endpoint like '%test-detalle-' || t.token || '%' and c.titulo = 'Estudiante asignado a una escuela destino de Escuela destino')
    then raise exception 'El aviso no identifica el tipo o el origen'; end if;
  if exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id join push_detalle_test t on t.distrital = s.user_id
      where s.endpoint like '%test-detalle-' || t.token || '%' and c.titulo like '%privado%')
    then raise exception 'Se incluyeron detalles privados en el título'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select distrital::text from push_detalle_test), true);
insert into public.salidas(user_id, cue, clave, escuela, titulo, fecha, destino, estado_id)
select escolar, 'cue-' || token, 'clave-' || token, 'Importación ' || token, 'Salida importada', '2026-12-01', 'Museo',
  (select id from public.salida_estados where nombre = 'Pendiente')
from push_detalle_test;
do $$ begin
  if exists (select 1 from public.notifications n cross join push_detalle_test t
    where n.title = 'Nueva salida educativa de Importación ' || t.token) then
    raise exception 'La importación administrativa generó alertas';
  end if;
end $$;

insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo)
select escolar, 'Remitente Ejemplo', escolar::text, 'Asunto privado', 'Contenido privado' from push_detalle_test returning id;
insert into public.correo_copias(mensaje_id, buzon, carpeta)
select m.id, t.areal::text, 'recibidos' from public.correo_mensajes m cross join push_detalle_test t
where m.autor_id = t.escolar and m.autor_nombre = 'Remitente Ejemplo' and m.asunto = 'Asunto privado';
do $$ begin
  if not exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id join push_detalle_test t on t.areal = s.user_id
    where s.endpoint like '%test-detalle-' || t.token || '%' and c.origen = 'correo' and c.titulo = 'Nuevo mensaje de Remitente Ejemplo')
    then raise exception 'El mensaje no identifica al remitente'; end if;
end $$;
