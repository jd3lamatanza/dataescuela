-- Articulación: escrituras solo por RPC security definer; las tablas quedan de solo lectura (RLS)
drop policy egr_all on public.egresantes;
drop policy interv_all on public.intervenciones;
create policy egr_sel on public.egresantes for select to authenticated
  using (public.can_see_trayectoria(origen_cue, origen_clave, destino_clave));
create policy interv_sel on public.intervenciones for select to authenticated
  using (exists (select 1 from public.egresantes g where g.id = intervenciones.egresante_id
    and public.can_see_trayectoria(g.origen_cue, g.origen_clave, g.destino_clave)));
revoke insert, update, delete on public.egresantes, public.intervenciones from authenticated;

create or replace function public._ciclo_actual() returns int language sql stable
as $$ select extract(year from (now() at time zone 'America/Argentina/Buenos_Aires'))::int $$;

create or replace function public._destinos_de(cod text) returns text[] language sql immutable
as $$ select case cod when 'JI' then '{PP}' when 'JV' then '{PP}' when 'JU' then '{PP}'
  when 'PP' then '{MS,MT}' else '{}' end::text[] $$;

create or replace function public._origenes_de(cod text) returns text[] language sql immutable
as $$ select case cod when 'PP' then '{JI,JV,JU}' when 'MS' then '{PP}' when 'MT' then '{PP}' else '{}' end::text[] $$;

