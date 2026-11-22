alter table public.eventos_escolares_realizaciones
  add column origen_historico boolean not null default false,
  add column articulacion_informada boolean not null default true,
  alter column hora_fin drop not null,
  alter column objetivos drop not null,
  alter column creado_por drop not null,
  add constraint eventos_escolares_datos_actuales_check
    check (origen_historico or (hora_fin is not null and objetivos is not null and creado_por is not null and articulacion_informada));

create function public.eventos_escolares_informar_articulacion() returns trigger
language plpgsql set search_path = public as $$
begin
  new.articulacion_informada := true;
  return new;
end $$;
create trigger eventos_escolares_informar_articulacion
  before update of escuela_articulada_id on public.eventos_escolares_realizaciones
  for each row execute function public.eventos_escolares_informar_articulacion();

create table public.eventos_escolares_importaciones_archivos (
  origen text primary key,
  sha256 text not null,
  importadas integer not null,
  omitidas integer not null,
  created_at timestamptz not null default now()
);
alter table public.eventos_escolares_importaciones_archivos enable row level security;
revoke all on public.eventos_escolares_importaciones_archivos from public, anon, authenticated;

create table public.eventos_escolares_importaciones (
  origen text not null references public.eventos_escolares_importaciones_archivos(origen),
  fila integer not null check (fila > 0),
  realizacion_id bigint references public.eventos_escolares_realizaciones(id) on delete set null,
  primary key (origen, fila)
);
alter table public.eventos_escolares_importaciones enable row level security;
revoke all on public.eventos_escolares_importaciones from public, anon, authenticated;

create function public.eventos_escolares_renombrar_tipo(p_id bigint, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 2 and 150 then raise exception 'El nombre debe tener entre 2 y 150 caracteres'; end if;
  update public.eventos_escolares_catalogo set nombre = btrim(p_nombre) where id = p_id;
  if not found then raise exception 'Evento no encontrado'; end if;
exception when unique_violation then
  raise exception 'Ya existe un evento con ese nombre';
end $$;

create function public.eventos_escolares_eliminar_tipo(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  delete from public.eventos_escolares_catalogo where id = p_id;
  if not found then raise exception 'Evento no encontrado'; end if;
exception when foreign_key_violation then
  raise exception 'No se puede eliminar un evento con realizaciones registradas';
end $$;

revoke all on function public.eventos_escolares_renombrar_tipo(bigint,text), public.eventos_escolares_eliminar_tipo(bigint) from public, anon;
grant execute on function public.eventos_escolares_renombrar_tipo(bigint,text), public.eventos_escolares_eliminar_tipo(bigint) to authenticated;

drop function public.eventos_escolares_listar(date,date,bigint,bigint);
create function public.eventos_escolares_listar(p_desde date default null, p_hasta date default null, p_id bigint default null, p_evento bigint default null)
returns table (
  id bigint, evento_id bigint, evento text, escuela_id bigint, escuela_cue text, escuela_clave text,
  escuela_nombre text, escuela_tipo text, escuela_numero integer, articulada_id bigint, articulada_cue text,
  articulada_clave text, articulada_nombre text, articulada_tipo text, articulada_numero integer,
  fecha date, lugar text, hora_inicio time, hora_fin time, objetivos text, observaciones text,
  created_at timestamptz, updated_at timestamptz, origen_historico boolean, articulacion_informada boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() not in ('escolar', 'areal', 'distrital') or public.app_role() is null then raise exception 'Sin permiso'; end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then raise exception 'Rango de fechas inválido'; end if;
  return query
    select r.id, r.evento_id, c.nombre, e.id, e.cue, e.clave, e.nombre, e.tipo, e.numero,
      a.id, a.cue, a.clave, a.nombre, a.tipo, a.numero, r.fecha, r.lugar, r.hora_inicio, r.hora_fin,
      r.objetivos, r.observaciones, r.created_at, r.updated_at, r.origen_historico, r.articulacion_informada
    from public.eventos_escolares_realizaciones r
    join public.eventos_escolares_catalogo c on c.id = r.evento_id
    join public.escuelas e on e.id = r.escuela_id
    left join public.escuelas a on a.id = r.escuela_articulada_id
    where (p_desde is null or r.fecha >= p_desde) and (p_hasta is null or r.fecha <= p_hasta)
      and (p_id is null or r.id = p_id) and (p_evento is null or r.evento_id = p_evento)
      and (public.app_role() = 'distrital'
        or (public.app_role() = 'escolar' and (e.cue = public.app_cue() or a.cue = public.app_cue()))
        or (public.app_role() = 'areal' and (e.clave = any(public.claves_asignadas()) or a.clave = any(public.claves_asignadas()))));
end $$;
revoke all on function public.eventos_escolares_listar(date,date,bigint,bigint) from public, anon;
grant execute on function public.eventos_escolares_listar(date,date,bigint,bigint) to authenticated;

update public.ayuda_guias
set secciones = secciones || '[
  {"titulo":"Catálogo y registros históricos","pasos":[
    "Desde el rol distrital podés buscar, ordenar y renombrar los eventos; solo se pueden eliminar si no tienen realizaciones.",
    "Los registros históricos pueden tener horario de finalización, objetivos o articulación sin informar. La escuela que los registró puede editarlos y completar esos datos."
  ]}
]'::jsonb
where id = 'eventos-escolares';
