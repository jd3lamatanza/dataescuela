create table public.estadistica_asistencia (
  clave text not null,
  anio text not null,
  fecha date not null,
  ciclo integer,
  matricula integer check (matricula >= 0),
  menos_10 integer check (menos_10 >= 0),
  de_10_19 integer check (de_10_19 >= 0),
  de_20_27 integer check (de_20_27 >= 0),
  de_28_44 integer check (de_28_44 >= 0),
  mas_45 integer check (mas_45 >= 0),
  sin_info integer check (sin_info >= 0),
  updated_at timestamptz not null default now(),
  primary key (clave, anio)
);

alter table public.estadistica_asistencia enable row level security;
create policy estadistica_asistencia_select on public.estadistica_asistencia for select to authenticated
  using (
    (public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())))
    and exists (select 1 from public.escuelas e where e.clave = estadistica_asistencia.clave)
  );
grant select on public.estadistica_asistencia to authenticated;

create function public.estadistica_asistencia_importar(p_fecha date, p_ciclo integer, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_guardadas integer;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_fecha is null or jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total < 1 or v_total > 20000 then raise exception 'Cantidad de filas inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, anio text, matricula integer, menos_10 integer, de_10_19 integer,
      de_20_27 integer, de_28_44 integer, mas_45 integer, sin_info integer)
    where r.clave is null or r.anio is null or length(r.anio) > 40
      or not exists (select 1 from public.escuelas e where e.clave = r.clave)
      or r.matricula < 0 or r.menos_10 < 0 or r.de_10_19 < 0 or r.de_20_27 < 0 or r.de_28_44 < 0 or r.mas_45 < 0 or r.sin_info < 0
  ) then raise exception 'El archivo contiene datos inválidos o escuelas fuera del padrón distrital'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, anio text) group by r.clave, r.anio having count(*) > 1
  ) then raise exception 'Hay años de estudio repetidos para una escuela'; end if;

  insert into public.estadistica_asistencia as actual (clave, anio, fecha, ciclo, matricula, menos_10, de_10_19, de_20_27, de_28_44, mas_45, sin_info)
  select r.clave, r.anio, p_fecha, p_ciclo, r.matricula, r.menos_10, r.de_10_19, r.de_20_27, r.de_28_44, r.mas_45, r.sin_info
  from jsonb_to_recordset(p_filas) as r(clave text, anio text, matricula integer, menos_10 integer, de_10_19 integer,
      de_20_27 integer, de_28_44 integer, mas_45 integer, sin_info integer)
  on conflict (clave, anio) do update
    set fecha = excluded.fecha, ciclo = excluded.ciclo, matricula = excluded.matricula, menos_10 = excluded.menos_10,
        de_10_19 = excluded.de_10_19, de_20_27 = excluded.de_20_27, de_28_44 = excluded.de_28_44,
        mas_45 = excluded.mas_45, sin_info = excluded.sin_info, updated_at = now()
    where excluded.fecha >= actual.fecha;
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'anteriores', v_total - v_guardadas);
end $$;
revoke all on function public.estadistica_asistencia_importar(date, integer, jsonb) from public, anon;
grant execute on function public.estadistica_asistencia_importar(date, integer, jsonb) to authenticated;
