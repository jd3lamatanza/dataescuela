create table public.chat_distrital_mensajes (
  id bigint generated always as identity primary key,
  solicitud uuid not null,
  autor_id uuid not null references public.profiles(id),
  destinatario_id uuid not null references public.profiles(id),
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  creado_en timestamptz not null default now(),
  leido_en timestamptz,
  constraint chat_distrital_autor_destino_distintos check (autor_id <> destinatario_id),
  unique (autor_id, solicitud)
);

create index chat_distrital_destinatario on public.chat_distrital_mensajes(destinatario_id, id desc);
create index chat_distrital_autor on public.chat_distrital_mensajes(autor_id, id desc);
create index chat_distrital_no_leidos on public.chat_distrital_mensajes(destinatario_id, autor_id, id) where leido_en is null;

create function public.chat_distrital_autorizado() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.real_role() = 'distrital' and public.app_role() = 'distrital'
    and public.eff_uid() = auth.uid()
    and not exists (select 1 from public.simulaciones where actor_id = auth.uid()), false)
$$;

alter table public.chat_distrital_mensajes enable row level security;
create policy chat_distrital_lectura on public.chat_distrital_mensajes for select to authenticated
  using (public.chat_distrital_autorizado() and auth.uid() in (autor_id, destinatario_id));
revoke all on public.chat_distrital_mensajes from public, anon, authenticated;
grant select on public.chat_distrital_mensajes to authenticated;

create function public.chat_distrital_contactos()
returns table (id uuid, nombre text, activo boolean, no_leidos bigint, ultimo_recibido bigint, ultimo_mensaje timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.chat_distrital_autorizado() then raise exception 'Sin permiso'; end if;
  return query
    select p.id, p.name, p.active,
      (select count(*) from public.chat_distrital_mensajes m where m.destinatario_id = auth.uid() and m.autor_id = p.id and m.leido_en is null),
      (select max(m.id) from public.chat_distrital_mensajes m where m.destinatario_id = auth.uid() and m.autor_id = p.id),
      (select max(m.creado_en) from public.chat_distrital_mensajes m where (m.autor_id = auth.uid() and m.destinatario_id = p.id) or (m.destinatario_id = auth.uid() and m.autor_id = p.id))
    from public.profiles p
    where p.id <> auth.uid() and p.role = 'distrital'
      and (p.active or exists (select 1 from public.chat_distrital_mensajes m
        where (m.autor_id = auth.uid() and m.destinatario_id = p.id) or (m.destinatario_id = auth.uid() and m.autor_id = p.id)))
    order by 6 desc nulls last, lower(p.name), p.id;
end $$;

create function public.chat_distrital_historial(p_contacto uuid, p_antes bigint default null)
returns table (id bigint, autor_id uuid, destinatario_id uuid, texto text, creado_en timestamptz, leido_en timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.chat_distrital_autorizado() then raise exception 'Sin permiso'; end if;
  if p_contacto is null or p_contacto = auth.uid() then raise exception 'Contacto inválido'; end if;
  return query select m.id, m.autor_id, m.destinatario_id, m.texto, m.creado_en, m.leido_en
    from public.chat_distrital_mensajes m
    where ((m.autor_id = auth.uid() and m.destinatario_id = p_contacto)
      or (m.destinatario_id = auth.uid() and m.autor_id = p_contacto))
      and (p_antes is null or m.id < p_antes)
    order by m.id desc limit 51;
end $$;

create function public.chat_distrital_enviar(p_contacto uuid, p_texto text, p_solicitud uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare nuevo bigint; existente public.chat_distrital_mensajes;
begin
  if not public.chat_distrital_autorizado() then raise exception 'Sin permiso'; end if;
  if p_contacto is null or p_contacto = auth.uid() or p_solicitud is null
    or length(btrim(coalesce(p_texto, ''))) not between 1 and 4000 then raise exception 'Mensaje inválido'; end if;
  if not exists (select 1 from public.profiles where id = p_contacto and role = 'distrital' and active) then
    raise exception 'El contacto no está disponible';
  end if;
  insert into public.chat_distrital_mensajes (solicitud, autor_id, destinatario_id, texto)
    values (p_solicitud, auth.uid(), p_contacto, btrim(p_texto))
    on conflict (autor_id, solicitud) do nothing returning id into nuevo;
  if nuevo is null then
    select * into existente from public.chat_distrital_mensajes where autor_id = auth.uid() and solicitud = p_solicitud;
    if existente.destinatario_id <> p_contacto or existente.texto <> btrim(p_texto) then raise exception 'Solicitud de mensaje inválida'; end if;
    nuevo := existente.id;
  end if;
  return nuevo;
end $$;

create function public.chat_distrital_leer(p_contacto uuid, p_hasta bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.chat_distrital_autorizado() then raise exception 'Sin permiso'; end if;
  if p_contacto is null or p_contacto = auth.uid() or p_hasta is null or p_hasta < 1 then raise exception 'Solicitud inválida'; end if;
  update public.chat_distrital_mensajes set leido_en = now()
    where destinatario_id = auth.uid() and autor_id = p_contacto and id <= p_hasta and leido_en is null;
end $$;

revoke all on function public.chat_distrital_autorizado(), public.chat_distrital_contactos(), public.chat_distrital_historial(uuid, bigint),
  public.chat_distrital_enviar(uuid, text, uuid), public.chat_distrital_leer(uuid, bigint) from public, anon;
grant execute on function public.chat_distrital_autorizado(), public.chat_distrital_contactos(), public.chat_distrital_historial(uuid, bigint),
  public.chat_distrital_enviar(uuid, text, uuid), public.chat_distrital_leer(uuid, bigint) to authenticated;

alter publication supabase_realtime add table public.chat_distrital_mensajes;
