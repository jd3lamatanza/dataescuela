-- Planta y Matrícula: escrituras por RPC (security definer)

create or replace function public._hoy_ar() returns date language sql stable
as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

-- Escuela sobre la que opera el usuario: la propia (escolar) o la indicada (jefatura).
-- Solo la primera escuela de cada CUE tiene planta y matrícula.
create or replace function public._escuela_obj(p_escuela bigint) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role(); e bigint;
begin
  if r is not distinct from 'escolar' then
    e := public.mi_escuela();
  elsif r in ('admin','regional','distrital') then
    select min(x.id) into e from public.escuelas x where x.cue = (select cue from public.escuelas where id = p_escuela);
  end if;
  if e is null then raise exception 'No tenés una escuela asociada'; end if;
  return e;
end $$;

create or replace function public.planta_guardar(p_escuela bigint, p_total int, p_turnos int[], p_planes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  e bigint := public._escuela_obj(p_escuela);
  esc public.escuelas;
  pl public.plantas;
  pid bigint;
  tot int := 0;
  plan jsonb; s jsonb;
  v_plan bigint; v_curso bigint; v_turno int; n int;
  vistos bigint[] := '{}';
  rows jsonb[] := '{}';
begin
  select * into esc from public.escuelas where id = e;
  select * into pl from public.plantas where escuela_id = e;
  if pl.id is not null and not pl.editable and coalesce((select valor from public.ajustes where clave = 'planta_edicion'), '0') <> '1' then
    raise exception 'La planta ya está confirmada. Solo el Inspector o la Jefatura puede habilitar la edición.';
  end if;
  if coalesce(array_length(p_turnos, 1), 0) = 0 then raise exception 'Seleccioná al menos un turno'; end if;
  if jsonb_typeof(p_planes) is distinct from 'array' or jsonb_array_length(p_planes) = 0 then raise exception 'Agregá al menos un plan de estudio'; end if;
  if (select count(*) from public.turnos where activo and id = any (p_turnos)) <> (select count(distinct t) from unnest(p_turnos) t) then
    raise exception 'Turno no válido';
  end if;

  for plan in select * from jsonb_array_elements(p_planes) loop
    v_plan := (plan->>'plan_id')::bigint;
    if v_plan = any (vistos) then raise exception 'Un plan de estudio está repetido'; end if;
    vistos := vistos || v_plan;
    if not exists (select 1 from public.planes_estudio p where p.id = v_plan and p.activo
      and p.nivel_id in (select id from public.catalogos where coleccion = 'nivel' and nombre = esc.nivel)
      and p.modalidad_id in (select id from public.catalogos where coleccion = 'modalidad' and nombre = esc.modalidad)) then
      raise exception 'Plan de estudio no válido para el nivel y la modalidad de tu escuela';
    end if;
    for s in select * from jsonb_array_elements(coalesce(plan->'secciones', '[]')) loop
      v_curso := (s->>'curso_id')::bigint; v_turno := (s->>'turno_id')::int; n := (s->>'n')::int;
      if not exists (select 1 from public.planes_cursos where id = v_curso and plan_id = v_plan) or v_turno <> all (p_turnos) then
        raise exception 'Curso o turno no válido';
      end if;
      if n is null or n < 0 or n > 99 then raise exception 'Las secciones deben ser un número entre 0 y 99'; end if;
      if n > 0 then
        rows := rows || jsonb_build_object('p', v_plan, 'c', v_curso, 't', v_turno, 'n', n);
        tot := tot + n;
      end if;
    end loop;
  end loop;
  if tot < 1 then raise exception 'Cargá al menos una sección'; end if;
  if p_total is distinct from tot then raise exception 'El total confirmado no coincide con lo cargado. Revisá la información.'; end if;

  if pl.id is not null then
    pid := pl.id;
    update public.plantas set total_secciones = tot, editable = false, confirmada_at = now(), updated_by = auth.uid() where id = pid;
    delete from public.planta_turnos where planta_id = pid;
    delete from public.planta_secciones where planta_id = pid;
  else
    insert into public.plantas (escuela_id, total_secciones, updated_by) values (e, tot, auth.uid()) returning id into pid;
  end if;
  insert into public.planta_turnos (planta_id, turno_id) select pid, distinct_t from (select distinct unnest(p_turnos) as distinct_t) q;
  insert into public.planta_secciones (planta_id, plan_id, curso_id, turno_id, secciones)
    select pid, (x->>'p')::bigint, (x->>'c')::bigint, (x->>'t')::int, (x->>'n')::int from unnest(rows) x;
end $$;

create or replace function public.planta_edicion(p_escuela bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare r boolean;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  update public.plantas set editable = not editable, updated_by = auth.uid()
    where escuela_id = (select min(x.id) from public.escuelas x where x.cue = (select cue from public.escuelas where id = p_escuela))
    returning editable into r;
  if r is null then raise exception 'La escuela todavía no tiene planta'; end if;
  return r;
end $$;

create or replace function public.matricula_guardar(p_escuela bigint, p_ciclo int, p_mes int, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  e bigint := public._escuela_obj(p_escuela);
  hoy date := public._hoy_ar();
  k public.matricula_cargas;
  pl public.plantas;
  cid bigint;
  s record; i jsonb; mat int; asi int; n int := 0;
  filas jsonb[] := '{}';
begin
  if p_ciclo not between 2020 and 2100 or p_mes not between 1 and 12 then raise exception 'Período no válido'; end if;
  select * into k from public.matricula_cargas where escuela_id = e and ciclo = p_ciclo and mes = p_mes;
  if public.app_role() is not distinct from 'escolar'
     and not exists (select 1 from public.carga_activa c where c.ciclo = p_ciclo and c.mes = p_mes and c.carga and hoy between c.fecha_apertura and c.fecha_cierre)
     and not coalesce(k.habilitada, false) then
    raise exception 'Fuera de Período de Carga';
  end if;
  select * into pl from public.plantas where escuela_id = e;
  if pl.id is null then raise exception 'La escuela no tiene planta configurada'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Datos no válidos'; end if;

  for s in select plan_id, curso_id, turno_id, secciones from public.planta_secciones where planta_id = pl.id and secciones > 0 loop
    select x into i from jsonb_array_elements(p_items) x where (x->>'curso_id')::bigint = s.curso_id and (x->>'turno_id')::int = s.turno_id limit 1;
    if i is null or coalesce(i->>'matricula', '') = '' or coalesce(i->>'asistencia', '') = '' then
      raise exception 'Completá la matrícula y la asistencia de todos los cursos';
    end if;
    mat := (i->>'matricula')::int; asi := (i->>'asistencia')::int;
    if mat < 0 or asi < 0 or mat > 99999 or asi > 99999 then raise exception 'Los valores deben estar entre 0 y 99999'; end if;
    if asi > mat then raise exception 'La asistencia no puede ser mayor que la matrícula'; end if;
    filas := filas || jsonb_build_object('p', s.plan_id, 'c', s.curso_id, 't', s.turno_id, 's', s.secciones, 'm', mat, 'a', asi);
    n := n + 1;
  end loop;
  if jsonb_array_length(p_items) <> n then raise exception 'Hay datos que no corresponden a la planta de la escuela'; end if;

  if k.id is not null then
    cid := k.id;
    update public.matricula_cargas set confirmada_at = now(), updated_by = auth.uid() where id = cid;
    delete from public.matricula_datos where carga_id = cid;
  else
    insert into public.matricula_cargas (escuela_id, ciclo, mes, confirmada_at, updated_by) values (e, p_ciclo, p_mes, now(), auth.uid()) returning id into cid;
  end if;
  insert into public.matricula_datos (carga_id, plan_id, curso_id, turno_id, secciones, matricula, asistencia)
    select cid, (x->>'p')::bigint, (x->>'c')::bigint, (x->>'t')::int, (x->>'s')::int, (x->>'m')::int, (x->>'a')::int from unnest(filas) x;
end $$;

create or replace function public.matricula_habilitar(p_escuela bigint, p_ciclo int, p_mes int) returns boolean
language plpgsql security definer set search_path = public as $$
declare e bigint; r boolean;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  e := public._escuela_obj(p_escuela);
  insert into public.matricula_cargas (escuela_id, ciclo, mes, habilitada, updated_by) values (e, p_ciclo, p_mes, true, auth.uid())
    on conflict (escuela_id, ciclo, mes) do update set habilitada = not public.matricula_cargas.habilitada, updated_by = auth.uid()
    returning habilitada into r;
  return r;
end $$;

-- Copia o mueve una carga confirmada a otro período donde la escuela no tenga carga confirmada
create or replace function public.matricula_trasladar(p_carga bigint, p_ciclo int, p_mes int, p_mover boolean) returns void
language plpgsql security definer set search_path = public as $$
declare k public.matricula_cargas; d public.matricula_cargas; nid bigint;
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  select * into k from public.matricula_cargas where id = p_carga and confirmada_at is not null;
  if k.id is null then raise exception 'Carga no encontrada'; end if;
  if p_ciclo = k.ciclo and p_mes = k.mes then raise exception 'Elegí otro período'; end if;
  if not exists (select 1 from public.carga_activa where ciclo = p_ciclo and mes = p_mes) then raise exception 'Período no válido'; end if;
  select * into d from public.matricula_cargas where escuela_id = k.escuela_id and ciclo = p_ciclo and mes = p_mes;
  if d.confirmada_at is not null then raise exception 'La escuela ya tiene una carga en ese período'; end if;
  if p_mover then
    if d.id is not null then delete from public.matricula_cargas where id = d.id; end if;
    update public.matricula_cargas set ciclo = p_ciclo, mes = p_mes, updated_by = auth.uid() where id = k.id;
  else
    if d.id is not null then
      nid := d.id;
      update public.matricula_cargas set confirmada_at = now(), updated_by = auth.uid() where id = nid;
    else
      insert into public.matricula_cargas (escuela_id, ciclo, mes, confirmada_at, updated_by) values (k.escuela_id, p_ciclo, p_mes, now(), auth.uid()) returning id into nid;
    end if;
    insert into public.matricula_datos (carga_id, plan_id, curso_id, turno_id, secciones, matricula, asistencia)
      select nid, plan_id, curso_id, turno_id, secciones, matricula, asistencia from public.matricula_datos where carga_id = k.id;
  end if;
end $$;

create or replace function public.matricula_eliminar(p_carga bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Sin permiso'; end if;
  delete from public.matricula_cargas where id = p_carga;
end $$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._crear_auth(uuid,text,text), public._puede_gestionar(text), public._mi_origen(), public._notificar(uuid,text,text,text), public._resolver_destino(text,text,text), public._dni_ubicacion(int,text,bigint), public._escuela_obj(bigint), public._hoy_ar() from authenticated;
