create table public.estadistica_salidas_sin_ingreso (
  id bigint generated always as identity primary key,
  nivel text not null check (nivel in ('inicial', 'primario', 'secundario')),
  fecha date not null,
  clave text not null,
  nombre text,
  apellido text,
  dni text,
  turno text,
  anio text,
  seccion text,
  estado text
);
create index estadistica_salidas_clave_idx on public.estadistica_salidas_sin_ingreso (clave);
create index estadistica_salidas_nivel_idx on public.estadistica_salidas_sin_ingreso (nivel);

alter table public.estadistica_salidas_sin_ingreso enable row level security;
create policy estadistica_salidas_select on public.estadistica_salidas_sin_ingreso for select to authenticated
  using (
    (public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())))
    and exists (select 1 from public.escuelas e where e.clave = estadistica_salidas_sin_ingreso.clave)
  );
grant select on public.estadistica_salidas_sin_ingreso to authenticated;

create function public.estadistica_salidas_importar(p_nivel text, p_fecha date, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_eliminadas integer;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_nivel not in ('inicial', 'primario', 'secundario') or p_fecha is null
     or jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total > 50000 then raise exception 'Cantidad de estudiantes inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text)
    where r.clave is null or not exists (select 1 from public.escuelas e where e.clave = r.clave)
  ) then raise exception 'El archivo contiene escuelas fuera del padrón distrital'; end if;

  delete from public.estadistica_salidas_sin_ingreso where nivel = p_nivel;
  get diagnostics v_eliminadas = row_count;
  insert into public.estadistica_salidas_sin_ingreso (nivel, fecha, clave, nombre, apellido, dni, turno, anio, seccion, estado)
  select p_nivel, p_fecha, r.clave, r.nombre, r.apellido, r.dni, r.turno, r.anio, r.seccion, r.estado
  from jsonb_to_recordset(p_filas) as r(clave text, nombre text, apellido text, dni text, turno text, anio text, seccion text, estado text);
  return jsonb_build_object('guardados', v_total, 'eliminados', v_eliminadas);
end $$;
revoke all on function public.estadistica_salidas_importar(text, date, jsonb) from public, anon;
grant execute on function public.estadistica_salidas_importar(text, date, jsonb) to authenticated;
