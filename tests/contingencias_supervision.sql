-- Ejecutar dentro de una transacción revertida.
create temporary table contingencias_supervision_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id limit 1) escolar,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 1 limit 1) areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 2 limit 1) otro_areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 3 limit 1) distrital,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 4 limit 1) regional,
  (select cue from public.escuelas where cue <> '' and clave is not null and clave <> '' order by id limit 1) cue1,
  (select clave from public.escuelas where cue <> '' and clave is not null and clave <> '' order by id limit 1) clave1,
  (select distinct cue from public.escuelas where cue <> '' and cue <> (select cue from public.escuelas where cue <> '' and clave is not null and clave <> '' order by id limit 1) order by cue limit 1) cue2,
  (select id from public.turnos where activo order by id limit 1) turno,
  null::bigint id1, null::bigint id2;
grant select, update on contingencias_supervision_test to authenticated;
do $$ begin
  if exists (select 1 from contingencias_supervision_test where escolar is null or areal is null or otro_areal is null or distrital is null or regional is null or cue1 is null or cue2 is null or clave1 is null or turno is null) then
    raise exception 'Faltan datos de prueba';
  end if;
end $$;
update public.profiles set role = 'escolar', active = true, cue = (select cue1 from contingencias_supervision_test) where id = (select escolar from contingencias_supervision_test);
update public.profiles set role = 'areal', active = true where id in (select areal from contingencias_supervision_test union all select otro_areal from contingencias_supervision_test);
update public.profiles set role = 'distrital', active = true where id = (select distrital from contingencias_supervision_test);
update public.profiles set role = 'regional', active = true where id = (select regional from contingencias_supervision_test);
insert into public.inspectores(user_id,cuil,nombre,escuelas_asignadas)
select areal, 'prueba-' || gen_random_uuid(), 'Prueba', array[clave1] from contingencias_supervision_test
union all select otro_areal, 'prueba-' || gen_random_uuid(), 'Prueba', '{}'::text[] from contingencias_supervision_test;
select set_config('request.jwt.claim.sub', (select escolar::text from contingencias_supervision_test), true);
set local role authenticated;
update contingencias_supervision_test set id1 = public.contingencia_guardar(null, array['Falta de Agua'], 'parcial', array[turno], 'Observación ficticia', date '2026-03-05');
select public.contingencia_guardar((select id1 from contingencias_supervision_test), array['Duelo'], 'total', array[(select turno from contingencias_supervision_test)], 'Actualizada', date '2026-03-07');
reset role;
insert into public.contingencias(cue,fecha,tipos,suspension,observaciones)
select cue2, date '2026-03-08', array['Otro'], 'sin', 'Otra escuela' from contingencias_supervision_test;
update contingencias_supervision_test set id2 = (select max(id) from public.contingencias where cue = (select cue2 from contingencias_supervision_test) and observaciones = 'Otra escuela');
do $$ begin
  if (select count(*) from public.notifications where user_id = (select areal from contingencias_supervision_test) and url = '/contingencias?contingencia=' || (select id1 from contingencias_supervision_test)) <> 2
    or (select count(*) from public.notifications where user_id = (select distrital from contingencias_supervision_test) and url = '/contingencias?contingencia=' || (select id1 from contingencias_supervision_test)) <> 2
    or exists (select 1 from public.notifications where user_id in (select otro_areal from contingencias_supervision_test union all select regional from contingencias_supervision_test) and url = '/contingencias?contingencia=' || (select id1 from contingencias_supervision_test)) then
    raise exception 'Las notificaciones no respetan el alcance o no se crean en alta y edición';
  end if;
end $$;
select set_config('request.jwt.claim.sub', (select areal::text from contingencias_supervision_test), true);
set local role authenticated;
do $$
declare r jsonb; rechazado boolean := false;
begin
  if not exists (select 1 from public.contingencias where id = (select id1 from contingencias_supervision_test))
    or exists (select 1 from public.contingencias where id = (select id2 from contingencias_supervision_test))
    or not exists (select 1 from public.contingencia_turnos where contingencia_id = (select id1 from contingencias_supervision_test)) then
    raise exception 'El inspector no respeta el alcance asignado';
  end if;
  r := public.contingencias_supervision(p_id => (select id1 from contingencias_supervision_test));
  if (r->>'total')::int <> 1 or r->'filas'->0->>'fecha' <> '2026-03-07'
    or r->'filas'->0->>'suspension' <> 'total' or jsonb_array_length(r->'filas'->0->'turnos') <> 1 then
    raise exception 'La vista no conserva fecha, suspensión y turnos';
  end if;
  r := public.contingencias_supervision(p_id => (select id2 from contingencias_supervision_test));
  if (r->>'total')::int <> 0 then raise exception 'La vista revela una contingencia ajena'; end if;
  begin perform public.contingencia_guardar((select id1 from contingencias_supervision_test), array['Duelo'], 'sin', array[(select turno from contingencias_supervision_test)], '', date '2026-03-07');
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'El inspector puede modificar contingencias'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select distrital::text from contingencias_supervision_test), true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.contingencias_supervision(p_id => (select id2 from contingencias_supervision_test));
  if (r->>'total')::int <> 1 then raise exception 'Distrital no ve todas las escuelas'; end if;
  r := public.contingencias_supervision(p_tipo => 'Duelo', p_suspension => 'total', p_desde => '2026-03-07', p_hasta => '2026-03-07', p_id => (select id1 from contingencias_supervision_test));
  if (r->>'total')::int <> 1 then raise exception 'Filtros válidos no encuentran el registro'; end if;
  r := public.contingencias_supervision(p_tipo => 'Falta de Agua', p_id => (select id1 from contingencias_supervision_test));
  if (r->>'total')::int <> 0 then raise exception 'El filtro de tipo es incorrecto'; end if;
  r := public.contingencias_supervision(p_hasta => '2026-03-06', p_id => (select id1 from contingencias_supervision_test));
  if (r->>'total')::int <> 0 then raise exception 'El filtro de fechas es incorrecto'; end if;
  r := public.contingencias_supervision(p_busqueda => 'Actualizada', p_id => (select id1 from contingencias_supervision_test));
  if (r->>'total')::int <> 1 then raise exception 'La búsqueda no encuentra observaciones'; end if;
end $$;
reset role;
insert into public.simulaciones(actor_id, target_id) select distrital, areal from contingencias_supervision_test;
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.contingencias_supervision(p_id => (select id1 from contingencias_supervision_test));
  if (r->>'total')::int <> 1 then raise exception 'La simulación areal no ve su escuela'; end if;
  r := public.contingencias_supervision(p_id => (select id2 from contingencias_supervision_test));
  if (r->>'total')::int <> 0 then raise exception 'La simulación areal ve una escuela ajena'; end if;
end $$;
reset role;
delete from public.simulaciones where actor_id = (select distrital from contingencias_supervision_test);
select set_config('request.jwt.claim.sub', (select otro_areal::text from contingencias_supervision_test), true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.contingencias where id in (select id1 from contingencias_supervision_test union all select id2 from contingencias_supervision_test)) then
    raise exception 'El inspector sin escuelas asignadas puede ver contingencias';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select regional::text from contingencias_supervision_test), true);
set local role authenticated;
do $$
declare rechazado boolean := false;
begin
  if exists (select 1 from public.contingencias where id in (select id1 from contingencias_supervision_test union all select id2 from contingencias_supervision_test)) then
    raise exception 'Regional no debe ver contingencias';
  end if;
  begin perform public.contingencias_supervision(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Regional puede usar la vista'; end if;
end $$;
reset role;
