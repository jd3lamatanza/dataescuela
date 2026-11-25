create function public.simulables_filtrar(q text, p_rol text)
returns table (id uuid, name text, login text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.tiene_permiso_avanzado(), false) then raise exception 'Sin permiso'; end if;
  if p_rol is null or p_rol not in ('', 'areal', 'escolar', 'eav', 'eoe') then raise exception 'Rol inválido'; end if;
  return query select p.id, p.name, p.login, p.role from public.profiles p
    where p.active and p.role in ('areal', 'escolar', 'eav', 'eoe')
      and (p_rol = '' or p.role = p_rol)
      and (coalesce(q, '') = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
    order by p.name, p.id limit 30;
end $$;
revoke all on function public.simulables_filtrar(text, text) from public, anon;
grant execute on function public.simulables_filtrar(text, text) to authenticated;

create or replace function public.simulables(q text default '') returns table (id uuid, name text, login text, role text)
language sql stable security definer set search_path = public as $$
  select * from public.simulables_filtrar(q, '')
$$;

create or replace function public.simular_iniciar(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare iid bigint;
begin
  if not coalesce(public.tiene_permiso_avanzado(), false) then raise exception 'Sin permiso'; end if;
  if exists (select 1 from public.simulaciones where actor_id = auth.uid()) then raise exception 'Ya hay un ingreso simulado activo'; end if;
  if not exists (select 1 from public.profiles where id = target and active and role in ('areal', 'escolar', 'eav', 'eoe')) then
    raise exception 'Usuario no disponible para ingreso simulado';
  end if;
  insert into public.impersonaciones (actor_id, target_id) values (auth.uid(), target) returning id into iid;
  insert into public.simulaciones (actor_id, target_id, imp_id) values (auth.uid(), target, iid);
end $$;
