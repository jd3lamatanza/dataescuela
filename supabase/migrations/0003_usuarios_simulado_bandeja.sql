-- Ingreso simulado, administración de usuarios y bandeja de entrada (RPC security definer)

create table public.simulaciones (
  actor_id uuid primary key references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  imp_id bigint,
  started_at timestamptz not null default now()
);
alter table public.simulaciones enable row level security;

-- Usuario "efectivo": el simulado si el actor está en ingreso simulado; si no, el propio.
create or replace function public.eff_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select target_id from public.simulaciones where actor_id = auth.uid()), auth.uid())
$$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = public.eff_uid() and active
$$;

create or replace function public.app_cue() returns text
language sql stable security definer set search_path = public as $$
  select cue from public.profiles where id = public.eff_uid() and active
$$;

create or replace function public.claves_asignadas() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c), '{}')
  from public.inspectores i, unnest(i.escuelas_asignadas) c
  where i.user_id = public.eff_uid()
$$;

-- Rol real del que inició sesión (ignora la simulación)
create or replace function public.real_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

drop policy profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or id = public.eff_uid() or public.is_admin());
drop policy notif_own on public.notifications;
create policy notif_own on public.notifications for all to authenticated
  using (user_id = public.eff_uid()) with check (user_id = public.eff_uid());
drop policy msg_sel on public.messages;
drop policy msg_ins on public.messages;
drop policy msg_upd on public.messages;
create policy msg_sel on public.messages for select to authenticated
  using (to_user_id = public.eff_uid() or from_user_id = public.eff_uid());
create policy msg_ins on public.messages for insert to authenticated
  with check (from_user_id = public.eff_uid());
create policy msg_upd on public.messages for update to authenticated
  using (to_user_id = public.eff_uid()) with check (to_user_id = public.eff_uid());

-- Perfil efectivo + quién simula (para el banner)
create or replace function public.mi_perfil() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object('simulador', (select a.name from public.simulaciones s join public.profiles a on a.id = s.actor_id where s.actor_id = auth.uid()))
  from public.profiles p where p.id = public.eff_uid() and p.active
$$;

