create table public.estadistica_fichas_inscripcion (
  clave text primary key,
  fecha date not null,
  matricula integer check (matricula >= 0),
  dni_tramite integer check (dni_tramite >= 0),
  dni_sin_tramite integer check (dni_sin_tramite >= 0),
  sin_dni integer check (sin_dni >= 0),
  genero integer check (genero >= 0),
  nacimiento integer check (nacimiento >= 0),
  salud integer check (salud >= 0),
  inclusion integer check (inclusion >= 0),
  complementaria integer check (complementaria >= 0),
  updated_at timestamptz not null default now()
);

alter table public.estadistica_fichas_inscripcion enable row level security;
create policy estadistica_fichas_select on public.estadistica_fichas_inscripcion for select to authenticated
  using (
    (public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())))
    and exists (select 1 from public.escuelas e where e.clave = estadistica_fichas_inscripcion.clave)
  );
grant select on public.estadistica_fichas_inscripcion to authenticated;

create function public.estadistica_fichas_importar(p_fecha date, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_guardadas integer;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_fecha is null or jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total < 1 or v_total > 10000 then raise exception 'Cantidad de escuelas inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, matricula integer, dni_tramite integer, dni_sin_tramite integer,
      sin_dni integer, genero integer, nacimiento integer, salud integer, inclusion integer, complementaria integer)
    where r.clave is null
      or not exists (select 1 from public.escuelas e where e.clave = r.clave)
      or r.matricula < 0 or r.dni_tramite < 0 or r.dni_sin_tramite < 0 or r.sin_dni < 0 or r.genero < 0
      or r.nacimiento < 0 or r.salud < 0 or r.inclusion < 0 or r.complementaria < 0
  ) then raise exception 'El archivo contiene datos inválidos o escuelas fuera del padrón distrital'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text)
    group by r.clave having count(*) > 1
  ) then raise exception 'Hay claves de escuela repetidas'; end if;

  insert into public.estadistica_fichas_inscripcion as actual
    (clave, fecha, matricula, dni_tramite, dni_sin_tramite, sin_dni, genero, nacimiento, salud, inclusion, complementaria)
  select r.clave, p_fecha, r.matricula, r.dni_tramite, r.dni_sin_tramite, r.sin_dni, r.genero, r.nacimiento, r.salud, r.inclusion, r.complementaria
  from jsonb_to_recordset(p_filas) as r(clave text, matricula integer, dni_tramite integer, dni_sin_tramite integer,
      sin_dni integer, genero integer, nacimiento integer, salud integer, inclusion integer, complementaria integer)
  on conflict (clave) do update
    set fecha = excluded.fecha, matricula = excluded.matricula, dni_tramite = excluded.dni_tramite,
        dni_sin_tramite = excluded.dni_sin_tramite, sin_dni = excluded.sin_dni, genero = excluded.genero,
        nacimiento = excluded.nacimiento, salud = excluded.salud, inclusion = excluded.inclusion,
        complementaria = excluded.complementaria, updated_at = now()
    where excluded.fecha >= actual.fecha;
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'anteriores', v_total - v_guardadas);
end $$;
revoke all on function public.estadistica_fichas_importar(date, jsonb) from public, anon;
grant execute on function public.estadistica_fichas_importar(date, jsonb) to authenticated;
