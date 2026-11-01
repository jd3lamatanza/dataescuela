-- Administración: planes de estudio y agrupamientos (operaciones atómicas)

create or replace function public.plan_guardar(
  p_id bigint, p_nombre text, p_nivel bigint, p_modalidad bigint, p_cursos text[], p_activo boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare pid bigint := p_id; n integer := coalesce(array_length(p_cursos, 1), 0); i integer;
begin
  if public.real_role() is distinct from 'admin' then raise exception 'Sin permiso'; end if;
  p_nombre := trim(p_nombre);
  if length(p_nombre) < 3 then raise exception 'Completá el nombre del plan'; end if;
  if n < 1 or n > 20 then raise exception 'La cantidad de cursos debe estar entre 1 y 20'; end if;
  if exists (select 1 from unnest(p_cursos) c where length(trim(c)) = 0) then raise exception 'Completá el nombre de todos los cursos'; end if;
  if not exists (select 1 from public.catalogos where id = p_nivel and coleccion = 'nivel') then raise exception 'Nivel no válido'; end if;
  if not exists (select 1 from public.catalogos where id = p_modalidad and coleccion = 'modalidad') then raise exception 'Modalidad no válida'; end if;
  if exists (select 1 from public.planes_estudio where lower(nombre) = lower(p_nombre) and id is distinct from p_id) then
    raise exception 'Ya existe un plan con ese nombre';
  end if;

  if pid is null then
    insert into public.planes_estudio (nombre, nivel_id, modalidad_id, cantidad_cursos, activo, updated_by)
    values (p_nombre, p_nivel, p_modalidad, n, p_activo, auth.uid()) returning id into pid;
  else
    update public.planes_estudio set nombre = p_nombre, nivel_id = p_nivel, modalidad_id = p_modalidad,
      cantidad_cursos = n, activo = p_activo, updated_at = now(), updated_by = auth.uid() where id = pid;
    if not found then raise exception 'Plan no encontrado'; end if;
    -- los cursos que se quitan no pueden estar usados por plantas o matrículas
    if exists (
      select 1 from public.planes_cursos c where c.plan_id = pid and c.orden > n
        and (exists (select 1 from public.planta_secciones s where s.curso_id = c.id)
          or exists (select 1 from public.matricula_datos d where d.curso_id = c.id))
    ) then raise exception 'No se pueden quitar cursos que ya tienen plantas o matrícula cargadas'; end if;
    delete from public.planes_cursos where plan_id = pid and orden > n;
  end if;

  for i in 1..n loop
    insert into public.planes_cursos (plan_id, orden, nombre) values (pid, i, trim(p_cursos[i]))
    on conflict (plan_id, orden) do update set nombre = excluded.nombre;
  end loop;
  return pid;
end $$;

create or replace function public.plan_estado(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare v boolean;
begin
  if public.real_role() is distinct from 'admin' then raise exception 'Sin permiso'; end if;
  update public.planes_estudio set activo = not activo, updated_at = now(), updated_by = auth.uid()
  where id = p_id returning activo into v;
  if v is null then raise exception 'Plan no encontrado'; end if;
  return v;
end $$;

create or replace function public.agrupamiento_guardar(p_id bigint, p_nombre text, p_codigos text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare gid bigint := p_id; ocupado text;
begin
  if public.real_role() is distinct from 'admin' then raise exception 'Sin permiso'; end if;
  p_nombre := trim(p_nombre);
  if length(p_nombre) < 2 then raise exception 'Completá el nombre del agrupamiento'; end if;
  if coalesce(array_length(p_codigos, 1), 0) = 0 then raise exception 'Seleccioná al menos un código de escuela'; end if;
  if exists (select 1 from public.agrupamientos_matricula where lower(nombre) = lower(p_nombre) and id is distinct from p_id) then
    raise exception 'Ya existe un agrupamiento con ese nombre';
  end if;
  select string_agg(k.codigo || ' (' || a.nombre || ')', ', ') into ocupado
  from public.agrupamiento_codigos k join public.agrupamientos_matricula a on a.id = k.agrupamiento_id
  where k.agrupamiento_id is distinct from p_id and k.codigo = any (p_codigos);
  if ocupado is not null then raise exception 'Ya asignado: %', ocupado; end if;

  if gid is null then
    insert into public.agrupamientos_matricula (nombre, updated_by) values (p_nombre, auth.uid()) returning id into gid;
  else
    update public.agrupamientos_matricula set nombre = p_nombre, updated_by = auth.uid(), updated_at = now() where id = gid;
    if not found then raise exception 'Agrupamiento no encontrado'; end if;
    delete from public.agrupamiento_codigos where agrupamiento_id = gid;
  end if;
  insert into public.agrupamiento_codigos (agrupamiento_id, codigo) select gid, distinct_c from (select distinct unnest(p_codigos) distinct_c) x;
  return gid;
end $$;

-- Códigos de escuela existentes con su cantidad (para armar agrupamientos)
create or replace function public.codigos_escuela() returns table (codigo text, n bigint)
language sql stable security definer set search_path = public as $$
  select e.codigo, count(*) from (select distinct on (cue) codigo from public.escuelas order by cue, id) e
  where e.codigo is not null and e.codigo <> '' group by e.codigo order by e.codigo
$$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._crear_auth(uuid, text, text) from authenticated, anon, public;
