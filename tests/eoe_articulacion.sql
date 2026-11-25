-- Ejecutar después de las migraciones 0091 a 0094 dentro de una transacción revertida.
create temp table eoe_art_test as select
  'tsta' || substr(gen_random_uuid()::text, 1, 8) as cue_a, 'tstb' || substr(gen_random_uuid()::text, 1, 8) as cue_b,
  -9223372036854775201::bigint as esc_a, -9223372036854775202::bigint as esc_b, null::uuid as cuenta, null::bigint as reg;
grant select on eoe_art_test to authenticated;

do $$
declare t record; cargo bigint := (select id from public.catalogos limit 1); uid uuid;
begin
  select * into t from eoe_art_test;
  insert into public.escuelas(id, cue, clave, nombre, codigo) values (t.esc_a, t.cue_a, 'TA' || t.esc_a, 'Escuela A', 'PP'), (t.esc_b, t.cue_b, 'TB' || t.esc_b, 'Escuela B', 'PP');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre) values (t.esc_a, cargo, 'Integrante A');
  select id into uid from public.profiles where login = 'eoe' || t.cue_a;
  if not (select active from public.profiles where id = uid) then raise exception 'La cuenta eoe debe estar activa'; end if;
  update eoe_art_test set cuenta = uid;
  -- Egresante de otra escuela
  insert into public.egresantes(ciclo, dni, nombre, curso, origen_cue, origen_clave, origen_codigo, created_by)
  values (public._ciclo_actual(), '70000099', 'Ajeno', '3', t.cue_b, 'TB' || t.esc_b, 'PP', uid);
end $$;

set local role authenticated;
do $$
declare t record; id1 bigint; bloqueado boolean;
begin
  select * into t from eoe_art_test;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.cuenta::text, true);
  id1 := public.egresante_guardar(null, public._ciclo_actual(), '70000001', 'Estudiante Uno', null, '3', false, false, false, null, null, null);
  if (select count(*) from public.egresantes where dni in ('70000001', '70000099')) <> 1 then raise exception 'Debe ver solo los egresantes de su escuela'; end if;
  if not exists (select 1 from public.egresantes where id = id1 and origen_cue = t.cue_a) then raise exception 'El egresante debe quedar en su escuela'; end if;
  perform public.egresante_guardar(id1, public._ciclo_actual(), '70000001', 'Estudiante Editado', null, '3', false, false, false, null, null, null);
  if not exists (select 1 from public.egresantes where id = id1 and nombre = 'Estudiante Editado') then raise exception 'Debe poder editar'; end if;
  if (select count(*) from public.dnis_ubicacion(public._ciclo_actual(), array['70000001'])) <> 1 then raise exception 'dnis_ubicacion debe responder'; end if;
  perform public.egresante_eliminar(id1);
  if exists (select 1 from public.egresantes where id = id1) then raise exception 'Debe poder eliminar'; end if;
end $$;
