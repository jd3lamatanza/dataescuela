-- Ejecutar dentro de una transacción revertida.
create temporary table supervision_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id limit 1) escolar,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 1 limit 1) areal,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 2 limit 1) distrital,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) and not exists (select 1 from public.inspectores i where i.user_id = p.id) order by id offset 3 limit 1) regional,
  gen_random_uuid()::text token, gen_random_uuid() id1, gen_random_uuid() id2, gen_random_uuid() id3, gen_random_uuid() id4;
grant select on supervision_test to authenticated;
do $$ begin
  if exists (select 1 from supervision_test where escolar is null or areal is null or distrital is null or regional is null) then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
update public.profiles set role = 'escolar', active = true, cue = 'cue1-' || (select token from supervision_test) where id = (select escolar from supervision_test);
update public.profiles set role = 'areal', active = true where id = (select areal from supervision_test);
update public.profiles set role = 'distrital', active = true where id = (select distrital from supervision_test);
update public.profiles set role = 'regional', active = true where id = (select regional from supervision_test);
insert into public.escuelas(cue, clave, nombre) select 'cue1-' || token, 'clave1-' || token, 'Escuela asignada' from supervision_test;
insert into public.escuelas(cue, clave, nombre) select 'cue2-' || token, 'clave2-' || token, 'Escuela ajena' from supervision_test;
-- Una clave asignada distinta no debe abrir proyectos asociados a otra carpeta con el mismo CUE.
insert into public.escuelas(cue, clave, nombre) select 'cue2-' || token, 'clave3-' || token, 'Otra escuela' from supervision_test;
insert into public.proyecto_carpetas(cue, clave, drive_folder_id)
select 'cue1-' || token, 'clave1-' || token, 'folder1' from supervision_test
union all select 'cue2-' || token, 'clave2-' || token, 'folder2' from supervision_test;
insert into public.inspectores(user_id,cuil,nombre,escuelas_asignadas)
select areal, 'test-' || token, 'Inspector ficticio', array['clave1-' || token, 'clave3-' || token] from supervision_test;
insert into public.proyectos_escolares(id,cue,tipo,nombre,bytes,drive_file_id,created_at)
select id1, 'cue1-' || token, 'Proyecto Institucional', 'zeta.pdf', 100, 'test-' || id1, '2026-01-02'::timestamptz from supervision_test
union all select id2, 'cue2-' || token, 'Proyecto de ESI', 'ajeno.pdf', 100, 'test-' || id2, '2026-01-03'::timestamptz from supervision_test
union all select id3, 'cue1-' || token, 'Proyecto de ESI', 'alfa.pdf', 100, 'test-' || id3, '2026-01-01'::timestamptz from supervision_test
union all select id4, 'cue3-' || token, 'Proyecto de ESI', 'sin-carpeta.pdf', 100, 'test-' || id4, '2025-01-01'::timestamptz from supervision_test;

select set_config('request.jwt.claim.sub', (select areal::text from supervision_test), true);
set local role authenticated;
do $$ declare r jsonb; rechazado boolean := false; begin
  if (select count(*) from public.proyectos_escolares where id in (select id1 from supervision_test union all select id2 from supervision_test union all select id3 from supervision_test)) <> 2
    or exists (select 1 from public.proyectos_escolares where id in (select id2 from supervision_test union all select id4 from supervision_test)) then
    raise exception 'Areal ve una carpeta de otra clave o no ve la asignada';
  end if;
  r := public.proyectos_supervision((select token from supervision_test), '', 'archivo', 1, 0);
  if (r->>'total')::integer <> 2 or r->'filas'->0->>'id' <> (select id3::text from supervision_test) then raise exception 'Búsqueda, orden o primera página incorrecta'; end if;
  r := public.proyectos_supervision((select token from supervision_test), '', 'archivo', 1, 1);
  if r->'filas'->0->>'id' <> (select id1::text from supervision_test) then raise exception 'Segunda página incorrecta'; end if;
  r := public.proyectos_supervision((select token from supervision_test), 'Proyecto de ESI', 'recientes', 15, 0);
  if (r->>'total')::integer <> 1 or r->'filas'->0->>'id' <> (select id3::text from supervision_test) then raise exception 'Filtro por tipo incorrecto'; end if;
  r := public.proyectos_supervision('%', '', 'recientes', 15, 0);
  if (r->>'total')::integer <> 0 then raise exception 'La búsqueda no trata los comodines como texto'; end if;
  begin perform public.proyectos_supervision('', '', 'invalid', 15, 0); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Acepta orden inválido'; end if;
  rechazado := false;
  begin delete from public.proyectos_escolares where id = (select id1 from supervision_test); exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Areal puede eliminar proyectos'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select distrital::text from supervision_test), true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.proyectos_supervision((select token from supervision_test), '', 'recientes', 15, 0);
  if (r->>'total')::integer <> 4 or r->'filas'->0->>'id' <> (select id2::text from supervision_test) then raise exception 'Distrital no ve todas las escuelas o no ordena por fecha'; end if;
end $$;
reset role;
insert into public.simulaciones(actor_id,target_id) select distrital,areal from supervision_test;
set local role authenticated;
do $$ begin
  if (public.proyectos_supervision((select token from supervision_test), '', 'recientes', 15, 0)->>'total')::integer <> 2 then
    raise exception 'La simulación no respeta las asignaciones del inspector';
  end if;
end $$;
reset role;
delete from public.simulaciones where actor_id = (select distrital from supervision_test);
select set_config('request.jwt.claim.sub', (select escolar::text from supervision_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  if exists (select 1 from public.proyectos_escolares where id = (select id2 from supervision_test)) then raise exception 'Escuela ve proyectos ajenos'; end if;
  begin perform public.proyectos_supervision(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Escuela accede a consulta de supervisión'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select regional::text from supervision_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  if exists (select 1 from public.proyectos_escolares where id in (select id1 from supervision_test union all select id2 from supervision_test)) then raise exception 'Regional ve proyectos'; end if;
  begin perform public.proyectos_supervision(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Regional accede a consulta de supervisión'; end if;
end $$;
reset role;
