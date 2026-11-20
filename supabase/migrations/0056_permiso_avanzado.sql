alter table public.profiles add column permiso_avanzado boolean not null default false;
alter table public.profiles add constraint profiles_permiso_avanzado_distrital
  check (not permiso_avanzado or role = 'distrital');

create function public.tiene_permiso_avanzado() returns boolean
language sql stable security definer set search_path = public as $$
  select public.real_role() = 'distrital' and public.app_role() = 'distrital'
    and public.eff_uid() = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.permiso_avanzado)
$$;

create function public.validar_permiso_avanzado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.permiso_avanzado is distinct from old.permiso_avanzado and auth.uid() is not null then
    if old.id = auth.uid() or old.id = public.eff_uid()
      or not (coalesce(public.real_role() = 'admin' and public.app_role() = 'admin', false)
        or coalesce(public.tiene_permiso_avanzado(), false)) then
      raise exception 'Sin permiso para modificar el permiso avanzado';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_validar_permiso_avanzado before update of permiso_avanzado on public.profiles
  for each row execute function public.validar_permiso_avanzado();

create function public.usuario_permiso_avanzado(p_id uuid, p_valor boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or p_valor is null or p_id = auth.uid() or p_id = public.eff_uid()
    or not (coalesce(public.real_role() = 'admin' and public.app_role() = 'admin', false)
      or coalesce(public.tiene_permiso_avanzado(), false)) then
    raise exception 'Sin permiso para modificar el permiso avanzado';
  end if;
  update public.profiles set permiso_avanzado = p_valor where id = p_id and role = 'distrital';
  if not found then raise exception 'Usuario distrital inexistente'; end if;
end $$;
revoke all on function public.usuario_permiso_avanzado(uuid, boolean) from public, anon, authenticated;
grant execute on function public.usuario_permiso_avanzado(uuid, boolean) to authenticated;

create or replace function public._puede_gestionar(target_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.real_role() = 'admin' and public.app_role() = 'admin')
    or (public.tiene_permiso_avanzado() and target_role = 'distrital'), false)
$$;

drop function public.usuarios_listar(text, text, text, integer, integer);
create function public.usuarios_listar(q text default '', rol text default '', estado text default '', lim integer default 15, off integer default 0)
returns table (id uuid, login text, name text, role text, active boolean, must_change boolean, email text, permiso_avanzado boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(public.real_role() = 'admin' and public.app_role() = 'admin', false)
    or coalesce(public.tiene_permiso_avanzado(), false)) then raise exception 'Sin permiso'; end if;
  return query
    select p.id, p.login, p.name, p.role, p.active, p.must_change, p.email, p.permiso_avanzado, count(*) over ()
    from public.profiles p
    where (public.real_role() = 'admin' or p.role = 'distrital')
      and (rol = '' or p.role = rol)
      and (estado = '' or (estado = 'act' and p.active) or (estado = 'blk' and not p.active))
      and (q = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
    order by p.role, lower(p.name) limit lim offset off;
end $$;
revoke all on function public.usuarios_listar(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.usuarios_listar(text, text, text, integer, integer) to authenticated;

create or replace function public.usuario_crear(p_name text, p_login text, p_role text, p_pass text, p_cue text default null, p_email text default null) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text; v_email text := nullif(lower(trim(p_email)), '');
begin
  if not (coalesce(public.real_role() = 'admin' and public.app_role() = 'admin', false)
    or (coalesce(public.tiene_permiso_avanzado(), false) and p_role = 'distrital')) then raise exception 'Sin permiso'; end if;
  if length(trim(p_name)) < 3 or length(trim(p_login)) < 3 or length(p_pass) < 8 then raise exception 'Datos inválidos'; end if;
  if p_role not in ('admin','regional','distrital','areal','escolar') then raise exception 'Rol inválido'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'El correo no es válido';
  end if;
  if exists (select 1 from public.profiles where lower(login) = lower(trim(p_login))) then raise exception 'El usuario ya existe'; end if;
  em := public.auth_email(trim(p_login));
  perform public._crear_auth(uid, em, p_pass);
  insert into public.profiles (id, login, name, role, cue, must_change, email) values (uid, trim(p_login), trim(p_name), p_role, p_cue, true, v_email);
  return uid;
end $$;

create or replace function public.simular_iniciar(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare iid bigint;
begin
  if not coalesce(public.tiene_permiso_avanzado(), false) then raise exception 'Sin permiso'; end if;
  if exists (select 1 from public.simulaciones where actor_id = auth.uid()) then raise exception 'Ya hay un ingreso simulado activo'; end if;
  if not exists (select 1 from public.profiles where id = target and active and role in ('areal','escolar')) then
    raise exception 'Usuario no disponible para ingreso simulado';
  end if;
  insert into public.impersonaciones (actor_id, target_id) values (auth.uid(), target) returning id into iid;
  insert into public.simulaciones (actor_id, target_id, imp_id) values (auth.uid(), target, iid);
end $$;

create or replace function public.simulables(q text default '') returns table (id uuid, name text, login text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.tiene_permiso_avanzado(), false) then raise exception 'Sin permiso'; end if;
  return query select p.id, p.name, p.login, p.role from public.profiles p
    where p.active and p.role in ('areal','escolar')
      and (q = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
    order by p.name limit 30;
end $$;

drop policy configuracion_email_distrital_select on public.configuracion_email;
drop policy configuracion_email_distrital_insert on public.configuracion_email;
drop policy configuracion_email_distrital_update on public.configuracion_email;
create policy configuracion_email_distrital_select on public.configuracion_email for select to authenticated using (public.tiene_permiso_avanzado());
create policy configuracion_email_distrital_insert on public.configuracion_email for insert to authenticated with check (public.tiene_permiso_avanzado());
create policy configuracion_email_distrital_update on public.configuracion_email for update to authenticated using (public.tiene_permiso_avanzado()) with check (public.tiene_permiso_avanzado());
