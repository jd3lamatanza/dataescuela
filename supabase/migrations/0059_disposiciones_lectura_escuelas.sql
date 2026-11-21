drop policy disposiciones_lectura on public.disposiciones;
create policy disposiciones_lectura on public.disposiciones for select to authenticated using (
  public.disposiciones_permitido()
  or (
    public.app_role() in ('areal', 'escolar')
    and (public.real_role() = public.app_role() or public.real_role() = 'distrital')
    and public.can_see_escuela(escuela_cubrir_id)
  )
);

drop policy disposicion_archivos_lectura on public.disposicion_archivos;
create policy disposicion_archivos_lectura on public.disposicion_archivos for select to authenticated using (
  exists (select 1 from public.disposiciones d where d.id = disposicion_archivos.disposicion_id)
);
