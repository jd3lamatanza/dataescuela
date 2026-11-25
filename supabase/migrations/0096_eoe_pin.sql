-- Los PIN no son consultables por clientes: solo se usan mediante funciones controladas.
create table public.eoe_pines (
  integrante_id bigint primary key references public.equipo_orientacion(id) on delete cascade,
  pin_hash text not null,
  version uuid not null default gen_random_uuid(),
  intentos integer not null default 0,
  bloqueado_hasta timestamptz,
  actualizado_en timestamptz not null default now()
);
alter table public.eoe_pines enable row level security;
revoke all on public.eoe_pines from public, anon, authenticated;

create table public.eoe_pin_solicitudes (
  id bigint generated always as identity primary key,
  integrante_id bigint not null references public.equipo_orientacion(id) on delete cascade,
  escuela_id bigint not null references public.escuelas(id),
  solicitante uuid not null references public.profiles(id),
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references public.profiles(id)
);
create unique index eoe_pin_solicitud_pendiente on public.eoe_pin_solicitudes(integrante_id) where resuelto_en is null;
alter table public.eoe_pin_solicitudes enable row level security;
revoke all on public.eoe_pin_solicitudes from public, anon, authenticated;

-- Devuelve el error para conservar el contador de intentos en la transacción.
create function public._eoe_pin_verificar(p_integrante bigint, p_pin text, p_escuela bigint)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare registro public.eoe_pines;
begin
  if not exists (select 1 from public.equipo_orientacion q where q.id = p_integrante and q.escuela_id = p_escuela and q.activo) then
    return 'Integrante no disponible.';
  end if;
  select * into registro from public.eoe_pines where integrante_id = p_integrante for update;
  if not found then return 'El integrante todavía no creó su PIN.'; end if;
  if registro.bloqueado_hasta > now() then return 'PIN bloqueado temporalmente. Intentá nuevamente más tarde.'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' or extensions.crypt(p_pin, registro.pin_hash) <> registro.pin_hash then
    update public.eoe_pines set
      intentos = case when registro.bloqueado_hasta is not null and registro.bloqueado_hasta <= now() then 1 else intentos + 1 end,
      bloqueado_hasta = case when (case when registro.bloqueado_hasta is not null and registro.bloqueado_hasta <= now() then 1 else intentos + 1 end) >= 5
        then now() + interval '15 minutes' else null end
    where integrante_id = p_integrante;
    return 'PIN incorrecto.';
  end if;
  update public.eoe_pines set intentos = 0, bloqueado_hasta = null where integrante_id = p_integrante;
  return null;
end $$;
revoke all on function public._eoe_pin_verificar(bigint,text,bigint) from public, anon, authenticated;

create or replace function public.correo_buzon_actual() returns text
language sql stable security definer set search_path = public as $$
  select case when public.app_role() = 'distrital' then 'jd3'
              when public.app_role() in ('escolar', 'areal', 'eoe') then public.eff_uid()::text
              else null end
$$;

create or replace function public.correo_destinos()
returns table (buzon text, nombre text, rol text)
language sql stable security definer set search_path = public as $$
  select 'jd3'::text, 'Jefatura Distrital 3'::text, 'distrital'::text
  where public.app_role() in ('escolar', 'areal', 'eoe')
  union all
  select p.id::text, p.name, p.role
  from public.profiles p
  where p.active and p.id <> public.eff_uid()
    and (
      (public.app_role() = 'distrital' and p.role in ('escolar', 'areal', 'eoe'))
      or (public.app_role() = 'areal' and p.role = 'escolar'
          and exists (select 1 from public.escuelas e
                      where e.cue = p.cue and e.clave = any(public.claves_asignadas())))
      or (public.app_role() = 'escolar' and p.role = 'areal'
          and exists (select 1 from public.inspectores i
                      join public.escuelas e on e.clave = any(i.escuelas_asignadas)
                      where i.user_id = p.id and e.cue = public.app_cue()))
    )
  order by 2, 1
$$;

