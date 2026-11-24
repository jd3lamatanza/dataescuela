-- Ejecutar junto con la migración dentro de una transacción revertida.
create temporary table tramite_test as
select
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id) and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id limit 1) escolar,
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id) and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id offset 1 limit 1) areal,
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id) and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id offset 2 limit 1) ajeno,
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id) and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id offset 3 limit 1) distrito,
  gen_random_uuid()::text token, null::bigint escuela, null::bigint otra, null::bigint tramite;
grant select,update on tramite_test to authenticated, service_role;
do $$ begin
  if exists (select 1 from tramite_test where escolar is null or areal is null or ajeno is null or distrito is null)
    then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
insert into public.escuelas(cue,clave,tipo,numero,nombre)
select 'cue-'||token,'clave-'||token,'EP',999,'Escuela ficticia' from tramite_test
union all select 'otra-'||token,'otra-'||token,'EP',998,'Otra escuela' from tramite_test;
update tramite_test set escuela=(select id from public.escuelas where cue='cue-'||tramite_test.token),
  otra=(select id from public.escuelas where cue='otra-'||tramite_test.token);
update public.profiles set role='escolar',active=true,permiso_avanzado=false,cue='cue-'||(select token from tramite_test) where id=(select escolar from tramite_test);
update public.profiles set role='areal',active=true,permiso_avanzado=false where id in (select areal from tramite_test union all select ajeno from tramite_test);
update public.profiles set role='distrital',active=true,permiso_avanzado=false where id=(select distrito from tramite_test);
insert into public.inspectores(user_id,cuil,nombre,escuelas_asignadas)
select areal,'test-'||token,'Inspector ficticio',array['clave-'||token] from tramite_test
union all select ajeno,'otro-'||token,'Inspector ajeno',array['otra-'||token] from tramite_test;

select set_config('request.jwt.claim.sub',(select areal::text from tramite_test),true);
set local role authenticated;
with creado as (
  insert into public.disposiciones(inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,escuela_cubrir_id,
    escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,fecha_designacion,numero_designacion,
    escuela_base_id,escuela_base_clave,escuela_base_nombre,cargo_base,revista_base,fecha_desde,usuario,estado)
  select 'falso','jefatura@abc.gob.ar','Docente ficticio','20123456789','docente@abc.gob.ar',escuela,'','','Director','Titular',
    'Asignación AP','Acto Público','2026-01-01','123',escuela,'','','Docente','Titular','2026-01-01','','Finalizada' from tramite_test
  returning id
) update tramite_test set tramite=(select id from creado);
do $$ declare t record; n int; rechazado boolean := false; begin
  select * into t from tramite_test;
  if not exists (select 1 from public.disposiciones where id=t.tramite and estado='Pendiente' and creado_areal and creado_por=t.areal and inspector='Inspector ficticio')
    then raise exception 'Alta areal incorrecta'; end if;
  begin update public.disposiciones set estado='En proceso' where id=t.tramite;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Areal cambió el estado directamente'; end if;
  exception when insufficient_privilege then null; end;
  begin perform public.disposicion_cambiar_estado(t.tramite,'En proceso',''); exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Areal cambió el estado por RPC'; end if;
  perform public.disposicion_comentar(t.tramite,'Respuesta del inspector');
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.notifications n join tramite_test t on n.user_id=t.distrito where n.title='Nueva disposición de Inspector ficticio')
    then raise exception 'No se notificó a Jefatura'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select escolar::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from tramite_test;
  if exists (select 1 from public.disposiciones where id=t.tramite)
    or not exists (select 1 from public.disposicion_escuelas_listar() where id=t.tramite and estado='Pendiente' and not pdf_disponible)
    or exists (select 1 from public.disposicion_final where disposicion_id=t.tramite)
    or exists (select 1 from public.disposicion_mensajes where disposicion_id=t.tramite)
    then raise exception 'Acceso escolar previo a la finalización incorrecto'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select ajeno::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; rechazado boolean:=false; begin
  select * into t from tramite_test;
  if public.disposicion_acceso(t.tramite) or exists (select 1 from public.disposiciones where id=t.tramite) then raise exception 'Inspector ajeno ve el trámite'; end if;
  begin perform public.disposicion_comentar(t.tramite,'Ajeno'); exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Inspector ajeno puede responder'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; rechazado boolean:=false; begin
  select * into t from tramite_test;
  if not exists (select 1 from public.disposiciones where id=t.tramite and leida_at is null) then raise exception 'No aparece sin abrir'; end if;
  perform public.disposicion_marcar_leida(t.tramite);
  if not exists (select 1 from public.disposiciones where id=t.tramite and leida_at is not null) then raise exception 'No se marcó como abierta'; end if;
  begin update public.disposiciones set estado='Finalizada' where id=t.tramite; exception when raise_exception or insufficient_privilege then rechazado:=true; end;
  if not rechazado then raise exception 'Se finalizó sin PDF'; end if;
  rechazado:=false;
  begin perform public.disposicion_finalizar_drive(t.tramite,t.distrito,'pdf_final_ficticio','final.pdf',100);
  exception when insufficient_privilege then rechazado:=true; end;
  if not rechazado then raise exception 'Usuario puede registrar un PDF sin verificar Drive'; end if;
  perform public.disposicion_cambiar_estado(t.tramite,'Devuelta para Corrección','Adjuntá la corrección');
