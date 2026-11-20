-- Ejecutar dentro de una transacción revertida.
do $$
declare usuario uuid; escuela bigint; nudo bigint; rechazado boolean;
begin
  select p.id into usuario from public.profiles p
    where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1;
  select id into escuela from public.escuelas order by id limit 1;
  if usuario is null or escuela is null then raise exception 'Faltan datos para la prueba'; end if;
  if has_function_privilege('anon', 'public.nudo_guardar(bigint,text)', 'execute')
    or has_function_privilege('anon', 'public.nudo_eliminar(bigint)', 'execute') then
    raise exception 'Un usuario anónimo puede administrar nudos';
  end if;
  perform set_config('request.jwt.claim.sub', usuario::text, true);
  update public.profiles set role = 'distrital', active = true where id = usuario;
  nudo := public.nudo_guardar(null, ' Nudo de prueba ');
  if not exists (select 1 from public.nudos where id = nudo and nombre = 'Nudo de prueba' and activo) then
    raise exception 'No se creó el nudo activo';
  end if;
  perform public.nudo_guardar(nudo, 'Nombre actualizado');
  if not exists (select 1 from public.nudos where id = nudo and nombre = 'Nombre actualizado') then raise exception 'No se actualizó el nombre'; end if;
  rechazado := false;
  begin perform public.nudo_guardar(null, '  ');
  exception when raise_exception then
    if sqlerrm <> 'Ingresá un nombre de hasta 150 caracteres' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Se permitió un nombre vacío'; end if;
  update public.escuelas set nudo_id = nudo where id = escuela;
  rechazado := false;
  begin perform public.nudo_eliminar(nudo);
  exception when raise_exception then
    if sqlerrm <> 'No se puede eliminar un nudo con escuelas asociadas' then raise; end if;
    rechazado := true;
  end;
  if not rechazado or not exists (select 1 from public.escuelas where id = escuela and nudo_id = nudo) then
    raise exception 'Se permitió eliminar un nudo asociado';
  end if;
  update public.escuelas set nudo_id = null where id = escuela;
  perform public.nudo_eliminar(nudo);
  if exists (select 1 from public.nudos where id = nudo) then raise exception 'No se eliminó el nudo'; end if;
  update public.profiles set role = 'escolar' where id = usuario;
  rechazado := false;
  begin perform public.nudo_guardar(null, 'No autorizado');
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Un usuario escolar puede crear nudos'; end if;
  rechazado := false;
  begin perform public.nudo_eliminar(-1);
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Un usuario escolar puede eliminar nudos'; end if;
end $$;
