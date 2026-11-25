-- Ejecutar después de la migración dentro de una transacción revertida.
do $$
declare
  esc_id bigint := -9223372036854775000;
  cue_prueba text := 'tst' || substr(gen_random_uuid()::text, 1, 8);
  uid_eav uuid; uid_eoe uuid; escolar uuid := gen_random_uuid(); otro uuid := gen_random_uuid(); sesion uuid := gen_random_uuid();
  miembro bigint; datos jsonb; rechazado boolean;
begin
  insert into public.escuelas(id, cue, nombre, eav) values (esc_id, cue_prueba, 'Escuela de prueba', 'No');
  select id into uid_eav from public.profiles where login = 'eav' || cue_prueba;
  select id into uid_eoe from public.profiles where login = 'eoe' || cue_prueba;
  if uid_eav is null or uid_eoe is null then raise exception 'No se crearon las cuentas eav y eoe'; end if;
  if exists (select 1 from public.profiles where id in (uid_eav, uid_eoe) and (active or not must_change or cue <> cue_prueba))
    or (select role from public.profiles where id = uid_eav) <> 'eav' or (select role from public.profiles where id = uid_eoe) <> 'eoe' then
    raise exception 'Estado inicial incorrecto: deben quedar inactivas, con cambio de clave y asociadas a la escuela';
  end if;
  if not exists (select 1 from auth.users where id = uid_eav and email = 'eav' || cue_prueba || '@dataescuela.app'
      and encrypted_password = extensions.crypt('12345678', encrypted_password)) then
    raise exception 'La cuenta no tiene la clave inicial o el usuario esperado';
  end if;

  -- eav: sigue el toggle de Escuela de Verano
  insert into auth.sessions(id, user_id) values (sesion, uid_eav);
  update public.escuelas set eav = 'Sí' where id = esc_id;
  if not (select active from public.profiles where id = uid_eav) or (select active from public.profiles where id = uid_eoe) then
    raise exception 'Activar Escuela de Verano debe activar solo eav';
  end if;
  update public.escuelas set eav = 'No' where id = esc_id;
  if (select active from public.profiles where id = uid_eav) or exists (select 1 from auth.sessions where user_id = uid_eav) then
    raise exception 'Desactivar Escuela de Verano debe bloquear eav y cerrar sus sesiones';
  end if;

  -- eoe: sigue la ficha del equipo de orientación
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre, activo) values (esc_id, (select id from public.catalogos limit 1), 'Integrante de prueba', true) returning id into miembro;
  if not (select active from public.profiles where id = uid_eoe) then raise exception 'Cargar el equipo debe activar eoe'; end if;
  update public.equipo_orientacion set activo = false where id = miembro;
  if (select active from public.profiles where id = uid_eoe) then raise exception 'Sin integrantes activos eoe debe quedar inactivo'; end if;
  update public.equipo_orientacion set activo = true where id = miembro;
  delete from public.equipo_orientacion where id = miembro;
  if (select active from public.profiles where id = uid_eoe) then raise exception 'Borrar el equipo debe desactivar eoe'; end if;
  if exists (select 1 from public.profiles where login = 'eav' || cue_prueba and not role = 'eav') then raise exception 'Rol alterado'; end if;

  -- Datos propios y permisos
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre) values (esc_id, (select id from public.catalogos limit 1), 'Otra persona');
  perform set_config('request.jwt.claim.sub', uid_eoe::text, true);
  datos := public.mi_escuela_cuenta();
  if datos->>'cue' <> cue_prueba or (datos->>'integrantes')::int <> 1 then raise exception 'mi_escuela_cuenta devuelve datos incorrectos'; end if;
  if public.can_see_escuela(esc_id) then raise exception 'eoe no debe usar el acceso de las escuelas'; end if;
  perform set_config('request.jwt.claim.sub', escolar::text, true);
  perform public._crear_auth(escolar, escolar::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role, cue) values (escolar, escolar::text, 'Escolar', 'escolar', cue_prueba);
  rechazado := false;
  begin perform public.mi_escuela_cuenta(); exception when others then rechazado := true; end;
  if not rechazado then raise exception 'mi_escuela_cuenta debe ser solo para eav y eoe'; end if;
  if has_function_privilege('authenticated', 'public._cuentas_escuela_sincronizar(bigint)', 'execute') then raise exception 'Función interna expuesta'; end if;

  -- Un admin no puede activarlas a mano
  perform public._crear_auth(otro, otro::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role) values (otro, otro::text, 'Admin', 'admin');
  perform set_config('request.jwt.claim.sub', otro::text, true);
  rechazado := false;
  begin perform public.usuario_activo(uid_eav, true); exception when others then rechazado := true; end;
  if not rechazado or (select active from public.profiles where id = uid_eav) then raise exception 'El estado manual no debe permitirse'; end if;

  -- Al eliminar la escuela se eliminan sus cuentas
  delete from public.equipo_orientacion q where q.escuela_id = esc_id;
  delete from public.escuelas where id = esc_id;
  if exists (select 1 from public.profiles where id in (uid_eav, uid_eoe)) or exists (select 1 from auth.users where id in (uid_eav, uid_eoe)) then
    raise exception 'Las cuentas deben eliminarse con la escuela';
  end if;
end $$;
