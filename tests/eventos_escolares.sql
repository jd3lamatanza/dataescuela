-- Ejecutar junto a la migración dentro de una transacción revertida.
create temporary table evento_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id limit 1) escolar,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 1 limit 1) participante,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 2 limit 1) areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 3 limit 1) distrital,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 4 limit 1) regional,
  gen_random_uuid()::text token, null::bigint escuela1, null::bigint escuela2, null::bigint escuela3,
  null::bigint tipo, null::bigint realizacion1, null::bigint realizacion2;
grant select, update on evento_test to authenticated;
do $$ begin
  if exists (select 1 from evento_test where escolar is null or participante is null or areal is null or distrital is null or regional is null) then
    raise exception 'Faltan perfiles para las pruebas';
  end if;
end $$;
insert into public.escuelas(cue, clave, nombre) select 'test-a-' || token, 'test-a-' || token, 'Escuela A' from evento_test;
insert into public.escuelas(cue, clave, nombre) select 'test-b-' || token, 'test-b-' || token, 'Escuela B' from evento_test;
insert into public.escuelas(cue, clave, nombre) select 'test-a-' || token, 'test-c-' || token, 'Escuela C' from evento_test;
update evento_test set escuela1 = (select id from public.escuelas where clave = 'test-a-' || token),
  escuela2 = (select id from public.escuelas where clave = 'test-b-' || token),
  escuela3 = (select id from public.escuelas where clave = 'test-c-' || token);
update public.profiles set role = 'escolar', active = true, cue = 'test-a-' || (select token from evento_test) where id = (select escolar from evento_test);
update public.profiles set role = 'escolar', active = true, cue = 'test-b-' || (select token from evento_test) where id = (select participante from evento_test);
update public.profiles set role = 'areal', active = true where id = (select areal from evento_test);
update public.profiles set role = 'distrital', active = true where id = (select distrital from evento_test);
update public.profiles set role = 'regional', active = true where id = (select regional from evento_test);
insert into public.inspectores(user_id,cuil,nombre,escuelas_asignadas)
  select areal, 'test-' || token, 'Inspector ficticio', array['test-b-' || token] from evento_test;

select set_config('request.jwt.claim.sub', (select distrital::text from evento_test), true);
set local role authenticated;
update evento_test set tipo = public.eventos_escolares_crear_tipo('Evento ficticio');
do $$ declare rechazado boolean := false; begin
  begin perform public.eventos_escolares_crear_tipo(' evento ficticio '); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Permite nombres duplicados'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select escolar::text from evento_test), true);
set local role authenticated;
update evento_test set realizacion1 = public.eventos_escolares_guardar(null, tipo, escuela1, escuela2, '2026-03-07', 'Escuela', '09:00', '10:00', 'Objetivo', 'Observación');
update evento_test set realizacion2 = public.eventos_escolares_guardar(null, tipo, escuela1, null, '2026-03-08', 'Escuela', '09:00', '10:00', 'Otro objetivo', '');
select public.eventos_escolares_guardar((select realizacion1 from evento_test), (select tipo from evento_test), (select escuela1 from evento_test), (select escuela2 from evento_test), '2026-03-07', 'Nuevo lugar', '09:00', '10:00', 'Objetivo actualizado', 'Observación');
do $$ declare rechazado boolean := false; begin
  if (select count(*) from public.eventos_escolares_listar(p_evento => (select tipo from evento_test))) <> 2 then raise exception 'No permite varias realizaciones'; end if;
  if not exists (select 1 from public.eventos_escolares_listar(p_id => (select realizacion1 from evento_test)) where lugar = 'Nuevo lugar' and objetivos = 'Objetivo actualizado') then raise exception 'La edición no conserva los datos'; end if;
  if (select count(*) from public.eventos_escolares_listar('2026-03-07', '2026-03-07', null, (select tipo from evento_test))) <> 1 then raise exception 'Filtro de fecha incorrecto'; end if;
  begin perform public.eventos_escolares_guardar(null, (select tipo from evento_test), (select escuela2 from evento_test), null, '2026-03-07', 'Escuela', '09:00', '10:00', 'Objetivo', '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Puede cargar por una escuela ajena'; end if;
  rechazado := false;
  begin perform public.eventos_escolares_guardar(null, (select tipo from evento_test), (select escuela1 from evento_test), null, '2026-03-07', 'Escuela', '10:00', '09:00', 'Objetivo', '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Acepta horario inverso'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select participante::text from evento_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  if (select count(*) from public.eventos_escolares_listar(p_evento => (select tipo from evento_test))) <> 1 then raise exception 'La participante no ve su articulación o ve una realización ajena'; end if;
  begin perform public.eventos_escolares_eliminar((select realizacion1 from evento_test));
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'La participante puede eliminar una carga ajena'; end if;
  rechazado := false;
  begin perform public.eventos_escolares_guardar((select realizacion1 from evento_test), (select tipo from evento_test), (select escuela2 from evento_test), null, '2026-03-07', 'Escuela', '09:00', '10:00', 'Objetivo', '');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'La participante puede editar una carga ajena'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select areal::text from evento_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  if (select count(*) from public.eventos_escolares_listar(p_evento => (select tipo from evento_test))) <> 1 then raise exception 'El inspector no respeta sus escuelas asignadas'; end if;
  begin perform public.eventos_escolares_seguimiento((select tipo from evento_test)); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'El inspector accede al seguimiento distrital'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select distrital::text from evento_test), true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.eventos_escolares_listar(p_evento => (select tipo from evento_test))) <> 2 then raise exception 'Distrital no ve todas las realizaciones'; end if;
  if not (select cargado from public.eventos_escolares_seguimiento((select tipo from evento_test)) where id = (select escuela1 from evento_test))
    or not (select cargado from public.eventos_escolares_seguimiento((select tipo from evento_test)) where id = (select escuela2 from evento_test))
    or (select cargado from public.eventos_escolares_seguimiento((select tipo from evento_test)) where id = (select escuela3 from evento_test)) then
    raise exception 'El seguimiento confunde escuelas o articulaciones';
  end if;
