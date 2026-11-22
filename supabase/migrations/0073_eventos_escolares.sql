create table public.eventos_escolares_catalogo (
  id bigint generated always as identity primary key,
  nombre text not null check (length(btrim(nombre)) between 2 and 150),
  created_at timestamptz not null default now()
);
create unique index eventos_escolares_nombre_unico on public.eventos_escolares_catalogo (lower(btrim(nombre)));

create table public.eventos_escolares_realizaciones (
  id bigint generated always as identity primary key,
  evento_id bigint not null references public.eventos_escolares_catalogo(id),
  escuela_id bigint not null references public.escuelas(id),
  escuela_articulada_id bigint references public.escuelas(id),
  fecha date not null,
  lugar text not null check (length(btrim(lugar)) between 1 and 250),
  hora_inicio time not null,
  hora_fin time not null,
  objetivos text not null check (length(btrim(objetivos)) between 1 and 10000),
  observaciones text not null default '' check (length(observaciones) <= 10000),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  check (escuela_articulada_id is null or escuela_articulada_id <> escuela_id)
);
create index eventos_escolares_fecha_idx on public.eventos_escolares_realizaciones(fecha, id);
create index eventos_escolares_evento_escuela_idx on public.eventos_escolares_realizaciones(evento_id, escuela_id);
create index eventos_escolares_evento_articulada_idx on public.eventos_escolares_realizaciones(evento_id, escuela_articulada_id);

alter table public.eventos_escolares_catalogo enable row level security;
alter table public.eventos_escolares_realizaciones enable row level security;
revoke all on public.eventos_escolares_catalogo, public.eventos_escolares_realizaciones from public, anon, authenticated;
grant select on public.eventos_escolares_catalogo to authenticated;
create policy eventos_escolares_catalogo_sel on public.eventos_escolares_catalogo
  for select to authenticated using (public.app_role() in ('escolar', 'areal', 'distrital'));

