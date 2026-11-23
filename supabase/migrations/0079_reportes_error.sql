create table public.reportes_error (
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  actor_id uuid not null references public.profiles(id),
  usuario text not null,
  rol text not null,
  modulo text not null check (length(btrim(modulo)) between 1 and 150),
  url text not null check (length(url) between 1 and 2048),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 4000),
  drive_file_id text not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  bytes integer not null check (bytes between 1 and 2097152),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_revision', 'resuelto')),
  observaciones text not null default '' check (length(observaciones) <= 4000),
  created_at timestamptz not null default now(),
  actualizado_en timestamptz,
  actualizado_por uuid references public.profiles(id),
  mensaje_legacy_id bigint references public.messages(id)
);
create index reportes_error_modulo_fecha on public.reportes_error (modulo, created_at desc, id);
alter table public.reportes_error enable row level security;
revoke all on public.reportes_error from public, anon, authenticated;
grant select on public.reportes_error to authenticated;
grant all on public.reportes_error to service_role;
create policy reportes_error_distrital on public.reportes_error for select to authenticated
  using (coalesce(public.tiene_permiso_avanzado(), false));

create function public.reporte_error_registrar(
  p_id uuid, p_actor uuid, p_user uuid, p_modulo text, p_url text, p_descripcion text,
  p_file text, p_mime text, p_bytes integer
) returns void language plpgsql security definer set search_path = '' as $$
declare usuario public.profiles; emisor uuid; correo bigint; mensaje bigint; destino text; cuerpo text; fecha timestamptz;
begin
  select * into usuario from public.profiles where id = p_user and active;
  if usuario.id is null or not exists (select 1 from public.profiles where id = p_actor and active)
    or (p_actor <> p_user and not exists (
      select 1 from public.simulaciones s join public.profiles a on a.id = s.actor_id
      where s.actor_id = p_actor and s.target_id = p_user and a.active and a.role = 'distrital'
    )) then raise exception 'La sesión ya no es válida.'; end if;
  if p_id is null or p_modulo is null or length(btrim(p_modulo)) not between 1 and 150
    or p_url is null or length(p_url) not between 1 and 2048
    or p_descripcion is null or length(btrim(p_descripcion)) not between 1 and 4000
    or p_file is null or p_file !~ '^[A-Za-z0-9_-]{10,100}$'
    or p_mime not in ('image/png', 'image/jpeg') or p_bytes not between 1 and 2097152
    then raise exception 'Datos del reporte inválidos.'; end if;
  select id into emisor from public.profiles where role = 'distrital' and active order by id limit 1;
  if emisor is null then raise exception 'No hay una cuenta distrital activa para enviar la confirmación.'; end if;
  insert into public.reportes_error(id, user_id, actor_id, usuario, rol, modulo, url, descripcion, drive_file_id, mime, bytes)
  values (p_id, p_user, p_actor, usuario.name, usuario.role, btrim(p_modulo), p_url, btrim(p_descripcion), p_file, p_mime, p_bytes)
  returning created_at into fecha;
  cuerpo := 'Recibimos tu reporte de error y lo resolveremos a la brevedad.' || E'\n\n'
    || 'Reporte: ' || p_id::text || E'\nFecha y hora: ' || to_char(fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
    || E'\nUsuario: ' || usuario.name || E'\nRol: ' || usuario.role || E'\nMódulo: ' || btrim(p_modulo) || E'\nURL: ' || p_url
    || E'\nDescripción: ' || btrim(p_descripcion) || E'\n\nMensaje automático de Jefatura Distrital 3.';
  if usuario.role in ('escolar', 'areal', 'distrital') then
    destino := case when usuario.role = 'distrital' then 'jd3' else usuario.id::text end;
    insert into public.correo_mensajes(autor_id, autor_nombre, autor_buzon, asunto, cuerpo)
      values (emisor, 'Jefatura Distrital 3 · Mensaje automático', 'jd3', 'Reporte de error recibido', cuerpo) returning id into correo;
    insert into public.correo_destinatarios(mensaje_id, buzon, nombre)
      values (correo, destino, case when destino = 'jd3' then 'Jefatura Distrital 3' else usuario.name end);
    insert into public.correo_copias(mensaje_id, buzon, carpeta) values (correo, destino, 'recibidos');
    insert into public.correo_copias(mensaje_id, buzon, carpeta, leido_en) values (correo, 'jd3', 'enviados', now());
  else
    insert into public.messages(from_user_id, to_user_id, subject, body)
      values (emisor, usuario.id, 'Reporte de error recibido', cuerpo) returning id into mensaje;
    update public.reportes_error set mensaje_legacy_id = mensaje where id = p_id;
    update public.push_cola set titulo = public.push_titulo('Nuevo mensaje', 'Jefatura Distrital 3')
      where origen = 'mensaje' and evento_id = mensaje;
  end if;
  insert into public.notifications(user_id, type, title, body, url)
    select p.id, 'info', public.push_titulo('Nuevo reporte de error', usuario.name), btrim(p_modulo), '/reportes-error'
    from public.profiles p where p.role = 'distrital' and p.active and p.permiso_avanzado;
end $$;
revoke all on function public.reporte_error_registrar(uuid,uuid,uuid,text,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.reporte_error_registrar(uuid,uuid,uuid,text,text,text,text,text,integer) to service_role;

create or replace function public.mensajes_bandeja() returns table (id bigint, from_name text, subject text, body text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, case when r.id is not null then 'Jefatura Distrital 3 · Mensaje automático' else f.name end,
    m.subject, m.body, m.read_at, m.created_at
  from public.messages m join public.profiles f on f.id = m.from_user_id
  left join public.reportes_error r on r.mensaje_legacy_id = m.id
  where m.to_user_id = public.eff_uid() order by m.id desc limit 50
$$;

create function public.reportes_error_listar(p_busqueda text default '', p_orden text default 'recientes', p_lim integer default 15, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare resultado jsonb;
begin
  if not coalesce(public.tiene_permiso_avanzado(), false) then raise exception 'Sin permiso'; end if;
  if p_lim is null or p_lim < 1 or p_lim > 100 or p_offset is null or p_offset < 0
    or p_orden is null or p_orden not in ('recientes', 'antiguos', 'usuario', 'estado') then raise exception 'Orden o paginación inválidos'; end if;
  with filtradas as (
    select id, usuario, rol, modulo, url, descripcion, estado, observaciones, created_at, actualizado_en
    from public.reportes_error
    where coalesce(btrim(p_busqueda), '') = '' or concat_ws(' ', usuario, rol, modulo, descripcion, estado)
      ilike '%' || replace(replace(replace(btrim(p_busqueda), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ), ordenadas as (
    select *, row_number() over (order by lower(modulo), modulo,
      case when p_orden = 'recientes' then created_at end desc,
      case when p_orden = 'antiguos' then created_at end asc,
      case when p_orden = 'usuario' then lower(usuario) end asc,
      case when p_orden = 'estado' then estado end asc, id) posicion from filtradas
  ), pagina as (select * from ordenadas order by posicion limit p_lim offset p_offset)
  select jsonb_build_object('total', (select count(*) from filtradas),
    'filas', coalesce((select jsonb_agg(to_jsonb(pagina) - 'posicion' order by posicion) from pagina), '[]'::jsonb)) into resultado;
  return resultado;
end $$;
create function public.reporte_error_actualizar(p_id uuid, p_estado text, p_observaciones text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.tiene_permiso_avanzado(), false) then raise exception 'Sin permiso'; end if;
  if p_estado is null or p_estado not in ('pendiente', 'en_revision', 'resuelto')
    or p_observaciones is null or length(p_observaciones) > 4000 then raise exception 'Seguimiento inválido'; end if;
  update public.reportes_error set estado = p_estado, observaciones = btrim(p_observaciones),
    actualizado_en = now(), actualizado_por = auth.uid() where id = p_id;
  if not found then raise exception 'Reporte inexistente'; end if;
end $$;
revoke all on function public.reportes_error_listar(text,text,integer,integer), public.reporte_error_actualizar(uuid,text,text) from public, anon;
grant execute on function public.reportes_error_listar(text,text,integer,integer), public.reporte_error_actualizar(uuid,text,text) to authenticated;

insert into public.ayuda_guias(id, modulo, titulo, descripcion, secciones, posicion)
values ('reporte-error', 'reporte-error', 'Reporte de error', 'Informar errores y realizar su seguimiento.',
  '[{"titulo":"Informar un error","pasos":["Tocá el botón Reporte de error en la barra superior. Si el navegador lo permite, elegí la pantalla o pestaña que querés capturar; de lo contrario, adjuntá una imagen PNG o JPEG de hasta 2 MB.","Revisá la captura y la URL para evitar compartir información sensible, describí el error y enviá el reporte. Recibirás una confirmación por mensajes; en Distrital se usa la bandeja compartida."]},{"titulo":"Seguimiento distrital","pasos":["Los usuarios distritales con permiso avanzado pueden consultar Reportes de Error en Sistema, buscar, ordenar y revisar los reportes agrupados por módulo.","Editá el estado y las observaciones de seguimiento sin alterar el reporte original."]}]'::jsonb, 142);
