-- Ejecutar después de 0104 dentro de una transacción revertida.
create temporary table distrital_cuentas_test (
  escuela bigint, distrito uuid, escolar uuid, eav uuid, eoe uuid,
  integrante bigint, sesion uuid, token text
);
grant select, update on distrital_cuentas_test to authenticated;

do $$
declare escuela bigint := -9223372036854775201; cue_prueba text := 'test' || substr(gen_random_uuid()::text, 1, 8);
  distrito uuid := gen_random_uuid(); escolar uuid := gen_random_uuid(); miembro bigint; eav uuid; eoe uuid;
begin
  perform public._crear_auth(distrito, distrito::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(escolar, escolar::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role, active, cue, must_change) values
    (distrito, distrito::text, 'Distrital prueba', 'distrital', true, null, false),
    (escolar, escolar::text, 'Escolar prueba', 'escolar', true, cue_prueba, false);
  insert into public.escuelas(id, cue, nombre) values (escuela, cue_prueba, 'Escuela prueba');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela, (select id from public.catalogos limit 1), 'Integrante prueba') returning id into miembro;
  select id into eav from public.profiles where login = 'eav' || cue_prueba;
  select id into eoe from public.profiles where login = 'eoe' || cue_prueba;
  insert into auth.sessions(id, user_id) values (gen_random_uuid(), escolar), (gen_random_uuid(), eav);
  update auth.users set encrypted_password = extensions.crypt('clave-anterior', extensions.gen_salt('bf')) where id in (eav, eoe);
  update public.profiles set must_change = false where id in (eav, eoe);
  insert into distrital_cuentas_test values (escuela, distrito, escolar, eav, eoe, miembro, gen_random_uuid(), null);
  insert into auth.sessions(id, user_id) select t.sesion, t.eoe from distrital_cuentas_test t;
end $$;

set local role authenticated;
do $$
declare t record; leg uuid; respuesta jsonb; rechazado boolean;
begin
  select * into t from distrital_cuentas_test;
  perform set_config('request.jwt.claim.sub', t.eoe::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.eoe, 'session_id', t.sesion, 'role', 'authenticated')::text, true);
  if public.eoe_pin_guardar(t.integrante, '123456') is not null then raise exception 'No se creó el PIN'; end if;
  leg := public.eoe_legajo_crear('Estudiante prueba', null);
  respuesta := public.eoe_legajo_abrir(leg, t.integrante, '123456');
  update distrital_cuentas_test set token = respuesta->>'token';
  perform public.eoe_pin_solicitar_restablecimiento(t.integrante);
  rechazado := false;
  begin perform public.eoe_pin_blanquear_distrital(t.escuela, t.integrante); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'EOE no debe blanquear PIN'; end if;
  rechazado := false;
  begin perform public.eoe_pin_estado_distrital(array[t.integrante]); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'EOE no debe consultar estado distrital'; end if;
  rechazado := false;
  begin perform public.escuela_reset_cuenta(t.escuela, 'eav'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'EOE no debe restablecer contraseñas'; end if;
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.distrito, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.eoe_pin_estado_distrital(array[t.integrante]) where integrante_id = t.integrante and tiene_pin) then
    raise exception 'Distrital no ve el PIN configurado';
  end if;
  rechazado := false;
  begin perform public.eoe_pin_blanquear_distrital(t.escuela + 1, t.integrante); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'No debe blanquearse con escuela equivocada'; end if;
  perform public.eoe_pin_blanquear_distrital(t.escuela, t.integrante);
  if not exists (select 1 from public.eoe_pin_estado_distrital(array[t.integrante]) where integrante_id = t.integrante and not tiene_pin)
    or exists (select 1 from public.eoe_pin_solicitudes_pendientes() where integrante = 'Integrante prueba' and cue = (select cue from public.escuelas where id = t.escuela)) then
    raise exception 'No se blanqueó el PIN o no se resolvió la solicitud';
  end if;
  perform set_config('request.jwt.claim.sub', t.eoe::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.eoe, 'session_id', t.sesion, 'role', 'authenticated')::text, true);
  rechazado := false;
  begin perform public.eoe_legajo_detalle(leg, t.token); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'El blanqueo debe revocar el acceso al legajo'; end if;
  if public.eoe_pin_guardar(t.integrante, '654321') is not null then raise exception 'Debe poder crearse un PIN nuevo'; end if;
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.distrito, 'role', 'authenticated')::text, true);
  rechazado := false;
  begin perform public.escuela_reset_cuenta(t.escuela, 'distrital'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se aceptó un rol no escolar'; end if;
  perform public.escuela_reset_cuenta(t.escuela, 'eav');
end $$;

reset role;
do $$
declare t record;
begin
  select * into t from distrital_cuentas_test;
  if exists (select 1 from public.profiles where id in (t.escolar, t.eoe) and must_change)
    or not exists (select 1 from auth.sessions where user_id = t.escolar)
    or not exists (select 1 from auth.sessions where user_id = t.eoe) then
    raise exception 'Restablecer EAV no debe afectar las demás cuentas';
  end if;
  insert into public.simulaciones(actor_id, target_id) values (t.distrito, t.eoe);
end $$;
set local role authenticated;
do $$
declare t record; rechazado boolean;
begin
  select * into t from distrital_cuentas_test;
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  rechazado := false;
  begin perform public.escuela_reset_cuenta(t.escuela, 'escolar'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'No debe restablecerse durante una simulación'; end if;
  rechazado := false;
  begin perform public.eoe_pin_blanquear_distrital(t.escuela, t.integrante); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'No debe blanquearse durante una simulación'; end if;
end $$;
reset role;
delete from public.simulaciones where actor_id = (select distrito from distrital_cuentas_test);
set local role authenticated;
do $$
declare t record;
begin
  select * into t from distrital_cuentas_test;
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  perform public.escuela_reset_cuenta(t.escuela, 'escolar');
  perform public.escuela_reset_cuenta(t.escuela, 'eoe');
end $$;

reset role;
do $$
declare t record; uid uuid;
begin
  select * into t from distrital_cuentas_test;
  foreach uid in array array[t.escolar, t.eav, t.eoe] loop
    if not exists (select 1 from auth.users u join public.profiles p on p.id = u.id
      where u.id = uid and u.encrypted_password = extensions.crypt('12345678', u.encrypted_password) and p.must_change)
      or exists (select 1 from auth.sessions s where s.user_id = uid) then
      raise exception 'No se restableció correctamente la cuenta %', uid;
    end if;
  end loop;
  if (select active from public.profiles where id = t.eav) then raise exception 'Restablecer no debe activar EAV'; end if;
  if not exists (select 1 from public.eoe_pin_blanqueos where integrante_id = t.integrante and autor_id = t.distrito) then
    raise exception 'Falta auditoría del blanqueo';
  end if;
end $$;
