-- La situación de revista del inspector depende del catálogo situacion_revista.
alter table public.inspectores add column revista_id bigint references public.catalogos (id);
update public.inspectores i set revista_id = c.id from public.catalogos c
where c.coleccion = 'situacion_revista' and lower(trim(i.situacion_revista)) = lower(c.nombre);

drop function public.inspector_crear(text, text, bigint, text, text, text, text, text);
drop function public.inspector_editar(bigint, text, text, bigint, text, text, text, text, text);

create or replace function public.inspector_crear(
  p_nombre text, p_cuil text, p_modalidad bigint, p_revista bigint default null, p_cargo text default null,
  p_toma text default null, p_telefono text default null, p_email text default null
) returns bigint
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); v_id bigint; v_cuil text := trim(p_cuil);
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  perform public._inspector_validar(p_nombre, v_cuil, p_modalidad, p_email);
  if not exists (select 1 from public.catalogos where id = p_revista and coleccion = 'situacion_revista' and activo) then
    raise exception 'Elegí una situación de revista válida';
  end if;
  if exists (select 1 from public.inspectores where cuil = v_cuil) then raise exception 'Ya existe un inspector con ese CUIL'; end if;
  if exists (select 1 from public.profiles where lower(login) = lower(v_cuil)) then raise exception 'Ya existe un usuario con ese CUIL'; end if;
  perform public._crear_auth(uid, public.auth_email(v_cuil), '12345678');
  insert into public.profiles (id, login, name, role, must_change) values (uid, v_cuil, trim(p_nombre), 'areal', true);
  insert into public.inspectores (user_id, nombre, cuil, modalidad_id, nivel_o_modalidad, revista_id, situacion_revista, cargo_base, fecha_toma_posesion, telefono, email)
  select uid, trim(p_nombre), v_cuil, m.id, m.nombre, rv.id, rv.nombre, nullif(trim(p_cargo), ''), nullif(trim(p_toma), ''),
         nullif(trim(p_telefono), ''), nullif(lower(trim(p_email)), '')
  from public.modalidades_inspeccion m left join public.catalogos rv on rv.id = p_revista and rv.coleccion = 'situacion_revista' and rv.activo
  where m.id = p_modalidad
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.inspector_editar(
  p_id bigint, p_nombre text, p_cuil text, p_modalidad bigint, p_revista bigint default null, p_cargo text default null,
  p_toma text default null, p_telefono text default null, p_email text default null
) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_uid uuid; v_cuil text := trim(p_cuil); v_old text;
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select user_id, cuil into v_uid, v_old from public.inspectores where id = p_id;
  if not found then raise exception 'Inspector inexistente'; end if;
  perform public._inspector_validar(p_nombre, v_cuil, p_modalidad, p_email);
  if not exists (select 1 from public.catalogos where id = p_revista and coleccion = 'situacion_revista' and activo) then
    raise exception 'Elegí una situación de revista válida';
  end if;
  if exists (select 1 from public.inspectores where cuil = v_cuil and id <> p_id) then raise exception 'Ya existe un inspector con ese CUIL'; end if;
  if v_uid is not null and v_cuil <> v_old
     and exists (select 1 from public.profiles where lower(login) = lower(v_cuil) and id <> v_uid) then
    raise exception 'Ya existe un usuario con ese CUIL';
  end if;
  update public.inspectores i set nombre = trim(p_nombre), cuil = v_cuil, modalidad_id = m.id, nivel_o_modalidad = m.nombre,
    situacion_revista = rv.nombre, revista_id = rv.id, cargo_base = nullif(trim(p_cargo), ''),
    fecha_toma_posesion = nullif(trim(p_toma), ''), telefono = nullif(trim(p_telefono), ''), email = nullif(lower(trim(p_email)), '')
  from public.modalidades_inspeccion m left join public.catalogos rv on rv.id = p_revista and rv.coleccion = 'situacion_revista' and rv.activo
  where i.id = p_id and m.id = p_modalidad;
  if v_uid is not null then
    update public.profiles set name = trim(p_nombre), login = v_cuil where id = v_uid;
    if v_cuil <> v_old then
      update auth.users set email = public.auth_email(v_cuil), updated_at = now() where id = v_uid;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', public.auth_email(v_cuil)), updated_at = now() where user_id = v_uid;
    end if;
  end if;
end $$;


grant execute on function public.inspector_crear(text, text, bigint, bigint, text, text, text, text) to authenticated;
grant execute on function public.inspector_editar(bigint, text, text, bigint, bigint, text, text, text, text) to authenticated;
