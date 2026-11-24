-- Ejecutar dentro de una transacción revertida.
create temporary table dispo_acceso_ids as
  select
    (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id)
      and not exists (select 1 from public.inspectores i where i.user_id = p.id) limit 1) actor,
    (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id)
      and exists (select 1 from public.inspectores i where i.user_id = p.id) limit 1) supervisor,
    (select id from public.escuelas where clave is not null and cue <> '' order by id limit 1) escuela1,
    (select id from public.escuelas where clave is not null and cue <> ''
      and cue <> (select cue from public.escuelas where clave is not null and cue <> '' order by id limit 1) order by id limit 1) escuela2;
grant select on dispo_acceso_ids to authenticated;
do $$ begin
  if exists (select 1 from dispo_acceso_ids where actor is null or supervisor is null or actor = supervisor or escuela1 is null or escuela2 is null) then
    raise exception 'Faltan datos de prueba';
  end if;
end $$;
update public.profiles set role = 'areal', active = true, permiso_avanzado = false where id = (select actor from dispo_acceso_ids);
insert into public.inspectores(user_id, cuil, nombre, escuelas_asignadas)
select t.actor, 'test-' || gen_random_uuid()::text, 'Inspector ficticio', array[e.clave]
from dispo_acceso_ids t join public.escuelas e on e.id = t.escuela1;
create temporary table dispo_acceso_fixtures (id bigint, docente_nombre text);
grant select on dispo_acceso_fixtures to authenticated;
with creadas as (
  insert into public.disposiciones(inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,
    escuela_cubrir_id,escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,
    fecha_designacion,numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,cargo_base,revista_base,fecha_desde,usuario)
  select 'Inspector ficticio','jefatura@abc.gob.ar',v.docente,'20123456789','docente@abc.gob.ar',
    v.cubrir,'clave','Escuela','Director','Titular','Asignación AP','Acto Público',
    '2026-01-01','123',v.base,'clave','Escuela base','Docente','Titular','2026-01-01','prueba'
  from dispo_acceso_ids t cross join lateral (values ('acceso-uno',t.escuela1,t.escuela2),('acceso-dos',t.escuela2,t.escuela1)) v(docente,cubrir,base)
  returning id, docente_nombre
) insert into dispo_acceso_fixtures select id, docente_nombre from creadas;
insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id)
select id,'prueba.pdf','application/pdf',1,'test-' || gen_random_uuid()::text from dispo_acceso_fixtures;
select set_config('request.jwt.claim.sub', (select actor::text from dispo_acceso_ids), true);
set local role authenticated;
do $$
declare cantidad integer; rechazado boolean := false;
begin
  if (select count(*) from public.disposiciones where id in (select id from dispo_acceso_fixtures)) <> 1
    or not exists (select 1 from public.disposiciones where docente_nombre = 'acceso-uno')
    or exists (select 1 from public.disposiciones where docente_nombre = 'acceso-dos') then
    raise exception 'Areal no está restringido a la escuela a cubrir asignada';
  end if;
  if (select count(*) from public.disposicion_archivos where disposicion_id in (select id from dispo_acceso_fixtures)) <> 1
    or exists (select 1 from public.disposicion_archivos where disposicion_id = (select id from dispo_acceso_fixtures where docente_nombre = 'acceso-dos')) then
    raise exception 'Areal puede ver archivos de otra escuela';
  end if;
  update public.disposiciones set observaciones = 'cambio no autorizado' where docente_nombre = 'acceso-uno';
  get diagnostics cantidad = row_count;
  if cantidad <> 0 then raise exception 'Areal puede editar disposiciones'; end if;
  begin insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id)
    values ((select id from dispo_acceso_fixtures where docente_nombre = 'acceso-uno'),'prueba','application/pdf',1,'sin-permiso');
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Areal puede agregar archivos'; end if;
  insert into public.disposiciones(inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,
    escuela_cubrir_id,escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,
    fecha_designacion,numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,cargo_base,revista_base,fecha_desde,usuario)
  select 'Inspector','jefatura@abc.gob.ar','Docente','20123456789','docente@abc.gob.ar',
    escuela1,'','','Director','Titular','Asignación AP','Acto Público',
    '2026-01-01','123',escuela1,'','','Docente','Titular','2026-01-01','' from dispo_acceso_ids;
  if not exists (select 1 from public.disposiciones where docente_nombre='Docente' and estado='Pendiente' and creado_areal)
    then raise exception 'Areal no puede crear disposiciones pendientes'; end if;
