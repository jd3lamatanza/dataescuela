-- Lectura del listado territorial sin ampliar el acceso a la ficha de escuelas.
create function public.nudos_escuelas()
returns table (id bigint, nudo_id bigint, clave text, tipo text, numero integer, nombre text, localidad text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.app_role(), '') not in ('distrital', 'areal')
    or coalesce(public.real_role(), '') not in ('distrital', 'areal') then
    raise exception 'Sin permiso';
  end if;
  return query select e.id, e.nudo_id, e.clave, e.tipo, e.numero, e.nombre, e.localidad from public.escuelas e;
end $$;

revoke all on function public.nudos_escuelas() from public, anon, authenticated;
grant execute on function public.nudos_escuelas() to authenticated;
