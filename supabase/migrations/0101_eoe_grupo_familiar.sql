create table public.eoe_legajo_grupo_familiar (
  legajo_id uuid primary key references public.eoe_legajos(id) on delete cascade,
  grupo_id uuid not null,
  escuela_id bigint not null references public.escuelas(id)
);
create index eoe_grupo_familiar_grupo on public.eoe_legajo_grupo_familiar(grupo_id);
alter table public.eoe_legajo_grupo_familiar enable row level security;
revoke all on public.eoe_legajo_grupo_familiar from public, anon, authenticated;

create function public._eoe_grupo_familiar_transferido() returns trigger
language plpgsql security definer set search_path = public as $$
declare grupo uuid;
begin
  perform pg_advisory_xact_lock(old.escuela_id);
  delete from public.eoe_legajo_grupo_familiar where legajo_id = old.id returning grupo_id into grupo;
  if grupo is not null and (select count(*) from public.eoe_legajo_grupo_familiar where grupo_id = grupo) < 2 then
    delete from public.eoe_legajo_grupo_familiar where grupo_id = grupo;
  end if;
  return new;
end $$;
revoke all on function public._eoe_grupo_familiar_transferido() from public, anon, authenticated;
create trigger eoe_grupo_familiar_transferido after update of escuela_id on public.eoe_legajos
for each row when (old.escuela_id is distinct from new.escuela_id)
execute function public._eoe_grupo_familiar_transferido();

create function public.eoe_grupo_familiar_listar(p_legajo uuid, p_token text)
returns table (id uuid, nombre text, dni text, identificador_temporal uuid, vinculado boolean, otro_grupo boolean)
language plpgsql stable security definer set search_path = public as $$
declare escuela bigint := public._eoe_legajo_escuela(); grupo uuid;
begin
  if not public._eoe_legajo_acceso(p_legajo, p_token) then
    raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.';
  end if;
  select f.grupo_id into grupo from public.eoe_legajo_grupo_familiar f
    where f.legajo_id = p_legajo and f.escuela_id = escuela;
  return query
    select l.id, l.nombre, l.dni, l.identificador_temporal,
      coalesce(grupo is not null and f.grupo_id = grupo, false), (f.grupo_id is not null and f.grupo_id is distinct from grupo)
    from public.eoe_legajos l
    left join public.eoe_legajo_grupo_familiar f on f.legajo_id = l.id and f.escuela_id = escuela
    where l.escuela_id = escuela and l.id <> p_legajo order by l.nombre, l.id;
end $$;

create function public.eoe_grupo_familiar_asociar(p_legajo uuid, p_token text, p_otro uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare escuela bigint := public._eoe_legajo_escuela(); grupo uuid; otro_grupo uuid; acceso public.eoe_legajo_accesos; nombre_integrante text;
begin
  perform pg_advisory_xact_lock(escuela);
  perform 1 from public.eoe_legajos where id in (p_legajo, p_otro) and escuela_id = escuela order by id for update;
  if p_legajo = p_otro or (select count(*) from public.eoe_legajos where id in (p_legajo, p_otro) and escuela_id = escuela) <> 2 then
    raise exception 'Legajo no disponible en esta escuela';
  end if;
  if not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select * into acceso from public.eoe_legajo_accesos where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found or not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select apellido_nombre into nombre_integrante from public.equipo_orientacion where id = acceso.integrante_id;
  select grupo_id into grupo from public.eoe_legajo_grupo_familiar where legajo_id = p_legajo;
  select grupo_id into otro_grupo from public.eoe_legajo_grupo_familiar where legajo_id = p_otro;
  if grupo is not null and grupo = otro_grupo then raise exception 'Los legajos ya pertenecen al mismo grupo'; end if;
  grupo := coalesce(grupo, otro_grupo, gen_random_uuid());
  if otro_grupo is not null and otro_grupo <> grupo then
    update public.eoe_legajo_grupo_familiar set grupo_id = grupo where grupo_id = otro_grupo and escuela_id = escuela;
  end if;
  insert into public.eoe_legajo_grupo_familiar(legajo_id, grupo_id, escuela_id)
    values (p_legajo, grupo, escuela), (p_otro, grupo, escuela)
    on conflict (legajo_id) do nothing;
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, integrante_id, integrante_nombre, usuario_id)
    select id, escuela, 'grupo_familiar_asociado', acceso.integrante_id, nombre_integrante, auth.uid()
    from public.eoe_legajos where id in (p_legajo, p_otro);
end $$;

