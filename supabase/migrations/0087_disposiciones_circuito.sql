drop trigger disposicion_archivo_limite on public.disposicion_archivos;
revoke update on public.disposiciones from authenticated;
grant update (inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,
  escuela_cubrir_id,escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,
  tipo,motivo,fecha_designacion,numero_designacion,escuela_base_id,escuela_base_clave,
  escuela_base_nombre,escuela_base_fuera_distrital,cargo_base,revista_base,fecha_desde,observaciones,usuario)
on public.disposiciones to authenticated;

create or replace function public.disposicion_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_areal boolean := public.app_role() = 'areal';
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'leida_at') = (to_jsonb(old) - 'leida_at') then
    if not public.disposiciones_permitido() then raise exception 'Sin permiso'; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'estado' - 'actualizada') = (to_jsonb(old) - 'estado' - 'actualizada') then
    if not public.disposiciones_permitido() then raise exception 'Sin permiso'; end if;
    if new.estado = 'Finalizada' and old.estado is distinct from 'Finalizada' then raise exception 'Usá la opción para aprobar el trámite'; end if;
    new.actualizada := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not (public.disposiciones_permitido() or public.disposicion_areal_asignada(new.escuela_cubrir_id)) then raise exception 'Sin permiso'; end if;
    new.creado_por := public.eff_uid();
    new.creado_areal := v_areal;
    new.leida_at := null;
    new.estado := case when v_areal then 'Pendiente' else 'En proceso' end;
    new.fecha_registro := now();
    if v_areal then
      select i.nombre into new.inspector from public.inspectores i where i.user_id = public.eff_uid() order by i.id limit 1;
      if coalesce(btrim(new.inspector),'') = '' then raise exception 'No se encontró el inspector de tu cuenta'; end if;
    end if;
  else
    if not public.disposiciones_permitido() then raise exception 'Sin permiso'; end if;
    if new.estado = 'Finalizada' and old.estado is distinct from 'Finalizada' then raise exception 'Usá la opción para aprobar el trámite'; end if;
    new.creado_por := old.creado_por;
    new.creado_areal := old.creado_areal;
    new.fecha_registro := old.fecha_registro;
  end if;
  select clave, coalesce(nullif(nombre, ''), concat_ws(' ', tipo, numero))
    into new.escuela_cubrir_clave, new.escuela_cubrir_nombre from public.escuelas where id = new.escuela_cubrir_id;
  if not found then raise exception 'Escuela a cubrir inexistente'; end if;
  if new.escuela_base_fuera_distrital then
    if new.escuela_base_id is not null or coalesce(btrim(new.escuela_base_nombre), '') = '' then raise exception 'Ingresá el nombre de la escuela fuera de la Distrital'; end if;
    new.escuela_base_nombre := btrim(new.escuela_base_nombre);
    new.escuela_base_clave := coalesce(btrim(new.escuela_base_clave), '');
  elsif new.escuela_base_id is null then
    if tg_op = 'INSERT' or old.escuela_base_id is not null or old.escuela_base_fuera_distrital then raise exception 'Seleccioná una escuela base'; end if;
    new.escuela_base_clave := old.escuela_base_clave;
    new.escuela_base_nombre := old.escuela_base_nombre;
  else
    select clave, coalesce(nullif(nombre, ''), concat_ws(' ', tipo, numero))
      into new.escuela_base_clave, new.escuela_base_nombre from public.escuelas where id = new.escuela_base_id;
    if not found then raise exception 'Escuela base inexistente'; end if;
  end if;
  if btrim(new.inspector) = '' or btrim(new.docente_nombre) = '' or new.docente_cuil !~ '^[0-9]+$'
    or new.email_jefatura !~* '^[^[:space:]@]+@abc\.gob\.ar$'
    or new.docente_email !~* '^[^[:space:]@]+@abc\.gob\.ar$'
    or new.cargo_cubrir not in ('Director','Vicedirector','Secretario','Prosecretario')
    or new.revista_cubrir not in ('Titular','Provisional','Suplente')
    or new.revista_base not in ('Titular','Provisional','Suplente')
    or btrim(new.numero_designacion) = '' or btrim(new.cargo_base) = '' then
    raise exception 'Completá los datos obligatorios con valores válidos';
  end if;
  select coalesce(nullif(name, ''), login) into new.usuario from public.profiles where id = public.eff_uid();
  new.actualizada := now();
  return new;
