-- Los datos clínicos y educativos del legajo solo se entregan mediante RPC.
create table public.eoe_legajos (
  id uuid primary key default gen_random_uuid(),
  escuela_id bigint not null references public.escuelas(id),
  dni text unique check (dni is null or dni ~ '^[0-9]{6,9}$'),
  identificador_temporal uuid not null unique default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 3 and 200),
  creado_en timestamptz not null default now()
);

create table public.eoe_legajo_intervenciones (
  id bigint generated always as identity primary key,
  legajo_id uuid not null references public.eoe_legajos(id),
  escuela_id bigint not null references public.escuelas(id),
  fecha date not null,
  texto text not null check (length(btrim(texto)) between 1 and 20000),
  firmante_id bigint references public.equipo_orientacion(id) on delete set null,
  firmante_nombre text not null,
  firmado_en timestamptz not null default now()
);

create table public.eoe_legajo_auditoria (
  id bigint generated always as identity primary key,
  legajo_id uuid not null references public.eoe_legajos(id),
  escuela_id bigint not null references public.escuelas(id),
  accion text not null,
  integrante_id bigint references public.equipo_orientacion(id) on delete set null,
  integrante_nombre text,
  usuario_id uuid,
  fecha timestamptz not null default now()
);

create table public.eoe_legajo_accesos (
  token_hash text primary key,
  legajo_id uuid not null references public.eoe_legajos(id) on delete cascade,
  escuela_id bigint not null references public.escuelas(id),
  usuario_id uuid not null,
  sesion_id uuid not null,
  integrante_id bigint not null references public.equipo_orientacion(id) on delete cascade,
  pin_version uuid not null,
  vence_en timestamptz not null
);
create index eoe_legajo_accesos_vence on public.eoe_legajo_accesos(vence_en);
create index eoe_legajo_auditoria_legajo on public.eoe_legajo_auditoria(legajo_id, id desc);
create index eoe_legajo_intervenciones_legajo on public.eoe_legajo_intervenciones(legajo_id, id desc);

alter table public.eoe_legajos enable row level security;
alter table public.eoe_legajo_intervenciones enable row level security;
alter table public.eoe_legajo_auditoria enable row level security;
alter table public.eoe_legajo_accesos enable row level security;
revoke all on public.eoe_legajos, public.eoe_legajo_intervenciones, public.eoe_legajo_auditoria, public.eoe_legajo_accesos from public, anon, authenticated;

create function public._eoe_legajo_escuela() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare escuela bigint;
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe' then raise exception 'Sin permiso'; end if;
  escuela := public.mi_escuela();
  if escuela is null or not public._eoe_escuela(escuela) then raise exception 'Sin escuela asociada'; end if;
  return escuela;
end $$;

create function public._eoe_legajo_integrante_escuela(p_integrante bigint, p_escuela bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select q.escuela_id from public.equipo_orientacion q
  join public.escuelas e on e.id = q.escuela_id
  join public.escuelas propia on propia.id = p_escuela and propia.cue = e.cue
  where q.id = p_integrante and q.activo
$$;

create function public._eoe_legajo_acceso(p_legajo uuid, p_token text)
returns boolean language sql stable security definer set search_path = public, extensions, auth as $$
  select coalesce(public.app_role() = 'eoe' and public.real_role() = 'eoe' and exists (
    select 1 from public.eoe_legajo_accesos a
    join public.eoe_legajos l on l.id = a.legajo_id and l.escuela_id = a.escuela_id
    join public.equipo_orientacion q on q.id = a.integrante_id and q.activo
      and q.escuela_id = public._eoe_legajo_integrante_escuela(q.id, a.escuela_id)
    join public.eoe_pines p on p.integrante_id = q.id and p.version = a.pin_version
    join auth.sessions s on s.id = a.sesion_id and s.user_id = a.usuario_id
    where a.legajo_id = p_legajo and a.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and a.usuario_id = auth.uid() and a.sesion_id::text = auth.jwt()->>'session_id'
      and a.vence_en > now() and public._eoe_escuela(a.escuela_id)
  ), false)
$$;
revoke all on function public._eoe_legajo_escuela(), public._eoe_legajo_integrante_escuela(bigint,bigint), public._eoe_legajo_acceso(uuid,text) from public, anon, authenticated;

create function public.eoe_legajos_listar()
returns table (id uuid, nombre text, dni text, identificador_temporal uuid)
language sql stable security definer set search_path = public as $$
  select l.id, l.nombre, l.dni, l.identificador_temporal
  from public.eoe_legajos l where l.escuela_id = public._eoe_legajo_escuela() order by l.nombre, l.id
$$;

create function public.eoe_legajo_crear(p_nombre text, p_dni text)
returns uuid language plpgsql security definer set search_path = public as $$
declare escuela bigint := public._eoe_legajo_escuela(); nuevo uuid; restriccion text;
begin
  p_nombre := btrim(coalesce(p_nombre, ''));
  p_dni := nullif(btrim(coalesce(p_dni, '')), '');
  if length(p_nombre) not between 3 and 200 then raise exception 'Ingresá el nombre del estudiante'; end if;
  if p_dni is not null and p_dni !~ '^[0-9]{6,9}$' then raise exception 'DNI inválido'; end if;
  if p_dni is not null and exists (select 1 from public.eoe_legajos where dni = p_dni) then
    raise exception 'Ya existe un legajo con ese DNI. Solicitá la transferencia a la escuela de origen.';
  end if;
  insert into public.eoe_legajos(escuela_id, nombre, dni) values (escuela, p_nombre, p_dni) returning id into nuevo;
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, usuario_id)
    values (nuevo, escuela, 'creacion', auth.uid());
  return nuevo;
