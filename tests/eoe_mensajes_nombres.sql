-- Ejecutar después de 0105 dentro de una transacción revertida.
create temporary table eoe_correo_test (
  escuela_a bigint, escuela_b bigint, cue_a text, cue_b text, eoe_a uuid, eoe_b uuid, eav uuid,
  escolar uuid, areal uuid, regional uuid, distrital uuid, administrador uuid, inactivo uuid, mensaje bigint
);
grant select, update on eoe_correo_test to authenticated;

do $$
declare
  escuela_a bigint := -9223372036854775201; escuela_b bigint := -9223372036854775202;
  cue_a text := 'coea' || substr(gen_random_uuid()::text, 1, 8);
  cue_b text := 'coeb' || substr(gen_random_uuid()::text, 1, 8);
  escolar uuid := gen_random_uuid(); areal uuid := gen_random_uuid(); regional uuid := gen_random_uuid();
  distrital uuid := gen_random_uuid(); administrador uuid := gen_random_uuid(); inactivo uuid := gen_random_uuid();
  eoe_a uuid; eoe_b uuid; eav uuid; uid uuid;
begin
  foreach uid in array array[escolar, areal, regional, distrital, administrador, inactivo] loop
    perform public._crear_auth(uid, uid::text || '@example.invalid', 'clave-anterior');
  end loop;
  insert into public.profiles(id, login, name, role, cue, active) values
    (escolar, escolar::text, 'Escolar de prueba', 'escolar', cue_a, true),
    (areal, areal::text, 'Areal de prueba', 'areal', null, true),
    (regional, regional::text, 'Regional de prueba', 'regional', null, true),
    (distrital, distrital::text, 'Distrital de prueba', 'distrital', null, true),
    (administrador, administrador::text, 'Admin de prueba', 'admin', null, true),
    (inactivo, inactivo::text, 'Inactivo de prueba', 'escolar', cue_b, false);
  insert into public.escuelas(id, cue, clave, nombre, eav) values
    (escuela_a, cue_a, 'CLAVE A', 'Escuela A', 'Sí'), (escuela_b, cue_b, 'CLAVE B', 'Escuela B', 'Sí');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_a, (select id from public.catalogos limit 1), 'Orientación A'),
           (escuela_b, (select id from public.catalogos limit 1), 'Orientación B');
  select id into eoe_a from public.profiles where login = 'eoe' || cue_a;
  select id into eoe_b from public.profiles where login = 'eoe' || cue_b;
  select id into eav from public.profiles where login = 'eav' || cue_b;
  insert into eoe_correo_test values (escuela_a, escuela_b, cue_a, cue_b, eoe_a, eoe_b, eav,
    escolar, areal, regional, distrital, administrador, inactivo, null);
  if (select name from public.profiles where id = eoe_a) <> 'EOE CLAVE A' then raise exception 'Nombre EOE inicial incorrecto'; end if;
  update public.profiles set name = 'Otro nombre' where id = eoe_a;
  if (select name from public.profiles where id = eoe_a) <> 'EOE CLAVE A' then raise exception 'El nombre EOE debe seguir la clave'; end if;
  update public.escuelas set clave = 'CLAVE NUEVA' where id = escuela_a;
  if not exists (select 1 from public.profiles p where p.id = eoe_a and p.name = 'EOE CLAVE NUEVA' and p.login = 'eoe' || cue_a) then
    raise exception 'La clave nueva debe actualizar el nombre, no el usuario';
  end if;
  insert into public.escuelas(id, cue, clave, nombre) values (escuela_a + 1, cue_a, 'CLAVE EXTRA', 'Mismo CUE');
  if (select name from public.profiles where id = eoe_a) <> 'EOE CLAVE EXTRA / CLAVE NUEVA' then
    raise exception 'Deben mostrarse todas las claves del CUE';
  end if;
  update public.escuelas set clave = null where id = escuela_b;
  if (select name from public.profiles where id = eoe_b) <> 'EOE CUE ' || cue_b then
    raise exception 'Falta identificar la cuenta sin clave provincial';
  end if;
  -- La sincronización de cuentas compartidas puede desactivar la cuenta del CUE duplicado.
  update public.profiles set active = true where id = eoe_a;
