-- La interfaz de correo accede mediante funciones; las tablas no se exponen directamente.
create table public.correo_mensajes (
  id bigint generated always as identity primary key,
  autor_id uuid not null references public.profiles(id),
  autor_nombre text not null,
  autor_buzon text not null,
  asunto text not null,
  cuerpo text not null,
  respuesta_a bigint references public.correo_mensajes(id),
  creado_en timestamptz not null default now(),
  antiguo_id bigint unique references public.messages(id),
  check (antiguo_id is not null or length(asunto) between 1 and 150),
  check (antiguo_id is not null or length(cuerpo) between 1 and 20000)
);

create table public.correo_destinatarios (
  mensaje_id bigint not null references public.correo_mensajes(id) on delete cascade,
  buzon text not null,
  nombre text not null,
  primary key (mensaje_id, buzon)
);

create table public.correo_copias (
  mensaje_id bigint not null references public.correo_mensajes(id) on delete cascade,
  buzon text not null,
  carpeta text not null check (carpeta in ('recibidos', 'enviados')),
  leido_en timestamptz,
  archivado boolean not null default false,
  papelera boolean not null default false,
  destacado boolean not null default false,
  primary key (mensaje_id, buzon, carpeta)
);
create index correo_copias_buzon on public.correo_copias(buzon, carpeta, mensaje_id desc);

create table public.correo_borradores (
  id bigint generated always as identity primary key,
  buzon text not null,
  autor_id uuid not null references public.profiles(id),
  asunto text not null default '' check (length(asunto) <= 150),
  cuerpo text not null default '' check (length(cuerpo) <= 20000),
  destinatarios text[] not null default '{}',
  respuesta_a bigint references public.correo_mensajes(id),
  actualizado_en timestamptz not null default now()
);
create index correo_borradores_buzon on public.correo_borradores(buzon, actualizado_en desc);

create table public.correo_adjuntos (
  id bigint generated always as identity primary key,
  borrador_id bigint references public.correo_borradores(id) on delete restrict,
  mensaje_id bigint references public.correo_mensajes(id) on delete restrict,
  nombre text not null check (length(nombre) between 1 and 255),
  mime text not null,
  bytes integer not null check (bytes between 1 and 5242880),
  drive_file_id text not null,
  check (num_nonnulls(borrador_id, mensaje_id) = 1)
);
create table public.correo_limpieza_drive (
  drive_file_id text primary key,
  creado_en timestamptz not null default now()
);

alter table public.correo_mensajes enable row level security;
alter table public.correo_destinatarios enable row level security;
alter table public.correo_copias enable row level security;
alter table public.correo_borradores enable row level security;
alter table public.correo_adjuntos enable row level security;
alter table public.correo_limpieza_drive enable row level security;
revoke all on public.correo_mensajes, public.correo_destinatarios, public.correo_copias,
  public.correo_borradores, public.correo_adjuntos, public.correo_limpieza_drive from public, anon, authenticated;

-- Se conserva cada mensaje anterior como una entrada independiente. Los dirigidos
-- a un usuario distrital pasan a la bandeja compartida, sin duplicar la entrada.
insert into public.correo_mensajes (autor_id, autor_nombre, autor_buzon, asunto, cuerpo, creado_en, antiguo_id)
select m.from_user_id,
       f.name || case when f.role = 'distrital' then ' · JD3' else '' end,
       case when f.role = 'distrital' then 'jd3' else f.id::text end,
       m.subject, m.body, m.created_at, m.id
from public.messages m join public.profiles f on f.id = m.from_user_id;

insert into public.correo_destinatarios (mensaje_id, buzon, nombre)
select c.id, case when t.role = 'distrital' then 'jd3' else t.id::text end,
       case when t.role = 'distrital' then 'Jefatura Distrital 3' else t.name end
from public.correo_mensajes c
join public.messages m on m.id = c.antiguo_id
join public.profiles t on t.id = m.to_user_id;

insert into public.correo_copias (mensaje_id, buzon, carpeta, leido_en)
select c.id, d.buzon, 'recibidos', m.read_at
from public.correo_mensajes c
join public.messages m on m.id = c.antiguo_id
join public.correo_destinatarios d on d.mensaje_id = c.id;

