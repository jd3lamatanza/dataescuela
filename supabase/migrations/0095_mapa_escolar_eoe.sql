-- El mapa es una lectura limitada a datos escolares, independiente de las políticas de escuelas.
create or replace function public.mapa_escolar_escuelas()
returns table (
  id bigint, clave text, nombre text, tipo text, numero integer, nivel text,
  modalidad text, localidad text, calle text, nu_calle integer, te text,
  latitud double precision, longitud double precision
)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.app_role(), '') not in ('admin', 'regional', 'distrital', 'areal', 'escolar', 'eoe')
    or coalesce(public.real_role(), '') not in ('admin', 'regional', 'distrital', 'areal', 'escolar', 'eoe') then
    raise exception 'Sin permiso';
  end if;
  return query
    select e.id, e.clave, e.nombre, e.tipo, e.numero, e.nivel, e.modalidad,
      e.localidad, e.calle, e.nu_calle, e.te, e.latitud, e.longitud
    from public.escuelas e
    where e.localidad in ('González Catán', '20 de Junio', 'Virrey del Pino');
end $$;
