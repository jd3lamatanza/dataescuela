-- Solo el autor edita o elimina sus eventos
create or replace function public.evento_guardar(p_id bigint, p_fecha date, p_tipo bigint, p_nombre text, p_desc text default null, p_para text[] default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.eff_uid(); v_rol text := public.app_role(); v_id bigint; v_para text[]; v_owner uuid; v_nombre text;
begin
  if v_rol is null then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Elegí la fecha'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Completá el nombre del evento'; end if;
  if length(coalesce(p_desc, '')) > 2000 then raise exception 'La descripción es demasiado larga'; end if;
  if not exists (select 1 from public.evento_tipos where id = p_tipo and activo and rol = v_rol) then
    raise exception 'Tu rol no puede crear ese tipo de evento';
  end if;
  v_para := case when v_rol = 'distrital'
    then coalesce((select array_agg(distinct r) from unnest(p_para) r where r in ('areal','escolar')), '{}') else '{}' end;
  if p_id is null then
    select name into v_nombre from public.profiles where id = v_uid;
    insert into public.eventos (fecha, tipo_id, nombre, descripcion, user_id, rol, autor, cue, para_roles)
    values (p_fecha, p_tipo, trim(p_nombre), nullif(trim(p_desc), ''), v_uid, v_rol, v_nombre, public.app_cue(), v_para)
    returning id into v_id;
  else
    select user_id into v_owner from public.eventos where id = p_id;
    if v_owner is null then raise exception 'Evento inexistente'; end if;
    if v_owner <> v_uid then raise exception 'Solo el autor puede editar el evento'; end if;
    update public.eventos set fecha = p_fecha, tipo_id = p_tipo, nombre = trim(p_nombre), descripcion = nullif(trim(p_desc), ''), para_roles = v_para
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

create or replace function public.evento_eliminar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.eventos where id = p_id;
  if v_owner is null then raise exception 'Evento inexistente'; end if;
  if v_owner <> public.eff_uid() then raise exception 'Solo el autor puede eliminar el evento'; end if;
  delete from public.eventos where id = p_id;
end $$;
