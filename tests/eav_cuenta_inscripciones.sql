-- Ejecutar después de las migraciones 0091 y 0092 dentro de una transacción revertida.
do $$
declare
  cue_a text := 'tsta' || substr(gen_random_uuid()::text, 1, 8);
  cue_b text := 'tstb' || substr(gen_random_uuid()::text, 1, 8);
  esc_a bigint := -9223372036854775001; esc_b bigint := -9223372036854775002;
  uid_a uuid; uid_b uuid; pre_a bigint; pre_b bigint; rechazado boolean; msg text;
begin
  insert into public.escuelas(id, cue, nombre, eav) values (esc_a, cue_a, 'Escuela A', 'Sí'), (esc_b, cue_b, 'Escuela B', 'Sí');
  insert into public.eav_cupos(escuela_id, cupos) values (esc_a, 2), (esc_b, 5);
  select id into uid_a from public.profiles where login = 'eav' || cue_a;
  select id into uid_b from public.profiles where login = 'eav' || cue_b;
  perform set_config('test.uid_a', uid_a::text, true);
  perform set_config('test.esc_a', esc_a::text, true);
  perform set_config('test.esc_b', esc_b::text, true);
  perform set_config('request.jwt.claim.sub', uid_a::text, true);

  perform public.eav_preinscripcion_cargar('70000001', 'Alumno Uno', date '2014-05-10', 'Mujer', null, 'Otra escuela', 'Calle 123', 'Responsable Uno', 'Madre/Padre', '1155550000', 'a@example.com');
  perform public.eav_preinscripcion_cargar('70000002', 'Alumno Dos', date '2014-05-10', 'Varón', esc_b, null, 'Calle 123', 'Responsable Dos', 'Otro', '1155550000', 'b@example.com');
  if (select count(*) from public.eav_preinscripciones where dni in ('70000001', '70000002') and escuela_eav_id = esc_a) <> 2 then
    raise exception 'La carga manual debe asociar las preinscripciones a la escuela propia';
  end if;
  foreach msg in array array['duplicado', 'sin_cupo', 'invalido'] loop
    rechazado := false;
    begin
      if msg = 'duplicado' then perform public.eav_preinscripcion_cargar('70000001', 'Alumno Uno', date '2014-05-10', 'Mujer', null, 'X escuela', 'Calle 123', 'Responsable Uno', 'Madre/Padre', '1155550000', 'a@example.com');
      elsif msg = 'sin_cupo' then perform public.eav_preinscripcion_cargar('70000003', 'Alumno Tres', date '2014-05-10', 'Mujer', null, 'X escuela', 'Calle 123', 'Responsable', 'Otro', '1155550000', 'a@example.com');
      else perform public.eav_preinscripcion_cargar('1', 'Alumno', date '2014-05-10', 'Mujer', null, 'X escuela', 'Calle 123', 'Responsable', 'Otro', '1155550000', 'a@example.com');
      end if;
    exception when others then rechazado := true; end;
    if not rechazado then raise exception 'Debe rechazar el caso %', msg; end if;
  end loop;

  select id into pre_a from public.eav_preinscripciones where dni = '70000001';
  insert into public.eav_preinscripciones(temporada, escuela_eav_id, dni, nombre, nacimiento, genero, escuela_actual_otra, domicilio, responsable, vinculo, telefono, email)
  values (2099, esc_b, '70000009', 'Alumno B', date '2014-01-01', 'Mujer', 'X', 'Calle', 'Resp', 'Otro', '1155550000', 'c@example.com') returning id into pre_b;
  perform set_config('test.pre_a', pre_a::text, true);
  perform set_config('test.pre_b', pre_b::text, true);
  rechazado := false;
  begin perform public.eav_confirmar_inscripcion(pre_b, true); exception when others then rechazado := true; end;
  if not rechazado then raise exception 'No debe confirmar preinscripciones de otra escuela'; end if;
  perform public.eav_confirmar_inscripcion(pre_a, false);
  if not exists (select 1 from public.eav_preinscripciones where id = pre_a and inscrito_en is not null and legajo_completo = false and inscrito_por = uid_a) then
    raise exception 'La confirmación no quedó registrada';
  end if;
  if (select count(*) from public.eav_escuelas_opciones()) < 2 then raise exception 'Faltan opciones de escuela'; end if;

  -- El cierre de la Escuela de Verano bloquea la cuenta y la carga
  update public.escuelas set eav = 'No' where id = esc_a;
  rechazado := false;
  begin perform public.eav_preinscripcion_cargar('70000004', 'Alumno Cuatro', date '2014-05-10', 'Mujer', null, 'X', 'Calle 123', 'Responsable', 'Otro', '1155550000', 'a@example.com');
  exception when others then rechazado := true; end;
  if not rechazado then raise exception 'Una cuenta eav inactiva no debe poder cargar'; end if;
  update public.escuelas set eav = 'Sí' where id = esc_a;
end $$;

-- Lectura bajo RLS: solo las preinscripciones de la propia escuela
set local role authenticated;
do $$
begin
  if (select count(*) from public.eav_preinscripciones where escuela_eav_id = current_setting('test.esc_a')::bigint) <> 2
    or exists (select 1 from public.eav_preinscripciones where escuela_eav_id = current_setting('test.esc_b')::bigint) then
    raise exception 'El rol eav debe ver solo las preinscripciones de su escuela';
  end if;
  if has_function_privilege('authenticated', 'public.eav_preinscribir_interno(bigint, text, text, date, text, bigint, text, text, text, text, text, text)', 'execute') then
    raise exception 'La función interna no debe ser ejecutable';
  end if;
end $$;
reset role;