exception when unique_violation then
  get stacked diagnostics restriccion = constraint_name;
  if restriccion = 'eoe_legajos_dni_key' then
    raise exception 'Ya existe un legajo con ese DNI. Solicitá la transferencia a la escuela de origen.';
  end if;
  raise;
end $$;

create function public.eoe_legajo_abrir(p_legajo uuid, p_integrante bigint, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, auth as $$
declare escuela bigint := public._eoe_legajo_escuela(); error_pin text; token text; sesion uuid; nombre text; version_pin uuid;
begin
  select s.id into sesion from auth.sessions s where s.id::text = auth.jwt()->>'session_id' and s.user_id = auth.uid();
  if sesion is null then raise exception 'La sesión ya no está disponible'; end if;
  perform 1 from public.eoe_legajos where id = p_legajo and escuela_id = escuela for update;
  if not found then raise exception 'Legajo no disponible'; end if;
  error_pin := public._eoe_pin_verificar(p_integrante, p_pin, public._eoe_legajo_integrante_escuela(p_integrante, escuela));
  if error_pin is not null then return jsonb_build_object('error', error_pin); end if;
  select q.apellido_nombre, p.version into nombre, version_pin from public.equipo_orientacion q
    join public.eoe_pines p on p.integrante_id = q.id where q.id = p_integrante;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.eoe_legajo_accesos(token_hash, legajo_id, escuela_id, usuario_id, sesion_id, integrante_id, pin_version, vence_en)
  values (encode(extensions.digest(token, 'sha256'), 'hex'), p_legajo, escuela, auth.uid(), sesion, p_integrante, version_pin, now() + interval '15 minutes');
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, integrante_id, integrante_nombre, usuario_id)
  values (p_legajo, escuela, 'apertura', p_integrante, nombre, auth.uid());
  return jsonb_build_object('token', token);
end $$;

create function public.eoe_legajo_detalle(p_legajo uuid, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare resultado jsonb;
begin
  if not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select jsonb_build_object(
    'id', l.id, 'nombre', l.nombre, 'dni', l.dni, 'identificador_temporal', l.identificador_temporal,
    'intervenciones', coalesce((select jsonb_agg(to_jsonb(i) order by i.fecha desc, i.id desc)
      from public.eoe_legajo_intervenciones i where i.legajo_id = l.id), '[]'::jsonb),
    'auditoria', coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc)
      from public.eoe_legajo_auditoria a where a.legajo_id = l.id), '[]'::jsonb)
  ) into resultado from public.eoe_legajos l where l.id = p_legajo;
  return resultado;
end $$;

create function public.eoe_legajo_identificar(p_legajo uuid, p_token text, p_dni text)
returns void language plpgsql security definer set search_path = public as $$
declare escuela bigint := public._eoe_legajo_escuela(); actual text; restriccion text;
begin
  if not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  p_dni := btrim(coalesce(p_dni, ''));
  if p_dni !~ '^[0-9]{6,9}$' then raise exception 'DNI inválido'; end if;
  select dni into actual from public.eoe_legajos where id = p_legajo and escuela_id = escuela for update;
  if not found then raise exception 'Legajo no disponible'; end if;
  if actual is not null then raise exception 'El legajo ya tiene DNI'; end if;
  update public.eoe_legajos set dni = p_dni where id = p_legajo;
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, usuario_id)
    values (p_legajo, escuela, 'identificacion', auth.uid());
exception when unique_violation then
  get stacked diagnostics restriccion = constraint_name;
  if restriccion = 'eoe_legajos_dni_key' then
    raise exception 'Ya existe un legajo con ese DNI. Solicitá la transferencia a la escuela de origen.';
  end if;
  raise;
end $$;

create function public.eoe_legajo_intervenir(p_legajo uuid, p_token text, p_fecha date, p_texto text, p_integrante bigint, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare escuela bigint := public._eoe_legajo_escuela(); error_pin text; nombre text;
begin
  if not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  p_texto := btrim(coalesce(p_texto, ''));
  if p_fecha is null or length(p_texto) not between 1 and 20000 then raise exception 'Completá la fecha y la intervención'; end if;
  perform 1 from public.eoe_legajos where id = p_legajo and escuela_id = escuela for update;
  if not found then raise exception 'Legajo no disponible'; end if;
  error_pin := public._eoe_pin_verificar(p_integrante, p_pin, public._eoe_legajo_integrante_escuela(p_integrante, escuela));
  if error_pin is not null then return error_pin; end if;
  select apellido_nombre into nombre from public.equipo_orientacion where id = p_integrante;
  insert into public.eoe_legajo_intervenciones(legajo_id, escuela_id, fecha, texto, firmante_id, firmante_nombre)
    values (p_legajo, escuela, p_fecha, p_texto, p_integrante, nombre);
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, integrante_id, integrante_nombre, usuario_id)
    values (p_legajo, escuela, 'intervencion', p_integrante, nombre, auth.uid());
  return null;
end $$;

revoke all on function public.eoe_legajos_listar(), public.eoe_legajo_crear(text,text),
  public.eoe_legajo_abrir(uuid,bigint,text), public.eoe_legajo_detalle(uuid,text),
  public.eoe_legajo_identificar(uuid,text,text), public.eoe_legajo_intervenir(uuid,text,date,text,bigint,text) from public, anon;
grant execute on function public.eoe_legajos_listar(), public.eoe_legajo_crear(text,text),
  public.eoe_legajo_abrir(uuid,bigint,text), public.eoe_legajo_detalle(uuid,text),
  public.eoe_legajo_identificar(uuid,text,text), public.eoe_legajo_intervenir(uuid,text,date,text,bigint,text) to authenticated;
