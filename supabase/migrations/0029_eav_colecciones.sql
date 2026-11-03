-- Escuela de Verano: colecciones de datos (cargos y predios) gestionadas por el distrito
create policy catalogos_eav_dist on public.catalogos for all to authenticated
  using (public.app_role() = 'distrital' and coleccion in ('eav_cargo', 'eav_predio'))
  with check (public.app_role() = 'distrital' and coleccion in ('eav_cargo', 'eav_predio'));
