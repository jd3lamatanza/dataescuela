alter table public.push_suscripciones add column p256dh text, add column auth_key text;
alter table public.push_suscripciones add constraint push_suscripciones_claves_pares
  check ((p256dh is null) = (auth_key is null));
alter table public.push_cola add column titulo text not null default 'Nueva notificación o mensaje';

create function public.push_registrar_claves(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare publico bytea; secreto bytea;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then raise exception 'Sin permiso'; end if;
  if not public.push_endpoint_valido(p_endpoint) then raise exception 'Servicio de notificaciones no admitido'; end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'Claves de suscripción inválidas';
  end if;
  publico := decode(translate(p_p256dh, '-_', '+/') || '=', 'base64');
  secreto := decode(translate(p_auth, '-_', '+/') || '==', 'base64');
  if length(publico) <> 65 or get_byte(publico, 0) <> 4 or length(secreto) <> 16 then raise exception 'Claves de suscripción inválidas'; end if;
  if not exists (select 1 from public.push_suscripciones where user_id = auth.uid() and endpoint = p_endpoint)
    and (select count(*) from public.push_suscripciones where user_id = auth.uid()) >= 30 then
    raise exception 'Se alcanzó el límite de dispositivos; contactá a soporte';
  end if;
  insert into public.push_suscripciones(user_id, endpoint, p256dh, auth_key) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth_key = excluded.auth_key;
end $$;
revoke all on function public.push_registrar_claves(text,text,text) from public, anon;
grant execute on function public.push_registrar_claves(text,text,text) to authenticated;

create function public.push_titulo(p_titulo text, p_nombre text default null) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(
    coalesce(nullif(btrim(p_titulo), ''), 'Nueva notificación') ||
      case when nullif(btrim(p_nombre), '') is not null then ' de ' || btrim(p_nombre) else '' end,
    '[[:space:]]+', ' ', 'g'), 180)
$$;
revoke all on function public.push_titulo(text,text) from public, anon, authenticated;

create or replace function public.push_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare titulo text;
begin
  if new.title = 'Nueva labor de inspector' then
    titulo := public.push_titulo('Nueva labor', split_part(coalesce(new.body, ''), ': ', 1));
  elsif new.title in ('Nueva contingencia', 'Contingencia actualizada') then
    titulo := public.push_titulo(new.title, split_part(coalesce(new.body, ''), ' · ', 1));
  elsif new.title = 'Directivo de EAV pendiente de aprobación' then
    titulo := public.push_titulo(new.title, split_part(coalesce(new.body, ''), ': ', 1));
  elsif new.title = 'Estudiante asignado a una escuela destino'
    and position(' fue asignado a ' in coalesce(new.body, '')) > 0 then
    titulo := public.push_titulo(new.title, split_part(new.body, ' fue asignado a ', 2));
  else
    titulo := public.push_titulo(new.title);
  end if;
  insert into public.push_cola(origen, evento_id, suscripcion_id, titulo)
  select 'notificacion', new.id, s.id, titulo from public.push_suscripciones s where s.user_id = new.user_id;
  return new;
end $$;

create or replace function public.push_correo_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(origen, evento_id, suscripcion_id, titulo)
  select 'correo', new.mensaje_id, s.id, public.push_titulo('Nuevo mensaje', m.autor_nombre)
  from public.push_suscripciones s
  join public.profiles p on p.id = s.user_id and p.active
  join public.correo_mensajes m on m.id = new.mensaje_id and m.antiguo_id is null
  where (new.buzon = 'jd3' and p.role = 'distrital')
     or (p.role in ('areal', 'escolar') and p.id::text = new.buzon);
  return new;
end $$;

create or replace function public.push_mensaje_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(origen, evento_id, suscripcion_id, titulo)
  select 'mensaje', new.id, s.id, public.push_titulo('Nuevo mensaje', autor.name)
  from public.push_suscripciones s left join public.profiles autor on autor.id = new.from_user_id
  where s.user_id = new.to_user_id;
  return new;
end $$;

drop function public.push_tomar(uuid);
create function public.push_tomar(p_reserva uuid)
returns table(id bigint, endpoint text, p256dh text, auth_key text, titulo text)
language sql security definer set search_path = '' as $$
  with pendientes as (
    select c.id from public.push_cola c
    join public.push_suscripciones s on s.id = c.suscripcion_id
    join public.profiles p on p.id = s.user_id and p.active
    where c.siguiente <= now() and (c.reservado_hasta is null or c.reservado_hasta < now())
    order by c.siguiente, c.id for update of c skip locked limit 100
  ), tomados as (
    update public.push_cola c set reserva = p_reserva, reservado_hasta = now() + interval '3 minutes', intentos = intentos + 1
    from pendientes p where c.id = p.id returning c.id, c.suscripcion_id, c.titulo
  )
  select t.id, s.endpoint, s.p256dh, s.auth_key, t.titulo
  from tomados t join public.push_suscripciones s on s.id = t.suscripcion_id
$$;
revoke all on function public.push_tomar(uuid) from public, anon, authenticated;
grant execute on function public.push_tomar(uuid) to service_role;

create function public.salida_notificar_nueva() returns trigger
language plpgsql security definer set search_path = '' as $$
declare nombre text;
begin
  if public.app_role() is distinct from 'escolar' or new.user_id is distinct from public.eff_uid() then return new; end if;
  nombre := coalesce(nullif(btrim(new.escuela), ''), nullif(btrim(new.clave), ''), new.cue);
  insert into public.notifications(user_id, type, title, body, url)
  select p.id, 'info', public.push_titulo('Nueva salida educativa', nombre), new.titulo,
    case when p.role = 'distrital' then '/salidas-distrito' else '/salidas-areal' end
  from public.profiles p
  where p.active and (p.role = 'distrital' or (p.role = 'areal' and exists (
    select 1 from public.inspectores i where i.user_id = p.id and new.clave = any(i.escuelas_asignadas)
  )));
  return new;
end $$;
revoke all on function public.salida_notificar_nueva() from public, anon, authenticated;
create trigger salida_nueva_notificar after insert on public.salidas
for each row execute function public.salida_notificar_nueva();

update public.ayuda_guias
set secciones = secciones || '[
  {"titulo":"Notificaciones push","pasos":[
    "Los avisos pueden mostrar el tipo y el nombre de la escuela, inspector o remitente, incluso con la sesión cerrada y en la pantalla bloqueada.",
    "Si ya activaste las notificaciones, abrí la aplicación con tu cuenta en cada dispositivo para actualizar la suscripción. Hasta entonces los avisos seguirán siendo genéricos."
  ]}
]'::jsonb, version = version + 1, actualizado = now()
where id = 'inicio';
