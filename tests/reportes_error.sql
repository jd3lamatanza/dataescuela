-- Ejecutar junto con la migración dentro de una transacción revertida.
create temporary table reportes_error_test as
select array_agg(id order by id) usuarios, gen_random_uuid() lote
from (select p.id from public.profiles p where not exists (
  select 1 from public.simulaciones s where s.actor_id = p.id or s.target_id = p.id
) order by p.id limit 6) p;
grant select on reportes_error_test to authenticated;
do $$ begin
  if array_length((select usuarios from reportes_error_test), 1) <> 6 then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
update public.profiles set permiso_avanzado = false where id in (select unnest(usuarios) from reportes_error_test);
update public.profiles set role = 'escolar', active = true where id = (select usuarios[1] from reportes_error_test);
update public.profiles set role = 'areal', active = true where id = (select usuarios[2] from reportes_error_test);
update public.profiles set role = 'distrital', active = true, permiso_avanzado = true where id = (select usuarios[3] from reportes_error_test);
update public.profiles set role = 'distrital', active = true where id = (select usuarios[4] from reportes_error_test);
update public.profiles set role = 'admin', active = true where id = (select usuarios[5] from reportes_error_test);
update public.profiles set role = 'regional', active = true where id = (select usuarios[6] from reportes_error_test);

do $$ declare u uuid; n integer := 0; id uuid; begin
  foreach u in array (select usuarios from reportes_error_test) loop
    n := n + 1; id := gen_random_uuid();
    perform public.reporte_error_registrar(id, u, u, 'Módulo ' || (select lote from reportes_error_test),
      'https://app.example/#/prueba', 'Descripción ficticia ' || n, 'test_' || replace(id::text, '-', ''), 'image/png', 8);
  end loop;
  if (select count(*) from public.reportes_error where modulo = 'Módulo ' || (select lote from reportes_error_test)) <> 6 then raise exception 'No se registraron los seis roles'; end if;
  if (select count(*) from public.reportes_error r join public.messages m on m.id = r.mensaje_legacy_id
      where r.modulo = 'Módulo ' || (select lote from reportes_error_test) and m.body like '%Mensaje automático%') <> 2 then
    raise exception 'Faltan confirmaciones en mensajes tradicionales';
  end if;
  if exists (select 1 from public.reportes_error r join public.push_cola c on c.origen = 'mensaje' and c.evento_id = r.mensaje_legacy_id
    where r.modulo = 'Módulo ' || (select lote from reportes_error_test) and c.titulo <> 'Nuevo mensaje de Jefatura Distrital 3') then
    raise exception 'La confirmación push no identifica al emisor automático';
  end if;
  if (select count(*) from public.correo_mensajes m where m.autor_nombre = 'Jefatura Distrital 3 · Mensaje automático'
      and m.cuerpo like '%' || (select lote::text from reportes_error_test) || '%') <> 4 then raise exception 'Faltan confirmaciones en correo'; end if;
  if not exists (select 1 from public.notifications n where n.user_id = (select usuarios[3] from reportes_error_test)
    and n.body like '%' || (select lote::text from reportes_error_test) || '%') then raise exception 'Falta notificación a usuario autorizado'; end if;
  if exists (select 1 from public.notifications n where n.user_id = (select usuarios[4] from reportes_error_test)
    and n.body like '%' || (select lote::text from reportes_error_test) || '%') then raise exception 'Notificación dirigida a usuario sin permiso'; end if;
end $$;

insert into public.simulaciones(actor_id, target_id) select usuarios[3], usuarios[1] from reportes_error_test;
do $$ declare v_id uuid := gen_random_uuid(); rechazado boolean := false; begin
  perform public.reporte_error_registrar(v_id, (select usuarios[3] from reportes_error_test), (select usuarios[1] from reportes_error_test),
    'Simulación', 'https://app.example/#/', 'Prueba simulada', 'test_' || replace(v_id::text, '-', ''), 'image/png', 8);
  if not exists (select 1 from public.reportes_error r where r.id = v_id
    and r.actor_id = (select usuarios[3] from reportes_error_test) and r.user_id = (select usuarios[1] from reportes_error_test)) then
    raise exception 'No conserva actor y usuario efectivo';
  end if;
  begin
    perform public.reporte_error_registrar(gen_random_uuid(), (select usuarios[3] from reportes_error_test),
      (select usuarios[2] from reportes_error_test), 'Falso', 'https://app.example/#/', 'Prueba', 'archivo_ficticio', 'image/png', 8);
  exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Acepta una identidad simulada no autorizada'; end if;
end $$;
delete from public.simulaciones where actor_id = (select usuarios[3] from reportes_error_test);

select set_config('request.jwt.claim.sub', (select usuarios[3]::text from reportes_error_test), true);
set local role authenticated;
do $$ declare r jsonb; v_id uuid; begin
  r := public.reportes_error_listar((select lote::text from reportes_error_test), 'recientes', 2, 0);
  if (r->>'total')::integer <> 6 or jsonb_array_length(r->'filas') <> 2 then raise exception 'Listado o paginación incorrecta'; end if;
  v_id := (r->'filas'->0->>'id')::uuid;
  perform public.reporte_error_actualizar(v_id, 'en_revision', 'Probando');
  if not exists (select 1 from public.reportes_error where reportes_error.id = v_id and estado = 'en_revision' and observaciones = 'Probando'
    and descripcion like 'Descripción ficticia %') then raise exception 'Seguimiento incorrecto'; end if;
  if (public.reportes_error_listar('%', 'recientes', 15, 0)->>'total')::integer <> 0 then raise exception 'La búsqueda no escapa comodines'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select usuarios[4]::text from reportes_error_test), true);
set local role authenticated;
do $$ declare rechazado boolean := false; begin
  if exists (select 1 from public.reportes_error where modulo = 'Módulo ' || (select lote from reportes_error_test)) then raise exception 'Usuario sin permiso ve reportes'; end if;
  begin perform public.reportes_error_listar(); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Usuario sin permiso accede al listado'; end if;
  rechazado := false;
  begin perform public.reporte_error_actualizar(gen_random_uuid(), 'resuelto', ''); exception when raise_exception then rechazado := true; end;
  if not rechazado then raise exception 'Usuario sin permiso modifica reportes'; end if;
  if has_function_privilege('authenticated', 'public.reporte_error_registrar(uuid,uuid,uuid,text,text,text,text,text,integer)', 'execute') then
    raise exception 'Un cliente puede registrar archivos sin validación';
  end if;
end $$;
reset role;
