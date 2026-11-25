-- Ejecutar después de las migraciones 0091 a 0093 dentro de una transacción revertida.
create temp table eoe_lectura_test as select
  'tsta' || substr(gen_random_uuid()::text, 1, 8) as cue_a, 'tstb' || substr(gen_random_uuid()::text, 1, 8) as cue_b,
  -9223372036854775101::bigint as esc_a, -9223372036854775102::bigint as esc_b, null::uuid as uid;
grant select on eoe_lectura_test to authenticated;

do $$
declare t record; cargo bigint := (select id from public.catalogos limit 1); estado bigint := (select id from public.salida_estados limit 1); cuenta uuid;
begin
  select * into t from eoe_lectura_test;
  insert into public.escuelas(id, cue, nombre) values (t.esc_a, t.cue_a, 'Escuela A'), (t.esc_b, t.cue_b, 'Escuela B');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre) values (t.esc_a, cargo, 'Integrante A'), (t.esc_b, cargo, 'Integrante B');
  insert into public.equipo_directivo(escuela_id, cargo_id, apellido_nombre) values (t.esc_a, cargo, 'Directivo A'), (t.esc_b, cargo, 'Directivo B');
  insert into public.plantas(escuela_id, total_secciones) values (t.esc_a, 1), (t.esc_b, 1);
  select id into cuenta from public.profiles where login = 'eoe' || t.cue_a;
  if not (select active from public.profiles where id = cuenta) then raise exception 'La cuenta eoe debe estar activa con la ficha cargada'; end if;
  insert into public.salidas(user_id, cue, escuela, titulo, fecha, destino, estado_id) values
    (cuenta, t.cue_a, 'Escuela A', 'Salida A', current_date, 'Museo', estado), (cuenta, t.cue_b, 'Escuela B', 'Salida B', current_date, 'Museo', estado);
  update eoe_lectura_test set uid = cuenta;
end $$;

set local role authenticated;
do $$
declare t record; n int; bloqueado boolean;
begin
  select * into t from eoe_lectura_test;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.uid::text, true);
  if (select count(*) from public.escuelas where id in (t.esc_a, t.esc_b)) <> 1 or not exists (select 1 from public.escuelas where id = t.esc_a) then raise exception 'Solo debe ver su escuela'; end if;
  if (select count(*) from public.plantas where escuela_id in (t.esc_a, t.esc_b)) <> 1 then raise exception 'Solo debe ver su planta'; end if;
  if (select count(*) from public.equipo_directivo where escuela_id in (t.esc_a, t.esc_b)) <> 1 then raise exception 'Solo debe ver su equipo directivo'; end if;
  if (select count(*) from public.salidas where cue in (t.cue_a, t.cue_b)) <> 1 then raise exception 'Solo debe ver las salidas de su escuela'; end if;

  -- Edita únicamente su equipo de orientación
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre) values (t.esc_a, (select id from public.catalogos limit 1), 'Nuevo integrante');
  update public.equipo_orientacion set apellido_nombre = 'Editado' where escuela_id = t.esc_a and apellido_nombre = 'Nuevo integrante';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Debe poder editar su equipo de orientación'; end if;
  update public.equipo_orientacion set apellido_nombre = 'Ajeno' where escuela_id = t.esc_b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'No debe editar el equipo de otra escuela'; end if;
  bloqueado := false;
  begin insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre) values (t.esc_b, (select id from public.catalogos limit 1), 'X'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe agregar integrantes a otra escuela'; end if;

  -- Todo lo demás es de solo lectura
  update public.escuelas set nombre = 'Cambiada' where id = t.esc_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'No debe editar la ficha de la escuela'; end if;
  update public.equipo_directivo set apellido_nombre = 'Cambiado' where escuela_id = t.esc_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'No debe editar el equipo directivo'; end if;
  update public.plantas set total_secciones = 9 where escuela_id = t.esc_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'No debe editar la planta'; end if;
  bloqueado := false;
  begin insert into public.referentes_esi(escuela_id, apellido_nombre) values (t.esc_a, 'X'); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe agregar referentes ESI'; end if;
  if public.salida_editable((select id from public.salidas where cue = t.cue_a)) then raise exception 'No debe poder editar salidas'; end if;
end $$;