end $$;
reset role;
update public.inspectores set escuelas_asignadas = '{}' where user_id = (select actor from dispo_acceso_ids);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.disposiciones where id in (select id from dispo_acceso_fixtures))
    or exists (select 1 from public.disposicion_archivos where disposicion_id in (select id from dispo_acceso_fixtures)) then
    raise exception 'Areal sin escuelas asignadas tiene acceso';
  end if;
end $$;
reset role;
update public.inspectores set escuelas_asignadas = array[(select e.clave from public.escuelas e join dispo_acceso_ids t on e.id = t.escuela1)]
  where user_id = (select actor from dispo_acceso_ids);
update public.profiles set role = 'escolar', cue = (select e.cue from public.escuelas e join dispo_acceso_ids t on e.id = t.escuela1)
  where id = (select actor from dispo_acceso_ids);
set local role authenticated;
do $$
declare cantidad integer; rechazado boolean := false;
begin
  if exists (select 1 from public.disposiciones where id in (select id from dispo_acceso_fixtures))
    or exists (select 1 from public.disposicion_archivos where disposicion_id in (select id from dispo_acceso_fixtures))
    or (select count(*) from public.disposicion_escuelas_listar() where id in (select id from dispo_acceso_fixtures)) <> 1
    or exists (select 1 from public.disposicion_escuelas_listar() where id = (select id from dispo_acceso_fixtures where docente_nombre = 'acceso-dos')) then
    raise exception 'Escolar no está restringido al resumen de la escuela a cubrir';
  end if;
  update public.disposiciones set observaciones = 'cambio no autorizado' where docente_nombre = 'acceso-uno';
  get diagnostics cantidad = row_count;
  if cantidad <> 0 then raise exception 'Escolar puede editar disposiciones'; end if;
  begin delete from public.disposicion_archivos where disposicion_id = (select id from dispo_acceso_fixtures where docente_nombre = 'acceso-uno');
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Escolar puede quitar archivos'; end if;
end $$;
reset role;
update public.profiles set cue = null where id = (select actor from dispo_acceso_ids);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.disposicion_escuelas_listar() where id in (select id from dispo_acceso_fixtures)) then
    raise exception 'Escolar sin CUE tiene acceso';
  end if;
end $$;
reset role;
update public.profiles set role = 'areal', cue = null where id = (select actor from dispo_acceso_ids);
update public.profiles set role = 'distrital', active = true where id = (select supervisor from dispo_acceso_ids);
insert into public.simulaciones(actor_id, target_id) select supervisor, actor from dispo_acceso_ids;
select set_config('request.jwt.claim.sub', (select supervisor::text from dispo_acceso_ids), true);
set local role authenticated;
do $$
declare cantidad integer;
begin
  if (select count(*) from public.disposiciones where id in (select id from dispo_acceso_fixtures)) <> 1
    or exists (select 1 from public.disposiciones where docente_nombre = 'acceso-dos') then
    raise exception 'La simulación no respeta las escuelas asignadas';
  end if;
  update public.disposiciones set observaciones = 'cambio no autorizado' where docente_nombre = 'acceso-uno';
  get diagnostics cantidad = row_count;
  if cantidad <> 0 then raise exception 'La simulación puede editar disposiciones'; end if;
end $$;
reset role;
