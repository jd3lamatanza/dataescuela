-- Ejecutar dentro de una transacción revertida, después de la migración 0096.
create temp table eoe_pin_test (escuela bigint, integrante bigint, cuenta uuid, distrito uuid);
grant select on eoe_pin_test to authenticated;

do $$
declare
  escuela bigint := -9223372036854775301;
  cue_prueba text := 'pin' || substr(gen_random_uuid()::text, 1, 8);
  integrante bigint;
  cuenta uuid;
  distrito uuid;
begin
  select id into distrito from public.profiles
    where role = 'distrital' and active
      and not exists (select 1 from public.simulaciones where actor_id = profiles.id)
    limit 1;
  if distrito is null then raise exception 'Se necesita una cuenta distrital activa'; end if;
  insert into public.escuelas(id, cue, nombre) values (escuela, cue_prueba, 'Escuela de prueba');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela, (select id from public.catalogos limit 1), 'Integrante de prueba') returning id into integrante;
  select id into cuenta from public.profiles where login = 'eoe' || cue_prueba;
  insert into eoe_pin_test values (escuela, integrante, cuenta, distrito);
end $$;

set local role authenticated;
do $$
declare t record; respuesta text; solicitud bigint; otro bigint;
begin
  select * into t from eoe_pin_test;
  perform set_config('request.jwt.claim.sub', t.cuenta::text, true);
  if has_table_privilege('authenticated', 'public.eoe_pines', 'select') then
    raise exception 'Los clientes no deben poder leer los hashes de los PIN';
  end if;
  if public.correo_buzon_actual() <> t.cuenta::text or not exists (select 1 from public.correo_destinos() where buzon = 'jd3') then
    raise exception 'EOE debe poder comunicarse con JD3';
  end if;
  if not exists (select 1 from public.eoe_pin_integrantes() where id = t.integrante and not tiene_pin) then
    raise exception 'No aparece el integrante sin PIN';
  end if;
  if public.eoe_pin_guardar(t.integrante, '012345') is not null then raise exception 'Falló la creación'; end if;
  if public.eoe_pin_guardar(t.integrante, '123456', '012345') is not null then raise exception 'Falló el cambio'; end if;
  for i in 1..5 loop
    respuesta := public.eoe_pin_guardar(t.integrante, '654321', '000000');
    if respuesta is null then raise exception 'Se aceptó un PIN incorrecto'; end if;
  end loop;
  respuesta := public.eoe_pin_guardar(t.integrante, '654321', '123456');
  if respuesta not like 'PIN bloqueado%' then raise exception 'No se bloquearon los intentos'; end if;
  perform public.eoe_pin_solicitar_restablecimiento(t.integrante);
  if not exists (select 1 from public.eoe_pin_integrantes() where id = t.integrante and solicitud_pendiente) then
    raise exception 'No se registró la solicitud';
  end if;
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  if not exists (select 1 from public.correo_destinos() where buzon = t.cuenta::text) then
    raise exception 'JD3 debe poder responder a EOE';
  end if;
  select s.id into solicitud from public.eoe_pin_solicitudes_pendientes() s where s.cue = (select e.cue from public.escuelas e where e.id = t.escuela);
  if solicitud is null then raise exception 'JD3 no ve la solicitud'; end if;
  perform public.eoe_pin_restablecer(solicitud);
  perform set_config('request.jwt.claim.sub', t.cuenta::text, true);
  if public.eoe_pin_guardar(t.integrante, '654321') is not null then raise exception 'Falló la creación después del restablecimiento'; end if;
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (t.escuela, (select id from public.catalogos limit 1), 'Otro integrante') returning id into otro;
  update public.equipo_orientacion set apellido_nombre = 'Otro integrante editado' where id = otro;
  delete from public.equipo_orientacion where id = otro;
  if (select count(*) from public.eoe_equipo_historial_listar() where nombre like 'Otro integrante%') <> 3 then
    raise exception 'El historial debe registrar alta, edición y eliminación';
  end if;
end $$;

reset role;
do $$
declare t record;
begin
  select * into t from eoe_pin_test;
  delete from public.equipo_orientacion where escuela_id = t.escuela;
  if exists (select 1 from public.eoe_pines where integrante_id = t.integrante)
    or not exists (select 1 from public.eoe_equipo_historial where integrante_id = t.integrante and accion = 'eliminacion') then
    raise exception 'La baja debe eliminar el PIN y conservar el historial del integrante';
  end if;
end $$;
