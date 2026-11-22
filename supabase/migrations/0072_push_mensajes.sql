alter table public.push_cola rename column notification_id to evento_id;
alter table public.push_cola drop constraint push_cola_notification_id_suscripcion_id_key;
alter table public.push_cola add column origen text not null default 'notificacion'
  check (origen in ('notificacion', 'correo', 'mensaje'));
alter table public.push_cola add unique (origen, evento_id, suscripcion_id);

create or replace function public.push_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(origen, evento_id, suscripcion_id)
  select 'notificacion', new.id, s.id from public.push_suscripciones s where s.user_id = new.user_id;
  return new;
end $$;

create function public.push_correo_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(origen, evento_id, suscripcion_id)
  select 'correo', new.mensaje_id, s.id
  from public.push_suscripciones s
  join public.profiles p on p.id = s.user_id and p.active
  join public.correo_mensajes m on m.id = new.mensaje_id and m.antiguo_id is null
  where (new.buzon = 'jd3' and p.role = 'distrital')
     or (p.role in ('areal', 'escolar') and p.id::text = new.buzon);
  return new;
end $$;
revoke all on function public.push_correo_encolar() from public, anon, authenticated;
create trigger correo_recibido_encolar_push after insert on public.correo_copias
for each row when (new.carpeta = 'recibidos') execute function public.push_correo_encolar();

create function public.push_mensaje_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(origen, evento_id, suscripcion_id)
  select 'mensaje', new.id, s.id from public.push_suscripciones s where s.user_id = new.to_user_id;
  return new;
end $$;
revoke all on function public.push_mensaje_encolar() from public, anon, authenticated;
create trigger mensaje_recibido_encolar_push after insert on public.messages
for each row execute function public.push_mensaje_encolar();