-- Escuela propia del usuario escolar (origen de los registros)
create or replace function public._mi_origen(out cue text, out clave text, out codigo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'escolar' then raise exception 'Solo para escuelas'; end if;
  select e.cue, e.clave, e.codigo into cue, clave, codigo from public.escuelas e where e.id = public.mi_escuela();
  if clave is null then raise exception 'Escuela no encontrada'; end if;
end $$;

create or replace function public._notificar(p_user uuid, p_title text, p_body text, p_url text)
returns void language sql security definer set search_path = public
as $$ insert into public.notifications (user_id, type, title, body, url) values (p_user, 'info', p_title, p_body, p_url) $$;

-- Destinos posibles (escuelas agrupadas por clave) según el código de origen
create or replace function public.destinos_posibles(p_codigo text)
returns table (clave text, nombre text) language sql stable security definer set search_path = public as $$
  select e.clave, min(e.nombre) from public.escuelas e
  where e.codigo = any (public._destinos_de(p_codigo)) and public.app_role() is not null
  group by e.clave order by e.clave
$$;

-- Valida y normaliza el destino. Devuelve clave, nombre y si es manual.
create or replace function public._resolver_destino(p_origen_codigo text, p_destino text, p_nombre text,
  out o_clave text, out o_nombre text, out o_manual boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_destino is null or p_destino = '' then
    o_clave := null; o_nombre := null; o_manual := false; return;
  end if;
  if p_destino = '__otra' then
    o_nombre := left(btrim(coalesce(p_nombre, '')), 150);
    if o_nombre = '' then raise exception 'Ingresá el nombre de la escuela'; end if;
    o_clave := null; o_manual := true; return;
  end if;
  select e.clave, min(e.nombre) into o_clave, o_nombre from public.escuelas e
    where e.clave = p_destino and e.codigo = any (public._destinos_de(p_origen_codigo)) group by e.clave;
  if o_clave is null then raise exception 'Seleccioná una escuela destino válida'; end if;
  o_nombre := coalesce(o_nombre, o_clave); o_manual := false;
end $$;

create or replace function public._dni_ubicacion(p_ciclo int, p_dni text, p_excluir bigint)
returns text language sql stable security definer set search_path = public as $$
  select 'El DNI ' || p_dni || ' ya está cargado en el ciclo ' || p_ciclo || ' (' ||
    coalesce((select min(s.nombre) from public.escuelas s where s.clave = e.origen_clave), e.origen_clave) || ')'
  from public.egresantes e where e.ciclo = p_ciclo and e.dni = p_dni and e.id is distinct from p_excluir limit 1
$$;

drop function if exists public.egresante_guardar(bigint,int,text,text,text,text,boolean,text,boolean,text,text,text);
create or replace function public.egresante_guardar(p_id bigint, p_ciclo int, p_dni text, p_nombre text, p_direccion text,
  p_curso text, p_ppi boolean, p_acompanante boolean, p_intensifica boolean, p_destino text, p_destino_nombre text, p_obs text)
returns bigint language plpgsql security definer set search_path = public as $$
declare o record; r public.egresantes; d record; msg text; nid bigint;
begin
  select * into o from public._mi_origen();
  if o.codigo <> all (array['JI','JV','JU','PP']) then raise exception 'Tu escuela no carga egresantes'; end if;
  if p_ciclo < 2020 or p_ciclo > public._ciclo_actual() + 1 then raise exception 'Ciclo inválido'; end if;
  p_dni := btrim(coalesce(p_dni, ''));
  if p_dni !~ '^\d{6,9}$' then raise exception 'DNI inválido (6 a 9 dígitos)'; end if;
  p_nombre := btrim(coalesce(p_nombre, ''));
  if length(p_nombre) < 3 then raise exception 'Ingresá el nombre del estudiante'; end if;
  p_curso := btrim(coalesce(p_curso, ''));
  if p_curso = '' then raise exception 'Ingresá el curso'; end if;
  if p_id is not null then
    select * into r from public.egresantes where id = p_id and origen_cue = o.cue;
    if r.id is null then raise exception 'Registro no encontrado'; end if;
    if r.ciclo < public._ciclo_actual() or r.ingresado or r.ext_escuela is not null then
      raise exception 'El registro está bloqueado'; end if;
  end if;
  msg := public._dni_ubicacion(p_ciclo, p_dni, p_id);
  if msg is not null then raise exception '%', msg; end if;
  select * into d from public._resolver_destino(o.codigo, p_destino, p_destino_nombre);
  if p_id is null then
    insert into public.egresantes (ciclo, dni, nombre, direccion, curso, ppi, acompanante, intensifica, destino_clave,
      destino_nombre, destino_manual, observaciones, origen_cue, origen_clave, origen_codigo, created_by)
    values (p_ciclo, p_dni, p_nombre, nullif(btrim(coalesce(p_direccion,'')),''), p_curso, coalesce(p_ppi,false),
      coalesce(p_acompanante,false), coalesce(p_intensifica,false), d.o_clave, d.o_nombre, d.o_manual,
      nullif(btrim(coalesce(p_obs,'')),''), o.cue, o.clave, o.codigo, public.eff_uid())
    returning id into nid;
  else
    update public.egresantes set ciclo = p_ciclo, dni = p_dni, nombre = p_nombre,
      direccion = nullif(btrim(coalesce(p_direccion,'')),''), curso = p_curso, ppi = coalesce(p_ppi,false),
      acompanante = coalesce(p_acompanante,false), intensifica = coalesce(p_intensifica,false),
      destino_clave = d.o_clave, destino_nombre = d.o_nombre, destino_manual = d.o_manual,
      observaciones = nullif(btrim(coalesce(p_obs,'')),''), updated_at = now(),
      doc_completa = case when destino_clave is not distinct from d.o_clave and destino_manual = d.o_manual then doc_completa else false end
    where id = p_id returning id into nid;
  end if;
  return nid;
end $$;

create or replace function public.egresante_eliminar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o record; r public.egresantes;
begin
  select * into o from public._mi_origen();
  select * into r from public.egresantes where id = p_id and origen_cue = o.cue;
  if r.id is null then raise exception 'Registro no encontrado'; end if;
  if r.ciclo < public._ciclo_actual() or r.ingresado or r.ext_escuela is not null then raise exception 'El registro está bloqueado'; end if;
  if exists (select 1 from public.intervenciones where egresante_id = p_id) then
    raise exception 'No se puede eliminar: tiene intervenciones registradas'; end if;
  delete from public.egresantes where id = p_id;
end $$;

create or replace function public.egresantes_destino_masivo(p_ciclo int, p_ids bigint[], p_destino text, p_nombre text, p_reemplazar boolean)
returns int language plpgsql security definer set search_path = public as $$
declare o record; d record; n int;
begin
  select * into o from public._mi_origen();
  if p_ciclo < public._ciclo_actual() then raise exception 'El ciclo está cerrado'; end if;
  select * into d from public._resolver_destino(o.codigo, p_destino, p_nombre);
  if d.o_nombre is null then raise exception 'Seleccioná un destino'; end if;
  update public.egresantes set destino_clave = d.o_clave, destino_nombre = d.o_nombre, destino_manual = d.o_manual,
      doc_completa = false, updated_at = now()
  where origen_cue = o.cue and ciclo = p_ciclo and id = any (p_ids) and not ingresado and ext_escuela is null
    and (p_reemplazar or destino_nombre is null);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.egresantes_importar(p_ciclo int, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; f jsonb; ok int := 0; dup int := 0; msg text; dni text;
begin
  select * into o from public._mi_origen();
  if o.codigo <> all (array['JI','JV','JU','PP']) then raise exception 'Tu escuela no carga egresantes'; end if;
  if p_ciclo < public._ciclo_actual() then raise exception 'El ciclo está cerrado'; end if;
  if jsonb_array_length(p_filas) > 1500 then raise exception 'Máximo 1500 filas'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    dni := btrim(f->>'dni');
    if dni !~ '^\d{6,9}$' or length(btrim(coalesce(f->>'nombre',''))) < 3 or btrim(coalesce(f->>'curso','')) = '' then continue; end if;
    msg := public._dni_ubicacion(p_ciclo, dni, null);
    if msg is not null then dup := dup + 1; continue; end if;
    insert into public.egresantes (ciclo, dni, nombre, curso, origen_cue, origen_clave, origen_codigo, created_by)
    values (p_ciclo, dni, left(btrim(f->>'nombre'),150), left(btrim(f->>'curso'),20), o.cue, o.clave, o.codigo, public.eff_uid());
    ok := ok + 1;
  end loop;
  return jsonb_build_object('insertados', ok, 'repetidos', dup);
end $$;

-- DNI repetidos: devuelve dónde está cada uno (para clasificar la importación)
create or replace function public.dnis_ubicacion(p_ciclo int, p_dnis text[])
returns table (dni text, propio boolean, donde text) language sql stable security definer set search_path = public as $$
  select e.dni, e.origen_cue = public.app_cue(),
    coalesce((select min(s.nombre) from public.escuelas s where s.clave = e.origen_clave), e.origen_clave)
  from public.egresantes e where e.ciclo = p_ciclo and e.dni = any (p_dnis) and public.app_role() = 'escolar'
$$;

-- Ingresantes (escuelas receptoras)
create or replace function public.ingresante_buscar(p_ciclo int, p_dni text)
returns table (id bigint, dni text, nombre text, curso text, origen_nombre text, estado text)
language plpgsql stable security definer set search_path = public as $$
declare o record;
begin
  select * into o from public._mi_origen();
  return query
  select e.id, e.dni, e.nombre, e.curso,
    coalesce((select min(s.nombre) from public.escuelas s where s.clave = e.origen_clave), e.origen_clave),
    case when e.destino_clave = o.clave and not e.destino_manual then 'mine'
         when e.destino_clave is not null and not e.destino_manual then 'enrolled' else 'free' end
  from public.egresantes e
  where e.ciclo = p_ciclo - 1 and e.dni = btrim(p_dni) and e.origen_codigo = any (public._origenes_de(o.codigo));
end $$;

create or replace function public.ingresante_asignar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o record; r public.egresantes;
begin
  select * into o from public._mi_origen();
  select * into r from public.egresantes where id = p_id and origen_codigo = any (public._origenes_de(o.codigo));
  if r.id is null then raise exception 'Estudiante no encontrado'; end if;
  if r.ingresado or r.ext_escuela is not null then raise exception 'La trayectoria ya está confirmada'; end if;
  if r.destino_clave is not null and not r.destino_manual and r.destino_clave <> o.clave then
    raise exception 'El estudiante ya está asignado a otra escuela'; end if;
  update public.egresantes set destino_clave = o.clave,
    destino_nombre = (select min(nombre) from public.escuelas where clave = o.clave), destino_manual = false,
    doc_completa = false, ingresado = false, updated_at = now() where id = p_id;
  if r.created_by is not null then
    perform public._notificar(r.created_by, 'Estudiante asignado a una escuela destino',
      r.nombre || ' (DNI ' || r.dni || ') fue asignado a ' || (select min(nombre) from public.escuelas where clave = o.clave), '#/articulacion');
  end if;
end $$;

create or replace function public.ingresante_marcar(p_id bigint, p_campo text) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public._mi_origen();
  if p_campo not in ('doc_completa','ingresado') then raise exception 'Campo inválido'; end if;
  if not exists (select 1 from public.egresantes where id = p_id and destino_clave = o.clave and not destino_manual) then
    raise exception 'Registro no encontrado'; end if;
  if p_campo = 'doc_completa' then
    update public.egresantes set doc_completa = true, updated_at = now() where id = p_id and not doc_completa;
  else
    update public.egresantes set ingresado = true, updated_at = now() where id = p_id and not ingresado;
  end if;
end $$;

-- Intervenciones y confirmaciones (escuela de origen, areal y distrital según visibilidad)
create or replace function public.intervencion_crear(p_egresante bigint, p_texto text, p_tipo text default 'nota')
returns void language plpgsql security definer set search_path = public as $$
declare r public.egresantes; n text;
begin
  select * into r from public.egresantes where id = p_egresante
    and public.can_see_trayectoria(origen_cue, origen_clave, destino_clave) and public.app_role() <> 'regional';
  if r.id is null then raise exception 'Registro no encontrado'; end if;
  p_texto := btrim(coalesce(p_texto, ''));
  if p_texto = '' then raise exception 'Escribí el texto de la intervención'; end if;
  select name into n from public.profiles where id = public.eff_uid();
  insert into public.intervenciones (egresante_id, texto, tipo, created_by, created_by_name)
  values (p_egresante, left(p_texto, 2000), 'nota', public.eff_uid(), n);
end $$;

create or replace function public.inscripcion_externa(p_id bigint, p_escuela text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.egresantes; n text; hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires','DD/MM/YYYY');
begin
  select * into r from public.egresantes where id = p_id and public.app_role() in ('escolar','areal','distrital')
    and public.can_see_trayectoria(origen_cue, origen_clave, destino_clave);
  if r.id is null then raise exception 'Registro no encontrado'; end if;
  if r.ingresado or r.ext_escuela is not null then raise exception 'La trayectoria ya está confirmada'; end if;
  p_escuela := left(btrim(coalesce(p_escuela,'')), 150);
  if p_escuela = '' then raise exception 'Ingresá el nombre de la escuela'; end if;
  select name into n from public.profiles where id = public.eff_uid();
  update public.egresantes set ext_escuela = p_escuela, ext_at = now(), updated_at = now() where id = p_id;
  insert into public.intervenciones (egresante_id, texto, tipo, created_by, created_by_name)
  values (p_id, 'Inscripción fuera del distrito: ' || p_escuela || ' (' || hoy || ').', 'inscripcion_externa', public.eff_uid(), n);
end $$;

-- Distrital: confirmar inscripción en destino y eliminar
create or replace function public.distrito_confirmar_destino(p_id bigint, p_destino text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.egresantes; d record; n text; hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires','DD/MM/YYYY');
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select * into r from public.egresantes where id = p_id;
  if r.id is null then raise exception 'Registro no encontrado'; end if;
  if r.ingresado or r.ext_escuela is not null then raise exception 'La trayectoria ya tiene el ingreso confirmado'; end if;
  if p_destino is null or p_destino = '' then raise exception 'Seleccioná una escuela destino'; end if;
  select * into d from public._resolver_destino(r.origen_codigo, p_destino, p_nombre);
  select name into n from public.profiles where id = public.eff_uid();
  update public.egresantes set destino_clave = d.o_clave, destino_nombre = d.o_nombre, destino_manual = d.o_manual,
    ingresado = true, doc_completa = case when not d.o_manual and not destino_manual and destino_clave = d.o_clave then doc_completa else false end,
    updated_at = now() where id = p_id;
  insert into public.intervenciones (egresante_id, texto, tipo, created_by, created_by_name)
  values (p_id, 'Inscripción confirmada en la escuela destino: ' || d.o_nombre || coalesce(' (' || d.o_clave || ')', ' (ingreso manual)') || ' (' || hoy || ').',
    'inscripcion_destino', public.eff_uid(), n);
end $$;

create or replace function public.distrito_eliminar_egresante(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  delete from public.intervenciones where egresante_id = p_id;
  delete from public.egresantes where id = p_id;
end $$;

-- Resumen por escuela (areal, distrital, región): egresantes del ciclo y ingresantes (ciclo-1)
create or replace function public.articulacion_resumen(p_ciclo int)
returns table (clave text, nombre text, cue text, codigo text, eg_total int, eg_conf int, ing_total int, ing_conf int)
language sql stable security definer set search_path = public as $$
  select s.clave, s.nombre, s.cue, s.codigo,
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo and e.origen_clave = s.clave),
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo and e.origen_clave = s.clave and (e.ingresado or e.ext_escuela is not null)),
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo - 1 and e.destino_clave = s.clave and not e.destino_manual),
    (select count(*)::int from public.egresantes e where e.ciclo = p_ciclo - 1 and e.destino_clave = s.clave and not e.destino_manual and e.ingresado)
  from (select e.clave, min(e.nombre) nombre, min(e.cue) cue, min(e.codigo) codigo from public.escuelas e
        where e.codigo in ('JI','JV','JU','PP','MS','MT')
          and (public.app_role() in ('admin','regional','distrital')
               or (public.app_role() = 'areal' and e.clave = any (public.claves_asignadas())))
        group by e.clave) s
  order by s.clave
$$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._crear_auth(uuid,text,text), public._puede_gestionar(text) from authenticated;
revoke execute on function public._mi_origen(), public._notificar(uuid,text,text,text), public._resolver_destino(text,text,text),
  public._dni_ubicacion(int,text,bigint) from authenticated;
