create unique index acreditacion_firma_areal_unica on public.acreditacion_firmas(propietario_id)
  where propietario_id is not null;

create or replace function public.acreditacion_gestion_permitida(p_evento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'distrital'
    or (public.app_role() = 'areal' and public.real_role() in ('areal', 'distrital')
      and exists (select 1 from public.acreditacion_eventos e where e.id = p_evento and e.autor_id = public.eff_uid())
      and exists (select 1 from public.acreditacion_firmas f where f.propietario_id = public.eff_uid())), false)
$$;
