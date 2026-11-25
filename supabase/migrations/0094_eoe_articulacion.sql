-- Cuenta eoe: Articulación con las mismas reglas y alcance que la cuenta escolar de su escuela.

CREATE OR REPLACE FUNCTION public._mi_origen(OUT cue text, OUT clave text, OUT codigo text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public.app_role() not in ('escolar', 'eoe'), true) then raise exception 'Solo para escuelas'; end if;
  select e.cue, e.clave, e.codigo into cue, clave, codigo from public.escuelas e where e.id = public.mi_escuela();
  if clave is null then raise exception 'Escuela no encontrada'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.can_see_trayectoria(ocue text, oclave text, dclave text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case public.app_role()
    when 'admin' then true
    when 'regional' then true
    when 'distrital' then true
    when 'escolar' then ocue = public.app_cue()
      or dclave in (select e.clave from public.escuelas e where e.cue = public.app_cue())
    when 'eoe' then ocue = public.app_cue()
      or dclave in (select e.clave from public.escuelas e where e.cue = public.app_cue())
    when 'areal' then oclave = any (public.claves_asignadas()) or dclave = any (public.claves_asignadas())
    else false end
$function$;

CREATE OR REPLACE FUNCTION public.dnis_ubicacion(p_ciclo integer, p_dnis text[])
 RETURNS TABLE(dni text, propio boolean, donde text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.dni, e.origen_cue = public.app_cue(),
    coalesce((select min(s.nombre) from public.escuelas s where s.clave = e.origen_clave), e.origen_clave)
  from public.egresantes e where e.ciclo = p_ciclo and e.dni = any (p_dnis) and public.app_role() in ('escolar', 'eoe')
$function$;

CREATE OR REPLACE FUNCTION public.inscripcion_externa(p_id bigint, p_escuela text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.egresantes; n text; hoy text := to_char(now() at time zone 'America/Argentina/Buenos_Aires','DD/MM/YYYY');
begin
  select * into r from public.egresantes where id = p_id and public.app_role() in ('escolar','eoe','areal','distrital')
    and public.can_see_trayectoria(origen_cue, origen_clave, destino_clave);
  if r.id is null then raise exception 'Registro no encontrado'; end if;
  if r.ingresado or r.ext_escuela is not null then raise exception 'La trayectoria ya está confirmada'; end if;
  p_escuela := left(btrim(coalesce(p_escuela,'')), 150);
  if p_escuela = '' then raise exception 'Ingresá el nombre de la escuela'; end if;
  select name into n from public.profiles where id = public.eff_uid();
  update public.egresantes set ext_escuela = p_escuela, ext_at = now(), updated_at = now() where id = p_id;
  insert into public.intervenciones (egresante_id, texto, tipo, created_by, created_by_name)
  values (p_id, 'Inscripción fuera del distrito: ' || p_escuela || ' (' || hoy || ').', 'inscripcion_externa', public.eff_uid(), n);
end $function$;
