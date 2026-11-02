-- La escuela ya no edita lo cargado; el rol areal ve las salidas de sus escuelas asignadas (solo lectura).
drop function if exists public.salida_editar(bigint, text, date, text, text);

drop policy if exists salidas_sel on public.salidas;
create policy salidas_sel on public.salidas for select to authenticated using (
  public.app_role() in ('admin','regional','distrital')
  or (public.app_role() = 'escolar' and user_id = public.eff_uid())
  or (public.app_role() = 'areal' and clave = any (public.claves_asignadas())));