create or replace function public.simular_iniciar(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare iid bigint;
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if exists (select 1 from public.simulaciones where actor_id = auth.uid()) then raise exception 'Ya hay un ingreso simulado activo'; end if;
  if not exists (select 1 from public.profiles where id = target and active and role in ('areal','escolar')) then
    raise exception 'Usuario no disponible para ingreso simulado';
  end if;
  insert into public.impersonaciones (actor_id, target_id) values (auth.uid(), target) returning id into iid;
  insert into public.simulaciones (actor_id, target_id, imp_id) values (auth.uid(), target, iid);
end $$;

create or replace function public.simular_salir() returns void
language plpgsql security definer set search_path = public as $$
declare s public.simulaciones;
begin
  select * into s from public.simulaciones where actor_id = auth.uid();
  if found then
    update public.impersonaciones set ended_at = now() where id = s.imp_id;
    delete from public.simulaciones where actor_id = auth.uid();
  end if;
end $$;

-- Búsqueda de usuarios para ingreso simulado (solo distrital real)
create or replace function public.simulables(q text default '') returns table (id uuid, name text, login text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.login, p.role from public.profiles p
  where public.real_role() = 'distrital' and p.active and p.role in ('areal','escolar')
    and (q = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
  order by p.name limit 30
$$;

-- Administración de usuarios: admin sobre todos; distrital solo areal/escolar
create or replace function public._puede_gestionar(target_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.real_role() when 'admin' then true
    when 'distrital' then target_role in ('areal','escolar') else false end
$$;

create or replace function public.usuarios_listar(q text default '', rol text default '', estado text default '', lim integer default 15, off integer default 0)
returns table (id uuid, login text, name text, role text, active boolean, must_change boolean, total bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.login, p.name, p.role, p.active, p.must_change, count(*) over ()
  from public.profiles p
  where public.real_role() in ('admin','distrital')
    and (public.real_role() = 'admin' or p.role in ('areal','escolar'))
    and (rol = '' or p.role = rol)
    and (estado = '' or (estado = 'act' and p.active) or (estado = 'blk' and not p.active))
    and (q = '' or p.name ilike '%' || q || '%' or p.login ilike '%' || q || '%')
  order by p.role, lower(p.name) limit lim offset off
$$;

create or replace function public._crear_auth(uid uuid, email text, pass text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user,is_anonymous)
  values ('00000000-0000-0000-0000-000000000000',uid,'authenticated','authenticated',email,crypt(pass,gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','','','','',false,false);
  insert into auth.identities (provider_id,user_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
  values (uid::text,uid,jsonb_build_object('sub',uid::text,'email',email,'email_verified',true,'phone_verified',false),'email',now(),now(),now());
end $$;

create or replace function public.usuario_crear(p_name text, p_login text, p_role text, p_pass text, p_cue text default null) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text;
begin
  if public.real_role() is distinct from 'admin' then raise exception 'Sin permiso'; end if;
  if length(trim(p_name)) < 3 or length(trim(p_login)) < 3 or length(p_pass) < 8 then raise exception 'Datos inválidos'; end if;
  if p_role not in ('admin','regional','distrital','areal','escolar') then raise exception 'Rol inválido'; end if;
  if exists (select 1 from public.profiles where lower(login) = lower(trim(p_login))) then raise exception 'El usuario ya existe'; end if;
  em := public.auth_email(trim(p_login));
  perform public._crear_auth(uid, em, p_pass);
  insert into public.profiles (id, login, name, role, cue, must_change) values (uid, trim(p_login), trim(p_name), p_role, p_cue, true);
  return uid;
end $$;

create or replace function public.usuario_editar(p_id uuid, p_name text, p_login text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare r text;
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) then raise exception 'Sin permiso'; end if;
  if length(trim(p_name)) < 3 or length(trim(p_login)) < 3 then raise exception 'Completá nombre y usuario'; end if;
  if exists (select 1 from public.profiles where lower(login) = lower(trim(p_login)) and id <> p_id) then
    raise exception 'Ya existe otro usuario con ese nombre de acceso';
  end if;
  update public.profiles set name = trim(p_name), login = trim(p_login) where id = p_id;
  update auth.users set email = public.auth_email(trim(p_login)), updated_at = now() where id = p_id;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', public.auth_email(trim(p_login))), updated_at = now() where user_id = p_id;
end $$;

create or replace function public.usuario_reset(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare r text;
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) then raise exception 'Sin permiso'; end if;
  update auth.users set encrypted_password = crypt('12345678', gen_salt('bf')), updated_at = now() where id = p_id;
  update public.profiles set must_change = true where id = p_id;
  delete from auth.sessions where user_id = p_id;
end $$;

create or replace function public.usuario_activo(p_id uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare r text;
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) or p_id = auth.uid() then raise exception 'Sin permiso'; end if;
  update public.profiles set active = p_activo where id = p_id;
  if not p_activo then delete from auth.sessions where user_id = p_id; end if;
end $$;

-- Mensajería
create or replace function public.destinatarios() returns table (id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.role from public.profiles p
  where p.active and p.id <> public.eff_uid() and public.eff_uid() is not null
  order by p.name limit 500
$$;

create or replace function public.mensajes_bandeja() returns table (id bigint, from_name text, subject text, body text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, f.name, m.subject, m.body, m.read_at, m.created_at
  from public.messages m join public.profiles f on f.id = m.from_user_id
  where m.to_user_id = public.eff_uid() order by m.id desc limit 50
$$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;

-- Función interna: no ejecutable desde el cliente
revoke execute on function public._crear_auth(uuid, text, text) from authenticated, anon, public;
