-- Ejecutar después de las migraciones 0096 a 0101, dentro de una transacción revertida.
create temp table eoe_familia_test (
  escuela_a bigint, escuela_b bigint, cuenta_a uuid, cuenta_b uuid,
  integrante_a bigint, sesion_a uuid, sesion_b uuid,
  primero uuid, segundo uuid, tercero uuid, cuarto uuid, ajeno uuid, token text, vence timestamptz
);
grant select, update on eoe_familia_test to authenticated;

do $$
declare
  escuela_a bigint := -9223372036854775301; escuela_b bigint := -9223372036854775302;
  cue_a text := 'fama' || substr(gen_random_uuid()::text, 1, 8);
  cue_b text := 'famb' || substr(gen_random_uuid()::text, 1, 8);
  cargo bigint := (select id from public.catalogos limit 1);
  miembro bigint; cuenta_a uuid; cuenta_b uuid;
  sesion_a uuid := gen_random_uuid(); sesion_b uuid := gen_random_uuid();
begin
  insert into public.escuelas(id, cue, nombre) values (escuela_a, cue_a, 'Familia A'), (escuela_b, cue_b, 'Familia B');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_a, cargo, 'Integrante Familia') returning id into miembro;
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values (escuela_b, cargo, 'Integrante Otra Escuela');
  select id into cuenta_a from public.profiles where login = 'eoe' || cue_a;
  select id into cuenta_b from public.profiles where login = 'eoe' || cue_b;
  insert into auth.sessions(id, user_id) values (sesion_a, cuenta_a), (sesion_b, cuenta_b);
  insert into eoe_familia_test(escuela_a, escuela_b, cuenta_a, cuenta_b, integrante_a, sesion_a, sesion_b)
    values (escuela_a, escuela_b, cuenta_a, cuenta_b, miembro, sesion_a, sesion_b);
end $$;
set local role authenticated;
do $$
declare t record; r jsonb; token_a text; token_b text; bloqueado boolean; detalle jsonb;
begin
  select * into t from eoe_familia_test;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  if has_table_privilege('authenticated', 'public.eoe_legajo_grupo_familiar', 'select') then raise exception 'La tabla familiar no debe ser pública'; end if;
  perform public.eoe_pin_guardar(t.integrante_a, '123456');
  update eoe_familia_test set primero = public.eoe_legajo_crear('Primer estudiante', null),
    segundo = public.eoe_legajo_crear('Segundo estudiante', null),
    tercero = public.eoe_legajo_crear('Tercer estudiante', null),
    cuarto = public.eoe_legajo_crear('Cuarto estudiante', null);
  select * into t from eoe_familia_test;
  r := public.eoe_legajo_abrir(t.primero, t.integrante_a, '123456');
  token_a := r->>'token';
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_listar(t.primero, 'incorrecto'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'La lista familiar requiere acceso válido'; end if;
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_abrir(t.primero, token_a, t.segundo); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe abrir un legajo no asociado'; end if;
  perform public.eoe_grupo_familiar_asociar(t.primero, token_a, t.segundo);
  if (select count(*) from public.eoe_grupo_familiar_listar(t.primero, token_a) where vinculado) <> 1 then raise exception 'Falta el familiar asociado'; end if;
  r := public.eoe_legajo_abrir(t.tercero, t.integrante_a, '123456');
  perform public.eoe_grupo_familiar_asociar(t.tercero, r->>'token', t.cuarto);
  perform public.eoe_legajo_cerrar(r->>'token');
  if not exists (select 1 from public.eoe_grupo_familiar_listar(t.primero, token_a) where id = t.tercero and otro_grupo) then raise exception 'No se detectó el otro grupo'; end if;
  perform public.eoe_grupo_familiar_asociar(t.primero, token_a, t.tercero);
  if (select count(*) from public.eoe_grupo_familiar_listar(t.primero, token_a) where vinculado) <> 3 then raise exception 'No se unieron los grupos completos'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_abrir(t.primero, token_a, t.segundo); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Otra sesión no debe navegar con el token'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  r := public.eoe_grupo_familiar_abrir(t.primero, token_a, t.segundo);
  token_b := r->>'token';
  if token_b is null or r->'legajo'->>'id' <> t.segundo::text then raise exception 'No se abrió el familiar'; end if;
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(t.primero, token_a); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'El token anterior debe quedar revocado'; end if;
  detalle := public.eoe_legajo_detalle(t.segundo, token_b);
  if not exists (select 1 from jsonb_array_elements(detalle->'auditoria') a where a->>'accion' = 'apertura' and a->>'integrante_nombre' = 'Integrante Familia') then raise exception 'No se auditó la apertura del familiar'; end if;
  perform public.eoe_grupo_familiar_desvincular(t.segundo, token_b, t.cuarto);
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_abrir(t.segundo, token_b, t.cuarto); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe abrir un legajo desvinculado'; end if;
  perform public.eoe_legajo_cerrar(token_b);
  bloqueado := false;
  begin perform public.eoe_legajo_detalle(t.segundo, token_b); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Cerrar debe revocar el token'; end if;
  r := public.eoe_legajo_abrir(t.primero, t.integrante_a, '123456');
  update eoe_familia_test set token = r->>'token';
  perform set_config('request.jwt.claim.sub', t.cuenta_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_b, 'session_id', t.sesion_b, 'role', 'authenticated')::text, true);
  update eoe_familia_test set ajeno = public.eoe_legajo_crear('Estudiante de otra escuela', null);
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_listar(t.primero, r->>'token'); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Otra escuela no debe consultar el grupo'; end if;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  select * into t from eoe_familia_test;
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_asociar(t.primero, t.token, t.ajeno); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe asociarse un legajo de otra escuela'; end if;
end $$;