end $$;
reset role;
do $$ declare t record; begin
  select * into t from tramite_test;
  if not exists (select 1 from public.notifications where user_id=t.areal and body like '%Devuelta para Corrección%')
    or exists (select 1 from public.notifications where user_id=t.ajeno and body like '%Disposición #'||t.tramite||'%')
    or not exists (select 1 from public.disposicion_mensajes where disposicion_id=t.tramite and texto='Adjuntá la corrección')
    then raise exception 'Aviso o mensaje de devolución incorrecto'; end if;
  insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id)
  select t.tramite,'prueba.pdf','application/pdf',1,'inicial-'||t.token||'-'||n from generate_series(1,3) n;
  insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id,tipo)
  values (t.tramite,'respuesta.pdf','application/pdf',1,'respuesta-'||t.token,'seguimiento');
end $$;

insert into public.simulaciones(actor_id,target_id) select distrito,areal from tramite_test;
select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; n int; begin
  select * into t from tramite_test;
  if not public.disposicion_acceso(t.tramite) then raise exception 'Simulación areal perdió acceso asignado'; end if;
  begin update public.disposiciones set estado='En proceso' where id=t.tramite;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Simulación areal puede cambiar el estado'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ declare t record; rechazado boolean:=false; begin
  select * into t from tramite_test;
  begin perform public.disposicion_finalizar_drive(t.tramite,t.distrito,'pdf_final_ficticio','final.pdf',100);
  exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Se finalizó durante una simulación'; end if;
end $$;
reset role;
delete from public.simulaciones where actor_id=(select distrito from tramite_test);

select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ declare t record; begin
  select * into t from tramite_test;
  perform public.disposicion_finalizar_drive(t.tramite,t.distrito,'pdf_final_ficticio','final.pdf',100);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; rechazado boolean:=false; begin
  select * into t from tramite_test;
  begin perform public.disposicion_cambiar_estado(t.tramite,'En proceso',null);
  exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Una disposición con PDF final cambió de estado'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select escolar::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from tramite_test;
  if not exists (select 1 from public.disposicion_escuelas_listar() where id=t.tramite and estado='Finalizada' and pdf_disponible)
    or not exists (select 1 from public.disposicion_final where disposicion_id=t.tramite)
    or exists (select 1 from public.disposicion_archivos where disposicion_id=t.tramite)
    or exists (select 1 from public.disposiciones where id=t.tramite)
    then raise exception 'Escuela no ve solo el PDF final'; end if;
end $$;
reset role;