create table public.eoe_equipo_historial (
  id bigint generated always as identity primary key,
  escuela_id bigint not null references public.escuelas(id) on delete cascade,
  integrante_id bigint not null,
  accion text not null check (accion in ('alta', 'edicion', 'eliminacion')),
  nombre text not null,
  autor_id uuid,
  autor_nombre text,
  fecha timestamptz not null default now(),
  cambios text[] not null default '{}'
);
alter table public.eoe_equipo_historial enable row level security;
revoke all on public.eoe_equipo_historial from public, anon, authenticated;

create function public._eoe_registrar_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor text; campos text[];
begin
  select name into actor from public.profiles where id = auth.uid();
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into campos
    from jsonb_object_keys(to_jsonb(new)) as k
    where k not in ('updated_at', 'updated_by') and to_jsonb(old)->k is distinct from to_jsonb(new)->k;
    if cardinality(campos) = 0 then return new; end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.escuela_id is distinct from new.escuela_id) then
    insert into public.eoe_equipo_historial(escuela_id, integrante_id, accion, nombre, autor_id, autor_nombre)
    values (old.escuela_id, old.id, 'eliminacion', old.apellido_nombre, auth.uid(), actor);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.escuela_id is distinct from new.escuela_id) then
    insert into public.eoe_equipo_historial(escuela_id, integrante_id, accion, nombre, autor_id, autor_nombre)
    values (new.escuela_id, new.id, 'alta', new.apellido_nombre, auth.uid(), actor);
  elsif tg_op = 'UPDATE' then
    insert into public.eoe_equipo_historial(escuela_id, integrante_id, accion, nombre, autor_id, autor_nombre, cambios)
    values (new.escuela_id, new.id, 'edicion', new.apellido_nombre, auth.uid(), actor, campos);
  end if;
  return null;
end $$;
revoke all on function public._eoe_registrar_equipo() from public, anon, authenticated;
create trigger eoe_equipo_historial after insert or update or delete on public.equipo_orientacion
  for each row execute function public._eoe_registrar_equipo();

