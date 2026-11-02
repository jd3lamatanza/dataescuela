-- Agenda Anticipada: eventos de los inspectores (rol areal), con lugar.
alter table public.eventos add column if not exists lugar text;

create or replace function public.agenda_guardar(p_id bigint, p_titulo text, p_fecha date, p_lugar text, p_desc text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.eff_uid(); v_tipo bigint; v_id bigint; v_owner uuid; v_nombre text;
begin
  if public.app_role() is distinct from 'areal' then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Elegí la fecha'; end if;
  if length(trim(coalesce(p_titulo, ''))) < 3 or length(trim(p_titulo)) > 150 then raise exception 'Completá el título'; end if;
  if length(trim(coalesce(p_lugar, ''))) < 2 or length(p_lugar) > 200 then raise exception 'Completá el lugar'; end if;
  if length(coalesce(p_desc, '')) > 2000 then raise exception 'La descripción es demasiado larga'; end if;
  select id into v_tipo from public.evento_tipos where nombre = 'Agenda Anticipada' and activo and rol = 'areal';
  if v_tipo is null then raise exception 'Tipo de evento no disponible'; end if;
  if p_id is null then
    select name into v_nombre from public.profiles where id = v_uid;
    insert into public.eventos (fecha, tipo_id, nombre, descripcion, lugar, user_id, rol, autor)
    values (p_fecha, v_tipo, trim(p_titulo), nullif(trim(p_desc), ''), trim(p_lugar), v_uid, 'areal', v_nombre)
    returning id into v_id;
  else
    select user_id into v_owner from public.eventos where id = p_id and tipo_id = v_tipo;
    if v_owner is null then raise exception 'Evento inexistente'; end if;
    if v_owner <> v_uid then raise exception 'Solo el autor puede editar el evento'; end if;
    update public.eventos set fecha = p_fecha, nombre = trim(p_titulo), descripcion = nullif(trim(p_desc), ''), lugar = trim(p_lugar) where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

revoke all on function public.agenda_guardar(bigint, text, date, text, text) from anon, public;
grant execute on function public.agenda_guardar(bigint, text, date, text, text) to authenticated;
