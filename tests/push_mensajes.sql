-- Ejecutar después de la migración dentro de una transacción revertida.
create temporary table push_mensajes_test as
select p.id escolar, i.user_id inspector,
  (select id from public.profiles d where d.role = 'distrital' and d.active
    and not exists (select 1 from public.simulaciones s where s.actor_id = d.id) order by id limit 1) distrito,
  (select id from public.profiles d where d.role = 'distrital' and d.active
    and not exists (select 1 from public.simulaciones s where s.actor_id = d.id) order by id offset 1 limit 1) distrito2,
  (select id from public.profiles d where d.role = 'distrital' and d.active
    and not exists (select 1 from public.simulaciones s where s.actor_id = d.id) order by id offset 2 limit 1) inactivo,
  (select id from public.profiles a where a.role = 'admin' and a.active
    and not exists (select 1 from public.simulaciones s where s.actor_id = a.id) order by id limit 1) admin,
  (select id from public.profiles r where r.role = 'escolar' and r.active and r.id <> p.id order by id limit 1) regional,
  null::bigint correo, null::bigint respuesta
from public.profiles p
join public.escuelas e on e.cue = p.cue
join public.inspectores i on e.clave = any(i.escuelas_asignadas)
join public.profiles a on a.id = i.user_id and a.active and a.role = 'areal'
where p.role = 'escolar' and p.active
  and not exists (select 1 from public.simulaciones s where s.actor_id in (p.id, i.user_id))
limit 1;
grant select, update on push_mensajes_test to authenticated;

do $$ begin
  if not exists (select 1 from push_mensajes_test where escolar is not null and inspector is not null
    and distrito is not null and distrito2 is not null and inactivo is not null and admin is not null and regional is not null)
    then raise exception 'Faltan perfiles para pruebas de mensajes'; end if;
end $$;
update public.profiles set active = false where id = (select inactivo from push_mensajes_test);
update public.profiles set role = 'regional' where id = (select regional from push_mensajes_test);
insert into public.push_suscripciones(user_id, endpoint)
select usuarios.id, 'https://fcm.googleapis.com/fcm/send/test-push-mensajes-' || usuarios.id::text
from push_mensajes_test t
cross join lateral (values (t.escolar), (t.inspector), (t.distrito), (t.distrito2), (t.inactivo), (t.admin), (t.regional)) usuarios(id);
insert into public.push_suscripciones(user_id, endpoint)
select inspector, 'https://fcm.googleapis.com/fcm/send/test-push-mensajes-segundo' from push_mensajes_test;

set local role authenticated;
do $$
declare t record; draft bigint;
begin
  select * into t from push_mensajes_test;
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  draft := public.correo_guardar_borrador(null, 'Prueba push', 'Contenido privado',
    array['jd3', t.inspector::text, t.inspector::text], null);
  update push_mensajes_test set correo = public.correo_enviar(draft);
end $$;
reset role;

do $$
declare t record; id_evento bigint;
begin
  select * into t from push_mensajes_test;
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = t.correo and s.endpoint like '%test-push-mensajes-%' and s.user_id = t.inspector) <> 2
    then raise exception 'El inspector no recibió un aviso por dispositivo'; end if;
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = t.correo and s.endpoint like '%test-push-mensajes-%'
        and s.user_id in (t.distrito, t.distrito2)) <> 2
    then raise exception 'No se avisó a cada destinatario distrital activo'; end if;
  if exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = t.correo and s.endpoint like '%test-push-mensajes-%'
        and s.user_id in (t.escolar, t.inactivo, t.admin, t.regional))
    then raise exception 'Se avisó al remitente o a un destinatario no habilitado'; end if;
  update public.correo_copias set leido_en = now() where mensaje_id = t.correo and carpeta = 'recibidos';
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = t.correo and s.endpoint like '%test-push-mensajes-%') <> 4
    then raise exception 'Se duplicaron avisos al modificar una copia'; end if;
end $$;

set local role authenticated;
do $$
declare t record; draft bigint;
begin
  select * into t from push_mensajes_test;
  perform set_config('request.jwt.claim.sub', t.inspector::text, true);
  draft := public.correo_guardar_borrador(null, 'Respuesta', 'Prueba', array[t.escolar::text], t.correo);
  update push_mensajes_test set respuesta = public.correo_enviar(draft);
end $$;
reset role;
do $$ begin
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = (select respuesta from push_mensajes_test)
        and s.user_id = (select escolar from push_mensajes_test) and s.endpoint like '%test-push-mensajes-%') <> 1
    then raise exception 'La respuesta no avisó a la escuela'; end if;
end $$;

select set_config('request.jwt.claim.sub', (select admin::text from push_mensajes_test), true);
set local role authenticated;
insert into public.messages(id, from_user_id, to_user_id, subject, body)
select -9223372036854775000, admin, regional, 'Prueba', 'Prueba' from push_mensajes_test;
reset role;
insert into public.notifications(id, user_id, title)
select -9223372036854775000, regional, 'Prueba' from push_mensajes_test;
do $$ begin
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.evento_id = -9223372036854775000 and c.origen in ('mensaje', 'notificacion')
        and s.user_id = (select regional from push_mensajes_test) and s.endpoint like '%test-push-mensajes-%') <> 2
    then raise exception 'Colisión entre mensajes antiguos y notificaciones'; end if;
end $$;

insert into public.messages(id, from_user_id, to_user_id, subject, body)
select -9223372036854774999, admin, escolar, 'Prueba', 'Prueba' from push_mensajes_test;
insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo, antiguo_id)
select admin, 'Prueba', admin::text, 'Prueba', 'Prueba', -9223372036854774999 from push_mensajes_test;
insert into public.correo_copias(mensaje_id, buzon, carpeta)
select m.id, t.escolar::text, 'recibidos' from public.correo_mensajes m cross join push_mensajes_test t
where m.antiguo_id = -9223372036854774999;
do $$ begin
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where s.user_id = (select escolar from push_mensajes_test) and s.endpoint like '%test-push-mensajes-%'
        and (c.origen = 'mensaje' and c.evento_id = -9223372036854774999
          or c.origen = 'correo' and c.evento_id = (select id from public.correo_mensajes where antiguo_id = -9223372036854774999))) <> 1
    then raise exception 'La copia de un mensaje antiguo duplicó el aviso'; end if;
end $$;
