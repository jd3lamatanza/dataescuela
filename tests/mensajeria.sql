-- Se ejecuta después de la migración dentro de una transacción que se revierte.
create temporary table correo_test_roles as
select p.id escolar, i.user_id inspector,
  (select id from public.profiles where role = 'distrital' and active order by id limit 1) distrito,
  (select id from public.profiles where role = 'distrital' and active order by id offset 1 limit 1) distrito2,
  (select id from public.profiles where role = 'escolar' and active and id <> p.id order by id limit 1) otra_escuela
from public.profiles p
join public.escuelas e on e.cue = p.cue
join public.inspectores i on e.clave = any(i.escuelas_asignadas)
join public.profiles a on a.id = i.user_id and a.active and a.role = 'areal'
where p.role = 'escolar' and p.active
  and not exists (select 1 from public.simulaciones s where s.actor_id in (p.id, i.user_id))
limit 1;
grant select on correo_test_roles to authenticated;

set local role authenticated;
do $$
declare t record; draft bigint; msg bigint; respuesta bigint; bloqueado boolean; d jsonb;
begin
  select * into t from correo_test_roles;
  if t.escolar is null or t.distrito2 is null or t.otra_escuela is null then raise exception 'Faltan perfiles para pruebas'; end if;
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  if not exists (select 1 from public.correo_destinos() where buzon = t.inspector::text) then raise exception 'Inspector asignado no visible'; end if;
  if exists (select 1 from public.correo_destinos() where buzon = t.otra_escuela::text) then raise exception 'Escuela ajena visible'; end if;
  draft := public.correo_guardar_borrador(null, 'Prueba', 'Contenido de prueba', array[t.otra_escuela::text], null);
  bloqueado := false;
  begin perform public.correo_enviar(draft); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Envío indebido permitido'; end if;
  bloqueado := false;
  begin insert into public.messages(from_user_id,to_user_id,subject,body) values(t.escolar,t.otra_escuela,'Prueba','Prueba'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Envío antiguo elude los permisos'; end if;
  perform public.correo_guardar_borrador(draft, 'Prueba', 'Contenido de prueba', array['jd3', t.inspector::text], null);
  msg := public.correo_enviar(draft);
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  if public.correo_contar_no_leidos() < 1 then raise exception 'JD3 no recibió el mensaje'; end if;
  d := public.correo_detalle(msg, 'recibidos');
  if d->>'asunto' <> 'Prueba' then raise exception 'Detalle incorrecto'; end if;
  perform set_config('request.jwt.claim.sub', t.distrito2::text, true);
  if not exists (select 1 from public.correo_listar('recibidos') x where x.id = msg and x.leido) then raise exception 'Lectura JD3 no compartida'; end if;
  draft := public.correo_guardar_borrador(null, 'Respuesta', 'Respuesta de prueba', array[t.escolar::text], msg);
  respuesta := public.correo_enviar(draft);
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  d := public.correo_detalle(respuesta, 'recibidos');
  if d->>'autor' not like '% · JD3' then raise exception 'Falta identidad JD3'; end if;
  perform set_config('request.jwt.claim.sub', t.otra_escuela::text, true);
  bloqueado := false;
  begin perform public.correo_detalle(msg, 'recibidos'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Lectura ajena permitida'; end if;
  bloqueado := false;
  begin perform public.correo_guardar_borrador(null, 'Prueba', 'Prueba', array[t.escolar::text], msg); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Respuesta a mensaje ajeno permitida'; end if;
  perform set_config('request.jwt.claim.sub', t.inspector::text, true);
  draft := public.correo_guardar_borrador(null, 'Respuesta a todos', 'Respuesta', array[t.escolar::text, 'jd3'], msg);
  respuesta := public.correo_enviar(draft);
  perform set_config('request.jwt.claim.sub', t.distrito2::text, true);
  d := public.correo_detalle(respuesta, 'recibidos');
  if jsonb_array_length(d->'destinatarios') <> 2 then raise exception 'Destinatarios incompletos'; end if;
  perform public.correo_cambiar_estado(msg, 'recibidos', 'papelera');
  perform set_config('request.jwt.claim.sub', t.distrito::text, true);
  if not exists (select 1 from public.correo_listar('papelera') x where x.id = msg) then raise exception 'Papelera JD3 no compartida'; end if;
end $$;
reset role;

create temporary table correo_test_adjuntos (draft bigint, archivo bigint);
grant select, insert on correo_test_adjuntos to authenticated;
set local role authenticated;
insert into correo_test_adjuntos(draft)
select public.correo_guardar_borrador(null, 'Adjunto', 'Prueba', array['jd3'], null)
from (select set_config('request.jwt.claim.sub', escolar::text, true) from correo_test_roles) x;
reset role;
insert into public.correo_adjuntos(borrador_id,nombre,mime,bytes,drive_file_id)
select draft, 'prueba.txt', 'application/octet-stream', 5242880, 'archivo-prueba' from correo_test_adjuntos;
update correo_test_adjuntos set archivo = (select id from public.correo_adjuntos where drive_file_id = 'archivo-prueba');
do $$
declare bloqueado boolean := false;
begin
  begin
    insert into public.correo_adjuntos(borrador_id,nombre,mime,bytes,drive_file_id)
    select draft, 'grande.txt', 'application/octet-stream', 5242881, 'archivo-grande' from correo_test_adjuntos;
  exception when check_violation then bloqueado := true;
  end;
  if not bloqueado then raise exception 'Se aceptó un adjunto mayor a 5 MB'; end if;
end $$;
set local role authenticated;
do $$
declare t record; a record;
begin
  select * into t from correo_test_roles; select * into a from correo_test_adjuntos;
  perform set_config('request.jwt.claim.sub', t.otra_escuela::text, true);
  if exists (select 1 from public.correo_adjunto_autorizado(a.archivo)) then raise exception 'Adjunto ajeno visible'; end if;
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  if not exists (select 1 from public.correo_adjunto_autorizado(a.archivo)) then raise exception 'Adjunto propio no visible'; end if;
  if public.correo_quitar_adjunto(a.archivo) <> 'archivo-prueba' then raise exception 'Limpieza no encolada'; end if;
  perform public.correo_eliminar_borrador(a.draft);
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.correo_limpieza_drive where drive_file_id = 'archivo-prueba') then raise exception 'No se registró la limpieza pendiente'; end if;
end $$;
