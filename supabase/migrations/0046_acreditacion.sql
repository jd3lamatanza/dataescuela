create table public.acreditacion_eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 3 and 200),
  lugar text not null check (length(btrim(lugar)) between 3 and 200),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  descripcion text not null check (length(btrim(descripcion)) between 1 and 1000),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activo', 'finalizado')),
  creado_en timestamptz not null default now(),
  check (hora_inicio < hora_fin)
);

create table public.acreditacion_personas (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.acreditacion_eventos(id) on delete restrict,
  nombre text not null check (length(btrim(nombre)) between 3 and 200),
  dni text not null check (dni ~ '^[0-9]{7,8}$'),
  cargo text not null check (length(btrim(cargo)) between 2 and 200),
  escuela_id bigint not null references public.escuelas(id),
  email text not null check (length(email) <= 254 and email ~* '^[a-z0-9._%+-]+@abc[.]gob[.]ar$'),
  creado_en timestamptz not null default now(),
  constancia_enviada_en timestamptz,
  envio_estado text not null default 'pendiente' check (envio_estado in ('pendiente', 'enviando', 'enviado', 'incierto')),
  envio_token uuid,
  envio_iniciado_en timestamptz,
  unique (evento_id, dni),
  check ((envio_estado = 'enviado') = (constancia_enviada_en is not null)),
  check ((envio_estado in ('enviando', 'incierto')) = (envio_token is not null)),
  check ((envio_estado in ('enviando', 'incierto')) = (envio_iniciado_en is not null))
);
create index acreditacion_personas_evento on public.acreditacion_personas (evento_id, id);

create table public.acreditacion_firmas (
  id bigint generated always as identity primary key,
  nombre text not null check (length(nombre) between 1 and 150),
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  contenido bytea not null check (octet_length(contenido) between 1 and 2097152),
  creado_en timestamptz not null default now()
);

alter table public.acreditacion_eventos enable row level security;
alter table public.acreditacion_personas enable row level security;
alter table public.acreditacion_firmas enable row level security;
revoke all on public.acreditacion_eventos, public.acreditacion_personas, public.acreditacion_firmas from public, anon, authenticated;
grant select on public.acreditacion_eventos, public.acreditacion_personas, public.acreditacion_firmas to authenticated;
create policy acreditacion_eventos_distrital on public.acreditacion_eventos for select to authenticated using (public.app_role() = 'distrital');
create policy acreditacion_personas_distrital on public.acreditacion_personas for select to authenticated using (public.app_role() = 'distrital');
create policy acreditacion_firmas_distrital on public.acreditacion_firmas for select to authenticated using (public.app_role() = 'distrital');

