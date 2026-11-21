alter table public.eventos
  add column hora time,
  add column agenda_historica boolean not null default false;

alter table public.eventos drop constraint eventos_nombre_check;
alter table public.eventos add constraint eventos_nombre_check
  check (length(trim(nombre)) between case when agenda_historica then 1 else 3 end and 150);

create table public.agenda_importaciones (
  archivo_sha256 text not null,
  fila integer not null check (fila >= 2),
  origen_id text not null,
  actualizado_en timestamptz not null,
  evento_id bigint unique references public.eventos(id) on delete set null,
  primary key (archivo_sha256, fila),
  unique (archivo_sha256, origen_id)
);
alter table public.agenda_importaciones enable row level security;
revoke all on public.agenda_importaciones from public, anon, authenticated, service_role;

create function public.agenda_guardar_hora(p_id bigint, p_titulo text, p_fecha date, p_lugar text, p_desc text default null, p_hora time default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.eff_uid(); v_tipo bigint; v_id bigint; v_nombre text; anterior public.eventos;
begin
  if public.app_role() is distinct from 'areal' then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Elegí la fecha'; end if;
  select id into v_tipo from public.evento_tipos where nombre = 'Agenda Anticipada' and activo and rol = 'areal';
  if v_tipo is null then raise exception 'Tipo de evento no disponible'; end if;
  if p_id is not null then
    select * into anterior from public.eventos where id = p_id and tipo_id = v_tipo;
    if not found then raise exception 'Evento inexistente'; end if;
    if anterior.user_id <> v_uid then raise exception 'Solo el autor puede editar el evento'; end if;
  end if;
  if length(trim(coalesce(p_titulo, ''))) > 150
    or (length(trim(coalesce(p_titulo, ''))) < 3 and not
      (p_id is not null and anterior.agenda_historica and trim(coalesce(p_titulo, '')) = anterior.nombre and length(anterior.nombre) >= 1))
  then raise exception 'Completá el título'; end if;
  if length(coalesce(p_lugar, '')) > 200 or
    (length(trim(coalesce(p_lugar, ''))) < 2 and not
      (p_id is not null and anterior.agenda_historica and anterior.lugar is null and trim(coalesce(p_lugar, '')) = ''))
  then raise exception 'Completá el lugar'; end if;
  if length(coalesce(p_desc, '')) > 2000 then raise exception 'La descripción es demasiado larga'; end if;
  if p_id is null then
    select name into v_nombre from public.profiles where id = v_uid;
    insert into public.eventos (fecha, tipo_id, nombre, descripcion, lugar, hora, user_id, rol, autor)
    values (p_fecha, v_tipo, trim(p_titulo), nullif(trim(p_desc), ''), trim(p_lugar), p_hora, v_uid, 'areal', v_nombre)
    returning id into v_id;
  else
    update public.eventos set fecha = p_fecha, nombre = trim(p_titulo), descripcion = nullif(trim(p_desc), ''),
      lugar = nullif(trim(p_lugar), ''), hora = p_hora where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

revoke all on function public.agenda_guardar_hora(bigint, text, date, text, text, time) from anon, public;
grant execute on function public.agenda_guardar_hora(bigint, text, date, text, text, time) to authenticated;
