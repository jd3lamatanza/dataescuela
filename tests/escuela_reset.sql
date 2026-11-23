-- Ejecutar después de la migración dentro de una transacción revertida.
do $$
declare
  distrital uuid := gen_random_uuid();
  escolar uuid := gen_random_uuid();
  otro_escolar uuid := gen_random_uuid();
  areal uuid := gen_random_uuid();
  sesion uuid := gen_random_uuid();
  escuela_id bigint := -9223372036854775000;
  cue_prueba text := 'test-' || gen_random_uuid()::text;
  rol text;
  rechazado boolean;
begin
  perform public._crear_auth(distrital, distrital::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(escolar, escolar::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(otro_escolar, otro_escolar::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(areal, areal::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role, cue, must_change, created_at) values
    (distrital, distrital::text, 'Distrital prueba', 'distrital', cue_prueba, false, now()),
    (escolar, escolar::text, 'Escolar prueba', 'escolar', cue_prueba, false, now() - interval '1 minute'),
    (otro_escolar, otro_escolar::text, 'Otra cuenta escolar', 'escolar', cue_prueba, false, now()),
    (areal, areal::text, 'Areal prueba', 'areal', cue_prueba, false, now());
  insert into public.escuelas(id, cue) values (escuela_id, cue_prueba);
  insert into auth.sessions(id, user_id) values (sesion, escolar);

  if has_function_privilege('authenticated', 'public._restablecer_usuario(uuid)', 'execute')
    or has_function_privilege('anon', 'public._restablecer_usuario(uuid)', 'execute') then
    raise exception 'La función interna es accesible para clientes';
  end if;
  perform set_config('request.jwt.claim.sub', distrital::text, true);
  perform public.escuela_reset(escuela_id);
  if not exists (select 1 from auth.users where id = escolar and encrypted_password = extensions.crypt('12345678', encrypted_password))
    or not (select must_change from public.profiles where id = escolar)
    or exists (select 1 from auth.sessions where user_id = escolar) then
    raise exception 'No se restableció correctamente la cuenta escolar';
  end if;
  if exists (select 1 from public.profiles where id in (distrital, otro_escolar, areal) and must_change)
    or not exists (select 1 from auth.users where id = otro_escolar and encrypted_password = extensions.crypt('clave-anterior', encrypted_password)) then
    raise exception 'Se modificó otra cuenta';
  end if;
  rechazado := false;
  begin perform public.usuario_reset(escolar);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital puede usar usuario_reset para una cuenta escolar'; end if;

  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set permiso_avanzado = true where id = distrital;
  update public.profiles set must_change = false where id = escolar;
  insert into auth.sessions(id, user_id) values (sesion, escolar);
  perform set_config('request.jwt.claim.sub', distrital::text, true);
  perform public.escuela_reset(escuela_id);
  if not (select must_change from public.profiles where id = escolar)
    or exists (select 1 from auth.sessions where user_id = escolar) then
    raise exception 'Distrital avanzado no puede restablecer la cuenta escolar';
  end if;
  rechazado := false;
  begin perform public.usuario_reset(escolar);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital avanzado puede administrar cuentas escolares'; end if;

  insert into public.simulaciones(actor_id, target_id) values (distrital, areal);
  rechazado := false;
  begin perform public.escuela_reset(escuela_id);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Se permite restablecer durante una simulación'; end if;
  delete from public.simulaciones where actor_id = distrital;

  foreach rol in array array['admin', 'regional', 'areal', 'escolar'] loop
    perform set_config('request.jwt.claim.sub', '', true);
    update public.profiles set role = rol where id = areal;
    perform set_config('request.jwt.claim.sub', areal::text, true);
    rechazado := false;
    begin perform public.escuela_reset(escuela_id);
    exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
    if not rechazado then raise exception 'El rol % puede restablecer una escuela', rol; end if;
  end loop;
end $$;
