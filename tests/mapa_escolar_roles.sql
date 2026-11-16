-- Ejecutar dentro de una transacción que se revierte al finalizar.
do $$
declare
  usuario uuid;
  rol text;
  esperado bigint;
  obtenido bigint;
  bloqueado boolean;
begin
  select p.id into usuario from public.profiles p
  where not exists (select 1 from public.simulaciones s where s.actor_id = p.id)
  limit 1;
  if usuario is null then raise exception 'Se necesita un perfil de prueba'; end if;
  select count(*) into esperado from public.escuelas
    where localidad in ('González Catán', '20 de Junio', 'Virrey del Pino');
  if esperado = 0 then raise exception 'No hay escuelas para probar'; end if;
  if has_function_privilege('anon', 'public.mapa_escolar_escuelas()', 'execute')
    or not has_function_privilege('authenticated', 'public.mapa_escolar_escuelas()', 'execute') then
    raise exception 'Permisos de ejecución incorrectos';
  end if;
  perform set_config('request.jwt.claim.sub', usuario::text, true);
  foreach rol in array array['admin', 'regional', 'distrital', 'areal', 'escolar'] loop
    update public.profiles set role = rol, active = true where id = usuario;
    select count(*) into obtenido from public.mapa_escolar_escuelas();
    if obtenido <> esperado then raise exception 'El rol % recibió % escuelas, se esperaban %', rol, obtenido, esperado; end if;
    if exists (select 1 from public.mapa_escolar_escuelas() where localidad not in ('González Catán', '20 de Junio', 'Virrey del Pino')) then
      raise exception 'El mapa incluye otra localidad';
    end if;
  end loop;
  update public.profiles set active = false where id = usuario;
  bloqueado := false;
  begin
    perform public.mapa_escolar_escuelas();
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    bloqueado := true;
  end;
  if not bloqueado then raise exception 'El perfil inactivo accedió al mapa'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  bloqueado := false;
  begin
    perform public.mapa_escolar_escuelas();
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    bloqueado := true;
  end;
  if not bloqueado then raise exception 'Un perfil inexistente accedió al mapa'; end if;
end $$;
