-- Ejecutar dentro de una transacción revertida.
do $$
declare usuario uuid; escuela bigint; circuito bigint; rechazado boolean; rol text;
begin
  select p.id into usuario from public.profiles p
    where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1;
  select id into escuela from public.escuelas order by id limit 1;
  if usuario is null or escuela is null then raise exception 'Faltan datos para la prueba'; end if;
  if has_function_privilege('anon', 'public.circuito_guardar(bigint,text)', 'execute')
    or has_function_privilege('anon', 'public.circuito_eliminar(bigint)', 'execute') then
    raise exception 'Un usuario anónimo puede administrar circuitos';
  end if;
  perform set_config('request.jwt.claim.sub', usuario::text, true);
  update public.profiles set role = 'admin', active = true where id = usuario;
  circuito := public.circuito_guardar(null, ' Circuito de prueba ');
  if not exists (select 1 from public.circuitos_electorales where id = circuito and nombre = 'Circuito de prueba' and activo) then
    raise exception 'No se creó el circuito activo';
  end if;
  perform public.circuito_guardar(circuito, 'Circuito actualizado');
  if not exists (select 1 from public.circuitos_electorales where id = circuito and nombre = 'Circuito actualizado') then raise exception 'No se actualizó el nombre'; end if;
  rechazado := false;
  begin perform public.circuito_guardar(null, '  ');
  exception when raise_exception then
    if sqlerrm <> 'Ingresá un nombre de hasta 150 caracteres' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Se permitió un nombre vacío'; end if;
  update public.escuelas set circuito_id = circuito where id = escuela;
  rechazado := false;
  begin perform public.circuito_eliminar(circuito);
  exception when raise_exception then
    if sqlerrm <> 'No se puede eliminar un circuito con escuelas asociadas' then raise; end if;
    rechazado := true;
  end;
  if not rechazado or not exists (select 1 from public.escuelas where id = escuela and circuito_id = circuito) then
    raise exception 'Se permitió eliminar un circuito asociado';
  end if;
  update public.escuelas set circuito_id = null where id = escuela;
  perform public.circuito_eliminar(circuito);
  if exists (select 1 from public.circuitos_electorales where id = circuito) then raise exception 'No se eliminó el circuito'; end if;
  foreach rol in array array['escolar', 'areal', 'distrital', 'regional'] loop
    update public.profiles set role = rol where id = usuario;
    rechazado := false;
    begin perform public.circuito_guardar(null, 'No autorizado');
    exception when raise_exception then
      if sqlerrm <> 'Sin permiso' then raise; end if;
      rechazado := true;
    end;
    if not rechazado then raise exception 'El rol % puede crear circuitos', rol; end if;
    rechazado := false;
    begin perform public.circuito_eliminar(-1);
    exception when raise_exception then
      if sqlerrm <> 'Sin permiso' then raise; end if;
      rechazado := true;
    end;
    if not rechazado then raise exception 'El rol % puede eliminar circuitos', rol; end if;
  end loop;
end $$;
