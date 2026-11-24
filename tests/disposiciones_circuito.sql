-- Ejecutar después de disposiciones_tramite.sql dentro de la misma transacción revertida.
create temporary table circuito_test (id bigint, lote1 uuid, lote2 uuid, incompleto uuid);
grant select,insert,update on circuito_test to authenticated, service_role;
select set_config('request.jwt.claim.sub','',true);
create temporary table circuito_existente (id bigint, lote uuid);
grant select,update on circuito_existente to authenticated, service_role;
with creado as (
  insert into public.disposiciones(inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,
    escuela_cubrir_id,escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,
    fecha_designacion,numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,
    escuela_base_fuera_distrital,cargo_base,revista_base,fecha_desde,usuario,estado)
  select inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,escuela_cubrir_id,
    escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,fecha_designacion,
    numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,escuela_base_fuera_distrital,
    cargo_base,revista_base,fecha_desde,usuario,'Pendiente'
  from public.disposiciones where id=(select tramite from tramite_test) returning id
) insert into circuito_test(id) select id from creado;

select set_config('request.jwt.claim.sub',(select escolar::text from tramite_test),true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.disposicion_escuela_detalle((select id from circuito_test))) then raise exception 'Escuela ve detalle pendiente'; end if;
  if not exists (select 1 from public.disposicion_escuelas_listar() where id=(select id from circuito_test) and cargo_cubrir='Director' and docente_nombre='Docente ficticio') then
    raise exception 'Faltan datos del título escolar';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select areal::text from tramite_test),true);
set local role authenticated;
update circuito_test set lote1=public.disposicion_lote_iniciar(id,4);
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ declare t record; i int; begin
  select * into t from circuito_test;
  for i in 1..4 loop
    perform public.disposicion_lote_registrar(t.lote1,t.id,(select areal from tramite_test),'prueba-'||i||'.pdf','application/pdf',10,'archivo_prueba_'||i,'inicial');
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select areal::text from tramite_test),true);
set local role authenticated;
select public.disposicion_lote_cerrar(lote1,true) from circuito_test;
reset role;

select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
do $$ declare rechazado boolean:=false; begin
  begin perform public.disposicion_cambiar_estado((select id from circuito_test),'Devuelta para Corrección',' ');
  exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Se devolvió sin observación'; end if;
  perform public.disposicion_cambiar_estado((select id from circuito_test),'Devuelta para Corrección','Corregir documentación');
end $$;
update circuito_test set lote2=public.disposicion_lote_iniciar(id,2), incompleto=public.disposicion_lote_iniciar(id,1);
reset role;
select set_config('request.jwt.claim.sub',(select areal::text from tramite_test),true);
set local role authenticated;
do $$ declare rechazado boolean:=false; begin
  begin perform public.disposicion_lote_cerrar((select incompleto from circuito_test),null);
  exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Se canceló una carga ajena con una operación nula'; end if;
  rechazado:=false;
  begin perform public.disposicion_lote_cerrar((select incompleto from circuito_test),false);
  exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Inspector puede cancelar una carga ajena'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ declare t record; rechazado boolean:=false; begin
  select * into t from circuito_test;
  perform public.disposicion_lote_registrar(t.lote2,t.id,(select distrito from tramite_test),'nuevo.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',10,'archivo_nuevo_uno','seguimiento');
  perform public.disposicion_lote_registrar(t.lote2,t.id,(select distrito from tramite_test),'nuevo.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',10,'archivo_nuevo_dos','seguimiento');
  begin perform public.disposicion_aprobar(t.id,(select distrito from tramite_test)); exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Se aprobó con cargas incompletas'; end if;
  rechazado:=false;
  begin perform public.disposicion_aprobar(t.id,(select areal from tramite_test)); exception when raise_exception then rechazado:=true; end;
  if not rechazado then raise exception 'Un inspector puede aprobar'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','',true);
with creado as (
  insert into public.disposiciones(inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,
    escuela_cubrir_id,escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,
    fecha_designacion,numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,
    escuela_base_fuera_distrital,cargo_base,revista_base,fecha_desde,usuario,estado)
  select inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,escuela_cubrir_id,
    escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,fecha_designacion,
    numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,escuela_base_fuera_distrital,
    cargo_base,revista_base,fecha_desde,usuario,'Pendiente'
  from public.disposiciones where id=(select id from circuito_test) returning id
) insert into circuito_existente(id) select id from creado;
update public.disposiciones set docente_email='dato histórico incompleto' where id=(select id from circuito_existente);
select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
select public.disposicion_cambiar_estado((select id from circuito_existente),'Devuelta para Corrección','Revisar el correo');
reset role;
select set_config('request.jwt.claim.sub',(select areal::text from tramite_test),true);
set local role authenticated;
update circuito_existente set lote=public.disposicion_lote_iniciar(id,1);
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ begin
  perform public.disposicion_lote_registrar((select lote from circuito_existente),(select id from circuito_existente),
    (select areal from tramite_test),'existente.pdf','application/pdf',10,'archivo_existente','inicial');
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select areal::text from tramite_test),true);
set local role authenticated;
select public.disposicion_lote_cerrar(lote,true) from circuito_existente;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$ begin
  perform public.disposicion_aprobar((select id from circuito_existente),(select distrito from tramite_test));
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select escolar::text from tramite_test),true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.disposicion_archivos where disposicion_id=(select id from circuito_existente)) <> 1 then
    raise exception 'No se aprobó con la documentación existente';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
select public.disposicion_lote_cerrar(lote2,true),public.disposicion_lote_cerrar(incompleto,false) from circuito_test;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select public.disposicion_aprobar(id,(select distrito from tramite_test)) from circuito_test;
reset role;
select set_config('request.jwt.claim.sub',(select escolar::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from circuito_test;
  if not exists (select 1 from public.disposicion_escuela_detalle(t.id) where estado='Finalizada') then raise exception 'Escuela no ve detalle aprobado'; end if;
  if (select count(*) from public.disposicion_archivos where disposicion_id=t.id) <> 2
    or exists (select 1 from public.disposicion_archivos where disposicion_id=t.id and lote_id=t.lote1)
    or (select count(*) from public.disposicion_archivos where disposicion_id=t.id and lote_id=t.lote2) <> 2 then
    raise exception 'La escuela no ve exactamente el último lote';
  end if;
end $$;
reset role;
update public.profiles set role='escolar',cue='otra-'||(select token from tramite_test) where id=(select ajeno from tramite_test);
select set_config('request.jwt.claim.sub',(select ajeno::text from tramite_test),true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.disposicion_escuela_detalle((select id from circuito_test)))
    or exists (select 1 from public.disposicion_archivos where disposicion_id=(select id from circuito_test)) then
    raise exception 'Escuela ajena ve la disposición';
  end if;
end $$;
reset role;