create function public.eoe_grupo_familiar_desvincular(p_legajo uuid, p_token text, p_otro uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare escuela bigint := public._eoe_legajo_escuela(); grupo uuid; acceso public.eoe_legajo_accesos; nombre_integrante text;
begin
  perform pg_advisory_xact_lock(escuela);
  perform 1 from public.eoe_legajos where id in (p_legajo, p_otro) and escuela_id = escuela order by id for update;
  if not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select f.grupo_id into grupo from public.eoe_legajo_grupo_familiar f
    join public.eoe_legajo_grupo_familiar otro on otro.grupo_id = f.grupo_id and otro.escuela_id = escuela
    join public.eoe_legajos l on l.id = otro.legajo_id and l.escuela_id = escuela
    where f.legajo_id = p_legajo and f.escuela_id = escuela and otro.legajo_id = p_otro and p_otro <> p_legajo;
  if grupo is null then raise exception 'El legajo no pertenece a este grupo familiar'; end if;
  select * into acceso from public.eoe_legajo_accesos where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found or not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select apellido_nombre into nombre_integrante from public.equipo_orientacion where id = acceso.integrante_id;
  delete from public.eoe_legajo_grupo_familiar where legajo_id = p_otro;
  if (select count(*) from public.eoe_legajo_grupo_familiar where grupo_id = grupo) < 2 then
    delete from public.eoe_legajo_grupo_familiar where grupo_id = grupo;
  end if;
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, integrante_id, integrante_nombre, usuario_id)
    select id, escuela, 'grupo_familiar_desvinculado', acceso.integrante_id, nombre_integrante, auth.uid()
    from public.eoe_legajos where id in (p_legajo, p_otro);
end $$;

create function public.eoe_grupo_familiar_abrir(p_legajo uuid, p_token text, p_otro uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare escuela bigint := public._eoe_legajo_escuela(); acceso public.eoe_legajo_accesos; destino public.eoe_legajos; token text; nombre text;
begin
  perform pg_advisory_xact_lock(escuela);
  perform 1 from public.eoe_legajos where id in (p_legajo, p_otro) and escuela_id = escuela order by id for update;
  if not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select * into acceso from public.eoe_legajo_accesos
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if not found or not public._eoe_legajo_acceso(p_legajo, p_token) then raise exception 'Acceso vencido o no autorizado. Abrí el legajo nuevamente.'; end if;
  select l.* into destino from public.eoe_legajos l
    join public.eoe_legajo_grupo_familiar b on b.legajo_id = l.id and b.escuela_id = escuela
    join public.eoe_legajo_grupo_familiar a on a.grupo_id = b.grupo_id and a.escuela_id = escuela
    where a.legajo_id = p_legajo and l.id = p_otro and l.id <> p_legajo and l.escuela_id = escuela;
  if not found then raise exception 'El legajo no pertenece al grupo familiar de esta escuela'; end if;
  select apellido_nombre into nombre from public.equipo_orientacion where id = acceso.integrante_id;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  delete from public.eoe_legajo_accesos where token_hash = acceso.token_hash;
  insert into public.eoe_legajo_accesos(token_hash, legajo_id, escuela_id, usuario_id, sesion_id, integrante_id, pin_version, vence_en)
    values (encode(extensions.digest(token, 'sha256'), 'hex'), destino.id, escuela, acceso.usuario_id,
      acceso.sesion_id, acceso.integrante_id, acceso.pin_version, acceso.vence_en);
  insert into public.eoe_legajo_auditoria(legajo_id, escuela_id, accion, integrante_id, integrante_nombre, usuario_id)
    values (destino.id, escuela, 'apertura', acceso.integrante_id, nombre, auth.uid());
  return jsonb_build_object('token', token, 'legajo', jsonb_build_object('id', destino.id, 'nombre', destino.nombre,
    'dni', destino.dni, 'identificador_temporal', destino.identificador_temporal));
end $$;

create function public.eoe_legajo_cerrar(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._eoe_legajo_escuela();
  delete from public.eoe_legajo_accesos
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and usuario_id = auth.uid() and sesion_id::text = auth.jwt()->>'session_id';
end $$;

revoke all on function public.eoe_grupo_familiar_listar(uuid,text), public.eoe_grupo_familiar_asociar(uuid,text,uuid),
  public.eoe_grupo_familiar_desvincular(uuid,text,uuid), public.eoe_grupo_familiar_abrir(uuid,text,uuid),
  public.eoe_legajo_cerrar(text) from public, anon;
grant execute on function public.eoe_grupo_familiar_listar(uuid,text), public.eoe_grupo_familiar_asociar(uuid,text,uuid),
  public.eoe_grupo_familiar_desvincular(uuid,text,uuid), public.eoe_grupo_familiar_abrir(uuid,text,uuid),
  public.eoe_legajo_cerrar(text) to authenticated;
