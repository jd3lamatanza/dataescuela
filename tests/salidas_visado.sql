-- Ejecutar después de la migración dentro de una transacción revertida.
create temporary table salidas_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id limit 1) escolar,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 1 limit 1) otra_escuela,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 2 limit 1) areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 3 limit 1) ajeno,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 4 limit 1) distrito,
  gen_random_uuid()::text token, null::bigint escuela_id, null::bigint salida, null::bigint salida_escolar;
grant select, update on salidas_test to authenticated;
do $$ begin
  if exists (select 1 from salidas_test where escolar is null or otra_escuela is null or areal is null or ajeno is null or distrito is null)
  then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
update public.profiles set role = 'escolar', active = true, permiso_avanzado = false, cue = 'cue-' || (select token from salidas_test) where id = (select escolar from salidas_test);
update public.profiles set role = 'escolar', active = true, permiso_avanzado = false, cue = 'otra-' || (select token from salidas_test) where id = (select otra_escuela from salidas_test);
update public.profiles set role = 'areal', active = true, permiso_avanzado = false where id in (select areal from salidas_test union all select ajeno from salidas_test);
update public.profiles set role = 'distrital', active = true, permiso_avanzado = false where id = (select distrito from salidas_test);
insert into public.escuelas(cue, clave, tipo, numero, nombre)
select 'cue-' || token, 'clave-' || token, 'EP', 999, 'Prueba' from salidas_test;
update salidas_test set escuela_id = (select id from public.escuelas where cue = 'cue-' || salidas_test.token);
insert into public.inspectores(user_id, cuil, nombre, escuelas_asignadas)
select areal, 'asignado-' || token, 'Asignado', array['clave-' || token] from salidas_test
union all select ajeno, 'ajeno-' || token, 'Ajeno', array['otra-' || token] from salidas_test;

select set_config('request.jwt.claim.sub', (select distrito::text from salidas_test), true);
set local role authenticated;
update salidas_test set salida = public.salida_crear_distrital(escuela_id, 'Salida distrital', '2027-01-15', 'Museo', null);
do $$ declare t record; rechazado boolean := false; begin
  select * into t from salidas_test;
  if not public.salida_editable(t.salida) or not exists (select 1 from public.salidas where id = t.salida and creada_por_distrital and not enviar_mail and user_id = t.distrito)
    then raise exception 'La salida distrital no se creó o no admite archivos'; end if;
  begin perform public.salida_estado(t.salida, public._salida_estado_id('Aprobada'), null);
  exception when raise_exception then
    if sqlerrm <> 'La salida debe estar visada por un inspector antes de aprobarse' then raise; end if;
    rechazado := true;
  end;
  if not rechazado or exists (select 1 from public.salidas where id=t.salida and (evento_id is not null or estado_id=public._salida_estado_id('Aprobada')))
    then raise exception 'Distrital aprobó sin visado o creó un evento'; end if;
end $$;
reset role;

do $$ declare t record; rechazado boolean := false; begin
  select * into t from salidas_test;
  begin update public.salidas set estado_id=public._salida_estado_id('Aprobada') where id=t.salida;
  exception when raise_exception then
    if sqlerrm <> 'La salida debe estar visada por un inspector antes de aprobarse' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Se aprobó directamente sin visado'; end if;
end $$;

