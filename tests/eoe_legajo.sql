-- Ejecutar las migraciones 0096 y 0097 y esta prueba dentro de una transacción revertida.
create temp table eoe_legajo_test (
  escuela_a bigint, escuela_b bigint, cuenta_a uuid, cuenta_b uuid,
  integrante_a bigint, integrante_b bigint, sesion_a uuid, sesion_b uuid,
  legajo uuid, token text
);
grant select, update on eoe_legajo_test to authenticated;

do $$
declare
  escuela_a bigint := -9223372036854775401; escuela_b bigint := -9223372036854775402;
  cue_a text := 'lega' || substr(gen_random_uuid()::text, 1, 8);
  cue_b text := 'legb' || substr(gen_random_uuid()::text, 1, 8);
  cargo bigint := (select id from public.catalogos limit 1);
  miembro_a bigint; miembro_b bigint; cuenta_a uuid; cuenta_b uuid;
  sesion_a uuid := gen_random_uuid(); sesion_b uuid := gen_random_uuid();
begin
  insert into public.escuelas(id, cue, nombre) values (escuela_a, cue_a, 'Escuela A'), (escuela_b, cue_b, 'Escuela B');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_a, cargo, 'Integrante A') returning id into miembro_a;
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_b, cargo, 'Integrante B') returning id into miembro_b;
  select id into cuenta_a from public.profiles where login = 'eoe' || cue_a;
  select id into cuenta_b from public.profiles where login = 'eoe' || cue_b;
  insert into auth.sessions(id, user_id) values (sesion_a, cuenta_a), (sesion_b, cuenta_b);
  insert into eoe_legajo_test values (escuela_a, escuela_b, cuenta_a, cuenta_b, miembro_a, miembro_b, sesion_a, sesion_b, null, null);
end $$;

set local role authenticated;
do $$
declare t record; leg uuid; temporal uuid; token_acceso text; resultado jsonb; bloqueado boolean; detalle jsonb;
begin
  select * into t from eoe_legajo_test;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  if has_table_privilege('authenticated', 'public.eoe_legajos', 'select')
    or has_table_privilege('authenticated', 'public.eoe_legajo_intervenciones', 'select') then
    raise exception 'Los datos del legajo no deben ser consultables directamente';
  end if;
  if public.eoe_pin_guardar(t.integrante_a, '012345') is not null then raise exception 'No se creó el PIN'; end if;
  leg := public.eoe_legajo_crear('Estudiante de prueba', '70000123');
  update eoe_legajo_test set legajo = leg;
  resultado := public.eoe_legajo_abrir(leg, t.integrante_a, '000000');
  if resultado->>'error' is null or resultado->>'token' is not null then raise exception 'Se aceptó un PIN incorrecto'; end if;
  resultado := public.eoe_legajo_abrir(leg, t.integrante_a, '012345');
  token_acceso := resultado->>'token';
  if token_acceso is null then raise exception 'No se abrió el legajo'; end if;
  update eoe_legajo_test set token = token_acceso;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(leg, token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'El token no debe funcionar en otra sesión'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  detalle := public.eoe_legajo_detalle(leg, token_acceso);
  if jsonb_array_length(detalle->'auditoria') <> 2 then raise exception 'No se registraron creación y apertura'; end if;
  if public.eoe_legajo_intervenir(leg, token_acceso, current_date, 'Intervención de prueba', t.integrante_a, '000000') is null then
    raise exception 'No debe firmarse con PIN incorrecto';
  end if;
  if public.eoe_legajo_intervenir(leg, token_acceso, current_date, 'Intervención de prueba', t.integrante_a, '012345') is not null then
    raise exception 'No se firmó la intervención';
  end if;
  detalle := public.eoe_legajo_detalle(leg, token_acceso);
  if jsonb_array_length(detalle->'intervenciones') <> 1
    or detalle->'intervenciones'->0->>'firmante_nombre' <> 'Integrante A' then
    raise exception 'La intervención no conservó la firma';
  end if;
  if public.eoe_pin_guardar(t.integrante_a, '234567', '012345') is not null then raise exception 'No se cambió el PIN'; end if;
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(leg, token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Cambiar el PIN debe revocar el acceso previo'; end if;
  resultado := public.eoe_legajo_abrir(leg, t.integrante_a, '234567');
  token_acceso := resultado->>'token';
  if token_acceso is null then raise exception 'No se abrió el legajo con el PIN nuevo'; end if;
  temporal := public.eoe_legajo_crear('Estudiante sin DNI', null);
  resultado := public.eoe_legajo_abrir(temporal, t.integrante_a, '234567');
  if resultado->>'token' is null then raise exception 'No se abrió el legajo temporal'; end if;
  perform public.eoe_legajo_identificar(temporal, resultado->>'token', '70000124');
  if not exists (select 1 from public.eoe_legajos_listar() where id = temporal and dni = '70000124') then
    raise exception 'No se identificó el legajo temporal';
  end if;
  bloqueado := false;
  begin perform public.eoe_legajo_identificar(temporal, resultado->>'token', '70000125'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe reemplazarse un DNI ya asignado'; end if;
  for i in 1..5 loop
    resultado := public.eoe_legajo_abrir(leg, t.integrante_a, '000000');
    if resultado->>'error' is null then raise exception 'No debe aceptarse un PIN incorrecto'; end if;
  end loop;
  resultado := public.eoe_legajo_abrir(leg, t.integrante_a, '234567');
  if resultado->>'error' not like 'PIN bloqueado%' then raise exception 'La apertura debe respetar el bloqueo por intentos'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.eoe_legajos_listar() where id = leg) then raise exception 'Se mostró el legajo a otra escuela'; end if;
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(leg, token_acceso); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Otra escuela abrió el legajo con el token'; end if;
  bloqueado := false;
  begin perform public.eoe_legajo_crear('Duplicado', '70000123'); exception when unique_violation or raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Se creó un legajo con DNI duplicado'; end if;
end $$;
