alter table public.acreditacion_eventos add column firmas_configuradas boolean not null default false;

create table public.acreditacion_evento_firmas (
  evento_id uuid not null references public.acreditacion_eventos(id) on delete cascade,
  orden smallint not null check (orden between 1 and 6),
  nombre text not null check (length(nombre) between 1 and 150),
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  contenido bytea not null check (octet_length(contenido) between 1 and 2097152),
  primary key (evento_id, orden)
);
alter table public.acreditacion_evento_firmas enable row level security;
revoke all on public.acreditacion_evento_firmas from public, anon, authenticated;

create index acreditacion_personas_escuela on public.acreditacion_personas(escuela_id);
create index acreditacion_adicionales_escuela on public.acreditacion_escuelas_adicionales(escuela_id, persona_id);

create function public.acreditacion_instalar_firmas(p_evento uuid, p_firmas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare firma jsonb; bytes bytea; indice integer := 0;
begin
  if jsonb_typeof(p_firmas) is distinct from 'array' or jsonb_array_length(p_firmas) not between 1 and 6 then
    raise exception 'Seleccioná entre una y seis firmas válidas';
  end if;
  perform 1 from public.acreditacion_eventos where id = p_evento and not firmas_configuradas for update;
  if not found then raise exception 'El evento no existe o ya tiene firmas configuradas'; end if;
  for firma in select value from jsonb_array_elements(p_firmas) loop
    if jsonb_typeof(firma->'nombre') is distinct from 'string'
      or length(btrim(firma->>'nombre')) not between 1 and 150
      or jsonb_typeof(firma->'base64') is distinct from 'string'
      or length(firma->>'base64') > 2796204
      or coalesce(firma->>'mime', '') not in ('image/png', 'image/jpeg') then
      raise exception 'Firma inválida';
    end if;
    bytes := decode(firma->>'base64', 'base64');
    if octet_length(bytes) not between 1 and 2097152
      or (firma->>'mime' = 'image/png' and substring(bytes from 1 for 8) <> decode('89504e470d0a1a0a', 'hex'))
      or (firma->>'mime' = 'image/jpeg' and substring(bytes from 1 for 3) <> decode('ffd8ff', 'hex')) then
      raise exception 'Firma inválida';
    end if;
    indice := indice + 1;
    insert into public.acreditacion_evento_firmas(evento_id, orden, nombre, mime, contenido)
    values (p_evento, indice, btrim(firma->>'nombre'), firma->>'mime', bytes);
  end loop;
  update public.acreditacion_eventos set firmas_configuradas = true where id = p_evento;
end $$;
revoke all on function public.acreditacion_instalar_firmas(uuid, jsonb) from public, anon, authenticated;

create function public.acreditacion_guardar_evento_firmado(
  p_id uuid, p_nombre text, p_lugar text, p_fecha date,
  p_inicio time, p_fin time, p_descripcion text, p_firmas jsonb, p_usuario uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare evento uuid;
begin
  if auth.role() is distinct from 'service_role'
    or not exists (select 1 from public.profiles where id = p_usuario and active and role = 'distrital') then raise exception 'Sin permiso'; end if;
  if p_id is null and p_firmas is null then raise exception 'Seleccioná las firmas del evento'; end if;
  if p_id is not null and p_firmas is not null then raise exception 'Las firmas de un evento se configuran por separado'; end if;
  if p_id is null then
    insert into public.acreditacion_eventos(nombre, lugar, fecha, hora_inicio, hora_fin, descripcion)
    values (btrim(p_nombre), btrim(p_lugar), p_fecha, p_inicio, p_fin, btrim(p_descripcion)) returning id into evento;
    perform public.acreditacion_instalar_firmas(evento, p_firmas);
  else
    perform 1 from public.acreditacion_eventos where id = p_id for update;
    if not found then raise exception 'Evento inexistente'; end if;
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

create function public.acreditacion_configurar_firmas(p_evento uuid, p_firmas jsonb, p_usuario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role'
    or not exists (select 1 from public.profiles where id = p_usuario and active and role = 'distrital') then raise exception 'Sin permiso'; end if;
  perform public.acreditacion_instalar_firmas(p_evento, p_firmas);
end $$;

create function public.acreditacion_firmas_evento_datos(p_evento uuid)
returns table (nombre text, mime text, base64 text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  return query select f.nombre, f.mime, encode(f.contenido, 'base64')
    from public.acreditacion_evento_firmas f where f.evento_id = p_evento order by f.orden;
end $$;

revoke all on function public.acreditacion_guardar_evento(uuid, text, text, date, time, time, text) from authenticated;
revoke all on function public.acreditacion_guardar_evento_firmado(uuid, text, text, date, time, time, text, jsonb, uuid),
  public.acreditacion_configurar_firmas(uuid, jsonb, uuid), public.acreditacion_firmas_evento_datos(uuid) from public, anon, authenticated;
grant execute on function public.acreditacion_guardar_evento_firmado(uuid, text, text, date, time, time, text, jsonb, uuid),
  public.acreditacion_configurar_firmas(uuid, jsonb, uuid), public.acreditacion_firmas_evento_datos(uuid) to service_role;

create function public.acreditacion_escolar_puede_ver(p_persona bigint, p_evento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() = 'escolar'
    and public.real_role() in ('escolar', 'distrital')
    and exists (
      select 1 from public.acreditacion_personas p
      where p.id = p_persona and p.evento_id = p_evento
        and (public.can_see_escuela(p.escuela_id) or exists (
          select 1 from public.acreditacion_escuelas_adicionales a
          where a.persona_id = p.id and public.can_see_escuela(a.escuela_id)
        ))
    )
$$;

create function public.acreditacion_escolar_eventos()
returns table (id uuid, nombre text, fecha date)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.fecha from public.acreditacion_eventos e
  where public.app_role() = 'escolar' and public.real_role() in ('escolar', 'distrital')
    and exists (select 1 from public.acreditacion_personas p
      where p.evento_id = e.id and public.acreditacion_escolar_puede_ver(p.id, e.id))
  order by e.fecha desc, e.id
$$;

create function public.acreditacion_escolar_listar(
  p_busqueda text, p_evento uuid, p_orden text, p_desc boolean, p_limite integer, p_offset integer
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare resultado jsonb;
begin
  if public.app_role() is distinct from 'escolar' or coalesce(public.real_role(), '') not in ('escolar', 'distrital') then raise exception 'Sin permiso'; end if;
  if p_orden not in ('fecha', 'nombre', 'dni', 'evento') or p_orden is null or p_desc is null
    or p_limite not between 1 and 50 or p_limite is null or p_offset < 0 or p_offset is null
    or length(coalesce(p_busqueda, '')) > 80 then raise exception 'Filtros inválidos'; end if;
  with registros as (
    select p.id, p.nombre, p.dni, e.id as evento_id, e.nombre as evento, e.fecha,
      e.firmas_configuradas,
      (select string_agg(c.cargo, ' · ' order by c.orden) from (
        select 1 as orden, p.cargo where public.can_see_escuela(p.escuela_id)
        union all
        select a.orden::integer, a.cargo from public.acreditacion_escuelas_adicionales a
          where a.persona_id = p.id and public.can_see_escuela(a.escuela_id)
      ) c) as cargo
    from public.acreditacion_personas p join public.acreditacion_eventos e on e.id = p.evento_id
    where public.acreditacion_escolar_puede_ver(p.id, e.id)
      and (p_evento is null or e.id = p_evento)
  ), filtrados as (
    select * from registros r where coalesce(p_busqueda, '') = ''
      or r.nombre ilike '%' || p_busqueda || '%' or r.dni ilike '%' || p_busqueda || '%'
      or r.evento ilike '%' || p_busqueda || '%' or r.cargo ilike '%' || p_busqueda || '%'
  ), pagina as (
    select * from filtrados r order by
      case when p_orden = 'fecha' and not p_desc then r.fecha end asc,
      case when p_orden = 'fecha' and p_desc then r.fecha end desc,
      case when p_orden = 'nombre' and not p_desc then r.nombre end asc,
      case when p_orden = 'nombre' and p_desc then r.nombre end desc,
      case when p_orden = 'dni' and not p_desc then r.dni end asc,
      case when p_orden = 'dni' and p_desc then r.dni end desc,
      case when p_orden = 'evento' and not p_desc then r.evento end asc,
      case when p_orden = 'evento' and p_desc then r.evento end desc,
      r.id desc
    limit p_limite offset p_offset
  )
  select jsonb_build_object('total', (select count(*) from filtrados),
    'registros', coalesce(jsonb_agg(to_jsonb(pagina)), '[]'::jsonb)) into resultado from pagina;
  return resultado;
end $$;

revoke all on function public.acreditacion_escolar_puede_ver(bigint, uuid),
  public.acreditacion_escolar_eventos(),
  public.acreditacion_escolar_listar(text, uuid, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.acreditacion_escolar_puede_ver(bigint, uuid),
  public.acreditacion_escolar_eventos(),
  public.acreditacion_escolar_listar(text, uuid, text, boolean, integer, integer) to authenticated;