create function public.eventos_escolares_crear_tipo(p_nombre text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 2 and 150 then raise exception 'El nombre debe tener entre 2 y 150 caracteres'; end if;
  insert into public.eventos_escolares_catalogo(nombre) values (btrim(p_nombre)) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe un evento con ese nombre';
end $$;

create function public.eventos_escolares_escuelas()
returns table (id bigint, cue text, clave text, nombre text, tipo text, numero integer, localidad text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'escolar' then raise exception 'Sin permiso'; end if;
  return query select e.id, e.cue, e.clave, e.nombre, e.tipo, e.numero, e.localidad from public.escuelas e;
end $$;

create function public.eventos_escolares_guardar(
  p_id bigint, p_evento bigint, p_escuela bigint, p_articulada bigint, p_fecha date,
  p_lugar text, p_inicio time, p_fin time, p_objetivos text, p_observaciones text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if public.app_role() is distinct from 'escolar' or nullif(btrim(public.app_cue()), '') is null then raise exception 'Sin permiso o sin escuela asociada'; end if;
  if not exists (select 1 from public.escuelas e where e.id = p_escuela and e.cue = public.app_cue()) then
    raise exception 'La escuela seleccionada no pertenece a esta cuenta';
  end if;
  if p_id is not null then
    select r.id into v_id from public.eventos_escolares_realizaciones r
      join public.escuelas e on e.id = r.escuela_id
      where r.id = p_id and e.cue = public.app_cue() for update of r;
    if not found then raise exception 'Evento no encontrado o sin permiso para editarlo'; end if;
    if not exists (select 1 from public.eventos_escolares_realizaciones r where r.id = v_id and r.escuela_id = p_escuela) then
      raise exception 'No se puede cambiar la escuela que registró el evento';
    end if;
  end if;
  if not exists (select 1 from public.eventos_escolares_catalogo c where c.id = p_evento) then raise exception 'Seleccioná un evento válido'; end if;
  if p_articulada is not null and (p_articulada = p_escuela or not exists (select 1 from public.escuelas where id = p_articulada)) then
    raise exception 'Seleccioná otra escuela válida para la articulación';
  end if;
  if p_fecha is null or p_inicio is null or p_fin is null or p_fin <= p_inicio then raise exception 'Indicá una fecha y un horario de finalización posterior al inicio'; end if;
  if p_lugar is null or length(btrim(p_lugar)) not between 1 and 250 then raise exception 'Indicá el lugar de realización'; end if;
  if p_objetivos is null or length(btrim(p_objetivos)) not between 1 and 10000 then raise exception 'Indicá los objetivos'; end if;
  if length(coalesce(p_observaciones, '')) > 10000 then raise exception 'Las observaciones son demasiado extensas'; end if;
  if p_id is null then
    insert into public.eventos_escolares_realizaciones(evento_id, escuela_id, escuela_articulada_id, fecha, lugar, hora_inicio, hora_fin, objetivos, observaciones, creado_por)
      values (p_evento, p_escuela, p_articulada, p_fecha, btrim(p_lugar), p_inicio, p_fin, btrim(p_objetivos), coalesce(p_observaciones, ''), public.eff_uid())
      returning id into v_id;
  else
    update public.eventos_escolares_realizaciones set evento_id = p_evento, escuela_articulada_id = p_articulada,
      fecha = p_fecha, lugar = btrim(p_lugar), hora_inicio = p_inicio, hora_fin = p_fin, objetivos = btrim(p_objetivos),
      observaciones = coalesce(p_observaciones, ''), updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

create function public.eventos_escolares_eliminar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'escolar' then raise exception 'Sin permiso'; end if;
  delete from public.eventos_escolares_realizaciones r using public.escuelas e
    where r.id = p_id and r.escuela_id = e.id and e.cue = public.app_cue();
  if not found then raise exception 'Evento no encontrado o sin permiso para eliminarlo'; end if;
end $$;

create function public.eventos_escolares_listar(p_desde date default null, p_hasta date default null, p_id bigint default null, p_evento bigint default null)
returns table (
  id bigint, evento_id bigint, evento text, escuela_id bigint, escuela_cue text, escuela_clave text,
  escuela_nombre text, escuela_tipo text, escuela_numero integer, articulada_id bigint, articulada_cue text,
  articulada_clave text, articulada_nombre text, articulada_tipo text, articulada_numero integer,
  fecha date, lugar text, hora_inicio time, hora_fin time, objetivos text, observaciones text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() not in ('escolar', 'areal', 'distrital') or public.app_role() is null then raise exception 'Sin permiso'; end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then raise exception 'Rango de fechas inválido'; end if;
  return query
    select r.id, r.evento_id, c.nombre, e.id, e.cue, e.clave, e.nombre, e.tipo, e.numero,
      a.id, a.cue, a.clave, a.nombre, a.tipo, a.numero, r.fecha, r.lugar, r.hora_inicio, r.hora_fin,
      r.objetivos, r.observaciones, r.created_at, r.updated_at
    from public.eventos_escolares_realizaciones r
    join public.eventos_escolares_catalogo c on c.id = r.evento_id
    join public.escuelas e on e.id = r.escuela_id
    left join public.escuelas a on a.id = r.escuela_articulada_id
    where (p_desde is null or r.fecha >= p_desde) and (p_hasta is null or r.fecha <= p_hasta)
      and (p_id is null or r.id = p_id)
      and (p_evento is null or r.evento_id = p_evento)
      and (public.app_role() = 'distrital'
        or (public.app_role() = 'escolar' and (e.cue = public.app_cue() or a.cue = public.app_cue()))
        or (public.app_role() = 'areal' and (e.clave = any(public.claves_asignadas()) or a.clave = any(public.claves_asignadas()))));
end $$;

create function public.eventos_escolares_seguimiento(p_evento bigint)
returns table (id bigint, cue text, clave text, nombre text, tipo text, numero integer, nivel text, modalidad text, localidad text, cargado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from public.eventos_escolares_catalogo c where c.id = p_evento) then raise exception 'Evento no encontrado'; end if;
  return query select e.id, e.cue, e.clave, e.nombre, e.tipo, e.numero, e.nivel, e.modalidad, e.localidad,
    exists (select 1 from public.eventos_escolares_realizaciones r
      where r.evento_id = p_evento and (r.escuela_id = e.id or r.escuela_articulada_id = e.id))
    from public.escuelas e;
end $$;

revoke all on function public.eventos_escolares_crear_tipo(text), public.eventos_escolares_escuelas(),
  public.eventos_escolares_guardar(bigint,bigint,bigint,bigint,date,text,time,time,text,text),
  public.eventos_escolares_eliminar(bigint), public.eventos_escolares_listar(date,date,bigint,bigint),
  public.eventos_escolares_seguimiento(bigint) from public, anon;
grant execute on function public.eventos_escolares_crear_tipo(text), public.eventos_escolares_escuelas(),
  public.eventos_escolares_guardar(bigint,bigint,bigint,bigint,date,text,time,time,text,text),
  public.eventos_escolares_eliminar(bigint), public.eventos_escolares_listar(date,date,bigint,bigint),
  public.eventos_escolares_seguimiento(bigint) to authenticated;

insert into public.ayuda_guias(id, modulo, titulo, descripcion, secciones, posicion)
values ('eventos-escolares', 'eventos-escolares', 'Eventos Escolares',
  'Registro de eventos de la escuela y de realizaciones articuladas.',
  $guia$[
    {"titulo":"Cargar un evento","pasos":[
      "Abrí Eventos Escolares y elegí «Cargar evento». Seleccioná el evento y la escuela que lo registra.",
      "Indicá la fecha, el lugar, los horarios de inicio y finalización, los objetivos y, si corresponde, otras observaciones.",
      "Si se realiza con otra escuela, marcá la articulación y seleccioná la escuela participante. La realización aparecerá en el calendario y el listado de ambas.",
      "Podés cargar varias realizaciones del mismo evento."
    ]},
    {"titulo":"Consultar, editar y eliminar","pasos":[
      "Consultá el detalle desde el listado o desde el calendario del inicio.",
      "Solo la escuela que registró la realización puede editarla o eliminarla. Al eliminarla desaparece también para la escuela articulada."
    ]}
  ]$guia$::jsonb, 150)
on conflict (id) do nothing;
