-- Lectura del listado sin ampliar el acceso a las fichas escolares.
create function public.circuitos_escuelas()
returns table (id bigint, circuito_id bigint, clave text, tipo text, numero integer, nombre text, localidad text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.app_role(), '') not in ('admin', 'distrital', 'areal')
    or coalesce(public.real_role(), '') not in ('admin', 'distrital', 'areal') then
    raise exception 'Sin permiso';
  end if;
  return query select e.id, e.circuito_id, e.clave, e.tipo, e.numero, e.nombre, e.localidad from public.escuelas e;
end $$;

revoke all on function public.circuitos_escuelas() from public, anon, authenticated;
grant execute on function public.circuitos_escuelas() to authenticated;
