-- El distrital administra únicamente cuentas distritales (alta, edición, bloqueo, eliminación).
create or replace function public._puede_gestionar(target_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.real_role() when 'admin' then true
    when 'distrital' then target_role = 'distrital' else false end
$$;

create or replace function public.usuarios_listar(q text default '', rol text default '', estado text default '', lim integer default 15, off integer default 0)
returns table (id uuid, login text, name text, role text, active boolean, must_change boolean, email text, total bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.login, p.name, p.role, p.active, p.must_change, p.email, count(*) over ()
  from public.profiles p
  where public.real_role() in ('admin','distrital')
    and (public.real_role() = 'admin' or p.role = 'distrital')
    and (rol = '' or p.role = rol)
    and (estado = '' or (estado = 'act' and p.active) or (estado = 'blk' and not p.active))
    and (q = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
  order by p.role, lower(p.name) limit lim offset off
$$;

create or replace function public.usuario_crear(p_name text, p_login text, p_role text, p_pass text, p_cue text default null, p_email text default null) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text; v_email text := nullif(lower(trim(p_email)), '');
begin
  if public.real_role() not in ('admin','distrital') then raise exception 'Sin permiso'; end if;
  if public.real_role() = 'distrital' and p_role <> 'distrital' then raise exception 'Sin permiso'; end if;
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

create or replace function public.usuario_eliminar(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare r text;
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) or p_id = auth.uid() or p_id = public.eff_uid() then raise exception 'Sin permiso'; end if;
  begin
    delete from auth.users where id = p_id;
  exception when foreign_key_violation then
    raise exception 'El usuario tiene actividad registrada y no puede eliminarse: bloquealo en su lugar';
  end;
end $$;

revoke all on function public.usuario_eliminar(uuid) from anon, public;
grant execute on function public.usuario_eliminar(uuid) to authenticated;
