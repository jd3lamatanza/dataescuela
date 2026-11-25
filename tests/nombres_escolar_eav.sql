-- Ejecutar después de 0106 dentro de una transacción revertida.
create temporary table nombres_cuentas_test (
  escuela_a bigint, escuela_b bigint, cue_a text, cue_b text,
  escolar uuid, eav_a uuid, eoe_a uuid, eav_b uuid, eoe_b uuid
);
grant select on nombres_cuentas_test to authenticated;

do $$
declare
  escuela_a bigint := -9223372036854775401; escuela_b bigint := -9223372036854775402;
  cue_a text := 'nca' || substr(gen_random_uuid()::text, 1, 8);
  cue_b text := 'ncb' || substr(gen_random_uuid()::text, 1, 8);
  escolar uuid := gen_random_uuid(); eav_a uuid; eoe_a uuid; eav_b uuid; eoe_b uuid;
begin
  insert into public.escuelas(id, cue, clave, nombre, eav) values
    (escuela_a, cue_a, 'CLAVE B', 'Nombre institucional', 'Sí'),
    (escuela_b, cue_b, 'CLAVE C', 'Otra escuela', 'Sí');
  perform public._crear_auth(escolar, escolar::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role, cue)
    values(escolar, 'usuario-' || escolar::text, 'Nombre anterior', 'escolar', cue_a);
  select id into eav_a from public.profiles where login = 'eav' || cue_a;
  select id into eoe_a from public.profiles where login = 'eoe' || cue_a;
  select id into eav_b from public.profiles where login = 'eav' || cue_b;
  select id into eoe_b from public.profiles where login = 'eoe' || cue_b;
  insert into nombres_cuentas_test values(escuela_a, escuela_b, cue_a, cue_b, escolar, eav_a, eoe_a, eav_b, eoe_b);

  if not exists (select 1 from public.profiles where id = escolar and name = 'CLAVE B' and login = 'usuario-' || escolar::text)
     or not exists (select 1 from public.profiles where id = eav_a and name = 'EAV CLAVE B' and login = 'eav' || cue_a)
     or not exists (select 1 from public.profiles where id = eoe_a and name = 'EOE CLAVE B') then
    raise exception 'Nombre o usuario inicial incorrecto';
  end if;
  update public.profiles set name = 'Otro nombre' where id in (escolar, eav_a);
  if (select name from public.profiles where id = escolar) <> 'CLAVE B'
     or (select name from public.profiles where id = eav_a) <> 'EAV CLAVE B' then
    raise exception 'Los nombres deben seguir la clave provincial';
  end if;
  insert into public.escuelas(id, cue, clave, nombre) values(escuela_a + 1, cue_a, 'CLAVE A', 'Mismo CUE');
  if (select name from public.profiles where id = escolar) <> 'CLAVE A / CLAVE B'
     or (select name from public.profiles where id = eav_a) <> 'EAV CLAVE A / CLAVE B'
     or (select name from public.profiles where id = eoe_a) <> 'EOE CLAVE A / CLAVE B' then
    raise exception 'Faltan claves del mismo CUE';
  end if;
  update public.escuelas set clave = null where id = escuela_a;
  if (select name from public.profiles where id = escolar) <> 'CLAVE A'
     or (select name from public.profiles where id = eav_a) <> 'EAV CLAVE A' then
    raise exception 'No se actualizó el nombre al modificar una clave';
  end if;
  update public.escuelas set cue = cue_b where id = escuela_a + 1;
  if (select name from public.profiles where id = escolar) <> 'CUE ' || cue_a
     or (select name from public.profiles where id = eav_a) <> 'EAV CUE ' || cue_a
     or (select name from public.profiles where id = eav_b) <> 'EAV CLAVE A / CLAVE C'
     or (select name from public.profiles where id = eoe_b) <> 'EOE CLAVE A / CLAVE C' then
    raise exception 'No se actualizaron ambos CUE o el nombre sin clave';
  end if;
  if (select nombre from public.escuelas where id = escuela_a) <> 'Nombre institucional'
     or not exists (select 1 from public.profiles where id = escolar and login = 'usuario-' || escolar::text)
     or not exists (select 1 from public.profiles where id = eav_a and login = 'eav' || cue_a) then
    raise exception 'Se alteró el nombre institucional o el usuario';
  end if;
  update public.profiles set active = true where id in (eav_b, eoe_b);
end $$;

set local role authenticated;
do $$
declare t record; perfil jsonb;
begin
  select * into t from nombres_cuentas_test;
  perform set_config('request.jwt.claim.sub', t.escolar::text, true);
  perfil := public.mi_perfil();
  if perfil->>'name' <> 'CUE ' || t.cue_a then raise exception 'Perfil escolar incorrecto'; end if;
  perform set_config('request.jwt.claim.sub', t.eav_b::text, true);
  if not exists (select 1 from public.correo_destinos() where buzon = t.eoe_b::text and nombre = 'EOE CLAVE A / CLAVE C') then
    raise exception 'La mensajería no conserva el nombre actualizado de EOE';
  end if;
  perform set_config('request.jwt.claim.sub', t.eoe_b::text, true);
  if not exists (select 1 from public.correo_destinos() where buzon = t.escolar::text and nombre = 'CUE ' || t.cue_a)
     or not exists (select 1 from public.correo_destinos() where buzon = t.eav_b::text and nombre = 'EAV CLAVE A / CLAVE C') then
    raise exception 'Los destinatarios escolar y EAV no muestran su nombre actualizado';
  end if;
end $$;
reset role;