reset role;
do $$
declare t record; vencimiento timestamptz;
begin
  select * into t from eoe_familia_test;
  select vence_en into vencimiento from public.eoe_legajo_accesos where token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
  update public.eoe_legajos set escuela_id = t.escuela_b where id = t.segundo;
  if exists (select 1 from public.eoe_legajo_grupo_familiar where legajo_id = t.segundo) then raise exception 'La transferencia debe desvincular el legajo'; end if;
  if vencimiento is null then raise exception 'No existe el acceso de prueba'; end if;
end $$;
set local role authenticated;
do $$
declare t record; bloqueado boolean;
begin
  select * into t from eoe_familia_test;
  perform set_config('request.jwt.claim.sub', t.cuenta_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.cuenta_a, 'session_id', t.sesion_a, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.eoe_grupo_familiar_listar(t.primero, t.token) where id = t.segundo) then raise exception 'No debe mostrarse un familiar transferido'; end if;
  bloqueado := false;
  begin perform public.eoe_grupo_familiar_abrir(t.primero, t.token, t.segundo); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No debe abrirse un familiar transferido'; end if;
end $$;

reset role;
do $$
declare t record; limite timestamptz := now() + interval '1 minute';
begin
  select * into t from eoe_familia_test;
  update public.eoe_legajo_accesos set vence_en = limite where token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
  update eoe_familia_test set vence = limite;
end $$;
set local role authenticated;
do $$
declare t record; r jsonb;
begin
  select * into t from eoe_familia_test;
  r := public.eoe_grupo_familiar_abrir(t.primero, t.token, t.tercero);
  if r->>'token' is null then raise exception 'No se navegó al grupo antes del vencimiento'; end if;
  update eoe_familia_test set token = r->>'token';
end $$;
reset role;
do $$
declare t record;
begin
  select * into t from eoe_familia_test;
  if not exists (select 1 from public.eoe_legajo_accesos where token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex') and vence_en = t.vence) then
    raise exception 'La navegación no debe extender el vencimiento';
  end if;
  update public.eoe_legajo_accesos set vence_en = now() - interval '1 second' where token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
end $$;
set local role authenticated;
do $$
declare t record; bloqueado boolean := false;
begin
  select * into t from eoe_familia_test;
  begin perform public.eoe_grupo_familiar_abrir(t.tercero, t.token, t.primero); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'No se debe navegar con un acceso vencido'; end if;
end $$;