create function public.eoe_equipo_historial_listar()
returns table (accion text, nombre text, autor text, fecha timestamptz, cambios text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe' then raise exception 'Sin permiso'; end if;
  return query select h.accion, h.nombre, h.autor_nombre, h.fecha, h.cambios
    from public.eoe_equipo_historial h where public._eoe_escuela(h.escuela_id) order by h.id desc;
end $$;

create function public.eoe_pin_integrantes()
returns table (id bigint, nombre text, cargo text, tiene_pin boolean, solicitud_pendiente boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe' then raise exception 'Sin permiso'; end if;
  return query
    select e.id, e.apellido_nombre, c.nombre, p.integrante_id is not null,
      exists (select 1 from public.eoe_pin_solicitudes s where s.integrante_id = e.id and s.resuelto_en is null)
    from public.equipo_orientacion e
    left join public.catalogos c on c.id = e.cargo_id
    left join public.eoe_pines p on p.integrante_id = e.id
    where e.activo and public._eoe_escuela(e.escuela_id)
    order by e.apellido_nombre, e.id;
end $$;

-- Devuelve el error en lugar de lanzar una excepción para conservar los intentos fallidos.
create function public.eoe_pin_guardar(p_integrante bigint, p_nuevo text, p_anterior text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare registro public.eoe_pines; escuela bigint; error_pin text;
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe'
    or not exists (select 1 from public.equipo_orientacion e where e.id = p_integrante and e.activo and public._eoe_escuela(e.escuela_id))
  then raise exception 'Sin permiso'; end if;
  if p_nuevo is null or p_nuevo !~ '^[0-9]{6}$' then raise exception 'El PIN debe tener exactamente seis dígitos'; end if;
  -- Serializa también la primera creación para evitar reemplazos simultáneos.
  select escuela_id into escuela from public.equipo_orientacion where id = p_integrante for update;
  select * into registro from public.eoe_pines where integrante_id = p_integrante for update;
  if found then
    error_pin := public._eoe_pin_verificar(p_integrante, p_anterior, escuela);
    if error_pin is not null then return error_pin; end if;
    update public.eoe_pines set pin_hash = extensions.crypt(p_nuevo, extensions.gen_salt('bf', 10)),
      version = gen_random_uuid(), intentos = 0, bloqueado_hasta = null, actualizado_en = now() where integrante_id = p_integrante;
    update public.eoe_pin_solicitudes set resuelto_en = now(), resuelto_por = public.eff_uid()
      where integrante_id = p_integrante and resuelto_en is null;
  else
    insert into public.eoe_pines(integrante_id, pin_hash)
    values (p_integrante, extensions.crypt(p_nuevo, extensions.gen_salt('bf', 10)));
  end if;
  return null;
end $$;

create function public.eoe_pin_solicitar_restablecimiento(p_integrante bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e record; mensaje bigint; autor text;
begin
  if public.app_role() is distinct from 'eoe' or public.real_role() is distinct from 'eoe' then raise exception 'Sin permiso'; end if;
  select q.escuela_id, q.apellido_nombre, s.nombre as escuela into e
  from public.equipo_orientacion q join public.escuelas s on s.id = q.escuela_id
  where q.id = p_integrante and q.activo and public._eoe_escuela(q.escuela_id)
    and exists (select 1 from public.eoe_pines p where p.integrante_id = q.id);
  if not found then raise exception 'Integrante o PIN no disponible'; end if;
  if exists (select 1 from public.eoe_pin_solicitudes s where s.integrante_id = p_integrante and s.resuelto_en is null) then
    raise exception 'Ya existe una solicitud pendiente';
  end if;
  insert into public.eoe_pin_solicitudes(integrante_id, escuela_id, solicitante)
  values (p_integrante, e.escuela_id, public.eff_uid());
  select name into autor from public.profiles where id = public.eff_uid();
  insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo)
  values (public.eff_uid(), autor, public.eff_uid()::text, 'Solicitud de restablecimiento de PIN',
    'El equipo de orientación solicita restablecer el PIN de ' || e.apellido_nombre || ' (' || coalesce(e.escuela, 'escuela') || '). Verificá la identidad antes de autorizarlo.')
  returning id into mensaje;
  insert into public.correo_destinatarios values (mensaje, 'jd3', 'Jefatura Distrital 3');
  insert into public.correo_copias(mensaje_id, buzon, carpeta) values (mensaje, 'jd3', 'recibidos');
  insert into public.correo_copias(mensaje_id, buzon, carpeta, leido_en) values (mensaje, public.eff_uid()::text, 'enviados', now());
end $$;

create function public.eoe_pin_solicitudes_pendientes()
returns table (id bigint, integrante text, escuela text, cue text, creado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'distrital' or public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  return query select s.id, q.apellido_nombre, e.nombre, e.cue, s.creado_en
    from public.eoe_pin_solicitudes s join public.equipo_orientacion q on q.id = s.integrante_id
    join public.escuelas e on e.id = s.escuela_id where s.resuelto_en is null order by s.creado_en;
end $$;

create function public.eoe_pin_restablecer(p_solicitud bigint)
returns void language plpgsql security definer set search_path = public as $$
declare solicitud public.eoe_pin_solicitudes;
begin
  if public.app_role() is distinct from 'distrital' or public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  select * into solicitud from public.eoe_pin_solicitudes where id = p_solicitud and resuelto_en is null for update;
  if not found then raise exception 'Solicitud no disponible'; end if;
  delete from public.eoe_pines where integrante_id = solicitud.integrante_id;
  update public.eoe_pin_solicitudes set resuelto_en = now(), resuelto_por = public.eff_uid() where id = p_solicitud;
  perform public._notificar(solicitud.solicitante, 'PIN restablecido', 'Ya podés crear un nuevo PIN de validación.', '#/pin-validacion');
end $$;

revoke all on function public.eoe_pin_integrantes(), public.eoe_pin_guardar(bigint,text,text),
  public.eoe_pin_solicitar_restablecimiento(bigint), public.eoe_pin_solicitudes_pendientes(),
  public.eoe_pin_restablecer(bigint), public.eoe_equipo_historial_listar() from public, anon;
grant execute on function public.eoe_pin_integrantes(), public.eoe_pin_guardar(bigint,text,text),
  public.eoe_pin_solicitar_restablecimiento(bigint), public.eoe_pin_solicitudes_pendientes(),
  public.eoe_pin_restablecer(bigint), public.eoe_equipo_historial_listar() to authenticated;
