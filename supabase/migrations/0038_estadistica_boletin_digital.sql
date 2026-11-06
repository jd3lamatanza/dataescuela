create table public.estadistica_boletin_digital (
  clave text primary key,
  fecha date not null,
  trimestre text,
  completo integer check (completo >= 0),
  parcial integer check (parcial >= 0),
  sin_carga integer check (sin_carga >= 0),
  updated_at timestamptz not null default now()
);

alter table public.estadistica_boletin_digital enable row level security;
create policy estadistica_boletin_select on public.estadistica_boletin_digital for select to authenticated
  using (
    (public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())))
    and exists (select 1 from public.escuelas e where e.clave = estadistica_boletin_digital.clave)
  );
grant select on public.estadistica_boletin_digital to authenticated;

create function public.estadistica_boletin_importar(p_fecha date, p_trimestre text, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_guardadas integer;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_fecha is null or jsonb_typeof(p_filas) is distinct from 'array' or length(coalesce(p_trimestre, '')) > 40 then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total < 1 or v_total > 10000 then raise exception 'Cantidad de escuelas inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, completo integer, parcial integer, sin_carga integer)
    where r.clave is null or not exists (select 1 from public.escuelas e where e.clave = r.clave)
      or r.completo < 0 or r.parcial < 0 or r.sin_carga < 0
  ) then raise exception 'El archivo contiene datos inválidos o escuelas fuera del padrón distrital'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text) group by r.clave having count(*) > 1
  ) then raise exception 'Hay claves de escuela repetidas'; end if;

  insert into public.estadistica_boletin_digital as actual (clave, fecha, trimestre, completo, parcial, sin_carga)
  select r.clave, p_fecha, p_trimestre, r.completo, r.parcial, r.sin_carga
  from jsonb_to_recordset(p_filas) as r(clave text, completo integer, parcial integer, sin_carga integer)
  on conflict (clave) do update
    set fecha = excluded.fecha, trimestre = excluded.trimestre, completo = excluded.completo,
        parcial = excluded.parcial, sin_carga = excluded.sin_carga, updated_at = now()
    where excluded.fecha >= actual.fecha;
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'anteriores', v_total - v_guardadas);
end $$;
revoke all on function public.estadistica_boletin_importar(date, text, jsonb) from public, anon;
grant execute on function public.estadistica_boletin_importar(date, text, jsonb) to authenticated;
