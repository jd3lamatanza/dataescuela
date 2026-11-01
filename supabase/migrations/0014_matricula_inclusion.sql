alter table public.matricula_datos
  add column inclusion integer not null default 0 check (inclusion >= 0);

create or replace function public.matricula_guardar(p_escuela bigint, p_ciclo int, p_mes int, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_escuela bigint := public._escuela_obj(p_escuela);
  hoy date := public._hoy_ar();
  k public.matricula_cargas;
  pl public.plantas;
  cid bigint;
  s record; i jsonb; mat int; incl int; asi int; n int := 0;
  es_especial boolean;
  filas jsonb[] := '{}';
begin
  if p_ciclo not between 2020 and 2100 or p_mes not between 1 and 12 then raise exception 'Período no válido'; end if;
  select exists (
    select 1
    from public.escuelas esc
    join public.agrupamiento_codigos ac on ac.codigo = esc.codigo
    join public.agrupamientos_matricula am on am.id = ac.agrupamiento_id
    where esc.id = v_escuela and lower(am.nombre) = 'especial'
  ) into es_especial;
  select * into k from public.matricula_cargas where escuela_id = v_escuela and ciclo = p_ciclo and mes = p_mes;
  if public.app_role() is not distinct from 'escolar'
     and not exists (select 1 from public.carga_activa c where c.ciclo = p_ciclo and c.mes = p_mes and c.carga and hoy between c.fecha_apertura and c.fecha_cierre)
     and not coalesce(k.habilitada, false) then
    raise exception 'Fuera de Período de Carga';
  end if;
  select * into pl from public.plantas where escuela_id = v_escuela;
  if pl.id is null then raise exception 'La escuela no tiene planta configurada'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Datos no válidos'; end if;

  for s in select plan_id, curso_id, turno_id, secciones from public.planta_secciones where planta_id = pl.id and secciones > 0 loop
    select x into i from jsonb_array_elements(p_items) x where (x->>'curso_id')::bigint = s.curso_id and (x->>'turno_id')::int = s.turno_id limit 1;
    if i is null or coalesce(i->>'matricula', '') = '' or coalesce(i->>'asistencia', '') = ''
       or (es_especial and coalesce(i->>'inclusion', '') = '') then
      raise exception 'Completá la matrícula, inclusión y asistencia de todos los cursos';
    end if;
    mat := (i->>'matricula')::int;
    incl := coalesce(nullif(i->>'inclusion', '')::int, 0);
    asi := (i->>'asistencia')::int;
    if mat < 0 or incl < 0 or asi < 0 or mat > 99999 or incl > 99999 or asi > 99999 then
      raise exception 'Los valores deben estar entre 0 y 99999';
    end if;
    if asi > mat then raise exception 'La asistencia no puede ser mayor que la matrícula'; end if;
    filas := filas || jsonb_build_object('p', s.plan_id, 'c', s.curso_id, 't', s.turno_id, 's', s.secciones, 'm', mat, 'i', incl, 'a', asi);
    n := n + 1;
  end loop;
  if jsonb_array_length(p_items) <> n then raise exception 'Hay datos que no corresponden a la planta de la escuela'; end if;

  if k.id is not null then
    cid := k.id;
    update public.matricula_cargas set confirmada_at = now(), updated_by = auth.uid() where id = cid;
    delete from public.matricula_datos where carga_id = cid;
  else
    insert into public.matricula_cargas (escuela_id, ciclo, mes, confirmada_at, updated_by) values (v_escuela, p_ciclo, p_mes, now(), auth.uid()) returning id into cid;
  end if;
  insert into public.matricula_datos (carga_id, plan_id, curso_id, turno_id, secciones, matricula, inclusion, asistencia)
    select cid, (x->>'p')::bigint, (x->>'c')::bigint, (x->>'t')::int, (x->>'s')::int, (x->>'m')::int, (x->>'i')::int, (x->>'a')::int from unnest(filas) x;
end $$;
