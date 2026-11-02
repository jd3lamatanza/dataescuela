-- Reemplaza las escuelas asignadas a un inspector (por clave provincial).
create or replace function public.inspector_asignar(p_id bigint, p_claves text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_claves text[];
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from public.inspectores where id = p_id) then raise exception 'Inspector inexistente'; end if;
  select coalesce(array_agg(distinct e.clave order by e.clave), '{}') into v_claves
  from public.escuelas e where e.clave = any (coalesce(p_claves, '{}'));
  update public.inspectores set escuelas_asignadas = v_claves where id = p_id;
end $$;
grant execute on function public.inspector_asignar(bigint, text[]) to authenticated;
