create table public.eoe_legajo_solicitudes (
  id uuid primary key default gen_random_uuid(),
  origen_id bigint not null references public.escuelas(id),
  destino_id bigint not null references public.escuelas(id),
  solicitante uuid not null references public.profiles(id),
  dni text check (dni is null or dni ~ '^[0-9]{6,9}$'),
  descripcion text,
  estado text not null default 'borrador' check (estado in ('borrador', 'pendiente', 'transferido')),
  legajo_id uuid references public.eoe_legajos(id),
  creado_en timestamptz not null default now(),
  enviado_en timestamptz,
  resuelto_en timestamptz,
  check (origen_id <> destino_id),
  check ((dni is not null and descripcion is null) or (dni is null and descripcion is not null and length(btrim(descripcion)) between 3 and 1000))
);

create table public.eoe_legajo_probanzas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.eoe_legajo_solicitudes(id),
  nombre text not null check (length(nombre) between 1 and 255),
  mime text not null,
  bytes bigint not null check (bytes > 0),
  drive_file_id text not null unique,
  creado_en timestamptz not null default now()
);

create table public.eoe_legajo_transferencias_preparadas (
  token_hash text primary key,
  solicitud_id uuid not null references public.eoe_legajo_solicitudes(id) on delete cascade,
  legajo_id uuid not null references public.eoe_legajos(id),
  usuario_id uuid not null,
  sesion_id uuid not null,
  integrante_id bigint not null references public.equipo_orientacion(id) on delete cascade,
  integrante_nombre text not null,
  pin_version uuid not null,
  vence_en timestamptz not null
);
create index eoe_transferencias_expiracion on public.eoe_legajo_transferencias_preparadas(vence_en);
alter table public.eoe_legajo_solicitudes enable row level security;
alter table public.eoe_legajo_probanzas enable row level security;
alter table public.eoe_legajo_transferencias_preparadas enable row level security;
revoke all on public.eoe_legajo_solicitudes, public.eoe_legajo_probanzas, public.eoe_legajo_transferencias_preparadas from public, anon, authenticated;

create function public.eoe_legajo_escuelas_destino()
returns table (id bigint, nombre text, cue text)
language sql stable security definer set search_path = public as $$
  select e.id, coalesce(nullif(e.nombre, ''), e.cue), e.cue
  from public.escuelas e where e.id <> public._eoe_legajo_escuela()
    and e.id = (select min(e2.id) from public.escuelas e2 where e2.cue = e.cue)
    and exists (select 1 from public.profiles p where p.cue = e.cue and p.role = 'eoe' and p.active)
  order by 2, 1
$$;

create function public.eoe_legajo_solicitar(p_origen bigint, p_dni text, p_descripcion text)
returns uuid language plpgsql security definer set search_path = public as $$
declare escuela bigint := public._eoe_legajo_escuela(); solicitud uuid;
begin
  p_dni := nullif(btrim(coalesce(p_dni, '')), '');
  p_descripcion := nullif(btrim(coalesce(p_descripcion, '')), '');
  if p_origen = escuela or not exists (
    select 1 from public.escuelas e join public.profiles p on p.cue = e.cue
    where e.id = p_origen and e.id = (select min(e2.id) from public.escuelas e2 where e2.cue = e.cue) and p.role = 'eoe' and p.active
  ) then raise exception 'La escuela de origen no está disponible'; end if;
  if (p_dni is null) = (p_descripcion is null) then raise exception 'Ingresá el DNI o una descripción para el estudiante sin DNI'; end if;
  if p_dni is not null and p_dni !~ '^[0-9]{6,9}$' then raise exception 'DNI inválido'; end if;
  if p_descripcion is not null and length(p_descripcion) not between 3 and 1000 then raise exception 'La descripción debe tener entre 3 y 1000 caracteres'; end if;
  insert into public.eoe_legajo_solicitudes(origen_id, destino_id, solicitante, dni, descripcion)
    values (p_origen, escuela, auth.uid(), p_dni, p_descripcion) returning id into solicitud;
  return solicitud;
end $$;

create function public.eoe_legajo_solicitudes()
returns table (id uuid, origen_id bigint, destino_id bigint, origen text, destino text, dni text, descripcion text,
  estado text, creado_en timestamptz, enviado_en timestamptz, probanzas bigint, direccion text)
