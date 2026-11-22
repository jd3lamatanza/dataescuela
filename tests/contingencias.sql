-- Ejecutar dentro de una transacción revertida.
create temporary table contingencias_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) order by id limit 1) usuario1,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) order by id offset 1 limit 1) usuario2,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) order by id offset 2 limit 1) supervisor,
  (select cue from public.escuelas where cue is not null and trim(cue) <> '' order by cue limit 1) cue1,
  (select distinct cue from public.escuelas where cue is not null and trim(cue) <> '' order by cue offset 1 limit 1) cue2,
  (select id from public.turnos where activo order by id limit 1) turno1,
  (select id from public.turnos where activo order by id offset 1 limit 1) turno2,
  null::bigint contingencia1, null::bigint contingencia2;
grant select, update on contingencias_test to authenticated;
do $$ begin
  if exists (select 1 from contingencias_test where usuario1 is null or usuario2 is null or supervisor is null
    or cue1 is null or cue2 is null or turno1 is null or turno2 is null) then
    raise exception 'Faltan datos de prueba';
  end if;
end $$;
update public.profiles set role = 'escolar', active = true, cue = (select cue1 from contingencias_test)
  where id = (select usuario1 from contingencias_test);
update public.profiles set role = 'escolar', active = true, cue = (select cue2 from contingencias_test)
  where id = (select usuario2 from contingencias_test);
update public.profiles set role = 'distrital', active = true where id = (select supervisor from contingencias_test);

select set_config('request.jwt.claim.sub', (select usuario1::text from contingencias_test), true);
set local role authenticated;
update contingencias_test set contingencia1 = public.contingencia_guardar(null, array['Falta de Agua','Duelo'], 'parcial', array[turno1,turno2], 'Prueba');
do $$
declare rechazado boolean;
begin
  if (select count(*) from public.contingencias where id = (select contingencia1 from contingencias_test)) <> 1
    or (select count(*) from public.contingencia_turnos where contingencia_id = (select contingencia1 from contingencias_test)) <> 2 then
    raise exception 'La creación no conservó la contingencia y sus turnos';
  end if;
  rechazado := false;
  begin perform public.contingencia_guardar(null, '{}', 'sin', array[(select turno1 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Aceptó una contingencia sin tipos'; end if;
  rechazado := false;
  begin perform public.contingencia_guardar(null, array['Falta de Agua','Falta de Agua'], 'sin', array[(select turno1 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Aceptó tipos duplicados'; end if;
  rechazado := false;
  begin perform public.contingencia_guardar(null, array['No existe'], 'sin', array[(select turno1 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Aceptó un tipo inválido'; end if;
  rechazado := false;
  begin perform public.contingencia_guardar(null, array['Duelo'], 'inválido', array[(select turno1 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Aceptó una suspensión inválida'; end if;
  rechazado := false;
  begin perform public.contingencia_guardar(null, array['Duelo'], 'sin', '{}', '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Aceptó una contingencia sin turnos'; end if;
  rechazado := false;
  begin perform public.contingencia_guardar(null, array['Duelo'], 'sin', array[-1::bigint], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Aceptó un turno inexistente'; end if;
  rechazado := false;
  begin update public.contingencias set cue = 'ajeno' where id = (select contingencia1 from contingencias_test);
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Permitió escritura directa'; end if;
end $$;
reset role;

update public.turnos set activo = false where id = (select turno1 from contingencias_test);
set local role authenticated;
select public.contingencia_guardar((select contingencia1 from contingencias_test), array['Otro'], 'total', array[(select turno1 from contingencias_test)], 'Editada');
do $$
declare rechazado boolean := false;
begin
  if not exists (select 1 from public.contingencias where id = (select contingencia1 from contingencias_test)
    and tipos = array['Otro'] and suspension = 'total' and observaciones = 'Editada')
    or (select count(*) from public.contingencia_turnos where contingencia_id = (select contingencia1 from contingencias_test)) <> 1 then
    raise exception 'La edición no conservó el turno inactivo ni sus cambios';
  end if;
  begin perform public.contingencia_guardar(null, array['Duelo'], 'sin', array[(select turno1 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Permitió elegir un turno inactivo nuevo'; end if;
end $$;
select set_config('request.jwt.claim.sub', (select usuario2::text from contingencias_test), true);
update contingencias_test set contingencia2 = public.contingencia_guardar(null, array['Duelo'], 'sin', array[turno2], '');
do $$
declare rechazado boolean := false;
begin
  if exists (select 1 from public.contingencias where id = (select contingencia1 from contingencias_test))
    or exists (select 1 from public.contingencia_turnos where contingencia_id = (select contingencia1 from contingencias_test)) then
    raise exception 'Una escuela puede ver contingencias de otra';
  end if;
  begin perform public.contingencia_guardar((select contingencia1 from contingencias_test), array['Duelo'], 'sin', array[(select turno2 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Una escuela puede editar contingencias de otra'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select supervisor::text from contingencias_test), true);
set local role authenticated;
do $$
declare rechazado boolean := false;
begin
  if exists (select 1 from public.contingencias where id in (select contingencia1 from contingencias_test union all select contingencia2 from contingencias_test)) then
    raise exception 'Otro rol puede ver contingencias';
  end if;
  begin perform public.contingencia_guardar(null, array['Duelo'], 'sin', array[(select turno2 from contingencias_test)], '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Otro rol puede crear contingencias'; end if;
end $$;
reset role;
insert into public.simulaciones(actor_id, target_id) select supervisor, usuario1 from contingencias_test;
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.contingencias where id = (select contingencia1 from contingencias_test))
    or exists (select 1 from public.contingencias where id = (select contingencia2 from contingencias_test)) then
    raise exception 'El ingreso simulado no respeta la escuela efectiva';
  end if;
  perform public.contingencia_guardar((select contingencia1 from contingencias_test), array['Duelo'], 'sin', array[(select turno1 from contingencias_test)], 'Simulada');
  if not exists (select 1 from public.contingencias where id = (select contingencia1 from contingencias_test) and observaciones = 'Simulada') then
    raise exception 'El ingreso simulado no puede editar';
  end if;
end $$;
reset role;
