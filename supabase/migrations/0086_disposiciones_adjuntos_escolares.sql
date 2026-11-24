create table public.disposicion_adjuntos_escolares (
  archivo_id bigint primary key references public.disposicion_archivos(id) on delete cascade
);
alter table public.disposicion_adjuntos_escolares enable row level security;
revoke all on public.disposicion_adjuntos_escolares from public, anon, authenticated;

insert into public.disposicion_adjuntos_escolares (archivo_id)
select a.id from public.disposicion_archivos a
join public.disposiciones d on d.id = a.disposicion_id
where d.creado_por is null and d.estado = 'Finalizada' and a.mime = 'application/pdf';

create function public.disposicion_adjunto_escolar_visible(p_archivo bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'escolar'
    and public.real_role() in ('escolar', 'distrital')
    and exists (
      select 1 from public.disposicion_adjuntos_escolares e
      join public.disposicion_archivos a on a.id = e.archivo_id
      where e.archivo_id = p_archivo and a.mime = 'application/pdf'
        and public.disposicion_final_visible(a.disposicion_id)
    ), false)
$$;
revoke all on function public.disposicion_adjunto_escolar_visible(bigint) from public, anon;
grant execute on function public.disposicion_adjunto_escolar_visible(bigint) to authenticated;

create policy disposicion_archivos_escolares on public.disposicion_archivos
for select to authenticated using (public.disposicion_adjunto_escolar_visible(id));

update public.ayuda_guias
set secciones = replace(secciones::text,
  'Las probanzas y mensajes del trámite no están disponibles para la escuela. Si una disposición histórica no tiene PDF final, consultá a Jefatura.',
  'Las disposiciones históricas finalizadas muestran los PDF que ya estaban adjuntos. Los demás documentos y mensajes no están disponibles para la escuela.')::jsonb,
  version = version + 1, actualizado = now()
where id = 'disposiciones' and secciones::text like '%Las probanzas y mensajes del trámite no están disponibles para la escuela.%';