insert into public.correo_copias (mensaje_id, buzon, carpeta, leido_en)
select id, autor_buzon, 'enviados', creado_en from public.correo_mensajes;

create function public.correo_buzon_actual() returns text
language sql stable security definer set search_path = public as $$
  select case when public.app_role() = 'distrital' then 'jd3'
              when public.app_role() in ('escolar', 'areal') then public.eff_uid()::text
              else null end
$$;

create function public.correo_destinos()
returns table (buzon text, nombre text, rol text)
language sql stable security definer set search_path = public as $$
  select 'jd3'::text, 'Jefatura Distrital 3'::text, 'distrital'::text
  where public.app_role() in ('escolar', 'areal')
  union all
  select p.id::text, p.name, p.role
  from public.profiles p
  where p.active and p.id <> public.eff_uid()
    and (
      (public.app_role() = 'distrital' and p.role in ('escolar', 'areal'))
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

revoke all on function public.correo_buzon_actual(), public.correo_destinos() from public, anon;
grant execute on function public.correo_buzon_actual(), public.correo_destinos() to authenticated;

create function public.correo_participantes(p_id bigint)
returns table (buzon text, nombre text)
language sql stable security definer set search_path = public as $$
  select m.autor_buzon, m.autor_nombre from public.correo_mensajes m
  where m.id = p_id and exists (
    select 1 from public.correo_copias c where c.mensaje_id = m.id and c.buzon = public.correo_buzon_actual())
  union
  select d.buzon, d.nombre from public.correo_destinatarios d
  where d.mensaje_id = p_id and exists (
    select 1 from public.correo_copias c where c.mensaje_id = d.mensaje_id and c.buzon = public.correo_buzon_actual())
$$;

create function public.correo_guardar_borrador(p_id bigint, p_asunto text, p_cuerpo text, p_destinatarios text[], p_respuesta_a bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare b text := public.correo_buzon_actual(); nuevo bigint;
begin
  if b is null then raise exception 'Sin permiso'; end if;
  if length(coalesce(p_asunto,'')) > 150 or length(coalesce(p_cuerpo,'')) > 20000 then raise exception 'Datos inválidos'; end if;
  if p_respuesta_a is not null and not exists (
    select 1 from public.correo_copias where mensaje_id = p_respuesta_a and buzon = b
  ) then raise exception 'Mensaje original no disponible'; end if;
  if p_id is null then
    insert into public.correo_borradores(buzon, autor_id, asunto, cuerpo, destinatarios, respuesta_a)
    values(b, public.eff_uid(), coalesce(p_asunto,''), coalesce(p_cuerpo,''), coalesce(p_destinatarios,'{}'), p_respuesta_a)
    returning id into nuevo;
  else
    update public.correo_borradores set asunto = coalesce(p_asunto,''), cuerpo = coalesce(p_cuerpo,''),
      destinatarios = coalesce(p_destinatarios,'{}'), respuesta_a = p_respuesta_a, actualizado_en = now()
    where id = p_id and buzon = b returning id into nuevo;
    if nuevo is null then raise exception 'Borrador no disponible'; end if;
  end if;
  return nuevo;
end $$;

create function public.correo_enviar(p_borrador bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare b text := public.correo_buzon_actual(); d public.correo_borradores; destinatario text;
  nuevo bigint; nombre text; n text;
begin
  if b is null then raise exception 'Sin permiso'; end if;
  select * into d from public.correo_borradores where id = p_borrador and buzon = b for update;
  if not found then raise exception 'Borrador no disponible'; end if;
  if length(trim(d.asunto)) = 0 or length(trim(d.cuerpo)) = 0 or cardinality(d.destinatarios) = 0 then
    raise exception 'Completá destinatarios, asunto y mensaje';
  end if;
  if d.respuesta_a is not null and not exists (
    select 1 from public.correo_copias where mensaje_id = d.respuesta_a and buzon = b
  ) then raise exception 'Mensaje original no disponible'; end if;
  foreach destinatario in array d.destinatarios loop
    if destinatario = b or not (
      exists (select 1 from public.correo_destinos() x where x.buzon = destinatario)
      or (d.respuesta_a is not null and exists (
        select 1 from public.correo_participantes(d.respuesta_a) x
        where x.buzon = destinatario and
          (destinatario = 'jd3' or exists (select 1 from public.profiles p where p.id::text = destinatario and p.active))
      ))
    ) then raise exception 'Uno o más destinatarios no están permitidos'; end if;
  end loop;
  select p.name || case when b = 'jd3' then ' · JD3' else '' end into nombre
  from public.profiles p where p.id = public.eff_uid() and p.active;
  if nombre is null then raise exception 'Usuario inactivo'; end if;
  insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo, respuesta_a)
  values(public.eff_uid(), nombre, b, trim(d.asunto), trim(d.cuerpo), d.respuesta_a) returning id into nuevo;
  for destinatario in select distinct unnest(d.destinatarios) loop
    select case when destinatario = 'jd3' then 'Jefatura Distrital 3' else p.name end
      into n from (select 1) x left join public.profiles p on p.id::text = destinatario;
    if n is null then raise exception 'Destinatario inexistente'; end if;
    insert into public.correo_destinatarios values(nuevo, destinatario, n);
    insert into public.correo_copias(mensaje_id, buzon, carpeta) values(nuevo, destinatario, 'recibidos');
  end loop;
  insert into public.correo_copias(mensaje_id, buzon, carpeta, leido_en) values(nuevo, b, 'enviados', now());
  update public.correo_adjuntos set mensaje_id = nuevo, borrador_id = null where borrador_id = d.id;
  delete from public.correo_borradores where id = d.id;
  return nuevo;
end $$;

create function public.correo_contar_no_leidos() returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.correo_copias where buzon = public.correo_buzon_actual()
    and carpeta = 'recibidos' and leido_en is null and not papelera and not archivado
$$;

create function public.correo_listar(p_carpeta text, p_busqueda text default '', p_filtro text default '',
  p_limite integer default 20, p_offset integer default 0)
returns table(id bigint, carpeta text, autor text, asunto text, cuerpo text, fecha timestamptz,
  leido boolean, destacado boolean, archivado boolean, papelera boolean, adjuntos bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select m.id, c.carpeta, m.autor_nombre, m.asunto, left(m.cuerpo, 180), m.creado_en,
    c.leido_en is not null, c.destacado, c.archivado, c.papelera,
    (select count(*) from public.correo_adjuntos a where a.mensaje_id = m.id), count(*) over()
  from public.correo_copias c join public.correo_mensajes m on m.id = c.mensaje_id
  where c.buzon = public.correo_buzon_actual()
    and case p_carpeta when 'papelera' then c.papelera
      when 'archivados' then c.archivado and not c.papelera
      when 'destacados' then c.destacado and not c.papelera
      else c.carpeta = p_carpeta and not c.papelera and not c.archivado end
    and p_carpeta in ('recibidos','enviados','papelera','archivados','destacados')
    and (p_filtro = '' or (p_filtro = 'no_leidos' and c.leido_en is null)
      or (p_filtro = 'adjuntos' and exists (select 1 from public.correo_adjuntos a where a.mensaje_id = m.id)))
    and (coalesce(p_busqueda,'') = '' or m.asunto ilike '%' || p_busqueda || '%'
      or m.cuerpo ilike '%' || p_busqueda || '%' or m.autor_nombre ilike '%' || p_busqueda || '%'
      or exists (select 1 from public.correo_destinatarios d where d.mensaje_id = m.id and d.nombre ilike '%' || p_busqueda || '%'))
  order by m.creado_en desc, m.id desc limit least(greatest(p_limite,1),100) offset greatest(p_offset,0)
$$;

create function public.correo_detalle(p_id bigint, p_carpeta text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := public.correo_buzon_actual(); resultado jsonb;
begin
  if b is null or p_carpeta not in ('recibidos','enviados') then raise exception 'Sin permiso'; end if;
  update public.correo_copias set leido_en = coalesce(leido_en, now())
    where mensaje_id = p_id and buzon = b and carpeta = p_carpeta;
  if not found then raise exception 'Mensaje no disponible'; end if;
  select jsonb_build_object('id', m.id, 'autor', m.autor_nombre, 'autor_buzon', m.autor_buzon,
    'asunto', m.asunto, 'cuerpo', m.cuerpo, 'fecha', m.creado_en, 'respuesta_a', m.respuesta_a,
    'destinatarios', coalesce((select jsonb_agg(jsonb_build_object('buzon', d.buzon, 'nombre', d.nombre))
      from public.correo_destinatarios d where d.mensaje_id = m.id),'[]'::jsonb),
    'adjuntos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'bytes', a.bytes))
      from public.correo_adjuntos a where a.mensaje_id = m.id),'[]'::jsonb))
  into resultado from public.correo_mensajes m where m.id = p_id;
  return resultado;
end $$;

create function public.correo_cambiar_estado(p_id bigint, p_carpeta text, p_accion text) returns void
language plpgsql security definer set search_path = public as $$
declare b text := public.correo_buzon_actual();
begin
  if b is null or p_carpeta not in ('recibidos','enviados') then raise exception 'Sin permiso'; end if;
  update public.correo_copias set
    leido_en = case p_accion when 'leido' then now() when 'no_leido' then null else leido_en end,
    destacado = case p_accion when 'destacar' then true when 'quitar_destacado' then false else destacado end,
    archivado = case p_accion when 'archivar' then true when 'desarchivar' then false else archivado end,
    papelera = case p_accion when 'papelera' then true when 'restaurar' then false else papelera end
  where mensaje_id = p_id and buzon = b and carpeta = p_carpeta
    and p_accion in ('leido','no_leido','destacar','quitar_destacado','archivar','desarchivar','papelera','restaurar');
  if not found then raise exception 'Mensaje o acción no disponible'; end if;
end $$;

create function public.correo_borradores_listar(p_busqueda text default '', p_limite integer default 20, p_offset integer default 0)
returns table(id bigint, asunto text, cuerpo text, destinatarios text[], respuesta_a bigint, actualizado_en timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  select d.id, d.asunto, d.cuerpo, d.destinatarios, d.respuesta_a, d.actualizado_en, count(*) over()
  from public.correo_borradores d where d.buzon = public.correo_buzon_actual()
    and (coalesce(p_busqueda,'') = '' or d.asunto ilike '%' || p_busqueda || '%' or d.cuerpo ilike '%' || p_busqueda || '%')
  order by d.actualizado_en desc, d.id desc limit least(greatest(p_limite,1),100) offset greatest(p_offset,0)
$$;

create function public.correo_adjuntos_borrador(p_id bigint)
returns table(id bigint, nombre text, bytes integer)
language sql stable security definer set search_path = public as $$
  select a.id, a.nombre, a.bytes from public.correo_adjuntos a join public.correo_borradores d on d.id = a.borrador_id
  where d.id = p_id and d.buzon = public.correo_buzon_actual() order by a.id
$$;

create function public.correo_borrador_autorizado(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.correo_borradores where id = p_id and buzon = public.correo_buzon_actual())
$$;

create function public.correo_adjunto_autorizado(p_id bigint)
returns table(drive_file_id text, nombre text, mime text, borrador_id bigint)
language sql stable security definer set search_path = public as $$
  select a.drive_file_id, a.nombre, a.mime, a.borrador_id from public.correo_adjuntos a
  where a.id = p_id and (
    exists (select 1 from public.correo_borradores d where d.id = a.borrador_id and d.buzon = public.correo_buzon_actual())
    or exists (select 1 from public.correo_copias c where c.mensaje_id = a.mensaje_id and c.buzon = public.correo_buzon_actual()))
$$;

create function public.correo_eliminar_borrador(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.correo_borradores where id = p_id and buzon = public.correo_buzon_actual();
  if not found then raise exception 'Borrador no disponible'; end if;
end $$;

create function public.correo_quitar_adjunto(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare archivo text; borrador bigint;
begin
  select a.borrador_id into borrador from public.correo_adjuntos a
    join public.correo_borradores d on d.id = a.borrador_id
    where a.id = p_id and d.buzon = public.correo_buzon_actual();
  if borrador is null then raise exception 'Adjunto no disponible'; end if;
  perform 1 from public.correo_borradores where id = borrador and buzon = public.correo_buzon_actual() for update;
  if not found then raise exception 'Borrador no disponible'; end if;
  select drive_file_id into archivo from public.correo_adjuntos where id = p_id and borrador_id = borrador;
  if archivo is null then raise exception 'Adjunto no disponible'; end if;
  perform pg_advisory_xact_lock(hashtextextended(archivo, 0));
  delete from public.correo_adjuntos where id = p_id and borrador_id = borrador;
  if not exists (select 1 from public.correo_adjuntos where drive_file_id = archivo) then
    insert into public.correo_limpieza_drive(drive_file_id) values(archivo) on conflict do nothing;
    return archivo;
  end if;
  return null;
end $$;

create function public.correo_copiar_adjuntos(p_borrador bigint, p_mensaje bigint) returns void
language plpgsql security definer set search_path = public as $$
declare b text := public.correo_buzon_actual();
begin
  perform 1 from public.correo_borradores where id = p_borrador and buzon = b for update;
  if not found or not exists (select 1 from public.correo_copias where mensaje_id = p_mensaje and buzon = b) then
    raise exception 'Mensaje o borrador no disponible';
  end if;
  insert into public.correo_adjuntos(borrador_id, nombre, mime, bytes, drive_file_id)
  select p_borrador, a.nombre, a.mime, a.bytes, a.drive_file_id from public.correo_adjuntos a
  where a.mensaje_id = p_mensaje;
end $$;

revoke all on function public.correo_participantes(bigint),
  public.correo_guardar_borrador(bigint,text,text,text[],bigint), public.correo_enviar(bigint),
  public.correo_contar_no_leidos(), public.correo_listar(text,text,text,integer,integer),
  public.correo_detalle(bigint,text), public.correo_cambiar_estado(bigint,text,text),
  public.correo_borradores_listar(text,integer,integer), public.correo_adjuntos_borrador(bigint),
  public.correo_borrador_autorizado(bigint), public.correo_adjunto_autorizado(bigint),
  public.correo_eliminar_borrador(bigint), public.correo_copiar_adjuntos(bigint,bigint), public.correo_quitar_adjunto(bigint) from public, anon;
grant execute on function public.correo_participantes(bigint),
  public.correo_guardar_borrador(bigint,text,text,text[],bigint), public.correo_enviar(bigint),
  public.correo_contar_no_leidos(), public.correo_listar(text,text,text,integer,integer),
  public.correo_detalle(bigint,text), public.correo_cambiar_estado(bigint,text,text),
  public.correo_borradores_listar(text,integer,integer), public.correo_adjuntos_borrador(bigint),
  public.correo_borrador_autorizado(bigint), public.correo_adjunto_autorizado(bigint),
  public.correo_eliminar_borrador(bigint), public.correo_copiar_adjuntos(bigint,bigint), public.correo_quitar_adjunto(bigint) to authenticated;

-- El esquema anterior no debe permitir eludir los permisos de la nueva bandeja.
drop policy msg_ins on public.messages;
create function public.correo_legacy_destino_permitido(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_id and active and role in ('admin','regional'))
$$;
revoke all on function public.correo_legacy_destino_permitido(uuid) from public, anon;
grant execute on function public.correo_legacy_destino_permitido(uuid) to authenticated;
create or replace function public.destinatarios() returns table (id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.role from public.profiles p
  where public.app_role() in ('admin','regional') and p.active and p.id <> public.eff_uid()
    and p.role in ('admin','regional')
  order by p.name limit 500
$$;
create policy msg_ins on public.messages for insert to authenticated
  with check (public.app_role() in ('admin','regional') and from_user_id = public.eff_uid()
    and public.correo_legacy_destino_permitido(to_user_id));
drop policy msg_upd on public.messages;
create policy msg_upd on public.messages for update to authenticated
  using (public.app_role() in ('admin','regional') and to_user_id = public.eff_uid())
  with check (public.app_role() in ('admin','regional') and to_user_id = public.eff_uid());

grant select, insert, update, delete on public.correo_adjuntos to service_role;
grant select, delete on public.correo_limpieza_drive to service_role;
grant usage, select on sequence public.correo_adjuntos_id_seq to service_role;
