alter table public.acreditacion_firmas add column drive_file_id text unique;
alter table public.acreditacion_firmas alter column contenido drop not null;
alter table public.acreditacion_firmas add constraint acreditacion_firmas_almacenamiento
  check ((contenido is not null) <> (drive_file_id is not null));

revoke select on public.acreditacion_firmas from authenticated;
grant select (id, nombre, mime, creado_en) on public.acreditacion_firmas to authenticated;
revoke execute on function public.acreditacion_guardar_firma(text, text, text), public.acreditacion_eliminar_firma(bigint) from authenticated;

create function public.acreditacion_firmas_datos(p_ids bigint[] default null)
returns table (id bigint, nombre text, mime text, base64 text, drive_file_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  return query select f.id, f.nombre, f.mime, encode(f.contenido, 'base64'), f.drive_file_id
    from public.acreditacion_firmas f
    where p_ids is null or f.id = any(p_ids)
    order by f.id;
end $$;
revoke all on function public.acreditacion_firmas_datos(bigint[]) from public, anon, authenticated;
grant execute on function public.acreditacion_firmas_datos(bigint[]) to service_role;