language sql stable security definer set search_path = public as $$
  select s.id, s.origen_id, s.destino_id, coalesce(o.nombre, o.cue), coalesce(d.nombre, d.cue),
    s.dni, s.descripcion, s.estado, s.creado_en, s.enviado_en,
    (select count(*) from public.eoe_legajo_probanzas p where p.solicitud_id = s.id),
    case when s.destino_id = public._eoe_legajo_escuela() then 'enviada' else 'recibida' end
  from public.eoe_legajo_solicitudes s
  join public.escuelas o on o.id = s.origen_id join public.escuelas d on d.id = s.destino_id
  where s.destino_id = public._eoe_legajo_escuela()
     or (s.origen_id = public._eoe_legajo_escuela() and s.estado <> 'borrador')
  order by s.creado_en desc, s.id desc
$$;

-- Solo una función de servidor puede registrar el archivo que efectivamente subió a Drive.
create function public.eoe_legajo_registrar_probanza(p_solicitud uuid, p_usuario uuid, p_nombre text, p_mime text, p_bytes bigint, p_drive_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare archivo uuid;
begin
  perform 1 from public.eoe_legajo_solicitudes s join public.profiles p on p.id = p_usuario
  where s.id = p_solicitud and s.solicitante = p_usuario
    and p.active and p.role = 'eoe' and exists (select 1 from public.escuelas e where e.id = s.destino_id and e.cue = p.cue)
  for update of s;
  if not found then raise exception 'Solicitud no disponible'; end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 1 and 255 or p_mime is null or p_bytes is null or p_bytes <= 0
    or p_drive_id is null or p_drive_id !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'Archivo inválido'; end if;
  insert into public.eoe_legajo_probanzas(solicitud_id, nombre, mime, bytes, drive_file_id)
    values (p_solicitud, btrim(p_nombre), p_mime, p_bytes, p_drive_id) returning id into archivo;
  return archivo;
end $$;
revoke all on function public.eoe_legajo_registrar_probanza(uuid,uuid,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.eoe_legajo_registrar_probanza(uuid,uuid,text,text,bigint,text) to service_role;

create function public.eoe_legajo_enviar_solicitud(p_solicitud uuid) returns void
language plpgsql security definer set search_path = public as $$
declare escuela bigint := public._eoe_legajo_escuela(); destinatario uuid;
begin
  select p.id into destinatario from public.eoe_legajo_solicitudes s
    join public.escuelas e on e.id = s.origen_id
    join public.profiles p on p.cue = e.cue and p.role = 'eoe' and p.active
  where s.id = p_solicitud and s.destino_id = escuela and s.solicitante = auth.uid() and s.estado = 'borrador'
    and exists (select 1 from public.eoe_legajo_probanzas a where a.solicitud_id = s.id)
  for update of s;
  if destinatario is null then raise exception 'La solicitud necesita una probanza y una escuela de origen activa'; end if;
  update public.eoe_legajo_solicitudes set estado = 'pendiente', enviado_en = now() where id = p_solicitud and estado = 'borrador';
  perform public._notificar(destinatario, 'Solicitud de legajo digital', 'Otra escuela solicitó una transferencia de legajo. Revisá las solicitudes recibidas.', '#/legajo-digital');
end $$;

create function public.eoe_legajo_preparar_transferencia(p_solicitud uuid, p_legajo uuid, p_integrante bigint, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, auth as $$
declare escuela bigint := public._eoe_legajo_escuela(); solicitud public.eoe_legajo_solicitudes; legajo public.eoe_legajos;
  sesion uuid; error_pin text; token text; nombre text; version_pin uuid;
begin
  select id into sesion from auth.sessions s where s.id::text = auth.jwt()->>'session_id' and s.user_id = auth.uid();
  if sesion is null then raise exception 'La sesión ya no está disponible'; end if;
  select * into solicitud from public.eoe_legajo_solicitudes where id = p_solicitud and origen_id = escuela and estado = 'pendiente' for update;
  if not found then raise exception 'Solicitud no disponible'; end if;
  select * into legajo from public.eoe_legajos where id = p_legajo and escuela_id = escuela for update;
  if not found then raise exception 'Legajo no disponible'; end if;
  if solicitud.dni is not null and legajo.dni is distinct from solicitud.dni then raise exception 'El DNI no coincide con la solicitud'; end if;
  error_pin := public._eoe_pin_verificar(p_integrante, p_pin, public._eoe_legajo_integrante_escuela(p_integrante, escuela));
  if error_pin is not null then return jsonb_build_object('error', error_pin); end if;
  select q.apellido_nombre, p.version into nombre, version_pin from public.equipo_orientacion q
    join public.eoe_pines p on p.integrante_id = q.id where q.id = p_integrante;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.eoe_legajo_transferencias_preparadas(token_hash, solicitud_id, legajo_id, usuario_id, sesion_id, integrante_id, integrante_nombre, pin_version, vence_en)
    values (encode(extensions.digest(token, 'sha256'), 'hex'), p_solicitud, p_legajo, auth.uid(), sesion, p_integrante, nombre, version_pin, now() + interval '5 minutes');
  return jsonb_build_object('token', token);
end $$;

create function public.eoe_legajo_confirmar_transferencia(p_solicitud uuid, p_token text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
declare escuela bigint := public._eoe_legajo_escuela(); solicitud public.eoe_legajo_solicitudes;
  preparacion public.eoe_legajo_transferencias_preparadas; legajo public.eoe_legajos;
begin
  select * into solicitud from public.eoe_legajo_solicitudes where id = p_solicitud and origen_id = escuela and estado = 'pendiente' for update;
  if not found then raise exception 'Solicitud no disponible'; end if;
  select a.* into preparacion from public.eoe_legajo_transferencias_preparadas a
    join public.eoe_pines p on p.integrante_id = a.integrante_id and p.version = a.pin_version
    join public.equipo_orientacion q on q.id = a.integrante_id and q.activo
      and q.escuela_id = public._eoe_legajo_integrante_escuela(q.id, escuela)
    join auth.sessions s on s.id = a.sesion_id and s.user_id = a.usuario_id
  where a.solicitud_id = p_solicitud and a.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and a.usuario_id = auth.uid() and a.sesion_id::text = auth.jwt()->>'session_id' and a.vence_en > now()
  for update of a, p, q;
  if not found then raise exception 'Confirmación vencida o no autorizada'; end if;
  select * into legajo from public.eoe_legajos where id = preparacion.legajo_id and escuela_id = escuela for update;
  if not found or (solicitud.dni is not null and legajo.dni is distinct from solicitud.dni) then raise exception 'Legajo no disponible o DNI diferente'; end if;
  update public.eoe_legajos set escuela_id = solicitud.destino_id where id = legajo.id;
  update public.eoe_legajo_solicitudes set estado = 'transferido', legajo_id = legajo.id, resuelto_en = now() where id = solicitud.id;
  delete from public.eoe_legajo_accesos where legajo_id = legajo.id;
  delete from public.eoe_legajo_transferencias_preparadas where solicitud_id = solicitud.id;
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, integrante_id, integrante_nombre, usuario_id)
    values (legajo.id, escuela, 'transferencia', preparacion.integrante_id, preparacion.integrante_nombre, auth.uid());
  perform public._notificar(solicitud.solicitante, 'Legajo transferido', 'La escuela de origen confirmó la transferencia. Abrí el módulo Legajo Digital.', '#/legajo-digital');
end $$;

revoke all on function public.eoe_legajo_escuelas_destino(), public.eoe_legajo_solicitar(bigint,text,text),
  public.eoe_legajo_solicitudes(), public.eoe_legajo_enviar_solicitud(uuid),
  public.eoe_legajo_preparar_transferencia(uuid,uuid,bigint,text), public.eoe_legajo_confirmar_transferencia(uuid,text) from public, anon;
grant execute on function public.eoe_legajo_escuelas_destino(), public.eoe_legajo_solicitar(bigint,text,text),
  public.eoe_legajo_solicitudes(), public.eoe_legajo_enviar_solicitud(uuid),
  public.eoe_legajo_preparar_transferencia(uuid,uuid,bigint,text), public.eoe_legajo_confirmar_transferencia(uuid,text) to authenticated;
