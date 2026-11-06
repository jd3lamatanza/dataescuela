create table public.estadistica_matricula_sin_cierre (
  clave text primary key,
  fecha date not null,
  sin_cierre integer check (sin_cierre >= 0),
  updated_at timestamptz not null default now()
);

alter table public.estadistica_matricula_sin_cierre enable row level security;
create policy estadistica_sin_cierre_select on public.estadistica_matricula_sin_cierre for select to authenticated
  using (
    (public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())))
    and exists (select 1 from public.escuelas e where e.clave = estadistica_matricula_sin_cierre.clave)
  );
grant select on public.estadistica_matricula_sin_cierre to authenticated;

create function public.estadistica_sin_cierre_importar(p_fecha date, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_guardadas integer;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_fecha is null or jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total < 1 or v_total > 10000 then raise exception 'Cantidad de escuelas inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, sin_cierre integer)
    where r.clave is null or not exists (select 1 from public.escuelas e where e.clave = r.clave) or r.sin_cierre < 0
  ) then raise exception 'El archivo contiene datos inválidos o escuelas fuera del padrón distrital'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text) group by r.clave having count(*) > 1
  ) then raise exception 'Hay claves de escuela repetidas'; end if;

  insert into public.estadistica_matricula_sin_cierre as actual (clave, fecha, sin_cierre)
  select r.clave, p_fecha, r.sin_cierre
  from jsonb_to_recordset(p_filas) as r(clave text, sin_cierre integer)
  on conflict (clave) do update
    set fecha = excluded.fecha, sin_cierre = excluded.sin_cierre, updated_at = now()
    where excluded.fecha >= actual.fecha;
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'anteriores', v_total - v_guardadas);
end $$;
revoke all on function public.estadistica_sin_cierre_importar(date, jsonb) from public, anon;
grant execute on function public.estadistica_sin_cierre_importar(date, jsonb) to authenticated;
