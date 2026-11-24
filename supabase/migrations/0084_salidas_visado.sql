alter table public.salidas
  add column creada_por_distrital boolean not null default false,
  add column visado_at timestamptz,
  add column visado_por uuid references public.profiles(id),
  add constraint salidas_visado_completo check ((visado_at is null) = (visado_por is null));
alter table public.salidas alter column enviar_mail set default false;

drop policy salidas_sel on public.salidas;
create policy salidas_sel on public.salidas for select to authenticated using (
  public.app_role() in ('admin','regional','distrital')
  or (public.app_role() = 'escolar' and (user_id = public.eff_uid()
    or (creada_por_distrital and cue = public.app_cue())))
  or (public.app_role() = 'areal' and clave = any(public.claves_asignadas())));

create policy eventos_salida_distrital_escolar on public.eventos for select to authenticated using (
  public.app_role() = 'escolar' and exists (
    select 1 from public.salidas s where s.evento_id = eventos.id
      and s.creada_por_distrital and s.cue = public.app_cue()
  ));

create or replace function public.salida_es_dueno(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.salidas s where s.id = p_id and public.app_role() = 'escolar'
    and (s.user_id = public.eff_uid() or (s.creada_por_distrital and s.cue = public.app_cue())))
$$;

create or replace function public.salida_editable(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.salidas s where s.id = p_id
    and (public.salida_es_dueno(s.id) or (public.app_role() = 'distrital' and s.creada_por_distrital))
    and s.estado_id in (public._salida_estado_id('Pendiente'), public._salida_estado_id('Devuelta para Corrección')))
$$;

