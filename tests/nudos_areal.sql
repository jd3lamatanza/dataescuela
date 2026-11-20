-- Ejecutar dentro de una transacción revertida.
do $$
declare usuario uuid; objetivo uuid; rol text; rechazado boolean;
begin
  select p.id into usuario from public.profiles p
    where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1;
  select p.id into objetivo from public.profiles p where p.id <> usuario limit 1;
  if usuario is null or objetivo is null then raise exception 'Faltan perfiles para la prueba'; end if;
  if has_function_privilege('anon', 'public.nudos_escuelas()', 'execute')
    or not has_function_privilege('authenticated', 'public.nudos_escuelas()', 'execute') then
    raise exception 'Permisos de lectura incorrectos';
  end if;
  perform set_config('request.jwt.claim.sub', usuario::text, true);
  foreach rol in array array['areal', 'distrital'] loop
    update public.profiles set role = rol, active = true where id = usuario;
    if exists (
      (select id, nudo_id, clave, tipo, numero, nombre, localidad from public.escuelas
       except select * from public.nudos_escuelas())
      union all
      (select * from public.nudos_escuelas()
       except select id, nudo_id, clave, tipo, numero, nombre, localidad from public.escuelas)
    ) then raise exception 'El rol % no recibió todas las escuelas', rol; end if;
  end loop;
  update public.profiles set role = 'areal' where id = usuario;
  rechazado := false;
  begin perform public.nudo_guardar(null, 'No autorizado');
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Areal puede crear nudos'; end if;
  rechazado := false;
  begin perform public.nudo_eliminar(-1);
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Areal puede eliminar nudos'; end if;
  update public.profiles set role = 'distrital' where id = usuario;
  update public.profiles set role = 'areal', active = true where id = objetivo;
  insert into public.simulaciones (actor_id, target_id) values (usuario, objetivo);
  if (select count(*) from public.nudos_escuelas()) <> (select count(*) from public.escuelas) then
    raise exception 'Ingreso simulado Areal no recibe todas las escuelas';
  end if;
  update public.profiles set role = 'escolar' where id = objetivo;
  rechazado := false;
  begin perform public.nudos_escuelas();
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'El rol escolar puede consultar todas las escuelas'; end if;
  delete from public.simulaciones where actor_id = usuario;
  update public.profiles set role = 'areal', active = false where id = usuario;
  rechazado := false;
  begin perform public.nudos_escuelas();
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Un perfil inactivo puede consultar las escuelas'; end if;
end $$;