insert into public.simulaciones(actor_id, target_id) select distrito, areal from salidas_test;
select set_config('request.jwt.claim.sub', (select distrito::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; rechazado boolean := false; begin
  select * into t from salidas_test;
  if not exists (select 1 from public.salidas where id = t.salida) then raise exception 'La simulación no respeta al inspector asignado'; end if;
  begin perform public.salida_crear_distrital(t.escuela_id, 'Inválida', '2027-01-15', 'Museo', null);
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'El distrital simulado puede crear como distrital'; end if;
end $$;
reset role;
delete from public.simulaciones where actor_id = (select distrito from salidas_test);

select set_config('request.jwt.claim.sub', (select escolar::text from salidas_test), true);
set local role authenticated;
update salidas_test set salida_escolar = public.salida_crear('Salida escolar', '2027-01-16', 'Museo', null, true);
do $$ declare t record; rechazado boolean := false; begin
  select * into t from salidas_test;
  if not exists (select 1 from public.salidas where id = t.salida)
    or not public.salida_es_dueno(t.salida) or not public.salida_editable(t.salida)
    or exists (select 1 from public.salidas where id = t.salida_escolar and enviar_mail)
    then raise exception 'La escuela no ve la salida o se solicitó correo'; end if;
  perform public.salida_mensaje(t.salida, 'Comentario escolar');
  begin perform public.salida_visar(t.salida); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'La escuela puede visar'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select ajeno::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; rechazado boolean; begin
  select * into t from salidas_test;
  if exists (select 1 from public.salidas where id = t.salida) then raise exception 'Inspector ajeno ve la salida'; end if;
  rechazado := false;
  begin perform public.salida_visar(t.salida); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Inspector ajeno puede visar'; end if;
  rechazado := false;
  begin perform public.salida_estado(t.salida, public._salida_estado_id('Aprobada'), null); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Inspector ajeno puede cambiar estado'; end if;
  rechazado := false;
  begin perform public.salida_mensaje(t.salida, 'Ajeno'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Inspector ajeno puede comentar'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select areal::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; rechazado boolean := false; v_fecha timestamptz; begin
  select * into t from salidas_test;
  begin perform public.salida_estado(t.salida, public._salida_estado_id('Aprobada'), null);
  exception when raise_exception then
    if sqlerrm <> 'La salida debe estar visada por un inspector antes de aprobarse' then raise; end if;
    rechazado := true;
  end;
  if not rechazado then raise exception 'Inspector aprobó sin visar'; end if;
  rechazado := false;
  perform public.salida_visar(t.salida);
  select visado_at into v_fecha from public.salidas where id = t.salida and visado_por = t.areal and visado_nombre = 'Asignado';
  if v_fecha is null then raise exception 'No se guardó el visado'; end if;
  begin perform public.salida_visar(t.salida); exception when raise_exception then rechazado := true; end;
  if not rechazado or (select visado_at from public.salidas where id = t.salida) <> v_fecha then raise exception 'El visado no es permanente'; end if;
  perform public.salida_mensaje(t.salida, 'Comentario areal');
  perform public.salida_estado(t.salida, public._salida_estado_id('Aprobada'), 'Aprobada por inspector');
  if not exists (select 1 from public.salida_mensajes where salida_id = t.salida and rol = 'areal' and texto = 'Comentario areal')
    or not exists (select 1 from public.salidas where id = t.salida and evento_id is not null)
    then raise exception 'No se guardó comentario o calendario'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select distrito::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from salidas_test;
  if not exists (select 1 from public.salidas where id=t.salida and visado_nombre='Asignado') then
    raise exception 'Distrital no ve el nombre del inspector';
  end if;
  perform public.salida_estado(t.salida, public._salida_estado_id('Aprobada'), 'Aprobación distrital');
  if not exists (select 1 from public.salidas where id=t.salida and evento_id is not null and estado_id=public._salida_estado_id('Aprobada')) then
    raise exception 'Distrital no pudo aprobar la salida visada';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select escolar::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from salidas_test;
  if not exists (select 1 from public.eventos where id = (select evento_id from public.salidas where id = t.salida))
    then raise exception 'La escuela no ve el evento de la salida distrital'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select otra_escuela::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from salidas_test;
  if exists (select 1 from public.salidas where id = t.salida)
    or exists (select 1 from public.eventos where cue = 'cue-' || t.token)
    or public.salida_es_dueno(t.salida)
    then raise exception 'Otra escuela puede ver la salida o su evento'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select areal::text from salidas_test), true);
set local role authenticated;
do $$ declare t record; begin
  select * into t from salidas_test;
  perform public.salida_estado(t.salida, public._salida_estado_id('Pendiente'), null);
  if (select evento_id from public.salidas where id = t.salida) is not null then raise exception 'No se quitó el evento al cambiar el estado'; end if;
end $$;
reset role;