end $$;
reset role;
insert into public.simulaciones(actor_id, target_id) select distrital, areal from evento_test;
set local role authenticated;
do $$ begin
  if (select count(*) from public.eventos_escolares_listar(p_evento => (select tipo from evento_test))) <> 1 then
    raise exception 'La simulación areal no respeta sus escuelas asignadas';
  end if;
end $$;
reset role;
delete from public.simulaciones where actor_id = (select distrital from evento_test);
select set_config('request.jwt.claim.sub', (select escolar::text from evento_test), true);
set local role authenticated;
select public.eventos_escolares_eliminar((select realizacion1 from evento_test));
reset role;
select set_config('request.jwt.claim.sub', (select distrital::text from evento_test), true);
set local role authenticated;
do $$ begin
  if (select cargado from public.eventos_escolares_seguimiento((select tipo from evento_test)) where id = (select escuela2 from evento_test))
    or not (select cargado from public.eventos_escolares_seguimiento((select tipo from evento_test)) where id = (select escuela1 from evento_test)) then
    raise exception 'El seguimiento no refleja la eliminación';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select regional::text from evento_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  begin perform public.eventos_escolares_listar(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Regional puede acceder a realizaciones'; end if;
  rechazado := false;
  begin perform * from public.eventos_escolares_realizaciones; exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Regional puede leer la tabla directamente'; end if;
end $$;
reset role;
-- Edición del catálogo y datos históricos sin autor ni datos inventados.
insert into public.eventos_escolares_realizaciones(evento_id, escuela_id, fecha, lugar, hora_inicio, observaciones, origen_historico, articulacion_informada)
  select tipo, escuela1, '2026-07-09', 'Patio', '09:00', 'Texto histórico', true, false from evento_test;
select set_config('request.jwt.claim.sub', (select distrital::text from evento_test), true);
set local role authenticated;
select public.eventos_escolares_renombrar_tipo((select tipo from evento_test), 'Evento renombrado');
do $$ declare rechazado boolean := false; begin
  if not exists (select 1 from public.eventos_escolares_listar(p_evento => (select tipo from evento_test))
    where evento = 'Evento renombrado' and hora_fin is null and objetivos is null and origen_historico and not articulacion_informada) then
    raise exception 'La realización histórica no conserva los datos y el nombre';
  end if;
  begin perform public.eventos_escolares_eliminar_tipo((select tipo from evento_test)); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se pudo eliminar un evento con realizaciones'; end if;
end $$;
update evento_test set tipo = public.eventos_escolares_crear_tipo('Otro evento ficticio');
do $$ declare rechazado boolean := false; begin
  begin perform public.eventos_escolares_renombrar_tipo((select tipo from evento_test), ' evento renombrado '); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Se pudo renombrar a un nombre duplicado'; end if;
end $$;
select public.eventos_escolares_eliminar_tipo((select tipo from evento_test));
reset role;
select set_config('request.jwt.claim.sub', (select escolar::text from evento_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; v_id bigint; v_tipo bigint; begin
  begin perform public.eventos_escolares_renombrar_tipo((select tipo from evento_test), 'Prohibido'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Una escuela puede modificar el catálogo'; end if;
  select id, evento_id into v_id, v_tipo from public.eventos_escolares_listar() where origen_historico and escuela_id = (select escuela1 from evento_test);
  perform public.eventos_escolares_guardar(v_id, v_tipo, (select escuela1 from evento_test), null, '2026-07-09', 'Patio', '09:00', '10:00', 'Objetivo', 'Texto histórico');
  if not exists (select 1 from public.eventos_escolares_listar(p_id => v_id) where articulacion_informada and hora_fin = '10:00' and objetivos = 'Objetivo') then
    raise exception 'La edición histórica no registra los datos completados';
  end if;
end $$;
reset role;
