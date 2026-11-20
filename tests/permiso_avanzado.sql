-- Ejecutar dentro de una transacción revertida.
do $$
declare actor uuid; objetivo uuid; tercero uuid; rechazado boolean;
begin
  select p.id into actor from public.profiles p
    where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1;
  select p.id into objetivo from public.profiles p where p.id <> actor limit 1;
  select p.id into tercero from public.profiles p where p.id not in (actor, objetivo) limit 1;
  if actor is null or objetivo is null or tercero is null then raise exception 'Faltan perfiles para la prueba'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set role = 'distrital', active = true, permiso_avanzado = false where id in (actor, objetivo, tercero);
  perform set_config('request.jwt.claim.sub', actor::text, true);
  if coalesce(public.tiene_permiso_avanzado(), false) or public._puede_gestionar('distrital') then
    raise exception 'Distrital sin permiso puede administrar usuarios';
  end if;
  rechazado := false;
  begin perform public.usuarios_listar();
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede listar usuarios'; end if;
  rechazado := false;
  begin perform public.usuario_crear('Prueba', 'noautorizado', 'distrital', '12345678');
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede crear usuarios'; end if;
  rechazado := false;
  begin perform public.usuario_permiso_avanzado(objetivo, true);
  exception when raise_exception then if sqlerrm <> 'Sin permiso para modificar el permiso avanzado' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede concederlo'; end if;
  rechazado := false;
  begin update public.profiles set permiso_avanzado = true where id = objetivo;
  exception when raise_exception then if sqlerrm <> 'Sin permiso para modificar el permiso avanzado' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede modificar la condición directamente'; end if;
  rechazado := false;
  begin perform public.usuario_editar(objetivo, 'Prueba', 'prueba');
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede editar usuarios'; end if;
  rechazado := false;
  begin perform public.usuario_reset(objetivo);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede restablecer contraseñas'; end if;
  rechazado := false;
  begin perform public.usuario_activo(objetivo, false);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede bloquear usuarios'; end if;
  rechazado := false;
  begin perform public.usuario_eliminar(objetivo);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede eliminar usuarios'; end if;
  rechazado := false;
  begin perform public.simulables();
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede consultar ingreso simulado'; end if;
  rechazado := false;
  begin perform public.simular_iniciar(tercero);
  exception when raise_exception then if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Distrital sin permiso puede iniciar simulación'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set permiso_avanzado = true where id = actor;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  if not public.tiene_permiso_avanzado() or not public._puede_gestionar('distrital') then
    raise exception 'Distrital avanzado no puede administrar';
  end if;
  if not exists (select 1 from public.usuarios_listar() u where u.id = actor and u.permiso_avanzado) then
    raise exception 'Listado no informa el permiso avanzado';
  end if;
  perform public.usuario_permiso_avanzado(objetivo, true);
  if not exists (select 1 from public.profiles where id = objetivo and permiso_avanzado) then raise exception 'No se concedió el permiso'; end if;
  perform public.usuario_permiso_avanzado(objetivo, false);
  if exists (select 1 from public.profiles where id = objetivo and permiso_avanzado) then raise exception 'No se revocó el permiso'; end if;
  rechazado := false;
  begin perform public.usuario_permiso_avanzado(actor, false);
  exception when raise_exception then if sqlerrm <> 'Sin permiso para modificar el permiso avanzado' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Se pudo modificar el permiso propio mediante RPC'; end if;
  rechazado := false;
  begin update public.profiles set permiso_avanzado = false where id = actor;
  exception when raise_exception then if sqlerrm <> 'Sin permiso para modificar el permiso avanzado' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Se pudo modificar el permiso propio directamente'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.profiles set role = 'admin', permiso_avanzado = false where id = actor;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform public.usuario_permiso_avanzado(objetivo, true);
  if not exists (select 1 from public.profiles where id = objetivo and permiso_avanzado) then raise exception 'Admin no puede conceder el permiso'; end if;
end $$;

select set_config('request.jwt.claim.sub', '', true);
create temporary table permiso_test_actor as
  select id from public.profiles where role = 'distrital' limit 1;
grant select on permiso_test_actor to authenticated;
update public.profiles set active = true, permiso_avanzado = false where id = (select id from permiso_test_actor);
insert into public.configuracion_email(id, salidas_destino, sistema_remitente, respuesta, nombre_remitente)
  values (true, 'prueba@example.invalid', 'prueba@example.invalid', 'prueba@example.invalid', 'Prueba')
  on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from permiso_test_actor), true);
do $$
declare cantidad integer;
begin
  if exists (select 1 from public.configuracion_email) then raise exception 'Sin permiso se puede leer configuración'; end if;
  update public.configuracion_email set nombre_remitente = nombre_remitente;
  get diagnostics cantidad = row_count;
  if cantidad <> 0 then raise exception 'Sin permiso se puede editar configuración'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.profiles set permiso_avanzado = true where id = (select id from permiso_test_actor);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from permiso_test_actor), true);
do $$
declare cantidad integer;
begin
  if not exists (select 1 from public.configuracion_email) then raise exception 'Con permiso no se puede leer configuración'; end if;
  update public.configuracion_email set nombre_remitente = nombre_remitente;
  get diagnostics cantidad = row_count;
  if cantidad <> 1 then raise exception 'Con permiso no se puede editar configuración'; end if;
end $$;
reset role;