create function public.acreditacion_guardar_firma(p_nombre text, p_mime text, p_base64 text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_bytes bytea;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  perform pg_advisory_xact_lock(hashtext('acreditacion_firmas'));
  if (select count(*) from public.acreditacion_firmas) >= 6 then raise exception 'Se admiten hasta seis imágenes'; end if;
  if p_base64 is null or length(p_base64) > 2796204 then raise exception 'Imagen demasiado grande'; end if;
  v_bytes := decode(p_base64, 'base64');
  if (p_mime = 'image/png' and substring(v_bytes from 1 for 8) <> decode('89504e470d0a1a0a', 'hex'))
    or (p_mime = 'image/jpeg' and substring(v_bytes from 1 for 3) <> decode('ffd8ff', 'hex'))
    or p_mime not in ('image/png', 'image/jpeg') or p_mime is null then raise exception 'La imagen debe ser PNG o JPEG'; end if;
  insert into public.acreditacion_firmas(nombre, mime, contenido) values (btrim(p_nombre), p_mime, v_bytes) returning id into v_id;
  return v_id;
end $$;

create function public.acreditacion_eliminar_firma(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  delete from public.acreditacion_firmas where id = p_id;
  if not found then raise exception 'Firma inexistente'; end if;
end $$;

create function public.acreditacion_imagenes()
returns table (id bigint, nombre text, mime text, base64 text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  return query select f.id, f.nombre, f.mime, encode(f.contenido, 'base64') from public.acreditacion_firmas f order by f.id;
end $$;

create function public.acreditacion_guardar_evento(
  p_id uuid, p_nombre text, p_lugar text, p_fecha date,
  p_inicio time, p_fin time, p_descripcion text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if p_id is null then
    insert into public.acreditacion_eventos(nombre, lugar, fecha, hora_inicio, hora_fin, descripcion)
    values (btrim(p_nombre), btrim(p_lugar), p_fecha, p_inicio, p_fin, btrim(p_descripcion)) returning id into v_id;
  else
    perform 1 from public.acreditacion_eventos where id = p_id for update;
    if not found then raise exception 'Evento inexistente'; end if;
    if exists (select 1 from public.acreditacion_eventos where id = p_id and estado = 'finalizado')
       or exists (select 1 from public.acreditacion_personas where evento_id = p_id and envio_estado <> 'pendiente') then
      raise exception 'No se pueden editar los datos de este evento';
    end if;
    update public.acreditacion_eventos set nombre = btrim(p_nombre), lugar = btrim(p_lugar), fecha = p_fecha,
      hora_inicio = p_inicio, hora_fin = p_fin, descripcion = btrim(p_descripcion) where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end $$;

create function public.acreditacion_iniciar_envio(p_evento uuid, p_persona bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  perform 1 from public.acreditacion_eventos where id = p_evento and estado = 'finalizado' for update;
  if not found then raise exception 'El evento debe estar finalizado'; end if;
  update public.acreditacion_personas set envio_estado = 'incierto'
  where evento_id = p_evento and envio_estado = 'enviando' and envio_iniciado_en < now() - interval '10 minutes';
  if exists (select 1 from public.acreditacion_personas where evento_id = p_evento and envio_estado = 'enviando') then
    raise exception 'Hay un envío en curso para este evento';
  end if;
  v_token := gen_random_uuid();
  update public.acreditacion_personas set envio_estado = 'enviando', envio_token = v_token, envio_iniciado_en = now()
  where evento_id = p_evento and id = p_persona and envio_estado in ('pendiente', 'incierto');
  if not found then raise exception 'La constancia no está pendiente'; end if;
  return v_token;
end $$;

create function public.acreditacion_finalizar_envio(p_persona bigint, p_token uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  if p_estado not in ('enviado', 'incierto', 'pendiente') or p_estado is null then raise exception 'Resultado inválido'; end if;
  update public.acreditacion_personas set envio_estado = p_estado,
    constancia_enviada_en = case when p_estado = 'enviado' then now() else null end,
    envio_token = case when p_estado = 'incierto' then p_token else null end,
    envio_iniciado_en = case when p_estado = 'incierto' then envio_iniciado_en else null end
  where id = p_persona and envio_token = p_token and envio_estado = 'enviando';
  if not found then raise exception 'Intento de envío inexistente o ya resuelto'; end if;
end $$;

create function public.acreditacion_progreso_envios(p_evento uuid)
returns table (
  total bigint,
  enviados bigint,
  pendientes bigint,
  en_curso bigint,
  inciertos bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from public.acreditacion_eventos where id = p_evento) then
    raise exception 'Evento inexistente';
  end if;
  return query
    select count(*),
      count(*) filter (where envio_estado = 'enviado'),
      count(*) filter (where envio_estado in ('pendiente', 'incierto')
        or (envio_estado = 'enviando' and envio_iniciado_en < now() - interval '10 minutes')),
      count(*) filter (where envio_estado = 'enviando' and envio_iniciado_en >= now() - interval '10 minutes'),
      count(*) filter (where envio_estado = 'incierto'
        or (envio_estado = 'enviando' and envio_iniciado_en < now() - interval '10 minutes'))
    from public.acreditacion_personas where evento_id = p_evento;
end $$;

create function public.acreditacion_estado_evento(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select estado into v_estado from public.acreditacion_eventos where id = p_id for update;
  if not found then raise exception 'Evento inexistente'; end if;
  if not ((v_estado = 'pendiente' and p_estado = 'activo')
       or (v_estado = 'activo' and p_estado = 'finalizado')
       or (v_estado = 'finalizado' and p_estado = 'activo')) then
    raise exception 'Cambio de estado inválido';
  end if;
  if exists (select 1 from public.acreditacion_personas where evento_id = p_id and envio_estado = 'enviando' and envio_iniciado_en >= now() - interval '10 minutes') then
    raise exception 'Hay un envío en curso; esperá antes de cambiar el estado';
  end if;
  update public.acreditacion_eventos set estado = p_estado where id = p_id;
end $$;

create function public.acreditacion_eliminar_evento(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select estado into v_estado from public.acreditacion_eventos where id = p_id for update;
  if not found then raise exception 'Evento inexistente'; end if;
  if v_estado = 'finalizado' then raise exception 'No se puede eliminar un evento finalizado'; end if;
  if exists (select 1 from public.acreditacion_personas where evento_id = p_id) then raise exception 'No se puede eliminar un evento con acreditados'; end if;
  delete from public.acreditacion_eventos where id = p_id;
end $$;

create function public.acreditacion_registrar(
  p_evento uuid, p_nombre text, p_dni text, p_cargo text, p_escuela bigint, p_email text, p_publico boolean
) returns text language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if p_publico then
    if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  elsif public.app_role() is distinct from 'distrital' then raise exception 'Sin permiso';
  end if;
  select estado into v_estado from public.acreditacion_eventos where id = p_evento for update;
  if not found or (p_publico and v_estado <> 'activo') then return 'cerrado'; end if;
  if coalesce(p_dni, '') !~ '^[0-9]{7,8}$'
     or length(btrim(coalesce(p_nombre, ''))) not between 3 and 200
     or length(btrim(coalesce(p_cargo, ''))) not between 2 and 200
     or length(coalesce(p_email, '')) > 254
     or btrim(coalesce(p_email, '')) !~* '^[a-z0-9._%+-]+@abc[.]gob[.]ar$'
     or not exists (select 1 from public.escuelas where id = p_escuela) then return 'invalido'; end if;
  begin
    insert into public.acreditacion_personas(evento_id, nombre, dni, cargo, escuela_id, email)
    values (p_evento, btrim(p_nombre), p_dni, btrim(p_cargo), p_escuela, lower(btrim(p_email)));
  exception when unique_violation then return 'duplicado';
  end;
  return 'ok';
end $$;

revoke all on function public.acreditacion_guardar_evento(uuid, text, text, date, time, time, text) from public, anon, authenticated;
revoke all on function public.acreditacion_estado_evento(uuid, text) from public, anon, authenticated;
revoke all on function public.acreditacion_eliminar_evento(uuid) from public, anon, authenticated;
revoke all on function public.acreditacion_registrar(uuid, text, text, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.acreditacion_guardar_evento(uuid, text, text, date, time, time, text) to authenticated;
grant execute on function public.acreditacion_estado_evento(uuid, text) to authenticated;
grant execute on function public.acreditacion_eliminar_evento(uuid) to authenticated;
grant execute on function public.acreditacion_registrar(uuid, text, text, text, bigint, text, boolean) to authenticated, service_role;
revoke all on function public.acreditacion_iniciar_envio(uuid, bigint) from public, anon, authenticated;
revoke all on function public.acreditacion_finalizar_envio(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.acreditacion_progreso_envios(uuid) from public, anon, authenticated;
grant execute on function public.acreditacion_iniciar_envio(uuid, bigint) to service_role;
grant execute on function public.acreditacion_finalizar_envio(bigint, uuid, text) to service_role;
grant execute on function public.acreditacion_progreso_envios(uuid) to authenticated;
revoke all on function public.acreditacion_guardar_firma(text, text, text), public.acreditacion_eliminar_firma(bigint), public.acreditacion_imagenes() from public, anon, authenticated;
grant execute on function public.acreditacion_guardar_firma(text, text, text), public.acreditacion_eliminar_firma(bigint) to authenticated;
grant execute on function public.acreditacion_imagenes() to service_role;
