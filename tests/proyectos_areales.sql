-- Ejecutar junto con la migración en una transacción revertida.
create temporary table proyectos_areales_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id limit 1) areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 1 limit 1) otro,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 2 limit 1) distrital,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 3 limit 1) escolar,
  gen_random_uuid()::text token, gen_random_uuid() id1, gen_random_uuid() id2;
grant select on proyectos_areales_test to authenticated;
do $$ begin
  if exists (select 1 from proyectos_areales_test where areal is null or otro is null or distrital is null or escolar is null) then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
update public.profiles set role = 'areal', active = true, permiso_avanzado = false where id in (select areal from proyectos_areales_test union all select otro from proyectos_areales_test);
update public.profiles set role = 'distrital', active = true, permiso_avanzado = false where id = (select distrital from proyectos_areales_test);
update public.profiles set role = 'escolar', active = true, permiso_avanzado = false where id = (select escolar from proyectos_areales_test);
insert into public.inspectores(user_id,cuil,nombre,nivel_o_modalidad)
select areal, 'test-a-' || token, 'Inspector ' || token, 'Primaria' from proyectos_areales_test
union all select otro, 'test-b-' || token, 'Inspector ' || token, 'Secundaria' from proyectos_areales_test;
insert into public.proyectos_areales(id,user_id,tipo_id,nombre,bytes,drive_file_id,created_at)
select id1, areal, (select id from public.proyectos_areales_tipos where nombre = 'Proyecto Areal'), 'zeta.pdf', 100, 'test-' || id1, '2026-01-02'::timestamptz from proyectos_areales_test
union all select id2, otro, (select id from public.proyectos_areales_tipos where nombre = 'Proyecto Areal'), 'alfa.pdf', 100, 'test-' || id2, '2026-01-01'::timestamptz from proyectos_areales_test;

select set_config('request.jwt.claim.sub', (select areal::text from proyectos_areales_test), true);
set local role authenticated;
do $$ declare r jsonb; rechazado boolean := false; begin
  if (select count(*) from public.proyectos_areales where id in (select id1 from proyectos_areales_test union all select id2 from proyectos_areales_test)) <> 1
    or exists (select 1 from public.proyectos_areales where id = (select id2 from proyectos_areales_test)) then raise exception 'Areal ve proyectos ajenos'; end if;
  if public.proyecto_areal_mi_inspector() <> 'Inspector ' || (select token from proyectos_areales_test) then raise exception 'Nombre de inspector incorrecto'; end if;
  r := public.proyectos_areales_listar((select token from proyectos_areales_test), '', 'archivo', 15, 0);
  if (r->>'total')::integer <> 1 or r->'filas'->0->>'id' <> (select id1::text from proyectos_areales_test) then raise exception 'Listado areal incorrecto'; end if;
  begin perform public.proyecto_areal_guardar_tipo(null, 'No permitido'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Areal puede crear tipos'; end if;
  rechazado := false;
  begin perform public.proyectos_areales_inspectores(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Areal puede consultar otros inspectores'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select distrital::text from proyectos_areales_test), true);
set local role authenticated;
do $$ declare r jsonb; tipo bigint; rechazado boolean := false; begin
  r := public.proyectos_areales_listar((select token from proyectos_areales_test), '', 'archivo', 1, 0);
  if (r->>'total')::integer <> 2 or r->'filas'->0->>'id' <> (select id2::text from proyectos_areales_test) then raise exception 'Orden o primera página incorrectos'; end if;
  r := public.proyectos_areales_listar((select token from proyectos_areales_test), '', 'archivo', 1, 1);
  if r->'filas'->0->>'id' <> (select id1::text from proyectos_areales_test) then raise exception 'Segunda página incorrecta'; end if;
  r := public.proyectos_areales_inspectores((select token from proyectos_areales_test), 15, 0);
  if (r->>'total')::integer <> 2 or jsonb_array_length(r->'filas') <> 2 then raise exception 'Faltan inspectores homónimos'; end if;
  r := public.proyectos_areales_listar((select token from proyectos_areales_test),
    (select tipo_id::text from public.proyectos_areales where id = (select id1 from proyectos_areales_test)), 'recientes', 15, 0);
  if (r->>'total')::integer <> 2 then raise exception 'Filtro por tipo incorrecto'; end if;
  r := public.proyectos_areales_listar('%', '', 'recientes', 15, 0);
  if (r->>'total')::integer <> 0 then raise exception 'La búsqueda no trata comodines como texto'; end if;
  perform public.proyecto_areal_guardar_tipo(null, 'Tipo ' || (select token from proyectos_areales_test));
  select id into tipo from public.proyectos_areales_tipos where nombre = 'Tipo ' || (select token from proyectos_areales_test);
  perform public.proyecto_areal_guardar_tipo(tipo, 'Renombrado ' || (select token from proyectos_areales_test));
  perform public.proyecto_areal_eliminar_tipo(tipo);
  begin perform public.proyecto_areal_eliminar_tipo((select tipo_id from public.proyectos_areales where id = (select id1 from proyectos_areales_test))); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Elimina tipo con proyectos'; end if;
  rechazado := false;
  begin perform public.proyecto_areal_guardar_tipo(null, 'Otro'); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Acepta tipo reservado'; end if;
end $$;
reset role;
delete from public.proyectos_areales where id = (select id2 from proyectos_areales_test);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.proyectos_areales_inspectores((select token from proyectos_areales_test), 15, 0);
  if not exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = (select otro::text from proyectos_areales_test) and (x->>'cantidad')::integer = 0)
    then raise exception 'No muestra inspectores sin proyectos'; end if;
end $$;
reset role;
insert into public.simulaciones(actor_id,target_id) select distrital,areal from proyectos_areales_test;
set local role authenticated;
do $$ begin
  if (public.proyectos_areales_listar((select token from proyectos_areales_test), '', 'recientes', 15, 0)->>'total')::integer <> 1 then
    raise exception 'La simulación no respeta al inspector efectivo';
  end if;
end $$;
reset role;
delete from public.simulaciones where actor_id = (select distrital from proyectos_areales_test);
select set_config('request.jwt.claim.sub', (select escolar::text from proyectos_areales_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  if exists (select 1 from public.proyectos_areales where id in (select id1 from proyectos_areales_test union all select id2 from proyectos_areales_test)) then raise exception 'Escolar ve proyectos areales'; end if;
  begin perform public.proyectos_areales_listar(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Escolar accede al listado'; end if;
end $$;
reset role;