end $$;
reset role;

-- Una conversación histórica con un administrador nunca autoriza respuestas EOE.
do $$
declare t record; m bigint;
begin
  select * into t from eoe_correo_test;
  insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo)
    values(t.administrador, 'Admin de prueba', t.administrador::text, 'Histórico', 'Contenido') returning id into m;
  insert into public.correo_destinatarios values (m, t.eoe_a::text, 'EOE de prueba');
  insert into public.correo_copias(mensaje_id, buzon, carpeta) values (m, t.eoe_a::text, 'recibidos');
  insert into public.correo_copias(mensaje_id, buzon, carpeta) values (m, t.administrador::text, 'enviados');
  update eoe_correo_test set mensaje = m;
end $$;
set local role authenticated;
do $$
declare t record; draft bigint; rechazado boolean := false;
begin
  select * into t from eoe_correo_test;
  perform set_config('request.jwt.claim.sub', t.eoe_a::text, true);
  draft := public.correo_guardar_borrador(null, 'Respuesta', 'Contenido', array[t.administrador::text], t.mensaje);
  begin perform public.correo_enviar(draft); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'La respuesta histórica permitió enviar al administrador'; end if;
  perform set_config('request.jwt.claim.sub', t.administrador::text, true);
  if exists (select 1 from public.correo_destinos() where buzon = t.eoe_a::text) then raise exception 'Admin no debe contactar EOE'; end if;
  draft := public.correo_guardar_borrador(null, 'Nuevo', 'Contenido', array[t.eoe_a::text], null);
  rechazado := false;
  begin perform public.correo_enviar(draft); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Admin pudo iniciar comunicación con EOE'; end if;
  draft := public.correo_guardar_borrador(null, 'Respuesta', 'Contenido', array[t.eoe_a::text], t.mensaje);
  rechazado := false;
  begin perform public.correo_enviar(draft); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Admin pudo responder a EOE'; end if;
end $$;
reset role;

-- La bandeja anterior y la actual mantienen la comunicación admin-regional.
insert into public.push_suscripciones(user_id, endpoint)
select u.id, 'https://fcm.googleapis.com/fcm/send/test-eoe-' || u.id::text
from eoe_correo_test t cross join lateral (values (t.eoe_b), (t.eav), (t.regional), (t.administrador)) u(id);

do $$
declare t record; viejo bigint; moderno bigint;
begin
  select * into t from eoe_correo_test;
  insert into public.messages(from_user_id, to_user_id, subject, body)
    values(t.administrador, t.regional, 'Correo anterior', 'Contenido') returning id into viejo;
  select id into moderno from public.correo_mensajes where antiguo_id = viejo;
  if moderno is null or not exists (select 1 from public.correo_copias where mensaje_id = moderno and buzon = t.regional::text and carpeta = 'recibidos') then
    raise exception 'El correo anterior no llegó a la bandeja moderna';
  end if;
  update public.messages set read_at = now() where id = viejo;
  if not exists (select 1 from public.correo_copias where mensaje_id = moderno and buzon = t.regional::text and leido_en is not null) then
    raise exception 'No se sincronizó la lectura anterior';
  end if;
end $$;
set local role authenticated;
do $$
declare t record; draft bigint; msg bigint; detalle jsonb;
begin
  select * into t from eoe_correo_test;
  perform set_config('request.jwt.claim.sub', t.regional::text, true);
  if not exists (select 1 from public.correo_destinos() where buzon = t.administrador::text) then raise exception 'Regional perdió el contacto con admin'; end if;
  draft := public.correo_guardar_borrador(null, 'Regional a admin', 'Contenido', array[t.administrador::text], null);
  msg := public.correo_enviar(draft);
  perform set_config('request.jwt.claim.sub', t.administrador::text, true);
  detalle := public.correo_detalle(msg, 'recibidos');
  if detalle->>'asunto' <> 'Regional a admin' then raise exception 'Admin no recibió el mensaje de regional'; end if;
  draft := public.correo_guardar_borrador(null, 'Admin a regional', 'Contenido', array[t.regional::text], msg);
  msg := public.correo_enviar(draft);
  perform set_config('request.jwt.claim.sub', t.regional::text, true);
  detalle := public.correo_detalle(msg, 'recibidos');
  if detalle->>'asunto' <> 'Admin a regional' then raise exception 'Regional no recibió la respuesta de admin'; end if;
