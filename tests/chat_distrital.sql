-- Ejecutar dentro de una transacción revertida.
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); escolar uuid := gen_random_uuid();
  solicitud uuid := gen_random_uuid(); uno bigint; dos bigint; limite bigint; rechazado boolean;
begin
  perform public._crear_auth(a, a::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(b, b::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(c, c::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(escolar, escolar::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role) values
    (a, a::text, 'Chat A', 'distrital'), (b, b::text, 'Chat B', 'distrital'),
    (c, c::text, 'Chat C', 'distrital'), (escolar, escolar::text, 'Chat escolar', 'escolar');
  perform set_config('request.jwt.claim.sub', a::text, true);
  if exists (select 1 from public.chat_distrital_contactos() where id = escolar or id = a)
    or not exists (select 1 from public.chat_distrital_contactos() where id = b) then raise exception 'Contactos incorrectos'; end if;
  uno := public.chat_distrital_enviar(b, ' Primer mensaje ', solicitud);
  if uno <> public.chat_distrital_enviar(b, 'Primer mensaje', solicitud) then raise exception 'Reintento duplicó mensaje'; end if;
  rechazado := false;
  begin perform public.chat_distrital_enviar(c, 'Otro mensaje', solicitud);
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Solicitud reutilizada indebidamente'; end if;
  rechazado := false;
  begin perform public.chat_distrital_enviar(escolar, 'No permitido', gen_random_uuid());
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se pudo enviar a escolar'; end if;
  dos := public.chat_distrital_enviar(b, 'Segundo mensaje', gen_random_uuid());
  perform set_config('request.jwt.claim.sub', b::text, true);
  if (select no_leidos from public.chat_distrital_contactos() where id = a) <> 2 then raise exception 'Conteo incorrecto'; end if;
  perform public.chat_distrital_leer(a, uno);
  if (select no_leidos from public.chat_distrital_contactos() where id = a) <> 1 then raise exception 'Lectura afectó mensajes posteriores'; end if;
  if (select count(*) from public.chat_distrital_historial(a, dos)) <> 1 then raise exception 'Paginación incorrecta'; end if;
  insert into public.chat_distrital_mensajes(solicitud, autor_id, destinatario_id, texto)
    select gen_random_uuid(), a, b, 'Mensaje ' || n from generate_series(1, 55) n;
  if (select count(*) from public.chat_distrital_historial(a)) <> 51 then raise exception 'Página inicial incorrecta'; end if;
  select id into limite from public.chat_distrital_historial(a) order by id desc offset 49 limit 1;
  if (select count(*) from public.chat_distrital_historial(a, limite)) <> 7 then raise exception 'Mensajes anteriores incompletos'; end if;
  perform set_config('request.jwt.claim.sub', c::text, true);
  if exists (select 1 from public.chat_distrital_historial(a)) then raise exception 'Usuario ajeno leyó conversación'; end if;
  perform set_config('request.jwt.claim.sub', escolar::text, true);
  rechazado := false;
  begin perform public.chat_distrital_contactos(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Escolar accedió a contactos'; end if;
  perform set_config('request.jwt.claim.sub', a::text, true);
  insert into public.simulaciones(actor_id, target_id) values (a, escolar);
  rechazado := false;
  begin perform public.chat_distrital_enviar(b, 'No permitido', gen_random_uuid()); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se pudo escribir durante simulación'; end if;
  update public.simulaciones set target_id = b where actor_id = a;
  rechazado := false;
  begin perform public.chat_distrital_contactos(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se accedió durante simulación de otro distrital'; end if;
  delete from public.simulaciones where actor_id = a;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set active = false where id = b;
  perform set_config('request.jwt.claim.sub', a::text, true);
  rechazado := false;
  begin perform public.chat_distrital_enviar(b, 'No permitido', gen_random_uuid()); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se pudo enviar a una cuenta inactiva'; end if;
end $$;

select set_config('request.jwt.claim.sub', '', true);
create temporary table chat_test_ids as
  select gen_random_uuid() a, gen_random_uuid() b, gen_random_uuid() c;
grant select on chat_test_ids to authenticated;
select public._crear_auth(a, a::text || '@example.invalid', 'clave-anterior') from chat_test_ids;
select public._crear_auth(b, b::text || '@example.invalid', 'clave-anterior') from chat_test_ids;
select public._crear_auth(c, c::text || '@example.invalid', 'clave-anterior') from chat_test_ids;
insert into public.profiles(id, login, name, role)
select a, a::text, 'Chat A', 'distrital' from chat_test_ids union all
select b, b::text, 'Chat B', 'distrital' from chat_test_ids union all
select c, c::text, 'Chat C', 'distrital' from chat_test_ids;
insert into public.chat_distrital_mensajes(solicitud, autor_id, destinatario_id, texto)
select gen_random_uuid(), a, b, 'Mensaje privado' from chat_test_ids;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select c::text from chat_test_ids), true);
do $$
begin
  if exists (select 1 from public.chat_distrital_mensajes) then raise exception 'RLS expone conversación ajena'; end if;
  if has_table_privilege('authenticated', 'public.chat_distrital_mensajes', 'INSERT')
    or has_table_privilege('authenticated', 'public.chat_distrital_mensajes', 'UPDATE')
    or has_table_privilege('authenticated', 'public.chat_distrital_mensajes', 'DELETE') then raise exception 'Se permite modificar mensajes directamente'; end if;
end $$;
select set_config('request.jwt.claim.sub', (select b::text from chat_test_ids), true);
do $$ begin if (select count(*) from public.chat_distrital_mensajes) <> 1 then raise exception 'Destinatario no puede leer su mensaje'; end if; end $$;
reset role;
