alter table public.acreditacion_eventos add column autor_id uuid references public.profiles(id);
alter table public.acreditacion_firmas add column propietario_id uuid references public.profiles(id);
create index acreditacion_firmas_propietario on public.acreditacion_firmas(propietario_id);

create policy acreditacion_eventos_areal on public.acreditacion_eventos for select to authenticated
  using (public.app_role() = 'areal' and public.real_role() in ('areal', 'distrital'));

create function public.acreditacion_firmas_usuario(p_usuario uuid, p_ids bigint[] default null)
returns table (id bigint, nombre text, mime text, base64 text, drive_file_id text)
language plpgsql stable security definer set search_path = public as $$
declare rol text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  select p.role into rol from public.profiles p where p.id = p_usuario and p.active;
  if rol not in ('areal', 'distrital') or rol is null then raise exception 'Sin permiso'; end if;
  return query select f.id, f.nombre, f.mime, encode(f.contenido, 'base64'), f.drive_file_id
    from public.acreditacion_firmas f
    where ((rol = 'areal' and f.propietario_id = p_usuario) or (rol = 'distrital' and f.propietario_id is null))
      and (p_ids is null or f.id = any(p_ids))
    order by f.id;
end $$;
revoke all on function public.acreditacion_firmas_usuario(uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.acreditacion_firmas_usuario(uuid, bigint[]) to service_role;

create function public.acreditacion_gestion_permitida(p_evento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'distrital'
    or (public.app_role() = 'areal' and public.real_role() = 'areal'
      and exists (select 1 from public.acreditacion_eventos e where e.id = p_evento and e.autor_id = public.eff_uid())
      and exists (select 1 from public.acreditacion_firmas f where f.propietario_id = public.eff_uid())), false)
$$;
revoke all on function public.acreditacion_gestion_permitida(uuid) from public, anon, authenticated;

create or replace function public.acreditacion_guardar_evento_firmado(
  p_id uuid, p_nombre text, p_lugar text, p_fecha date,
  p_inicio time, p_fin time, p_descripcion text, p_firmas jsonb, p_usuario uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare evento uuid; rol text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  select p.role into rol from public.profiles p where p.id = p_usuario and p.active;
  if rol not in ('distrital', 'areal') or rol is null then raise exception 'Sin permiso'; end if;
  if rol = 'areal' and not exists (select 1 from public.acreditacion_firmas f where f.propietario_id = p_usuario) then
    raise exception 'Cargá tu firma digital antes de gestionar eventos';
  end if;
  if p_id is null and p_firmas is null then raise exception 'Seleccioná las firmas del evento'; end if;
  if p_id is not null and p_firmas is not null then raise exception 'Las firmas de un evento se configuran por separado'; end if;
  if p_id is null then
    insert into public.acreditacion_eventos(nombre, lugar, fecha, hora_inicio, hora_fin, descripcion, autor_id)
    values (btrim(p_nombre), btrim(p_lugar), p_fecha, p_inicio, p_fin, btrim(p_descripcion), p_usuario) returning id into evento;
    perform public.acreditacion_instalar_firmas(evento, p_firmas);
  else
    perform 1 from public.acreditacion_eventos where id = p_id and (rol = 'distrital' or autor_id = p_usuario) for update;
    if not found then raise exception 'Evento inexistente o sin permiso'; end if;
    if exists (select 1 from public.acreditacion_eventos where id = p_id and estado = 'finalizado')
      or exists (select 1 from public.acreditacion_personas where evento_id = p_id and envio_estado <> 'pendiente') then
      raise exception 'No se pueden editar los datos de este evento';
    end if;
    update public.acreditacion_eventos set nombre = btrim(p_nombre), lugar = btrim(p_lugar), fecha = p_fecha,
      hora_inicio = p_inicio, hora_fin = p_fin, descripcion = btrim(p_descripcion) where id = p_id;
    evento := p_id;
  end if;
  return evento;
end $$;

create or replace function public.acreditacion_estado_evento(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if not public.acreditacion_gestion_permitida(p_id) then raise exception 'Sin permiso o falta cargar tu firma digital'; end if;
  select estado into v_estado from public.acreditacion_eventos where id = p_id for update;
  if not found then raise exception 'Evento inexistente'; end if;
  if not ((v_estado = 'pendiente' and p_estado = 'activo') or (v_estado = 'activo' and p_estado = 'finalizado')
    or (v_estado = 'finalizado' and p_estado = 'activo')) then raise exception 'Cambio de estado inválido'; end if;
  if exists (select 1 from public.acreditacion_personas where evento_id = p_id and envio_estado = 'enviando' and envio_iniciado_en >= now() - interval '10 minutes') then
    raise exception 'Hay un envío en curso; esperá antes de cambiar el estado';
  end if;
  update public.acreditacion_eventos set estado = p_estado where id = p_id;
end $$;

create or replace function public.acreditacion_eliminar_evento(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if not public.acreditacion_gestion_permitida(p_id) then raise exception 'Sin permiso o falta cargar tu firma digital'; end if;
  select estado into v_estado from public.acreditacion_eventos where id = p_id for update;
  if not found then raise exception 'Evento inexistente'; end if;
  if v_estado = 'finalizado' then raise exception 'No se puede eliminar un evento finalizado'; end if;
  if exists (select 1 from public.acreditacion_personas where evento_id = p_id) then raise exception 'No se puede eliminar un evento con acreditados'; end if;
  delete from public.acreditacion_eventos where id = p_id;
end $$;

create function public.acreditacion_areal_personas(p_evento uuid)
returns table (id bigint, nombre text, dni text, cargo text, escuela_id bigint, escuela_externa text,
  email text, constancia_enviada_en timestamptz, envio_estado text, envio_iniciado_en timestamptz,
  cargos_busqueda text, escuela jsonb, adicionales jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'areal' or coalesce(public.real_role(), '') not in ('areal', 'distrital') then raise exception 'Sin permiso'; end if;
  return query select p.id, p.nombre, p.dni, p.cargo, p.escuela_id, p.escuela_externa, p.email,
    p.constancia_enviada_en, p.envio_estado, p.envio_iniciado_en, p.cargos_busqueda,
    case when e.id is null then null else jsonb_build_object('id', e.id, 'nombre', e.nombre, 'tipo', e.tipo, 'numero', e.numero, 'codigo', e.codigo, 'localidad', e.localidad, 'eav', e.eav, 'clave', e.clave) end,
    coalesce((select jsonb_agg(jsonb_build_object('orden', a.orden, 'cargo', a.cargo, 'escuela_id', a.escuela_id, 'escuela_externa', a.escuela_externa,
      'escuela', case when s.id is null then null else jsonb_build_object('id', s.id, 'nombre', s.nombre, 'tipo', s.tipo, 'numero', s.numero, 'codigo', s.codigo, 'localidad', s.localidad, 'eav', s.eav, 'clave', s.clave) end) order by a.orden)
      from public.acreditacion_escuelas_adicionales a left join public.escuelas s on s.id = a.escuela_id where a.persona_id = p.id), '[]'::jsonb)
    from public.acreditacion_personas p left join public.escuelas e on e.id = p.escuela_id where p.evento_id = p_evento;
end $$;
revoke all on function public.acreditacion_areal_personas(uuid) from public, anon, authenticated;
grant execute on function public.acreditacion_areal_personas(uuid) to authenticated;
