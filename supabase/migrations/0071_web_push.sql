-- La cola se completa en la misma transacción que la notificación.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.push_suscripciones (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index push_suscripciones_endpoint on public.push_suscripciones(endpoint);

create table public.push_cola (
  id bigint generated always as identity primary key,
  notification_id bigint not null,
  suscripcion_id bigint not null references public.push_suscripciones(id) on delete cascade,
  intentos integer not null default 0,
  siguiente timestamptz not null default now(),
  reserva uuid,
  reservado_hasta timestamptz,
  ultimo_error integer,
  unique (notification_id, suscripcion_id)
);
create index push_cola_pendiente on public.push_cola(siguiente, id);
alter table public.push_suscripciones enable row level security;
alter table public.push_cola enable row level security;
revoke all on public.push_suscripciones, public.push_cola from anon, authenticated;

create function public.push_endpoint_valido(p_endpoint text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(length(p_endpoint) between 20 and 2048 and
    p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com)/[^[:space:]#]*$', false)
$$;
revoke all on function public.push_endpoint_valido(text) from public;

create function public.push_clave_publica() returns text
language plpgsql security definer set search_path = '' as $$
declare clave text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then raise exception 'Sin permiso'; end if;
  select decrypted_secret into clave from vault.decrypted_secrets where name = 'dataescuela_push_public';
  if clave is null then raise exception 'Notificaciones push sin configurar'; end if;
  return clave;
end $$;

create function public.push_estado(p_endpoint text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.push_suscripciones s
    join public.profiles p on p.id = s.user_id and p.active
    where s.user_id = auth.uid() and s.endpoint = p_endpoint)
$$;

create function public.push_registrar(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then raise exception 'Sin permiso'; end if;
  if not public.push_endpoint_valido(p_endpoint) then raise exception 'Servicio de notificaciones no admitido'; end if;
  if not exists (select 1 from public.push_suscripciones where user_id = auth.uid() and endpoint = p_endpoint)
    and (select count(*) from public.push_suscripciones where user_id = auth.uid()) >= 30 then
    raise exception 'Se alcanzó el límite de dispositivos; contactá a soporte';
  end if;
  insert into public.push_suscripciones(user_id, endpoint) values (auth.uid(), p_endpoint)
  on conflict (user_id, endpoint) do nothing;
end $$;
revoke all on function public.push_clave_publica(), public.push_estado(text), public.push_registrar(text) from public;
grant execute on function public.push_clave_publica(), public.push_estado(text), public.push_registrar(text) to authenticated;

create function public.push_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(notification_id, suscripcion_id)
  select new.id, s.id from public.push_suscripciones s where s.user_id = new.user_id;
  return new;
end $$;
revoke all on function public.push_encolar() from public;
create trigger notificacion_encolar_push after insert on public.notifications
for each row execute function public.push_encolar();

create function public.push_tomar(p_reserva uuid)
returns table(id bigint, endpoint text)
language sql security definer set search_path = '' as $$
  with pendientes as (
    select c.id from public.push_cola c
    join public.push_suscripciones s on s.id = c.suscripcion_id
    join public.profiles p on p.id = s.user_id and p.active
    where c.siguiente <= now() and (c.reservado_hasta is null or c.reservado_hasta < now())
    order by c.siguiente, c.id for update of c skip locked limit 100
  ), tomados as (
    update public.push_cola c set reserva = p_reserva, reservado_hasta = now() + interval '3 minutes', intentos = intentos + 1
    from pendientes p where c.id = p.id returning c.id, c.suscripcion_id
  )
  select t.id, s.endpoint from tomados t join public.push_suscripciones s on s.id = t.suscripcion_id
$$;

create function public.push_finalizar(p_id bigint, p_reserva uuid, p_resultado text, p_error integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare destino text;
begin
  if p_resultado not in ('enviado', 'vencido', 'reintentar') then raise exception 'Resultado inválido'; end if;
  select s.endpoint into destino from public.push_cola c join public.push_suscripciones s on s.id = c.suscripcion_id
    where c.id = p_id and c.reserva = p_reserva for update of c;
  if not found then return; end if;
  if p_resultado = 'vencido' then
    delete from public.push_suscripciones where endpoint = destino;
  elsif p_resultado = 'enviado' then
    delete from public.push_cola where id = p_id;
  else
    update public.push_cola set reserva = null, reservado_hasta = null, ultimo_error = p_error,
      siguiente = now() + make_interval(secs => least(3600, 60 * power(2, least(intentos - 1, 6))::integer))
      where id = p_id;
  end if;
end $$;
revoke all on function public.push_tomar(uuid), public.push_finalizar(bigint, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.push_tomar(uuid), public.push_finalizar(bigint, uuid, text, integer) to service_role;

create function public.push_programar() returns void
language plpgsql security definer set search_path = '' as $$
declare secreto text; url text; marca text;
begin
  select decrypted_secret into secreto from vault.decrypted_secrets where name = 'dataescuela_push_dispatch';
  select decrypted_secret into url from vault.decrypted_secrets where name = 'dataescuela_push_url';
  if secreto is null or url is null then raise exception 'Despachador push sin configurar'; end if;
  marca := floor(extract(epoch from clock_timestamp()))::bigint::text;
  perform net.http_post(url := url || '/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-time', marca,
      'x-push-signature', encode(extensions.hmac(marca, secreto, 'sha256'), 'hex')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke all on function public.push_programar() from public, anon, authenticated;
select cron.schedule('dataescuela-push', '* * * * *', 'select public.push_programar()');
