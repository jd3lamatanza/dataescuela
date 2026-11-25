-- Ejecutar dentro de una transacción revertida.
create temporary table eav_form_test as
select
  (select id from public.profiles where role='distrital' and active
    and not exists (select 1 from public.simulaciones where actor_id=profiles.id) limit 1) distrito,
  (select id from public.profiles where role='escolar' and active limit 1) escolar,
  (select count(*) from public.eav_preinscripciones) cantidad;
grant select on eav_form_test to authenticated, service_role;
do $$ begin
  if exists (select 1 from eav_form_test where distrito is null or escolar is null) then
    raise exception 'Faltan perfiles para probar el formulario';
  end if;
end $$;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select distrito::text from eav_form_test),true);
set local role authenticated;
do $$ begin
  if public.eav_formulario_estado() is distinct from true then raise exception 'El formulario no inicia activo'; end if;
  if public.eav_formulario_cambiar_estado(false) is distinct from false then raise exception 'No se desactivó'; end if;
  if public.eav_formulario_estado() is distinct from false then raise exception 'No se conservó el estado'; end if;
  begin
    perform public.eav_formulario_cambiar_estado(null);
    raise exception 'Se aceptó estado nulo';
  exception when not_null_violation then raise; when raise_exception then
    if sqlerrm <> 'Indicá el estado del formulario' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$ declare r text; bloqueado boolean := false; begin
  if public.eav_formulario_estado() is distinct from false then raise exception 'Servicio no ve el cierre'; end if;
  r := public.eav_preinscribir(1,'99999999','Ejemplo Prueba','2018-01-01','Mujer',null,
    'Otra escuela','Domicilio prueba','Responsable prueba','Otro','01112345678','prueba@example.invalid');
  if r <> 'cerrado' then raise exception 'Se aceptó envío con formulario cerrado: %',r; end if;
  begin
    perform public.eav_preinscribir_interno(1,'99999999','Ejemplo Prueba','2018-01-01','Mujer',null,
      'Otra escuela','Domicilio prueba','Responsable prueba','Otro','01112345678','prueba@example.invalid');
  exception when insufficient_privilege then bloqueado:=true; end;
  if not bloqueado then raise exception 'El servicio puede eludir el cierre'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.eav_preinscripciones) <> (select cantidad from eav_form_test) then
    raise exception 'El cierre modificó inscripciones existentes';
  end if;
end $$;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select escolar::text from eav_form_test),true);
set local role authenticated;
do $$ declare bloqueado boolean:=false; begin
  begin perform public.eav_formulario_cambiar_estado(true);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Escolar puede cambiar el formulario'; end if;
  bloqueado:=false;
  begin perform public.eav_formulario_estado();
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Escolar puede leer el estado privado'; end if;
end $$;
reset role;

insert into public.simulaciones(actor_id,target_id) select distrito,escolar from eav_form_test;
select set_config('request.jwt.claim.sub',(select distrito::text from eav_form_test),true);
set local role authenticated;
do $$ declare bloqueado boolean:=false; begin
  begin perform public.eav_formulario_cambiar_estado(true);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Distrital simulando escolar puede cambiar el formulario'; end if;
end $$;
reset role;
delete from public.simulaciones where actor_id=(select distrito from eav_form_test);
set local role authenticated;
do $$ begin
  if public.eav_formulario_cambiar_estado(true) is distinct from true then raise exception 'No se reactivó'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
do $$ begin
  if public.eav_preinscribir(1,'123','Ejemplo Prueba','2018-01-01','Mujer',null,
    'Otra escuela','Domicilio prueba','Responsable prueba','Otro','01112345678','prueba@example.invalid') <> 'invalido'
    then raise exception 'La reactivación no restableció el procesamiento normal'; end if;
end $$;
reset role;
