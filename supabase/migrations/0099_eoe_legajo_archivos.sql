create table public.eoe_legajo_archivos (
  id uuid primary key default gen_random_uuid(),
  legajo_id uuid not null references public.eoe_legajos(id),
  nombre text not null check (length(btrim(nombre)) between 1 and 255),
  mime text not null,
  bytes bigint not null check (bytes > 0),
  drive_file_id text not null unique,
  creado_en timestamptz not null default now()
);

-- Una reserva evita crear dos carpetas al subir archivos en simultáneo.
create table public.eoe_drive_carpetas (
  tipo text not null check (tipo in ('legajo', 'solicitud')),
  referencia uuid not null,
  drive_folder_id text,
  reserva uuid,
  reserva_hasta timestamptz,
  primary key (tipo, referencia),
  unique (drive_folder_id)
);
create table public.eoe_drive_cargas (
  drive_file_id text primary key,
  tipo text not null check (tipo in ('legajo', 'solicitud')),
  referencia uuid not null,
  nombre text not null,
  mime text not null,
  bytes bigint not null check (bytes > 0),
  usuario_id uuid not null,
  archivo_id uuid,
  creado_en timestamptz not null default now()
);
alter table public.eoe_legajo_archivos enable row level security;
alter table public.eoe_drive_carpetas enable row level security;
alter table public.eoe_drive_cargas enable row level security;
revoke all on public.eoe_legajo_archivos, public.eoe_drive_carpetas, public.eoe_drive_cargas from public, anon, authenticated;

-- Esta variante también permite al servidor verificar al usuario después de una subida.
create function public._eoe_legajo_acceso_actor(p_legajo uuid, p_token text, p_usuario uuid, p_sesion uuid)
returns boolean language sql stable security definer set search_path = public, extensions, auth as $$
  select coalesce(exists (
    select 1 from public.eoe_legajo_accesos a
    join public.eoe_legajos l on l.id = a.legajo_id and l.escuela_id = a.escuela_id
    join public.escuelas e on e.id = a.escuela_id
    join public.profiles u on u.id = a.usuario_id and u.active and u.role = 'eoe' and u.cue = e.cue
    join public.equipo_orientacion q on q.id = a.integrante_id and q.activo
      and q.escuela_id = public._eoe_legajo_integrante_escuela(q.id, a.escuela_id)
    join public.eoe_pines p on p.integrante_id = q.id and p.version = a.pin_version
    join auth.sessions s on s.id = a.sesion_id and s.user_id = a.usuario_id
    where a.legajo_id = p_legajo and a.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and a.usuario_id = p_usuario and a.sesion_id = p_sesion and a.vence_en > now()
  ), false)
$$;
create or replace function public._eoe_legajo_acceso(p_legajo uuid, p_token text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(public.app_role() = 'eoe' and public.real_role() = 'eoe'
    and public._eoe_legajo_acceso_actor(p_legajo, p_token, auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid), false)
$$;

create function public._eoe_drive_permitido_actor(p_tipo text, p_referencia uuid, p_token text, p_usuario uuid, p_sesion uuid, p_escritura boolean)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select case p_tipo
    when 'legajo' then public._eoe_legajo_acceso_actor(p_referencia, p_token, p_usuario, p_sesion)
    when 'solicitud' then exists (
      select 1 from public.eoe_legajo_solicitudes s
      join public.profiles u on u.id = p_usuario and u.active and u.role = 'eoe'
      join auth.sessions ses on ses.id = p_sesion and ses.user_id = p_usuario
      where s.id = p_referencia and (
        (s.solicitante = p_usuario and exists (select 1 from public.escuelas e where e.id = s.destino_id and e.cue = u.cue)
        )
        or (not p_escritura and s.estado = 'pendiente'
          and exists (select 1 from public.escuelas e where e.id = s.origen_id and e.cue = u.cue))
      )
    )
    else false end
$$;
revoke all on function public._eoe_legajo_acceso_actor(uuid,text,uuid,uuid),
  public._eoe_drive_permitido_actor(text,uuid,text,uuid,uuid,boolean) from public, anon, authenticated;

create function public.eoe_drive_info(p_tipo text, p_referencia uuid, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare sesion uuid := nullif(auth.jwt()->>'session_id', '')::uuid; nombre text; carpeta text; puede_subir boolean;
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe'
    or not public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, auth.uid(), sesion, false) then raise exception 'Sin permiso'; end if;
  puede_subir := public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, auth.uid(), sesion, true);
  if p_tipo = 'legajo' then
    select coalesce(l.dni, 'SIN-DNI-' || l.identificador_temporal::text) into nombre from public.eoe_legajos l where l.id = p_referencia;
  else
    nombre := 'SOLICITUD-' || p_referencia::text;
  end if;
  select c.drive_folder_id into carpeta from public.eoe_drive_carpetas c where c.tipo = p_tipo and c.referencia = p_referencia;
  return jsonb_build_object('nombre_carpeta', nombre, 'carpeta_id', carpeta, 'puede_subir', puede_subir);
