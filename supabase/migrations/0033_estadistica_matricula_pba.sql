create table public.estadistica_matricula_pba (
  clave text primary key,
  fecha date not null,
  activa integer check (activa >= 0),
  anterior integer check (anterior >= 0),
  inicial integer check (inicial >= 0),
  updated_at timestamptz not null default now()
);

alter table public.estadistica_matricula_pba enable row level security;
create policy estadistica_pba_select on public.estadistica_matricula_pba for select to authenticated
  using (public.app_role() = 'areal' and clave = any(public.claves_asignadas())
    and exists (select 1 from public.escuelas e where e.clave = estadistica_matricula_pba.clave));
grant select on public.estadistica_matricula_pba to authenticated;

create function public.estadistica_pba_importar(p_fecha date, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_guardadas integer;
begin
  if public.app_role() is distinct from 'areal' then raise exception 'Sin permiso'; end if;
  if p_fecha is null or jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total < 1 or v_total > 10000 then raise exception 'Cantidad de escuelas inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, activa integer, anterior integer, inicial integer)
    where r.clave is null or not (r.clave = any(public.claves_asignadas()))
      or not exists (select 1 from public.escuelas e where e.clave = r.clave)
      or r.activa < 0 or r.anterior < 0 or r.inicial < 0
  ) then raise exception 'El archivo contiene datos inválidos o escuelas no asignadas'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text)
    group by r.clave having count(*) > 1
  ) then raise exception 'Hay claves de escuela repetidas'; end if;

  insert into public.estadistica_matricula_pba as actual (clave, fecha, activa, anterior, inicial)
  select r.clave, p_fecha, r.activa, r.anterior, r.inicial
  from jsonb_to_recordset(p_filas) as r(clave text, activa integer, anterior integer, inicial integer)
  on conflict (clave) do update
    set fecha = excluded.fecha, activa = excluded.activa, anterior = excluded.anterior,
        inicial = excluded.inicial, updated_at = now()
    where excluded.fecha >= actual.fecha;
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'anteriores', v_total - v_guardadas);
end $$;
revoke all on function public.estadistica_pba_importar(date, jsonb) from public, anon;
grant execute on function public.estadistica_pba_importar(date, jsonb) to authenticated;
