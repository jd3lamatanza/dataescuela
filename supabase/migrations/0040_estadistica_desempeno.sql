create table public.estadistica_desempeno (
  clave text not null,
  ciclo integer not null check (ciclo between 2000 and 2100),
  trimestre smallint not null check (trimestre between 1 and 3),
  anio text not null,
  fecha date not null,
  matricula integer check (matricula >= 0),
  aprobadas integer check (aprobadas >= 0),
  de_1_2 integer check (de_1_2 >= 0),
  de_3_4 integer check (de_3_4 >= 0),
  mas_5 integer check (mas_5 >= 0),
  ninguna integer check (ninguna >= 0),
  sin_info integer check (sin_info >= 0),
  updated_at timestamptz not null default now(),
  primary key (clave, ciclo, trimestre, anio)
);

alter table public.estadistica_desempeno enable row level security;
create policy estadistica_desempeno_select on public.estadistica_desempeno for select to authenticated
  using (
    (public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())))
    and exists (select 1 from public.escuelas e where e.clave = estadistica_desempeno.clave)
  );
grant select on public.estadistica_desempeno to authenticated;

create function public.estadistica_desempeno_importar(p_fecha date, p_ciclo integer, p_trimestre integer, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_guardadas integer;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_fecha is null or p_ciclo is null or p_ciclo not between 2000 and 2100 or p_trimestre is null or p_trimestre not between 1 and 3
     or jsonb_typeof(p_filas) is distinct from 'array' then raise exception 'Archivo inválido'; end if;
  v_total := jsonb_array_length(p_filas);
  if v_total < 1 or v_total > 20000 then raise exception 'Cantidad de filas inválida'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, anio text, matricula integer, aprobadas integer, de_1_2 integer,
      de_3_4 integer, mas_5 integer, ninguna integer, sin_info integer)
    where r.clave is null or r.anio is null or length(r.anio) > 40
      or not exists (select 1 from public.escuelas e where e.clave = r.clave)
      or r.matricula < 0 or r.aprobadas < 0 or r.de_1_2 < 0 or r.de_3_4 < 0 or r.mas_5 < 0 or r.ninguna < 0 or r.sin_info < 0
  ) then raise exception 'El archivo contiene datos inválidos o escuelas fuera del padrón distrital'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_filas) as r(clave text, anio text) group by r.clave, r.anio having count(*) > 1
  ) then raise exception 'Hay años de estudio repetidos para una escuela'; end if;

  insert into public.estadistica_desempeno as actual (clave, ciclo, trimestre, anio, fecha, matricula, aprobadas, de_1_2, de_3_4, mas_5, ninguna, sin_info)
  select r.clave, p_ciclo, p_trimestre, r.anio, p_fecha, r.matricula, r.aprobadas, r.de_1_2, r.de_3_4, r.mas_5, r.ninguna, r.sin_info
  from jsonb_to_recordset(p_filas) as r(clave text, anio text, matricula integer, aprobadas integer, de_1_2 integer,
      de_3_4 integer, mas_5 integer, ninguna integer, sin_info integer)
  on conflict (clave, ciclo, trimestre, anio) do update
    set fecha = excluded.fecha, matricula = excluded.matricula, aprobadas = excluded.aprobadas, de_1_2 = excluded.de_1_2,
        de_3_4 = excluded.de_3_4, mas_5 = excluded.mas_5, ninguna = excluded.ninguna, sin_info = excluded.sin_info, updated_at = now()
    where excluded.fecha >= actual.fecha;
  get diagnostics v_guardadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'anteriores', v_total - v_guardadas);
end $$;
revoke all on function public.estadistica_desempeno_importar(date, integer, integer, jsonb) from public, anon;
grant execute on function public.estadistica_desempeno_importar(date, integer, integer, jsonb) to authenticated;