end $$;

create table public.disposicion_lotes (
  id uuid primary key default gen_random_uuid(),
  disposicion_id bigint not null references public.disposiciones(id) on delete cascade,
  actor uuid not null references public.profiles(id),
  cantidad integer not null check (cantidad > 0),
  completo boolean not null default false,
  creado_at timestamptz not null default now(),
  completado_at timestamptz
);
alter table public.disposicion_lotes enable row level security;
revoke all on public.disposicion_lotes from public, anon, authenticated;
alter table public.disposicion_archivos add column lote_id uuid references public.disposicion_lotes(id);
create index disposicion_archivos_lote_idx on public.disposicion_archivos(lote_id);

create function public.disposicion_lote_iniciar(p_id bigint, p_cantidad integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_estado text;
begin
  if not public.disposicion_acceso(p_id) then raise exception 'Sin permiso'; end if;
  if p_cantidad is null or p_cantidad < 1 then raise exception 'Seleccioná al menos un archivo'; end if;
  select estado into v_estado from public.disposiciones where id=p_id for update;
  if v_estado = 'Finalizada' then raise exception 'El trámite ya está finalizado'; end if;
  insert into public.disposicion_lotes(disposicion_id,actor,cantidad)
  values(p_id,auth.uid(),p_cantidad) returning id into v_id;
  return v_id;
end $$;

create function public.disposicion_lote_registrar(
  p_lote uuid, p_id bigint, p_actor uuid, p_nombre text, p_mime text, p_bytes bigint, p_file_id text, p_tipo text
) returns void language plpgsql security definer set search_path = public as $$
declare v_lote public.disposicion_lotes; v_estado text;
begin
  select * into v_lote from public.disposicion_lotes where id=p_lote;
  if not found or v_lote.actor <> p_actor or v_lote.disposicion_id <> p_id then raise exception 'Carga inexistente o sin permiso'; end if;
  select estado into v_estado from public.disposiciones where id=v_lote.disposicion_id for update;
  select * into v_lote from public.disposicion_lotes where id=p_lote for update;
  if not found then raise exception 'La carga ya no existe'; end if;
  if v_estado = 'Finalizada' or v_lote.completo then raise exception 'La carga ya está cerrada'; end if;
  if (select count(*) from public.disposicion_archivos where lote_id=p_lote) >= v_lote.cantidad then
    raise exception 'La carga ya contiene todos los archivos';
  end if;
  if p_tipo not in ('inicial','seguimiento') or p_bytes not between 1 and 10485760
    or p_mime not in ('application/pdf','image/jpeg','image/png','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    or length(btrim(coalesce(p_nombre,''))) not between 1 and 200
    or coalesce(p_file_id,'') !~ '^[A-Za-z0-9_-]{10,}$' then raise exception 'Archivo inválido'; end if;
  insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id,tipo,lote_id)
  values(v_lote.disposicion_id,btrim(p_nombre),p_mime,p_bytes,p_file_id,p_tipo,p_lote);
end $$;

create function public.disposicion_lote_cerrar(p_lote uuid, p_completar boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_lote public.disposicion_lotes; v_estado text;
begin
  if p_completar is null then raise exception 'Operación inválida'; end if;
  select * into v_lote from public.disposicion_lotes where id=p_lote;
  if not found or not public.disposicion_acceso(v_lote.disposicion_id)
    or (v_lote.actor <> auth.uid() and (p_completar or not public.disposiciones_permitido())) then raise exception 'Sin permiso'; end if;
  select estado into v_estado from public.disposiciones where id=v_lote.disposicion_id for update;
  select * into v_lote from public.disposicion_lotes where id=p_lote for update;
  if not found then raise exception 'La carga ya no existe'; end if;
  if v_estado = 'Finalizada' or v_lote.completo then raise exception 'La carga ya está cerrada'; end if;
  if p_completar then
    if (select count(*) from public.disposicion_archivos where lote_id=p_lote) <> v_lote.cantidad then
      raise exception 'Faltan archivos de la carga';
    end if;
    update public.disposicion_lotes set completo=true, completado_at=clock_timestamp() where id=p_lote;
  else
    delete from public.disposicion_archivos where lote_id=p_lote;
    delete from public.disposicion_lotes where id=p_lote;
  end if;
end $$;
create function public.disposicion_lotes_pendientes(p_id bigint)
returns table(id uuid, creado_at timestamptz, cantidad integer, cargados bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.disposicion_acceso(p_id) then raise exception 'Sin permiso'; end if;
  return query select l.id,l.creado_at,l.cantidad,count(a.id)
    from public.disposicion_lotes l left join public.disposicion_archivos a on a.lote_id=l.id
    where l.disposicion_id=p_id and not l.completo
      and (l.actor=auth.uid() or public.disposiciones_permitido())
    group by l.id order by l.creado_at;
end $$;
revoke all on function public.disposicion_lote_iniciar(bigint,integer), public.disposicion_lote_cerrar(uuid,boolean) from public, anon;
grant execute on function public.disposicion_lote_iniciar(bigint,integer), public.disposicion_lote_cerrar(uuid,boolean) to authenticated;
revoke all on function public.disposicion_lotes_pendientes(bigint) from public, anon;
grant execute on function public.disposicion_lotes_pendientes(bigint) to authenticated;
revoke all on function public.disposicion_lote_registrar(uuid,bigint,uuid,text,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.disposicion_lote_registrar(uuid,bigint,uuid,text,text,bigint,text,text) to service_role;

create or replace function public.disposicion_adjunto_escolar_visible(p_archivo bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'escolar'
    and public.real_role() in ('escolar', 'distrital')
    and exists (
      select 1 from public.disposicion_adjuntos_escolares e
      join public.disposicion_archivos a on a.id=e.archivo_id
      where e.archivo_id=p_archivo and public.disposicion_final_visible(a.disposicion_id)
    ), false)
$$;

create function public.disposicion_aprobar(p_id bigint, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_lote uuid; v_estado text;
begin
  if exists (select 1 from public.simulaciones where actor_id=p_actor)
    or not exists (select 1 from public.profiles where id=p_actor and active and role='distrital') then
    raise exception 'Sin permiso';
  end if;
  select estado into v_estado from public.disposiciones where id=p_id for update;
  if not found then raise exception 'Disposición inexistente'; end if;
  if v_estado='Finalizada' then raise exception 'El trámite ya está finalizado'; end if;
  if exists (select 1 from public.disposicion_lotes where disposicion_id=p_id and not completo) then
    raise exception 'Hay una carga de documentación sin completar';
  end if;
  select id into v_lote from public.disposicion_lotes where disposicion_id=p_id and completo
    order by completado_at desc, id desc limit 1;
  if v_lote is not null and not exists (select 1 from public.disposicion_archivos where lote_id=v_lote) then
    raise exception 'La última carga no tiene archivos; agregá documentación antes de aprobar';
  end if;
  if v_lote is null and not exists (select 1 from public.disposicion_archivos where disposicion_id=p_id and lote_id is null)
    and not exists (select 1 from public.disposicion_final where disposicion_id=p_id) then
    raise exception 'Agregá documentación antes de aprobar';
  end if;
  delete from public.disposicion_adjuntos_escolares e using public.disposicion_archivos a
    where e.archivo_id=a.id and a.disposicion_id=p_id;
  insert into public.disposicion_adjuntos_escolares(archivo_id)
    select id from public.disposicion_archivos
    where disposicion_id=p_id and lote_id is not distinct from v_lote;
  update public.disposiciones set estado='Finalizada',actualizada=now() where id=p_id;
end $$;
revoke all on function public.disposicion_aprobar(bigint,uuid) from public, anon, authenticated;
grant execute on function public.disposicion_aprobar(bigint,uuid) to service_role;

create function public.disposicion_proteger_finalizada() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.estado='Finalizada' and new.estado is distinct from old.estado then
    raise exception 'Una disposición aprobada no puede cambiar de estado';
  end if;
  return new;
end $$;
create trigger disposicion_proteger_finalizada before update of estado on public.disposiciones
for each row execute function public.disposicion_proteger_finalizada();
create function public.disposicion_proteger_adjunto_publicado() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists (select 1 from public.disposicion_adjuntos_escolares e
    join public.disposiciones d on d.id=old.disposicion_id
    where e.archivo_id=old.id and d.estado='Finalizada') then
    raise exception 'No se puede quitar documentación publicada de una disposición aprobada';
  end if;
  return old;
end $$;
create trigger disposicion_proteger_adjunto_publicado before delete on public.disposicion_archivos
for each row execute function public.disposicion_proteger_adjunto_publicado();

create or replace function public.disposicion_cambiar_estado(p_id bigint, p_estado text, p_texto text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.disposiciones_permitido() then raise exception 'Sin permiso'; end if;
  if p_estado not in ('Pendiente','En proceso','Enviada a SAD','Rechazada','Devuelta para Corrección') then raise exception 'Estado inválido'; end if;
  if length(coalesce(p_texto,'')) > 3000 then raise exception 'El mensaje es demasiado largo'; end if;
  if p_estado='Devuelta para Corrección' and nullif(btrim(coalesce(p_texto,'')),'') is null then
    raise exception 'Escribí la observación para el inspector';
  end if;
  update public.disposiciones set estado=p_estado where id=p_id;
  if not found then raise exception 'Disposición inexistente'; end if;
  if nullif(btrim(coalesce(p_texto,'')),'') is not null then perform public.disposicion_comentar(p_id,p_texto); end if;
end $$;

drop function public.disposicion_escuelas_listar();
create function public.disposicion_escuelas_listar()
returns table(id bigint, estado text, fecha_registro timestamptz, escuela_cubrir_nombre text,
  cargo_cubrir text, docente_nombre text, inspector text, pdf_disponible boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'escolar' or public.real_role() not in ('escolar','distrital') then raise exception 'Sin permiso'; end if;
  return query select d.id,d.estado,d.fecha_registro,d.escuela_cubrir_nombre,d.cargo_cubrir,d.docente_nombre,d.inspector,
    d.estado='Finalizada' and exists (select 1 from public.disposicion_final f where f.disposicion_id=d.id)
  from public.disposiciones d where public.can_see_escuela(d.escuela_cubrir_id) order by d.id desc;
end $$;
create function public.disposicion_escuela_detalle(p_id bigint) returns setof public.disposiciones
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'escolar' or public.real_role() not in ('escolar','distrital') then raise exception 'Sin permiso'; end if;
  return query select d.* from public.disposiciones d where d.id=p_id and d.estado='Finalizada' and public.can_see_escuela(d.escuela_cubrir_id);
end $$;
revoke all on function public.disposicion_escuelas_listar(), public.disposicion_escuela_detalle(bigint) from public, anon;
grant execute on function public.disposicion_escuelas_listar(), public.disposicion_escuela_detalle(bigint) to authenticated;

update public.ayuda_guias set secciones = replace(replace(secciones::text,
  'El estado se muestra desde la creación. Cuando Jefatura finalice el trámite y cargue el PDF, tocá «Descargar PDF».',
  'El estado se muestra desde la creación. Al aprobarse, abrí la disposición para consultar sus datos y descargar la última documentación.'),
  'Las disposiciones históricas finalizadas muestran los PDF que ya estaban adjuntos. Los demás documentos y mensajes no están disponibles para la escuela.',
  'Las disposiciones históricas conservan los documentos que ya estaban disponibles. Los mensajes internos no se muestran a la escuela.')::jsonb,
  version=version+1, actualizado=now()
where id='disposiciones' and secciones::text like '%El estado se muestra desde la creación. Cuando Jefatura finalice el trámite y cargue el PDF%';
