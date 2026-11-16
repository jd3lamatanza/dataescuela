-- Ejecutar dentro de una transacción que se revierte, después de la migración.
create temporary table eav_pre_test as
select (select id from public.escuelas order by id limit 1) escuela,
       (select id from public.escuelas order by id offset 1 limit 1) otra,
       (select id from public.profiles where role = 'escolar' and active limit 1) escolar;
grant select on eav_pre_test to service_role, authenticated;

update public.escuelas set eav = 'Sí' where id in (select escuela from eav_pre_test);
insert into public.eav_cupos(escuela_id,cupos) select escuela, 1 from eav_pre_test
on conflict (escuela_id) do update set cupos = 1;
delete from public.eav_preinscripciones where escuela_eav_id in (select escuela from eav_pre_test);

set local role service_role;
do $$
declare t record; res text;
begin
  select * into t from eav_pre_test;
  if t.escuela is null or t.otra is null or t.escolar is null then raise exception 'Faltan datos de prueba'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  res := public.eav_preinscribir(t.escuela, '99999991', 'Ejemplo Prueba', '2018-01-01', 'Varón', t.otra, null, 'Domicilio de prueba', 'Responsable prueba', 'Madre/Padre', '011 12345678', 'prueba@example.invalid');
  if res <> 'ok' then raise exception 'Error al registrar: %', res; end if;
  res := public.eav_preinscribir(t.escuela, '99999991', 'Ejemplo Prueba', '2018-01-01', 'Varón', t.otra, null, 'Domicilio de prueba', 'Responsable prueba', 'Madre/Padre', '011 12345678', 'prueba@example.invalid');
  if res <> 'duplicado' then raise exception 'DNI duplicado no rechazado: %', res; end if;
  res := public.eav_preinscribir(t.escuela, '99999992', 'Ejemplo Prueba', '2018-01-01', 'Mujer', null, 'Otra escuela', 'Domicilio de prueba', 'Responsable prueba', 'Otro', '011 12345678', 'prueba@example.invalid');
  if res <> 'sin_cupo' then raise exception 'Cupo excedido: %', res; end if;
  res := public.eav_preinscribir(t.escuela, '123', 'Ejemplo Prueba', '2018-01-01', 'Mujer', null, 'Otra escuela', 'Domicilio de prueba', 'Responsable prueba', 'Otro', '011 12345678', 'prueba@example.invalid');
  if res <> 'invalido' then raise exception 'DNI inválido aceptado'; end if;
  res := public.eav_preinscribir(t.escuela, '99999993', 'Ejemplo Prueba', '2018-01-01', 'Mujer', null, 'Otra escuela', 'Domicilio de prueba', 'Responsable prueba', 'Otro', '--------', 'prueba@example.invalid');
  if res <> 'invalido' then raise exception 'Teléfono inválido aceptado'; end if;
end $$;
reset role;

update public.eav_cupos set cupos = 0 where escuela_id in (select escuela from eav_pre_test);
set local role service_role;
do $$
declare t record; res text;
begin
  select * into t from eav_pre_test;
  res := public.eav_preinscribir(t.escuela, '99999992', 'Ejemplo Prueba', '2018-01-01', 'Mujer', null, 'Otra escuela', 'Domicilio de prueba', 'Responsable prueba', 'Otro', '011 12345678', 'prueba@example.invalid');
  if res <> 'ok' then raise exception 'Cupo ilimitado rechazado: %', res; end if;
end $$;
reset role;

delete from public.eav_cupos where escuela_id in (select escuela from eav_pre_test);
set local role service_role;
do $$
declare t record; res text;
begin
  select * into t from eav_pre_test;
  res := public.eav_preinscribir(t.escuela, '99999993', 'Ejemplo Prueba', '2018-01-01', 'Mujer', null, 'Otra escuela', 'Domicilio prueba', 'Responsable prueba', 'Otro', '011 12345678', 'prueba@example.invalid');
  if res <> 'sin_cupo' then raise exception 'Escuela sin cupo aceptada: %', res; end if;
end $$;
reset role;

set local role authenticated;
do $$
declare t record; bloqueado boolean := false;
begin
  select * into t from eav_pre_test;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  if exists (select 1 from public.eav_preinscripciones) then raise exception 'Preinscripciones visibles al rol escolar'; end if;
  begin perform public.eav_preinscribir(t.escuela, '99999993', 'Ejemplo Prueba', '2018-01-01', 'Mujer', t.otra, null, 'Domicilio prueba', 'Responsable prueba', 'Otro', '011 12345678', 'prueba@example.invalid'); exception when insufficient_privilege then bloqueado := true; end;
  if not bloqueado then raise exception 'RPC accesible al rol escolar'; end if;
end $$;
reset role;
