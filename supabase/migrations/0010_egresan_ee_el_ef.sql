-- ET, EE, EL y EF cargan egresantes y reciben ingresantes de cualquier escuela; cualquier escuela puede tenerlas como destino.
create or replace function public._destinos_de(cod text) returns text[] language sql immutable
as $$ select case when cod in ('JI','JV','JU','PP','ET','EE','EL','EF') then '{JI,JV,JU,PP,MS,MT,ET,EE,EL,EF}' else '{}' end::text[] $$;

create or replace function public._origenes_de(cod text) returns text[] language sql immutable
as $$ select case when cod in ('PP','MS','MT','ET','EE','EL','EF') then '{JI,JV,JU,PP,ET,EE,EL,EF}' else '{}' end::text[] $$;

drop function if exists public.egresante_guardar(bigint,int,text,text,text,text,boolean,boolean,boolean,text,text,text);
create or replace function public.egresante_guardar(p_id bigint, p_ciclo int, p_dni text, p_nombre text, p_direccion text,
  p_curso text, p_ppi boolean, p_acompanante boolean, p_intensifica boolean, p_destino text, p_destino_nombre text, p_obs text)
returns bigint language plpgsql security definer set search_path = public as $$
declare o record; r public.egresantes; d record; msg text; nid bigint;
begin
  select * into o from public._mi_origen();
  if o.codigo <> all (array['JI','JV','JU','PP','ET','EE','EL','EF']) then raise exception 'Tu escuela no carga egresantes'; end if;
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

create or replace function public.egresantes_importar(p_ciclo int, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; f jsonb; ok int := 0; dup int := 0; msg text; dni text;
begin
  select * into o from public._mi_origen();
  if o.codigo <> all (array['JI','JV','JU','PP','ET','EE','EL','EF']) then raise exception 'Tu escuela no carga egresantes'; end if;
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

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._crear_auth(uuid,text,text), public._puede_gestionar(text), public._mi_origen(), public._notificar(uuid,text,text,text), public._resolver_destino(text,text,text), public._dni_ubicacion(int,text,bigint) from authenticated;
