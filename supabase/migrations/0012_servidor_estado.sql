-- Estado del servidor para el panel distrital
create or replace function public.servidor_estado() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' and public.app_role() is distinct from 'admin' then
    raise exception 'Sin permiso';
  end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'conexiones', (select count(*) from pg_stat_activity where datname = current_database()),
    'max_conexiones', current_setting('max_connections')::int,
    'usuarios', (select count(*) from public.profiles)
  );
end $$;

revoke all on function public.servidor_estado() from anon, public;
grant execute on function public.servidor_estado() to authenticated;
