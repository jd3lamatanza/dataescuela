-- El módulo Inspectores pasa del rol admin al rol distrital.

-- Alta: crea la ficha del inspector y su usuario (rol areal; usuario = CUIL; clave inicial 12345678 a cambiar al ingresar)
create or replace function public.inspector_crear(
  p_nombre text, p_cuil text, p_modalidad bigint, p_situacion text default null, p_cargo text default null,
  p_toma text default null, p_telefono text default null, p_email text default null
) returns bigint
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); v_id bigint; v_cuil text := trim(p_cuil);
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  perform public._inspector_validar(p_nombre, v_cuil, p_modalidad, p_email);
  if exists (select 1 from public.inspectores where cuil = v_cuil) then raise exception 'Ya existe un inspector con ese CUIL'; end if;
  if exists (select 1 from public.profiles where lower(login) = lower(v_cuil)) then raise exception 'Ya existe un usuario con ese CUIL'; end if;
  perform public._crear_auth(uid, public.auth_email(v_cuil), '12345678');
  insert into public.profiles (id, login, name, role, must_change) values (uid, v_cuil, trim(p_nombre), 'areal', true);
  insert into public.inspectores (user_id, nombre, cuil, modalidad_id, nivel_o_modalidad, situacion_revista, cargo_base, fecha_toma_posesion, telefono, email)
  select uid, trim(p_nombre), v_cuil, m.id, m.nombre, nullif(trim(p_situacion), ''), nullif(trim(p_cargo), ''), nullif(trim(p_toma), ''),
         nullif(trim(p_telefono), ''), nullif(lower(trim(p_email)), '')
  from public.modalidades_inspeccion m where m.id = p_modalidad
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.inspector_editar(
  p_id bigint, p_nombre text, p_cuil text, p_modalidad bigint, p_situacion text default null, p_cargo text default null,
  p_toma text default null, p_telefono text default null, p_email text default null
) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_uid uuid; v_cuil text := trim(p_cuil); v_old text;
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select user_id, cuil into v_uid, v_old from public.inspectores where id = p_id;
  if not found then raise exception 'Inspector inexistente'; end if;
  perform public._inspector_validar(p_nombre, v_cuil, p_modalidad, p_email);
  if exists (select 1 from public.inspectores where cuil = v_cuil and id <> p_id) then raise exception 'Ya existe un inspector con ese CUIL'; end if;
  if v_uid is not null and v_cuil <> v_old
     and exists (select 1 from public.profiles where lower(login) = lower(v_cuil) and id <> v_uid) then
    raise exception 'Ya existe un usuario con ese CUIL';
  end if;
  update public.inspectores i set nombre = trim(p_nombre), cuil = v_cuil, modalidad_id = m.id, nivel_o_modalidad = m.nombre,
    situacion_revista = nullif(trim(p_situacion), ''), cargo_base = nullif(trim(p_cargo), ''),
    fecha_toma_posesion = nullif(trim(p_toma), ''), telefono = nullif(trim(p_telefono), ''), email = nullif(lower(trim(p_email)), '')
  from public.modalidades_inspeccion m where i.id = p_id and m.id = p_modalidad;
  if v_uid is not null then
    update public.profiles set name = trim(p_nombre), login = v_cuil where id = v_uid;
    if v_cuil <> v_old then
      update auth.users set email = public.auth_email(v_cuil), updated_at = now() where id = v_uid;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', public.auth_email(v_cuil)), updated_at = now() where user_id = v_uid;
    end if;
  end if;
end $$;

-- Activa o desactiva al inspector y bloquea o habilita su usuario
create or replace function public.inspector_activo(p_id bigint, p_activo boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select user_id into v_uid from public.inspectores where id = p_id;
  if not found then raise exception 'Inspector inexistente'; end if;
  update public.inspectores set activo = p_activo where id = p_id;
  if v_uid is not null then
    update public.profiles set active = p_activo where id = v_uid and id <> auth.uid();
    if not p_activo then delete from auth.sessions where user_id = v_uid; end if;
  end if;
end $$;

-- Crea el usuario de un inspector cargado sin cuenta
create or replace function public.inspector_crear_usuario(p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); r public.inspectores;
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select * into r from public.inspectores where id = p_id;
  if not found then raise exception 'Inspector inexistente'; end if;
  if r.user_id is not null then raise exception 'El inspector ya tiene usuario'; end if;
  if exists (select 1 from public.profiles where lower(login) = lower(r.cuil)) then raise exception 'Ya existe un usuario con ese CUIL'; end if;
  perform public._crear_auth(uid, public.auth_email(r.cuil), '12345678');
  insert into public.profiles (id, login, name, role, must_change, active) values (uid, r.cuil, coalesce(nullif(trim(r.nombre), ''), r.cuil), 'areal', true, r.activo);
  update public.inspectores set user_id = uid where id = p_id;
end $$;

