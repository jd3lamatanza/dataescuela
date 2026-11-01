-- ET, EL y EF entran en la competencia del módulo. Destinos: todas las escuelas del módulo, sin filtro por origen.
create or replace function public._destinos_de(cod text) returns text[] language sql immutable
as $$ select case when cod in ('JI','JV','JU','PP') then '{JI,JV,JU,PP,MS,MT,ET,EL,EF,EE}' else '{}' end::text[] $$;

create or replace function public._origenes_de(cod text) returns text[] language sql immutable
as $$ select case when cod in ('PP','MS','MT','ET','EL','EF','EE') then '{JI,JV,JU,PP}' else '{}' end::text[] $$;

create or replace function public.articulacion_resumen(p_ciclo int)
returns table (clave text, nombre text, cue text, codigo text, eg_total int, eg_conf int, ing_total int, ing_conf int)
language sql stable security definer set search_path = public as $$
  select s.clave, s.nombre, s.cue, s.codigo,
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo and e.origen_clave = s.clave),
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo and e.origen_clave = s.clave and (e.ingresado or e.ext_escuela is not null)),
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo - 1 and e.destino_clave = s.clave and not e.destino_manual),
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo - 1 and e.destino_clave = s.clave and not e.destino_manual and e.ingresado)
  from (select e.clave, min(e.nombre) nombre, min(e.cue) cue, min(e.codigo) codigo from public.escuelas e
        where e.codigo in ('JI','JV','JU','PP','MS','MT','ET','EL','EF','EE')
          and (public.app_role() in ('admin','regional','distrital')
               or (public.app_role() = 'areal' and e.clave = any (public.claves_asignadas())))
        group by e.clave) s
  order by s.clave
$$;