end $$;
reset role;
set local role authenticated;
do $$
declare t record; destino text; draft bigint; msg bigint; respuesta bigint; detalle jsonb; rechazado boolean;
begin
  select * into t from eoe_correo_test;
  perform set_config('request.jwt.claim.sub', t.eoe_a::text, true);
  foreach destino in array array['jd3', t.escolar::text, t.areal::text, t.regional::text, t.eav::text, t.eoe_b::text] loop
    if not exists (select 1 from public.correo_destinos() where buzon = destino) then raise exception 'Falta un destino EOE: %', destino; end if;
  end loop;
  if exists (select 1 from public.correo_destinos() where buzon in (t.administrador::text, t.inactivo::text, t.eoe_a::text, t.distrital::text)) then
    raise exception 'Se mostró admin, usuario inactivo, cuenta propia o buzón distrital individual';
  end if;
  draft := public.correo_guardar_borrador(null, 'Prueba', 'Contenido', array[t.administrador::text], null);
  rechazado := false;
  begin perform public.correo_enviar(draft); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'EOE no debe enviar al administrador'; end if;
  draft := public.correo_guardar_borrador(null, 'Prueba EOE', 'Contenido', array['jd3', t.escolar::text, t.areal::text, t.regional::text, t.eav::text, t.eoe_b::text], null);
  msg := public.correo_enviar(draft);
  update eoe_correo_test set mensaje = msg;
  foreach destino in array array[t.escolar::text, t.areal::text, t.regional::text, t.eav::text, t.eoe_b::text, t.distrital::text] loop
    perform set_config('request.jwt.claim.sub', destino, true);
    detalle := public.correo_detalle(msg, 'recibidos');
    if detalle->>'autor' <> 'EOE CLAVE EXTRA / CLAVE NUEVA' then raise exception 'No se recibió el mensaje EOE'; end if;
    if not exists (select 1 from public.correo_destinos() where buzon = t.eoe_a::text) then raise exception 'El receptor no puede encontrar al EOE'; end if;
    draft := public.correo_guardar_borrador(null, 'Respuesta', 'Contenido', array[t.eoe_a::text], msg);
    respuesta := public.correo_enviar(draft);
    perform set_config('request.jwt.claim.sub', t.eoe_a::text, true);
    detalle := public.correo_detalle(respuesta, 'recibidos');
    if detalle->>'asunto' <> 'Respuesta' then raise exception 'EOE no recibió la respuesta'; end if;
  end loop;
end $$;
reset role;
do $$
declare t record;
begin
  select * into t from eoe_correo_test;
  if (select count(*) from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = t.mensaje and s.user_id in (t.eoe_b, t.eav, t.regional)) <> 3 then
    raise exception 'Faltan avisos push de los destinatarios EOE, EAV o Regional';
  end if;
  if exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      where c.origen = 'correo' and c.evento_id = t.mensaje and s.user_id = t.administrador) then
    raise exception 'Se avisó a un administrador no destinatario';
  end if;
  if not exists (select 1 from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
      join public.correo_mensajes m on m.id = c.evento_id
      where c.origen = 'correo' and m.asunto = 'Regional a admin' and s.user_id = t.administrador) then
    raise exception 'Admin no recibió el aviso del mensaje regional';
  end if;
end $$;
do $$
declare t record;
begin
  select * into t from eoe_correo_test;
  update public.escuelas set cue = t.cue_b where id = t.escuela_a + 1;
  if (select name from public.profiles where id = t.eoe_a) <> 'EOE CLAVE NUEVA'
     or (select name from public.profiles where id = t.eoe_b) <> 'EOE CLAVE EXTRA' then
    raise exception 'Cambiar CUE no actualizó ambos nombres EOE';
  end if;
end $$;
