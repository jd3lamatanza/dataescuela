create function public._nombre_eoe_cue(p_cue text) returns text
language sql stable security definer set search_path = public as $$
  select 'EOE ' || coalesce(
    (select string_agg(distinct btrim(e.clave), ' / ' order by btrim(e.clave))
       from public.escuelas e where btrim(e.cue) = btrim(p_cue) and nullif(btrim(e.clave), '') is not null),
    'CUE ' || coalesce(nullif(btrim(p_cue), ''), 'sin asignar'))
$$;
revoke all on function public._nombre_eoe_cue(text) from public, anon, authenticated;

create function public._nombre_eoe_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'eoe' then new.name := public._nombre_eoe_cue(new.cue); end if;
  return new;
end $$;
revoke all on function public._nombre_eoe_perfil() from public, anon, authenticated;
create trigger eoe_nombre_perfil before insert or update of cue, role, name on public.profiles
  for each row execute function public._nombre_eoe_perfil();

create function public._nombre_eoe_escuela() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set name = public._nombre_eoe_cue(p.cue)
    where p.role = 'eoe' and (btrim(p.cue) = btrim(new.cue) or (tg_op = 'UPDATE' and btrim(p.cue) = btrim(old.cue)))
      and p.name is distinct from public._nombre_eoe_cue(p.cue);
  return null;
end $$;
revoke all on function public._nombre_eoe_escuela() from public, anon, authenticated;
create trigger escuelas_eoe_nombre after insert or update of clave, cue on public.escuelas
  for each row execute function public._nombre_eoe_escuela();

update public.profiles p set name = public._nombre_eoe_cue(p.cue)
  where p.role = 'eoe' and p.name is distinct from public._nombre_eoe_cue(p.cue);

-- Conserva los mensajes anteriores de los roles que pasan a la bandeja actual.
create temporary table eoe_mensajes_anteriores on commit drop as
select m.id from public.messages m join public.profiles a on a.id = m.from_user_id
join public.profiles d on d.id = m.to_user_id
where (a.role in ('eav', 'regional', 'admin') or d.role in ('eav', 'regional', 'admin'))
  and not exists (select 1 from public.correo_mensajes c where c.antiguo_id = m.id);
insert into public.correo_mensajes (autor_id, autor_nombre, autor_buzon, asunto, cuerpo, creado_en, antiguo_id)
select m.from_user_id, a.name || case when a.role = 'distrital' then ' · JD3' else '' end,
  case when a.role = 'distrital' then 'jd3' else a.id::text end, m.subject, m.body, m.created_at, m.id
from public.messages m join public.profiles a on a.id = m.from_user_id
where m.id in (select id from eoe_mensajes_anteriores);
insert into public.correo_destinatarios (mensaje_id, buzon, nombre)
select c.id, case when d.role = 'distrital' then 'jd3' else d.id::text end,
  case when d.role = 'distrital' then 'Jefatura Distrital 3' else d.name end
from public.correo_mensajes c join public.messages m on m.id = c.antiguo_id
join public.profiles d on d.id = m.to_user_id
where c.antiguo_id in (select id from eoe_mensajes_anteriores);
insert into public.correo_copias (mensaje_id, buzon, carpeta, leido_en)
select c.id, d.buzon, 'recibidos', m.read_at from public.correo_mensajes c
join public.messages m on m.id = c.antiguo_id join public.correo_destinatarios d on d.mensaje_id = c.id
where c.antiguo_id in (select id from eoe_mensajes_anteriores)
on conflict (mensaje_id, buzon, carpeta) do nothing;
insert into public.correo_copias (mensaje_id, buzon, carpeta, leido_en)
select id, autor_buzon, 'enviados', creado_en from public.correo_mensajes where antiguo_id in (select id from eoe_mensajes_anteriores)
on conflict (mensaje_id, buzon, carpeta) do nothing;

