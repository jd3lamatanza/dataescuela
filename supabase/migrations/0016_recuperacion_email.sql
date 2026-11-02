alter table public.profiles add column email text;

drop function public.usuarios_listar(text, text, text, integer, integer);
create function public.usuarios_listar(q text default '', rol text default '', estado text default '', lim integer default 15, off integer default 0)
returns table (id uuid, login text, name text, role text, active boolean, must_change boolean, email text, total bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.login, p.name, p.role, p.active, p.must_change, p.email, count(*) over ()
  from public.profiles p
  where public.real_role() in ('admin','distrital')
    and (public.real_role() = 'admin' or p.role in ('areal','escolar'))
    and (rol = '' or p.role = rol)
    and (estado = '' or (estado = 'act' and p.active) or (estado = 'blk' and not p.active))
    and (q = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
  order by p.role, lower(p.name) limit lim offset off
$$;

drop function public.usuario_editar(uuid, text, text);
create function public.usuario_editar(p_id uuid, p_name text, p_login text, p_email text default null) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare r text; v_email text := nullif(lower(trim(p_email)), '');
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) then raise exception 'Sin permiso'; end if;
  if length(trim(p_name)) < 3 or length(trim(p_login)) < 3 then raise exception 'Completá nombre y usuario'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'El correo no es válido';
  end if;
  if exists (select 1 from public.profiles where lower(login) = lower(trim(p_login)) and id <> p_id) then
    raise exception 'Ya existe otro usuario con ese nombre de acceso';
  end if;
  update public.profiles set name = trim(p_name), login = trim(p_login), email = v_email where id = p_id;
  update auth.users set email = public.auth_email(trim(p_login)), updated_at = now() where id = p_id;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', public.auth_email(trim(p_login))), updated_at = now() where user_id = p_id;
end $$;

drop function public.usuario_crear(text, text, text, text, text);
create function public.usuario_crear(p_name text, p_login text, p_role text, p_pass text, p_cue text default null, p_email text default null) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text; v_email text := nullif(lower(trim(p_email)), '');
begin
  if public.real_role() is distinct from 'admin' then raise exception 'Sin permiso'; end if;
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

create table public.password_recovery_attempts (
  id bigint generated always as identity primary key,
  login_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index password_recovery_attempts_created_idx on public.password_recovery_attempts (created_at);
create index password_recovery_attempts_login_created_idx on public.password_recovery_attempts (login_hash, created_at);
create index password_recovery_attempts_ip_created_idx on public.password_recovery_attempts (ip_hash, created_at);
alter table public.password_recovery_attempts enable row level security;

create or replace function public.password_recovery_recipient(p_login text)
returns table (user_id uuid, login text, auth_email text, email text, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.login, public.auth_email(p.login),
    coalesce(
      case p.role
        when 'escolar' then (
          select nullif(lower(trim(e.email)), '') from public.escuelas e
          where e.cue = p.cue and nullif(trim(e.email), '') is not null
          order by e.id limit 1
        )
        when 'areal' then (
          select nullif(lower(trim(i.email)), '') from public.inspectores i
          where i.user_id = p.id and nullif(trim(i.email), '') is not null
          order by i.id limit 1
        )
      end,
      nullif(lower(trim(p.email)), '')
    ),
    p.name
  from public.profiles p
  where lower(p.login) = lower(trim(p_login)) and p.active
  limit 1
$$;

create or replace function public.password_recovery_allow(p_login_hash text, p_ip_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_login_hash, 0));
  if exists (
    select 1 from public.password_recovery_attempts
    where login_hash = p_login_hash and created_at > now() - interval '5 minutes'
  ) or (
    select count(*) from public.password_recovery_attempts
    where ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
  ) >= 10 then
    return false;
  end if;
  delete from public.password_recovery_attempts where created_at < now() - interval '1 day';
  insert into public.password_recovery_attempts (login_hash, ip_hash) values (p_login_hash, p_ip_hash);
  return true;
end $$;

revoke all on function public.password_recovery_allow(text, text) from public, anon, authenticated;
revoke all on function public.password_recovery_recipient(text) from public, anon, authenticated;
grant execute on function public.password_recovery_allow(text, text) to service_role;
grant execute on function public.password_recovery_recipient(text) to service_role;
grant execute on function public.usuarios_listar(text, text, text, integer, integer) to authenticated;
grant execute on function public.usuario_editar(uuid, text, text, text) to authenticated;
grant execute on function public.usuario_crear(text, text, text, text, text, text) to authenticated;
