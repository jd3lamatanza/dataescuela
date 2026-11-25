-- Rol eav: ve y confirma las preinscripciones de su escuela y puede cargarlas manualmente.

create policy eav_preinscripciones_eav on public.eav_preinscripciones
for select to authenticated using (
  public.app_role() = 'eav'
  and public.real_role() in ('eav', 'distrital')
  and escuela_eav_id = public.mi_escuela()
);

-- La función interna no es ejecutable por clientes (permisos revocados): el control de acceso queda en quien la invoca.
create or replace function public.eav_preinscribir_interno(
  p_escuela bigint, p_dni text, p_nombre text, p_nacimiento date, p_genero text,
  p_actual bigint, p_otra text, p_domicilio text, p_responsable text, p_vinculo text, p_telefono text, p_email text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_fecha date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_temporada integer := extract(year from v_fecha)::integer + case when extract(month from v_fecha) = 1 then 0 else 1 end;
  v_cupos integer;
begin
  if coalesce(p_dni, '') !~ '^[0-9]{7,8}$'
    or p_nacimiento is null or p_nacimiento > v_fecha
    or p_genero not in ('Varón', 'Mujer', 'No Binario') or p_genero is null
    or p_vinculo not in ('Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro') or p_vinculo is null
    or length(btrim(coalesce(p_nombre, ''))) not between 3 and 200
    or length(btrim(coalesce(p_domicilio, ''))) not between 3 and 200
    or length(btrim(coalesce(p_responsable, ''))) not between 3 and 200
    or btrim(coalesce(p_telefono, '')) !~ '^[+0-9 ()-]{6,40}$'
    or length(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g')) < 6
    or btrim(coalesce(p_email, '')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or length(coalesce(p_email, '')) > 120
    or ((p_actual is null) = (nullif(btrim(coalesce(p_otra, '')), '') is null))
    or length(coalesce(p_otra, '')) > 200 then
    return 'invalido';
  end if;
  if p_actual is not null and not exists (select 1 from public.escuelas where id = p_actual) then return 'invalido'; end if;
  perform 1 from public.escuelas where id = p_escuela and eav = 'Sí' for update;
  if not found then return 'escuela'; end if;
  select cupos into v_cupos from public.eav_cupos where escuela_id = p_escuela for update;
  if not found then return 'sin_cupo'; end if;
  if exists (select 1 from public.eav_preinscripciones where temporada = v_temporada and dni = p_dni) then return 'duplicado'; end if;
  if v_cupos > 0 and (select count(*) from public.eav_preinscripciones where temporada = v_temporada and escuela_eav_id = p_escuela) >= v_cupos then return 'sin_cupo'; end if;
  begin
    insert into public.eav_preinscripciones (temporada, escuela_eav_id, dni, nombre, nacimiento, genero, escuela_actual_id, escuela_actual_otra, domicilio, responsable, vinculo, telefono, email)
    values (v_temporada, p_escuela, p_dni, btrim(p_nombre), p_nacimiento, p_genero, p_actual, nullif(btrim(p_otra), ''), btrim(p_domicilio), btrim(p_responsable), p_vinculo, btrim(p_telefono), lower(btrim(p_email)));
  exception when unique_violation then
    return 'duplicado';
  end;
  return 'ok';
end $$;

create or replace function public.eav_confirmar_inscripcion(p_id bigint, p_legajo_completo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() not in ('escolar', 'eav')
    or coalesce(public.real_role(), '') not in ('escolar', 'eav', 'distrital') then
    raise exception 'Sin permiso';
  end if;
  if p_legajo_completo is null then raise exception 'Indicá el estado del legajo'; end if;
  if not exists (select 1 from public.escuelas where id=public.mi_escuela() and eav='Sí') then
    raise exception 'La escuela no está activa en Escuela de Verano';
  end if;
  update public.eav_preinscripciones
  set inscrito_en=now(), legajo_completo=p_legajo_completo, inscrito_por=public.eff_uid()
  where id=p_id and escuela_eav_id=public.mi_escuela() and inscrito_en is null;
  if not found then raise exception 'La preinscripción no está disponible o ya fue confirmada'; end if;
end $$;

create function public.eav_preinscripcion_cargar(
  p_dni text, p_nombre text, p_nacimiento date, p_genero text, p_actual bigint, p_otra text,
  p_domicilio text, p_responsable text, p_vinculo text, p_telefono text, p_email text
) returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if public.app_role() is distinct from 'eav' or coalesce(public.real_role(), '') not in ('eav', 'distrital') then
    raise exception 'Sin permiso';
  end if;
  r := public.eav_preinscribir_interno(public.mi_escuela(), p_dni, p_nombre, p_nacimiento, p_genero,
    p_actual, p_otra, p_domicilio, p_responsable, p_vinculo, p_telefono, p_email);
  if r = 'ok' then return; end if;
  raise exception '%', case r
    when 'invalido' then 'Revisá los datos ingresados'
    when 'escuela' then 'La escuela no está activa en Escuela de Verano'
    when 'sin_cupo' then 'No hay cupo disponible en la escuela de verano'
    when 'duplicado' then 'Ese DNI ya está preinscripto en esta temporada'
    else 'No se pudo cargar la preinscripción' end;
end $$;
revoke all on function public.eav_preinscripcion_cargar(text, text, date, text, bigint, text, text, text, text, text, text) from public, anon;
grant execute on function public.eav_preinscripcion_cargar(text, text, date, text, bigint, text, text, text, text, text, text) to authenticated;

-- Lista de escuelas para elegir la escuela actual del estudiante (la misma que muestra el formulario público).
create function public.eav_escuelas_opciones() returns table (id bigint, nombre text, tipo text, numero integer, codigo text, localidad text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'eav' then raise exception 'Sin permiso'; end if;
  return query select e.id, e.nombre, e.tipo, e.numero, e.codigo, e.localidad from public.escuelas e order by e.id;
end $$;
revoke all on function public.eav_escuelas_opciones() from public, anon;
grant execute on function public.eav_escuelas_opciones() to authenticated;
