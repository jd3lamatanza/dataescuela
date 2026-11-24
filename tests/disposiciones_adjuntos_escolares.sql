-- Ejecutar después de disposiciones_tramite.sql en la misma transacción revertida.
insert into public.disposicion_adjuntos_escolares(archivo_id)
select a.id from public.disposicion_archivos a join tramite_test t on t.tramite=a.disposicion_id
where a.tipo='inicial' order by a.id limit 2;

select set_config('request.jwt.claim.sub',(select escolar::text from tramite_test),true);
set local role authenticated;
do $$ declare t record; rechazado boolean:=false; begin
  select * into t from tramite_test;
  if (select count(*) from public.disposicion_archivos where disposicion_id=t.tramite) <> 2 then
    raise exception 'La escuela debe ver solo los dos PDF históricos autorizados';
  end if;
  if exists (select 1 from public.disposicion_archivos where disposicion_id=t.tramite and tipo='seguimiento')
    or exists (select 1 from public.disposiciones where id=t.tramite)
    or exists (select 1 from public.disposicion_mensajes where disposicion_id=t.tramite) then
    raise exception 'La escuela accede a información no autorizada';
  end if;
  begin insert into public.disposicion_adjuntos_escolares(archivo_id) values (1);
  exception when insufficient_privilege then rechazado:=true; end;
  if not rechazado then raise exception 'La escuela puede habilitar otros documentos'; end if;
end $$;
reset role;

update public.profiles set role='escolar', cue='otra-'||(select token from tramite_test)
where id=(select ajeno from tramite_test);
select set_config('request.jwt.claim.sub',(select ajeno::text from tramite_test),true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.disposicion_archivos where disposicion_id=(select tramite from tramite_test)) then
    raise exception 'Otra escuela puede ver los documentos';
  end if;
end $$;
reset role;

insert into public.simulaciones(actor_id,target_id) select distrito,escolar from tramite_test;
select set_config('request.jwt.claim.sub',(select distrito::text from tramite_test),true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.disposicion_archivos where disposicion_id=(select tramite from tramite_test)) <> 2 then
    raise exception 'La simulación escolar no respeta los documentos habilitados';
  end if;
end $$;
reset role;
