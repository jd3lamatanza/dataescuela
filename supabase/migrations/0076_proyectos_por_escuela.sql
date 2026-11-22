create function public.proyectos_por_escuela(
  p_busqueda text default '', p_nivel text default '', p_modalidad text default '',
  p_lim integer default 15, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare resultado jsonb;
begin
  if public.app_role() not in ('areal', 'distrital') or public.app_role() is null then raise exception 'Sin permiso'; end if;
  if p_lim is null or p_lim < 1 or p_lim > 100 or p_offset is null or p_offset < 0 then raise exception 'Paginación inválida'; end if;
  with visibles as materialized (
    select e.id, e.cue, e.clave, e.codigo, e.tipo, e.numero, e.nombre, e.nivel, e.modalidad
    from public.escuelas e
    where public.app_role() = 'distrital'
      or (public.app_role() = 'areal' and e.clave = any(public.claves_asignadas()))
  ), filtradas as (
    select * from visibles e
    where (coalesce(p_nivel, '') = '' or e.nivel = p_nivel)
      and (coalesce(p_modalidad, '') = '' or e.modalidad = p_modalidad)
      and (coalesce(btrim(p_busqueda), '') = '' or concat_ws(' ', e.clave, e.cue, e.codigo, e.tipo, e.numero, e.nombre)
        ilike '%' || replace(replace(replace(btrim(p_busqueda), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), pagina as (
    select e.*, row_number() over (order by e.clave asc nulls last, e.id) posicion
    from filtradas e order by e.clave asc nulls last, e.id limit p_lim offset p_offset
  ), detalle as (
    select p.*,
      case when c.cue is null and exists (select 1 from public.proyectos_escolares x where x.cue = p.cue)
        then null
        else (select count(*) from public.proyectos_escolares x where x.cue = p.cue and c.clave = p.clave)
      end cantidad,
      (select count(*) > 1 from public.escuelas e where e.cue = p.cue and e.clave = p.clave) compartida
    from pagina p left join public.proyecto_carpetas c on c.cue = p.cue
  )
  select jsonb_build_object(
    'total', (select count(*) from filtradas),
    'niveles', coalesce((select jsonb_agg(nivel order by nivel) from (select distinct nivel from visibles where nullif(btrim(nivel), '') is not null) n), '[]'::jsonb),
    'modalidades', coalesce((select jsonb_agg(modalidad order by modalidad) from (select distinct modalidad from visibles where nullif(btrim(modalidad), '') is not null) m), '[]'::jsonb),
    'filas', coalesce((select jsonb_agg(to_jsonb(detalle) - 'posicion' order by posicion) from detalle), '[]'::jsonb)
  ) into resultado;
  return resultado;
end $$;
revoke all on function public.proyectos_por_escuela(text,text,text,integer,integer) from public, anon;
grant execute on function public.proyectos_por_escuela(text,text,text,integer,integer) to authenticated;

update public.ayuda_guias
set secciones = secciones || '[
  {"titulo":"Seguimiento por escuela","pasos":[
    "En Proyectos Escolares, la pestaña «Escuelas» muestra la cantidad de proyectos de cada escuela, incluso si todavía no cargó ninguno.",
    "Podés buscar por escuela, clave o CUE y filtrar por nivel y modalidad. Si varias escuelas comparten CUE y clave, la cantidad es compartida y no identifica cuál realizó la carga."
  ]}
]'::jsonb, version = version + 1, actualizado = now()
where id = 'mis-proyectos';