-- Sincroniza mensajes de clientes anteriores hasta que actualicen la interfaz.
create function public._correo_legacy_moderno() returns trigger
language plpgsql security definer set search_path = public as $$
declare autor public.profiles; receptor public.profiles; mensaje bigint;
begin
  if tg_op = 'UPDATE' then
    update public.correo_copias set leido_en = coalesce(leido_en, new.read_at)
      where mensaje_id = (select id from public.correo_mensajes where antiguo_id = new.id)
        and buzon = new.to_user_id::text and carpeta = 'recibidos' and new.read_at is not null;
    return new;
  end if;
  select * into autor from public.profiles where id = new.from_user_id;
  select * into receptor from public.profiles where id = new.to_user_id;
  if autor.role not in ('admin', 'regional') or receptor.role not in ('admin', 'regional') then return new; end if;
  insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo, creado_en, antiguo_id)
    values (autor.id, autor.name, autor.id::text, new.subject, new.body, new.created_at, new.id) returning id into mensaje;
  insert into public.correo_destinatarios values (mensaje, receptor.id::text, receptor.name);
  insert into public.correo_copias(mensaje_id, buzon, carpeta, leido_en)
    values (mensaje, receptor.id::text, 'recibidos', new.read_at),
           (mensaje, autor.id::text, 'enviados', new.created_at);
  return new;
end $$;
revoke all on function public._correo_legacy_moderno() from public, anon, authenticated;
create trigger correo_legacy_moderno after insert on public.messages
  for each row execute function public._correo_legacy_moderno();
create trigger correo_legacy_leido after update of read_at on public.messages
  for each row execute function public._correo_legacy_moderno();

create or replace function public.push_correo_encolar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_cola(origen, evento_id, suscripcion_id, titulo)
  select 'correo', new.mensaje_id, s.id, public.push_titulo('Nuevo mensaje', m.autor_nombre)
  from public.push_suscripciones s
  join public.profiles p on p.id = s.user_id and p.active
  join public.correo_mensajes m on m.id = new.mensaje_id and m.antiguo_id is null
  where (new.buzon = 'jd3' and p.role = 'distrital')
     or (p.role in ('areal', 'escolar', 'eoe', 'eav', 'regional', 'admin') and p.id::text = new.buzon);
  return new;
end $$;

create or replace function public.correo_buzon_actual() returns text
language sql stable security definer set search_path = public as $$
  select case when public.app_role() = 'distrital' then 'jd3'
              when public.app_role() in ('escolar', 'areal', 'eoe', 'eav', 'regional', 'admin') then public.eff_uid()::text
              else null end
$$;

create or replace function public.correo_destinos()
returns table (buzon text, nombre text, rol text)
language sql stable security definer set search_path = public as $$
  select 'jd3'::text, 'Jefatura Distrital 3'::text, 'distrital'::text
  where public.app_role() in ('escolar', 'areal', 'eoe')
  union all
  select p.id::text, p.name, p.role from public.profiles p
  where p.active and p.id <> public.eff_uid() and (
    (public.app_role() = 'eoe' and p.role in ('escolar', 'areal', 'eoe', 'eav', 'regional'))
    or (public.app_role() = 'regional' and p.role in ('admin', 'regional'))
    or (public.app_role() = 'admin' and p.role in ('admin', 'regional'))
    or (public.app_role() in ('escolar', 'areal', 'distrital', 'eav', 'regional') and p.role = 'eoe')
    or (public.app_role() = 'distrital' and p.role in ('escolar', 'areal'))
    or (public.app_role() = 'areal' and p.role = 'escolar'
      and exists (select 1 from public.escuelas e where e.cue = p.cue and e.clave = any(public.claves_asignadas())))
    or (public.app_role() = 'escolar' and p.role = 'areal'
      and exists (select 1 from public.inspectores i join public.escuelas e on e.clave = any(i.escuelas_asignadas)
        where i.user_id = p.id and e.cue = public.app_cue()))
  )
  order by 2, 1
$$;

create or replace function public.correo_enviar(p_borrador bigint) returns bigint
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
    if destinatario = b or (public.app_role() = 'eoe' and not exists (
      select 1 from public.correo_destinos() x where x.buzon = destinatario
    )) or (public.app_role() = 'admin' and exists (
      select 1 from public.profiles p where p.id::text = destinatario and p.role = 'eoe'
    )) or not (
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
