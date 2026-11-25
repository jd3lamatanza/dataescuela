-- Ejecutar después de 0107 dentro de una transacción revertida.
create temporary table simulado_eav_eoe_test (
  actor uuid, sin_permiso uuid, eav uuid, eoe uuid, eav_inactiva uuid, cue text
);
grant select on simulado_eav_eoe_test to authenticated;

do $$
declare
  escuela bigint := -9223372036854775501;
  otra bigint := -9223372036854775502;
  v_cue text := 'sim' || substr(gen_random_uuid()::text, 1, 8);
  otro_cue text := 'smi' || substr(gen_random_uuid()::text, 1, 8);
  actor uuid := gen_random_uuid(); sin_permiso uuid := gen_random_uuid();
  eav uuid; eoe uuid; eav_inactiva uuid; uid uuid;
begin
  foreach uid in array array[actor, sin_permiso] loop
    perform public._crear_auth(uid, uid::text || '@example.invalid', 'clave-anterior');
  end loop;
  insert into public.profiles(id, login, name, role, active, permiso_avanzado)
  values (actor, actor::text, 'Distrital autorizado', 'distrital', true, true),
         (sin_permiso, sin_permiso::text, 'Distrital sin permiso', 'distrital', true, false);
  insert into public.escuelas(id, cue, clave, nombre, eav) values
    (escuela, v_cue, 'SIM-' || v_cue, 'Escuela de prueba', 'Sí'),
    (otra, otro_cue, 'SIM-' || otro_cue, 'Escuela inactiva', 'No');
  insert into public.equipo_orientacion(escuela_id, cargo_id, apellido_nombre)
    values(escuela, (select id from public.catalogos limit 1), 'Integrante de prueba');
  select id into eav from public.profiles where login = 'eav' || v_cue;
  select id into eoe from public.profiles where login = 'eoe' || v_cue;
  select id into eav_inactiva from public.profiles where login = 'eav' || otro_cue;
  if eav is null or eoe is null or eav_inactiva is null then raise exception 'Faltan cuentas de prueba'; end if;
  insert into simulado_eav_eoe_test values(actor, sin_permiso, eav, eoe, eav_inactiva, v_cue);
end $$;

set local role authenticated;
do $$
declare t record; rechazado boolean; perfil jsonb; objetivo uuid;
begin
  select * into t from simulado_eav_eoe_test;
  perform set_config('request.jwt.claim.sub', t.sin_permiso::text, true);
  rechazado := false;
  begin perform public.simulables_filtrar('', 'eav'); exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true;
  end;
  if not rechazado then raise exception 'Distrital sin permiso pudo listar cuentas'; end if;
  rechazado := false;
  begin perform public.simular_iniciar(t.eoe); exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true;
  end;
  if not rechazado then raise exception 'Distrital sin permiso pudo simular'; end if;

  perform set_config('request.jwt.claim.sub', t.actor::text, true);
  if not exists (select 1 from public.simulables_filtrar(t.cue, 'eav') where id = t.eav and role = 'eav')
     or not exists (select 1 from public.simulables_filtrar(t.cue, 'eoe') where id = t.eoe and role = 'eoe')
     or not exists (select 1 from public.simulables(t.cue) where id = t.eav)
     or exists (select 1 from public.simulables_filtrar(t.cue, 'eav') where id = t.eoe)
     or exists (select 1 from public.simulables_filtrar('', 'eav') where id = t.eav_inactiva) then
    raise exception 'La búsqueda o el filtro de cuentas es incorrecto';
  end if;
  rechazado := false;
  begin perform public.simulables_filtrar('', 'admin'); exception when raise_exception then
    if sqlerrm <> 'Rol inválido' then raise; end if; rechazado := true;
  end;
  if not rechazado then raise exception 'Filtro no autorizado aceptado'; end if;
  rechazado := false;
  begin perform public.simular_iniciar(t.eav_inactiva); exception when raise_exception then
    if sqlerrm <> 'Usuario no disponible para ingreso simulado' then raise; end if; rechazado := true;
  end;
  if not rechazado then raise exception 'Cuenta inactiva admitida'; end if;

  foreach objetivo in array array[t.eav, t.eoe] loop
    perform public.simular_iniciar(objetivo);
    perfil := public.mi_perfil();
    if public.eff_uid() <> objetivo or public.real_role() <> 'distrital'
       or perfil->>'id' <> objetivo::text or perfil->>'simulador' <> 'Distrital autorizado'
       or (perfil->>'must_change')::boolean then
      raise exception 'Perfil simulado incorrecto';
    end if;
    if public.mi_escuela_cuenta()->>'cue' <> t.cue then raise exception 'Escuela simulada incorrecta'; end if;
    if objetivo = t.eoe then
      rechazado := false;
      begin perform public.eoe_legajos_listar(); exception when raise_exception then
        if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true;
      end;
      if not rechazado then raise exception 'El ingreso simulado expuso los legajos'; end if;
      rechazado := false;
      begin perform public.eoe_pin_integrantes(); exception when raise_exception then
        if sqlerrm <> 'Sin permiso' then raise; end if; rechazado := true;
      end;
      if not rechazado then raise exception 'El ingreso simulado expuso los PIN'; end if;
    end if;
    perform public.simular_salir();
    if public.eff_uid() <> t.actor or public.app_role() <> 'distrital' then raise exception 'No se recuperó la cuenta distrital'; end if;
  end loop;
end $$;
reset role;

do $$
declare t record;
begin
  select * into t from simulado_eav_eoe_test;
  if (select count(*) from public.impersonaciones
      where actor_id = t.actor and target_id in (t.eav, t.eoe) and ended_at is not null) <> 2
     or exists (select 1 from public.simulaciones where actor_id = t.actor) then
    raise exception 'Las simulaciones no quedaron auditadas y cerradas';
  end if;
end $$;
