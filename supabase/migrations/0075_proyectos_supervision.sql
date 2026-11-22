create function public.proyecto_visible(p_cue text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.app_role()
    when 'escolar' then p_cue = public.app_cue()
    when 'distrital' then true
    when 'areal' then exists (
      select 1 from public.proyecto_carpetas c
      join public.escuelas e on e.cue = c.cue and e.clave = c.clave
      where c.cue = p_cue and c.clave = any(public.claves_asignadas())
    )
    else false
  end
$$;
revoke all on function public.proyecto_visible(text) from public, anon;
grant execute on function public.proyecto_visible(text) to authenticated;

create policy proyectos_supervision_sel on public.proyectos_escolares for select to authenticated
  using (public.app_role() in ('areal', 'distrital') and public.proyecto_visible(cue));

create function public.proyectos_supervision(
  p_busqueda text default '', p_tipo text default '', p_orden text default 'recientes',
  p_lim integer default 15, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare resultado jsonb;
begin
  if public.app_role() not in ('areal', 'distrital') or public.app_role() is null then raise exception 'Sin permiso'; end if;
  if p_lim is null or p_lim < 1 or p_lim > 100 or p_offset is null or p_offset < 0 then raise exception 'Paginación inválida'; end if;
  if p_orden is null or p_orden not in ('recientes', 'antiguos', 'escuela', 'tipo', 'archivo') then raise exception 'Orden inválido'; end if;
  with filtradas as (
    select p.id, p.cue, p.tipo, p.otro_tipo, p.nombre, p.bytes, p.created_at,
      coalesce(c.clave, '') clave, coalesce(e.nombre, '') escuela,
      coalesce(e.tipo, '') escuela_tipo, e.numero escuela_numero
    from public.proyectos_escolares p
    left join public.proyecto_carpetas c on c.cue = p.cue
    left join lateral (
      select esc.nombre, esc.tipo, esc.numero from public.escuelas esc
      where esc.cue = p.cue and esc.clave = c.clave order by esc.id limit 1
    ) e on true
    where public.proyecto_visible(p.cue)
      and (coalesce(p_tipo, '') = '' or p.tipo = p_tipo)
      and (coalesce(btrim(p_busqueda), '') = '' or concat_ws(' ', p.cue, c.clave, e.nombre, e.tipo, e.numero, p.tipo, p.otro_tipo, p.nombre)
        ilike '%' || replace(replace(replace(btrim(p_busqueda), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), ordenadas as (
    select *, row_number() over (order by
      case when p_orden = 'recientes' then created_at end desc,
      case when p_orden = 'antiguos' then created_at end asc,
      case when p_orden = 'escuela' then lower(concat_ws(' ', clave, escuela_tipo, escuela_numero, escuela)) end asc,
      case when p_orden = 'tipo' then lower(coalesce(otro_tipo, tipo)) end asc,
      case when p_orden = 'archivo' then lower(nombre) end asc, id asc) posicion
    from filtradas
  ), pagina as (
    select * from ordenadas order by posicion limit p_lim offset p_offset
  )
  select jsonb_build_object('total', (select count(*) from filtradas),
    'filas', coalesce((select jsonb_agg(to_jsonb(pagina) - 'posicion' order by posicion) from pagina), '[]'::jsonb))
  into resultado;
  return resultado;
end $$;
revoke all on function public.proyectos_supervision(text,text,text,integer,integer) from public, anon;
grant execute on function public.proyectos_supervision(text,text,text,integer,integer) to authenticated;

update public.ayuda_guias
set secciones = secciones || '[
  {"titulo":"Consultar proyectos","pasos":[
    "Usá «Previsualizar» para abrir el PDF sin descargarlo. Si tu dispositivo no lo muestra, abrilo en otra pestaña o descargalo.",
    "Los inspectores areales consultan los proyectos de sus escuelas asignadas y el rol distrital puede consultar todos. La supervisión puede buscar, filtrar y ordenar, pero solo la escuela puede subir o eliminar proyectos."
  ]}
]'::jsonb, version = version + 1, actualizado = now()
where id = 'mis-proyectos';
