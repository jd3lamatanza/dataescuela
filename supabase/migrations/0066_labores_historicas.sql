alter table public.labores
  add column escuela_historica text,
  add column acuerdos_pendientes_historicos text;

alter table public.labores drop constraint labores_motivo_check;
alter table public.labores add constraint labores_motivo_check check (length(trim(motivo)) between 3 and 1000);

alter table public.labor_archivos add column historico boolean not null default false;

insert into public.catalogos (coleccion, nombre, orden) values
  ('labor_lugar', 'Convocatoria', 5), ('labor_lugar', 'Domicilio', 6),
  ('labor_evento', 'No especificado', 9)
on conflict (coleccion, nombre) do nothing;

create table public.labores_importaciones (
  archivo_sha256 text not null,
  fila integer not null check (fila >= 2),
  labor_id bigint not null unique references public.labores(id) on delete cascade,
  primary key (archivo_sha256, fila)
);
alter table public.labores_importaciones enable row level security;
revoke all on public.labores_importaciones from public, anon, authenticated, service_role;

create or replace function public.labor_guardar(p_id bigint, p_fecha date, p_lugar bigint, p_tipo bigint, p_dimension bigint, p_motivo text, p_evento bigint,
  p_acuerdos text default null, p_equipo boolean default false, p_participantes uuid[] default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.eff_uid(); v_id bigint; v_nombre text; v_evento text;
begin
  if public.app_role() is distinct from 'areal' then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Elegí la fecha'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 or length(trim(p_motivo)) > 1000 then raise exception 'Completá el motivo'; end if;
  if length(coalesce(p_acuerdos, '')) > 5000 then raise exception 'Los acuerdos son demasiado largos'; end if;
  perform public._labor_cat(p_lugar, 'labor_lugar'); perform public._labor_cat(p_tipo, 'labor_tipo');
  perform public._labor_cat(p_dimension, 'labor_dimension'); perform public._labor_cat(p_evento, 'labor_evento');
  select name into v_nombre from public.profiles where id = v_uid;
  if p_id is null then
    insert into public.labores (user_id, autor, fecha, lugar_id, tipo_id, dimension_id, evento_id, motivo, acuerdos, equipo)
    values (v_uid, v_nombre, p_fecha, p_lugar, p_tipo, p_dimension, p_evento, trim(p_motivo), nullif(trim(p_acuerdos), ''), coalesce(p_equipo, false))
    returning id into v_id;
    select nombre into v_evento from public.catalogos where id = p_evento;
    insert into public.notifications (user_id, type, title, body, url)
    select p.id, 'info', 'Nueva labor de inspector', v_nombre || ': ' || v_evento || ' - ' || trim(p_motivo), '/labores-distrito?labor=' || v_id
    from public.profiles p where p.role = 'distrital' and p.active;
  else
    if not exists (select 1 from public.labores where id = p_id and user_id = v_uid) then raise exception 'Solo el autor puede editar la labor'; end if;
    update public.labores set fecha = p_fecha, lugar_id = p_lugar, tipo_id = p_tipo, dimension_id = p_dimension, evento_id = p_evento,
      motivo = trim(p_motivo), acuerdos = nullif(trim(p_acuerdos), ''), equipo = coalesce(p_equipo, false), updated_at = now()
    where id = p_id;
    v_id := p_id;
  end if;
  delete from public.labor_inspectores where labor_id = v_id;
  if coalesce(p_equipo, false) then
    insert into public.labor_inspectores (labor_id, user_id, nombre)
    select v_id, i.user_id, coalesce(nullif(trim(p.name), ''), i.nombre, i.cuil)
    from public.inspectores i join public.profiles p on p.id = i.user_id
    where i.user_id = any (coalesce(p_participantes, '{}')) and i.user_id <> v_uid and i.activo and p.active;
  end if;
  return v_id;
end $$;