-- Se conserva la firma anterior para clientes ya abiertos; p_mail se ignora.
create or replace function public.salida_crear(p_titulo text, p_fecha date, p_destino text, p_obs text default null, p_mail boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare e public.escuelas; v_id bigint;
begin
  if public.app_role() is distinct from 'escolar' then raise exception 'Solo las escuelas cargan salidas educativas'; end if;
  perform public._salida_validar(p_titulo, p_fecha, p_destino, p_obs);
  select * into e from public.escuelas where cue = public.app_cue() order by id limit 1;
  if not found then raise exception 'No se encontró la escuela de tu usuario'; end if;
  insert into public.salidas(user_id, cue, clave, escuela, titulo, fecha, destino, observaciones, estado_id, enviar_mail)
  values (public.eff_uid(), e.cue, e.clave, trim(concat_ws(' ', e.tipo, e.numero::text, e.nombre)),
    trim(p_titulo), p_fecha, trim(p_destino), nullif(trim(p_obs), ''), public._salida_estado_id('Pendiente'), false)
  returning id into v_id;
  return v_id;
end $$;

create function public.salida_crear_distrital(p_escuela bigint, p_titulo text, p_fecha date, p_destino text, p_obs text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare e public.escuelas; v_id bigint;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  perform public._salida_validar(p_titulo, p_fecha, p_destino, p_obs);
  select * into e from public.escuelas where id = p_escuela;
  if not found or nullif(btrim(e.cue), '') is null then raise exception 'Escuela inválida o sin CUE'; end if;
  insert into public.salidas(user_id, cue, clave, escuela, titulo, fecha, destino, observaciones, estado_id, enviar_mail, creada_por_distrital)
  values (public.eff_uid(), e.cue, e.clave, trim(concat_ws(' ', e.tipo, e.numero::text, e.nombre)),
    trim(p_titulo), p_fecha, trim(p_destino), nullif(trim(p_obs), ''), public._salida_estado_id('Pendiente'), false, true)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.salida_crear_distrital(bigint,text,date,text,text) from public, anon;
grant execute on function public.salida_crear_distrital(bigint,text,date,text,text) to authenticated;

create function public.salida_visar(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas;
begin
  if public.app_role() is distinct from 'areal' then raise exception 'Solo el inspector puede visar'; end if;
  select * into s from public.salidas where id = p_id for update;
  if not found then raise exception 'Salida inexistente'; end if;
  if s.clave is null or not (s.clave = any(public.claves_asignadas())) then raise exception 'Sin permiso'; end if;
  if s.visado_at is not null then raise exception 'La salida ya fue visada y el visado no se puede quitar'; end if;
  update public.salidas set visado_at = now(), visado_por = public.eff_uid(), updated_at = now() where id = p_id;
end $$;
revoke all on function public.salida_visar(bigint) from public, anon;
grant execute on function public.salida_visar(bigint) to authenticated;

create or replace function public.salida_mensaje(p_id bigint, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v_rol text := public.app_role(); v_uid uuid := public.eff_uid(); s public.salidas; v_autor text;
begin
  select * into s from public.salidas where id = p_id;
  if not found then raise exception 'Salida inexistente'; end if;
  if not coalesce(v_rol = 'distrital' or public.salida_es_dueno(p_id)
    or (v_rol = 'areal' and s.clave = any(public.claves_asignadas())), false) then raise exception 'Sin permiso'; end if;
  if length(trim(coalesce(p_texto, ''))) < 1 then raise exception 'Escribí un mensaje'; end if;
  select name into v_autor from public.profiles where id = v_uid;
  insert into public.salida_mensajes(salida_id, user_id, rol, autor, texto) values (p_id, v_uid, v_rol, v_autor, trim(p_texto));
end $$;

create or replace function public.salida_estado(p_id bigint, p_estado bigint, p_texto text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas; v_nombre text; v_ev bigint; v_autor text; v_tipo bigint; v_rol text := public.app_role();
begin
  select * into s from public.salidas where id = p_id for update;
  if not found then raise exception 'Salida inexistente'; end if;
  if not coalesce(v_rol = 'distrital' or (v_rol = 'areal' and s.clave = any(public.claves_asignadas())), false) then raise exception 'Sin permiso'; end if;
  select nombre into v_nombre from public.salida_estados where id = p_estado and activo;
  if v_nombre is null then raise exception 'Estado inválido'; end if;
  update public.salidas set estado_id = p_estado, updated_at = now() where id = p_id;
  if v_nombre = 'Aprobada' then
    select id into v_tipo from public.evento_tipos where nombre = 'Salida Educativa';
    select name into v_autor from public.profiles where id = s.user_id;
    if s.evento_id is null then
      insert into public.eventos(fecha, tipo_id, nombre, descripcion, user_id, rol, autor, cue)
      values (s.fecha, v_tipo, s.titulo, 'Destino: ' || s.destino || coalesce(E'\n' || s.observaciones, ''),
        s.user_id, 'escolar', case when s.creada_por_distrital then s.escuela else coalesce(v_autor, s.escuela) end, s.cue)
      returning id into v_ev;
      update public.salidas set evento_id = v_ev where id = p_id;
    else
      update public.eventos set fecha = s.fecha, nombre = s.titulo,
        descripcion = 'Destino: ' || s.destino || coalesce(E'\n' || s.observaciones, '') where id = s.evento_id;
    end if;
  elsif s.evento_id is not null then
    delete from public.eventos where id = s.evento_id;
  end if;
  select name into v_autor from public.profiles where id = public.eff_uid();
  insert into public.salida_mensajes(salida_id, user_id, rol, autor, texto, estado_id)
  values (p_id, public.eff_uid(), v_rol, coalesce(v_autor, 'Usuario'), coalesce(nullif(trim(p_texto), ''), 'Estado actualizado a ' || v_nombre || '.'), p_estado);
end $$;

update public.ayuda_guias
set secciones = replace(secciones::text,
  'La opción de envío por correo está activada inicialmente y puede desmarcarse. Tocá «Guardar»; si se guardan los datos pero falla la subida o el correo, abrí el detalle para completar la gestión.',
  'Tocá «Guardar» para registrar la salida sin enviar correo. Si falla la subida de archivos, abrí el detalle para completar la documentación.')::jsonb,
  version = version + 1, actualizado = now()
where id = 'salidas' and secciones::text like '%La opción de envío por correo está activada inicialmente y puede desmarcarse.%';
