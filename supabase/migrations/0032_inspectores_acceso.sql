-- Último acceso de los inspectores (login o renovación de sesión), visible para el distrito
create or replace function public.inspectores_acceso() returns table (user_id uuid, ultimo_acceso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() not in ('admin', 'regional', 'distrital') then raise exception 'Sin permiso'; end if;
  return query
    select i.user_id,
      greatest(u.last_sign_in_at, (select max(coalesce(s.refreshed_at, s.created_at)) from auth.sessions s where s.user_id = u.id))
    from public.inspectores i join auth.users u on u.id = i.user_id;
end $$;
revoke all on function public.inspectores_acceso() from public, anon;
grant execute on function public.inspectores_acceso() to authenticated;