end $$;

create function public.eoe_drive_listar(p_tipo text, p_referencia uuid, p_token text default null)
returns table (id uuid, nombre text, mime text, bytes bigint, creado_en timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe'
    or not public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, false) then raise exception 'Sin permiso'; end if;
  if p_tipo = 'legajo' then
    return query select a.id, a.nombre, a.mime, a.bytes, a.creado_en from public.eoe_legajo_archivos a where a.legajo_id = p_referencia order by a.creado_en desc, a.id;
  else
    return query select a.id, a.nombre, a.mime, a.bytes, a.creado_en from public.eoe_legajo_probanzas a where a.solicitud_id = p_referencia order by a.creado_en desc, a.id;
  end if;
end $$;

create function public.eoe_drive_archivo(p_tipo text, p_archivo uuid, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare referencia uuid; archivo text; carpeta text;
begin
  if p_tipo = 'legajo' then
    select a.legajo_id, a.drive_file_id into referencia, archivo from public.eoe_legajo_archivos a where a.id = p_archivo;
  elsif p_tipo = 'solicitud' then
    select a.solicitud_id, a.drive_file_id into referencia, archivo from public.eoe_legajo_probanzas a where a.id = p_archivo;
  end if;
  if referencia is null or public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe'
    or not public._eoe_drive_permitido_actor(p_tipo, referencia, p_token, auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, false) then raise exception 'Archivo no disponible'; end if;
  select c.drive_folder_id into carpeta from public.eoe_drive_carpetas c where c.tipo = p_tipo and c.referencia = referencia;
  if carpeta is null then raise exception 'Carpeta no disponible'; end if;
  return jsonb_build_object('referencia', referencia, 'drive_file_id', archivo, 'carpeta_id', carpeta);
end $$;

create function public.eoe_drive_pendientes(p_tipo text, p_referencia uuid, p_token text default null)
returns table (drive_file_id text, nombre text, mime text, bytes bigint, creado_en timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe'
    or not public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid, true) then raise exception 'Sin permiso'; end if;
  return query select c.drive_file_id, c.nombre, c.mime, c.bytes, c.creado_en
    from public.eoe_drive_cargas c where c.tipo = p_tipo and c.referencia = p_referencia and c.archivo_id is null
    order by c.creado_en, c.drive_file_id;
end $$;

create function public.eoe_drive_iniciar(p_tipo text, p_referencia uuid, p_token text, p_usuario uuid, p_sesion uuid,
  p_drive_id text, p_nombre text, p_mime text, p_bytes bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tipo = 'legajo' then
    perform 1 from public.eoe_legajos where id = p_referencia for update;
  elsif p_tipo = 'solicitud' then
    perform 1 from public.eoe_legajo_solicitudes where id = p_referencia and estado = 'borrador' for update;
  else raise exception 'Tipo inválido';
  end if;
  if not found or not public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, p_usuario, p_sesion, true) then raise exception 'Acceso vencido o no autorizado'; end if;
  if p_drive_id is null or p_drive_id !~ '^[A-Za-z0-9_-]{10,100}$' or p_nombre is null or length(btrim(p_nombre)) not between 1 and 255
    or p_mime is null or length(p_mime) not between 1 and 255 or p_bytes is null or p_bytes <= 0 then raise exception 'Archivo inválido'; end if;
  insert into public.eoe_drive_cargas(drive_file_id, tipo, referencia, nombre, mime, bytes, usuario_id)
    values (p_drive_id, p_tipo, p_referencia, btrim(p_nombre), p_mime, p_bytes, p_usuario);
end $$;

create function public.eoe_drive_reservar(p_tipo text, p_referencia uuid, p_reserva uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.eoe_drive_carpetas;
begin
  if p_tipo not in ('legajo', 'solicitud') or p_referencia is null or p_reserva is null then raise exception 'Reserva inválida'; end if;
  insert into public.eoe_drive_carpetas(tipo, referencia) values (p_tipo, p_referencia) on conflict do nothing;
  select * into r from public.eoe_drive_carpetas where tipo = p_tipo and referencia = p_referencia for update;
  if r.drive_folder_id is not null then return jsonb_build_object('estado', 'lista', 'id', r.drive_folder_id); end if;
  if r.reserva is not null and r.reserva_hasta > now() then return jsonb_build_object('estado', 'ocupada'); end if;
  update public.eoe_drive_carpetas set reserva = p_reserva, reserva_hasta = now() + interval '2 minutes'
    where tipo = p_tipo and referencia = p_referencia;
  return jsonb_build_object('estado', 'reservada');
end $$;

create function public.eoe_drive_confirmar(p_tipo text, p_referencia uuid, p_reserva uuid, p_carpeta text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_carpeta is null or p_carpeta !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'Carpeta inválida'; end if;
  update public.eoe_drive_carpetas set drive_folder_id = p_carpeta, reserva = null, reserva_hasta = null
    where tipo = p_tipo and referencia = p_referencia and reserva = p_reserva and reserva_hasta > now() and drive_folder_id is null;
  return found;
end $$;

create function public.eoe_drive_liberar(p_tipo text, p_referencia uuid, p_reserva uuid)
returns void language sql security definer set search_path = public as $$
  update public.eoe_drive_carpetas set reserva = null, reserva_hasta = null
    where tipo = p_tipo and referencia = p_referencia and reserva = p_reserva
$$;

create function public.eoe_drive_registrar(p_tipo text, p_referencia uuid, p_token text, p_usuario uuid, p_sesion uuid,
  p_carpeta text, p_drive_id text, p_nombre text, p_mime text, p_bytes bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare archivo uuid; escuela bigint; carga public.eoe_drive_cargas;
begin
  if not public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, p_usuario, p_sesion, true) then raise exception 'Acceso vencido o no autorizado'; end if;
  if not exists (select 1 from public.eoe_drive_carpetas c where c.tipo = p_tipo and c.referencia = p_referencia and c.drive_folder_id = p_carpeta) then raise exception 'Carpeta no disponible'; end if;
  if p_drive_id is null or p_drive_id !~ '^[A-Za-z0-9_-]{10,100}$' or p_nombre is null or length(btrim(p_nombre)) not between 1 and 255
    or p_mime is null or length(p_mime) not between 1 and 255 or p_bytes is null or p_bytes <= 0 then raise exception 'Archivo inválido'; end if;
  if p_tipo = 'legajo' then
    select l.escuela_id into escuela from public.eoe_legajos l where l.id = p_referencia for update;
    -- Se vuelve a verificar después del bloqueo para no registrar una carga luego de una transferencia.
    if not public._eoe_legajo_acceso_actor(p_referencia, p_token, p_usuario, p_sesion) then raise exception 'Acceso vencido o no autorizado'; end if;
    select * into carga from public.eoe_drive_cargas where drive_file_id = p_drive_id and tipo = p_tipo and referencia = p_referencia for update;
    if not found or carga.nombre is distinct from btrim(p_nombre) or carga.mime is distinct from p_mime or carga.bytes is distinct from p_bytes then raise exception 'Carga no disponible'; end if;
    if carga.archivo_id is not null then return carga.archivo_id; end if;
    insert into public.eoe_legajo_archivos(legajo_id, nombre, mime, bytes, drive_file_id)
      values (p_referencia, btrim(p_nombre), p_mime, p_bytes, p_drive_id) returning id into archivo;
    insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, usuario_id)
      values (p_referencia, escuela, 'documentacion', p_usuario);
  elsif p_tipo = 'solicitud' then
    perform 1 from public.eoe_legajo_solicitudes where id = p_referencia for update;
    if not found or not public._eoe_drive_permitido_actor(p_tipo, p_referencia, p_token, p_usuario, p_sesion, true) then raise exception 'Solicitud no disponible'; end if;
    select * into carga from public.eoe_drive_cargas where drive_file_id = p_drive_id and tipo = p_tipo and referencia = p_referencia for update;
    if not found or carga.nombre is distinct from btrim(p_nombre) or carga.mime is distinct from p_mime or carga.bytes is distinct from p_bytes then raise exception 'Carga no disponible'; end if;
    if carga.archivo_id is not null then return carga.archivo_id; end if;
    archivo := public.eoe_legajo_registrar_probanza(p_referencia, p_usuario, p_nombre, p_mime, p_bytes, p_drive_id);
  else
    raise exception 'Tipo inválido';
  end if;
  update public.eoe_drive_cargas set archivo_id = archivo where drive_file_id = p_drive_id;
  return archivo;
end $$;

revoke all on function public.eoe_drive_info(text,uuid,text), public.eoe_drive_listar(text,uuid,text),
  public.eoe_drive_archivo(text,uuid,text), public.eoe_drive_pendientes(text,uuid,text) from public, anon;
grant execute on function public.eoe_drive_info(text,uuid,text), public.eoe_drive_listar(text,uuid,text),
  public.eoe_drive_archivo(text,uuid,text), public.eoe_drive_pendientes(text,uuid,text) to authenticated;
revoke all on function public.eoe_drive_reservar(text,uuid,uuid), public.eoe_drive_confirmar(text,uuid,uuid,text),
  public.eoe_drive_liberar(text,uuid,uuid), public.eoe_drive_iniciar(text,uuid,text,uuid,uuid,text,text,text,bigint),
  public.eoe_drive_registrar(text,uuid,text,uuid,uuid,text,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.eoe_drive_reservar(text,uuid,uuid), public.eoe_drive_confirmar(text,uuid,uuid,text),
  public.eoe_drive_liberar(text,uuid,uuid), public.eoe_drive_iniciar(text,uuid,text,uuid,uuid,text,text,text,bigint),
  public.eoe_drive_registrar(text,uuid,text,uuid,uuid,text,text,text,text,bigint) to service_role;
