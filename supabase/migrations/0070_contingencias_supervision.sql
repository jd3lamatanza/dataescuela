alter table public.contingencias add column fecha date;
alter table public.contingencias add column fecha_estimada boolean not null default false;
update public.contingencias set fecha = (created_at at time zone 'America/Argentina/Buenos_Aires')::date, fecha_estimada = true;
alter table public.contingencias alter column fecha set not null;
alter table public.contingencias alter column fecha set default (now() at time zone 'America/Argentina/Buenos_Aires')::date;
create index contingencias_fecha_idx on public.contingencias(fecha desc, id desc);

create policy contingencias_supervision_sel on public.contingencias for select to authenticated using (
  public.app_role() = 'distrital'
  or (public.app_role() = 'areal' and exists (
    select 1 from public.escuelas e where e.cue = contingencias.cue and e.clave = any(public.claves_asignadas())
  ))
);

drop function public.contingencia_guardar(bigint, text[], text, bigint[], text);
create function public.contingencia_guardar(
  p_id bigint, p_tipos text[], p_suspension text, p_turnos bigint[], p_observaciones text, p_fecha date default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cue text := public.app_cue();
  v_id bigint;
  v_escuela text;
  v_fecha date;
begin
  if public.app_role() is distinct from 'escolar' or v_cue is null or trim(v_cue) = ''
    or not exists (select 1 from public.escuelas where cue = v_cue) then
    raise exception 'La cuenta no tiene permiso o escuela asociada';
  end if;
  if p_id is not null then
    select id, fecha into v_id, v_fecha from public.contingencias where id = p_id and cue = v_cue for update;
    if not found then raise exception 'Contingencia no encontrada o sin permiso'; end if;
  end if;
  if p_tipos is null or cardinality(p_tipos) = 0 or array_position(p_tipos, null) is not null
    or not p_tipos <@ array['Falta de Agua', 'Falta de Electricidad', 'Falta de Gas', 'Inclemencia Climática',
      'Riesgo Edilicio', 'Medida de Fuerza', 'Duelo', 'Otro']::text[]
    or cardinality(p_tipos) <> (select count(distinct t) from unnest(p_tipos) t) then
    raise exception 'Seleccioná al menos un tipo de contingencia válido';
  end if;
  if p_suspension is null or p_suspension not in ('sin', 'parcial', 'total') then
    raise exception 'Seleccioná una opción de suspensión válida';
  end if;
  if p_turnos is null or cardinality(p_turnos) = 0 or array_position(p_turnos, null) is not null
    or cardinality(p_turnos) <> (select count(distinct t) from unnest(p_turnos) t)
    or exists (
      select 1 from unnest(p_turnos) t(id)
      where not exists (
        select 1 from public.turnos turno where turno.id = t.id
          and (turno.activo or exists (
            select 1 from public.contingencia_turnos ct where ct.contingencia_id = v_id and ct.turno_id = turno.id
          ))
      )
    ) then
    raise exception 'Seleccioná al menos un turno válido';
  end if;
  v_fecha := coalesce(p_fecha, v_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  if p_id is null then
    insert into public.contingencias(cue, tipos, suspension, observaciones, fecha, fecha_estimada)
      values (v_cue, p_tipos, p_suspension, coalesce(p_observaciones, ''), v_fecha, p_fecha is null) returning id into v_id;
  else
    update public.contingencias set tipos = p_tipos, suspension = p_suspension,
      observaciones = coalesce(p_observaciones, ''), fecha = v_fecha,
      fecha_estimada = case when p_fecha is null then fecha_estimada else false end,
      updated_at = now() where id = v_id;
    delete from public.contingencia_turnos where contingencia_id = v_id;
  end if;
  insert into public.contingencia_turnos(contingencia_id, turno_id)
    select v_id, t from unnest(p_turnos) t;

  select coalesce(nullif(trim(concat_ws(' ', e.clave, e.nombre)), ''), v_cue) into v_escuela
    from public.escuelas e where e.cue = v_cue order by e.id limit 1;
  insert into public.notifications(user_id, type, title, body, url)
  select p.id, 'info', case when p_id is null then 'Nueva contingencia' else 'Contingencia actualizada' end,
    v_escuela || ' · ' || to_char(v_fecha, 'DD/MM/YYYY') || ' · ' || array_to_string(p_tipos, ', '),
    '/contingencias?contingencia=' || v_id
  from public.profiles p
  where p.active and (p.role = 'distrital' or (p.role = 'areal' and exists (
    select 1 from public.inspectores i join public.escuelas e on e.clave = any(i.escuelas_asignadas)
    where i.user_id = p.id and e.cue = v_cue
  )));
  return v_id;
end $$;
revoke all on function public.contingencia_guardar(bigint,text[],text,bigint[],text,date) from public, anon;
grant execute on function public.contingencia_guardar(bigint,text[],text,bigint[],text,date) to authenticated;

create function public.contingencias_supervision(
  p_busqueda text default '', p_tipo text default '', p_suspension text default '',
  p_desde date default null, p_hasta date default null, p_id bigint default null,
  p_lim integer default 20, p_offset integer default 0
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare resultado jsonb;
begin
  if public.app_role() not in ('areal', 'distrital') or public.app_role() is null then raise exception 'Sin permiso'; end if;
  if p_lim is null or p_lim < 1 or p_lim > 500 or p_offset is null or p_offset < 0 then raise exception 'Paginación inválida'; end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then raise exception 'El rango de fechas es inválido'; end if;
  with filtradas as (
    select c.id, c.cue, c.fecha, c.fecha_estimada, c.tipos, c.suspension, c.observaciones, c.created_at,
      coalesce(e.clave, '') clave, coalesce(e.nombre, '') escuela,
      coalesce((select array_agg(t.nombre order by t.hora_desde, t.nombre)
        from public.contingencia_turnos ct join public.turnos t on t.id = ct.turno_id where ct.contingencia_id = c.id), '{}') turnos
    from public.contingencias c
    left join lateral (select esc.clave, esc.nombre from public.escuelas esc where esc.cue = c.cue order by esc.id limit 1) e on true
    where (coalesce(p_tipo, '') = '' or p_tipo = any(c.tipos))
      and (coalesce(p_suspension, '') = '' or c.suspension = p_suspension)
      and (p_desde is null or c.fecha >= p_desde) and (p_hasta is null or c.fecha <= p_hasta)
      and (p_id is null or c.id = p_id)
      and (coalesce(trim(p_busqueda), '') = '' or concat_ws(' ', c.cue, e.clave, e.nombre, c.observaciones, array_to_string(c.tipos, ' '))
        ilike '%' || replace(replace(replace(trim(p_busqueda), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), pagina as (
    select * from filtradas order by fecha desc, id desc limit p_lim offset p_offset
  )
  select jsonb_build_object('total', (select count(*) from filtradas),
    'filas', coalesce((select jsonb_agg(to_jsonb(pagina) order by fecha desc, id desc) from pagina), '[]'::jsonb)) into resultado;
  return resultado;
end $$;
revoke all on function public.contingencias_supervision(text,text,text,date,date,bigint,integer,integer) from public, anon;
grant execute on function public.contingencias_supervision(text,text,text,date,date,bigint,integer,integer) to authenticated;

update public.ayuda_guias
set secciones = jsonb_set(secciones, '{0,pasos,1}', to_jsonb('Indicá la fecha de la contingencia, seleccioná la opción de suspensión y marcá al menos un turno afectado. Agregá observaciones si necesitás aclarar algo.'::text)),
    version = version + 1, actualizado = now()
where id = 'contingencias'
  and secciones #>> '{0,pasos,1}' = 'Seleccioná la opción de suspensión y marcá al menos un turno afectado. Agregá observaciones si necesitás aclarar algo.';
