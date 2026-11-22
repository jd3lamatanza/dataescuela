-- Ejecutar después de la migración dentro de una transacción revertida.
create temporary table push_test as
select (select id from public.profiles p where p.active and not exists
  (select 1 from public.simulaciones s where s.actor_id = p.id) order by id limit 1) a,
  (select id from public.profiles p where p.active and not exists
  (select 1 from public.simulaciones s where s.actor_id = p.id) order by id offset 1 limit 1) b;
grant select on push_test to authenticated;

select set_config('request.jwt.claim.sub', (select a::text from push_test), true);
set local role authenticated;
select public.push_registrar('https://fcm.googleapis.com/fcm/send/prueba-compartida');
select public.push_registrar('https://updates.push.services.mozilla.com/wpush/v2/prueba');
do $$ begin
  if not public.push_estado('https://fcm.googleapis.com/fcm/send/prueba-compartida') then raise exception 'Falta suscripción propia'; end if;
  begin
    perform public.push_registrar('https://fcm.googleapis.com.ejemplo.test/ataque');
    raise exception 'Se aceptó un destino externo';
  exception when raise_exception then
    if sqlerrm = 'Se aceptó un destino externo' then raise; end if;
  end;
  begin
    perform count(*) from public.push_cola;
    raise exception 'Se permitió leer la cola';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select vault.create_secret('secreto-ficticio', 'dataescuela_push_dispatch');
select vault.create_secret('https://example.test', 'dataescuela_push_url');
select public.push_programar();
do $$ begin
  if not exists (select 1 from net.http_request_queue where url = 'https://example.test/functions/v1/push-dispatch'
    and headers->>'x-push-signature' is not null and headers::text not like '%secreto-ficticio%') then
    raise exception 'El despachador no programó una solicitud firmada';
  end if;
end $$;

insert into public.simulaciones(actor_id, target_id) select a, b from push_test;
set local role authenticated;
select public.push_registrar('https://fcm.googleapis.com/fcm/send/prueba-simulacion');
reset role;
do $$ begin
  if not exists (select 1 from public.push_suscripciones where user_id = (select a from push_test)
    and endpoint like '%prueba-simulacion') then raise exception 'La simulación registró al usuario equivocado'; end if;
end $$;
delete from public.simulaciones where actor_id = (select a from push_test);

select set_config('request.jwt.claim.sub', (select b::text from push_test), true);
set local role authenticated;
do $$ begin
  if public.push_estado('https://fcm.googleapis.com/fcm/send/prueba-compartida') then raise exception 'Una cuenta vio una suscripción ajena'; end if;
end $$;
select public.push_registrar('https://fcm.googleapis.com/fcm/send/prueba-compartida');
reset role;
insert into public.notifications(user_id, title) select a, 'Prueba' from push_test;
insert into public.notifications(user_id, title) select b, 'Prueba' from push_test;
do $$
declare reserva uuid := 'de000000-0000-4000-8000-000000000001'; fila record; pendientes integer;
begin
  if (select count(*) from public.push_cola) <> 4 then raise exception 'No se encoló cada dispositivo'; end if;
  if (select count(*) from public.push_tomar(reserva)) <> 4 then raise exception 'No se reservaron los avisos'; end if;
  if exists (select 1 from public.push_tomar('de000000-0000-4000-8000-000000000002')) then raise exception 'Se reservó dos veces'; end if;
  select c.id into fila from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
    where s.endpoint like '%wpush/v2/prueba';
  perform public.push_finalizar(fila.id, reserva, 'reintentar', 503);
  if not exists (select 1 from public.push_cola c where c.id = fila.id and c.ultimo_error = 503 and c.siguiente > now() and c.reserva is null)
    then raise exception 'No se programó el reintento'; end if;
  select c.id into fila from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
    where s.endpoint like '%prueba-simulacion';
  perform public.push_finalizar(fila.id, reserva, 'enviado', 201);
  if exists (select 1 from public.push_cola where id = fila.id) then raise exception 'No se confirmó el envío'; end if;
  select c.id into fila from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
    where s.endpoint like '%prueba-compartida' limit 1;
  perform public.push_finalizar(fila.id, reserva, 'vencido', 410);
  select count(*) into pendientes from public.push_suscripciones where endpoint like '%prueba-compartida';
  if pendientes <> 0 then raise exception 'No se eliminaron las suscripciones vencidas'; end if;
end $$;
