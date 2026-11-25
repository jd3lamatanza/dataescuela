-- Ejecutar después de la migración 0102 dentro de una transacción revertida.
create temp table eoe_proyectos_test as select
  'proya' || substr(gen_random_uuid()::text, 1, 8) as cue_a,
  'proyb' || substr(gen_random_uuid()::text, 1, 8) as cue_b,
  -9223372036854775201::bigint as escuela_a,
  -9223372036854775202::bigint as escuela_b,
  gen_random_uuid() as proyecto_a, gen_random_uuid() as proyecto_b, null::uuid as usuario;
grant select on eoe_proyectos_test to authenticated;

do $$
declare t record; cargo bigint := (select id from public.catalogos limit 1);
begin
  select * into t from eoe_proyectos_test;
  insert into public.escuelas(id, cue, nombre) values (t.escuela_a, t.cue_a, 'Escuela A'), (t.escuela_b, t.cue_b, 'Escuela B');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (t.escuela_a, cargo, 'Integrante A'), (t.escuela_b, cargo, 'Integrante B');
  update eoe_proyectos_test set usuario = (select id from public.profiles where login = 'eoe' || t.cue_a);
  insert into public.proyectos_escolares(id, cue, tipo, nombre, bytes, drive_file_id) values
    (t.proyecto_a, t.cue_a, 'Proyecto Institucional', 'propio.pdf', 100, 'test-' || t.proyecto_a),
    (t.proyecto_b, t.cue_b, 'Proyecto Institucional', 'ajeno.pdf', 100, 'test-' || t.proyecto_b);
end $$;

set local role authenticated;
do $$
declare t record; bloqueado boolean;
begin
  select * into t from eoe_proyectos_test;
  perform set_config('request.jwt.claim.sub', t.usuario::text, true);
  if public.app_role() is distinct from 'eoe' then raise exception 'La cuenta de prueba no es EOE'; end if;
  if not exists (select 1 from public.proyectos_escolares where id = t.proyecto_a)
    or exists (select 1 from public.proyectos_escolares where id = t.proyecto_b) then
    raise exception 'El EOE debe ver solamente los proyectos de su escuela';
  end if;
  bloqueado := false;
  begin
    insert into public.proyectos_escolares(cue, tipo, nombre, bytes, drive_file_id)
      values (t.cue_a, 'Proyecto Institucional', 'nuevo.pdf', 1, 'test-nuevo');
  exception when insufficient_privilege then bloqueado := true; end;
  if not bloqueado then raise exception 'El EOE no debe poder cargar proyectos'; end if;
  bloqueado := false;
  begin delete from public.proyectos_escolares where id = t.proyecto_a;
  exception when insufficient_privilege then bloqueado := true; end;
  if not bloqueado then raise exception 'El EOE no debe poder eliminar proyectos'; end if;
  bloqueado := false;
  begin update public.proyectos_escolares set nombre = 'cambiado.pdf' where id = t.proyecto_a;
  exception when insufficient_privilege then bloqueado := true; end;
  if not bloqueado then raise exception 'El EOE no debe poder modificar proyectos'; end if;
end $$;
