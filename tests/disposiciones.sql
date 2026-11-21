-- Ejecutar dentro de una transacción revertida.
create temporary table disposiciones_test_ids as
  select (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1) actor,
         (select id from public.escuelas where clave is not null limit 1) escuela;
grant select on disposiciones_test_ids to authenticated;
do $$ begin
  if exists (select 1 from disposiciones_test_ids where actor is null or escuela is null) then raise exception 'Faltan datos de prueba'; end if;
end $$;
update public.profiles set role = 'distrital', active = true, permiso_avanzado = false where id = (select actor from disposiciones_test_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select actor::text from disposiciones_test_ids), true);
do $$
declare nuevo bigint; escuela bigint; nombre_clave text; rechazado boolean;
begin
  select t.escuela into escuela from disposiciones_test_ids t;
  select e.clave into nombre_clave from public.escuelas e where id = escuela;
  insert into public.disposiciones(inspector,email_jefatura,docente_nombre,docente_cuil,docente_email,
    escuela_cubrir_id,escuela_cubrir_clave,escuela_cubrir_nombre,cargo_cubrir,revista_cubrir,tipo,motivo,
    fecha_designacion,numero_designacion,escuela_base_id,escuela_base_clave,escuela_base_nombre,cargo_base,revista_base,fecha_desde,usuario)
  values ('Inspector Prueba','jefatura@abc.gob.ar','Docente Prueba','20123456789','docente@abc.gob.ar',
    escuela,'falsa','falsa','Director','Titular','Asignación AP','Acto Público',
    '2026-01-01','123',escuela,'falsa','falsa','Docente','Titular','2026-01-01','falso')
  returning id into nuevo;
  if not exists (select 1 from public.disposiciones where id = nuevo and estado = 'En proceso' and escuela_cubrir_clave = nombre_clave and escuela_base_clave = nombre_clave) then
    raise exception 'No se vinculó la disposición a las escuelas';
  end if;
  update public.disposiciones set estado = 'Finalizada' where id = nuevo;
  if not exists (select 1 from public.disposiciones where id = nuevo and estado = 'Finalizada') then raise exception 'No se actualizó el estado'; end if;
  rechazado := false;
  begin update public.disposiciones set escuela_base_id = null where id = nuevo;
  exception when raise_exception then if sqlerrm <> 'Seleccioná una escuela base' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Se aceptó una escuela base vacía'; end if;
  rechazado := false;
  begin update public.disposiciones set docente_email = 'externo@example.com' where id = nuevo;
  exception when raise_exception then if sqlerrm <> 'Completá los datos obligatorios con valores válidos' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Se aceptó un correo inválido'; end if;
  rechazado := false;
  begin insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id) values (nuevo,'a','application/pdf',1,'prueba');
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Un usuario puede insertar archivos sin verificación de Drive'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare nuevo bigint; rechazado boolean := false;
begin
  select id into nuevo from public.disposiciones where docente_nombre = 'Docente Prueba';
  insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id)
  select nuevo,'prueba','application/pdf',1,'prueba-' || n from generate_series(1,3) n;
  begin insert into public.disposicion_archivos(disposicion_id,nombre,mime,bytes,drive_file_id)
    values (nuevo,'prueba','application/pdf',1,'prueba-4');
  exception when raise_exception then if sqlerrm <> 'Solo se permiten hasta 3 archivos de probanza' then raise; end if; rechazado := true; end;
  if not rechazado then raise exception 'Se aceptó un cuarto archivo'; end if;
  update public.disposiciones set escuela_base_id = null, escuela_base_clave = 'prueba', escuela_base_nombre = 'histórica' where id = nuevo;
end $$;
select set_config('request.jwt.claim.sub', (select actor::text from disposiciones_test_ids), true);
set local role authenticated;
do $$ begin
  update public.disposiciones set observaciones = 'Actualizada', escuela_base_clave = '', escuela_base_nombre = '' where docente_nombre = 'Docente Prueba';
  if not exists (select 1 from public.disposiciones where docente_nombre = 'Docente Prueba' and escuela_base_id is null and escuela_base_clave = 'prueba' and escuela_base_nombre = 'histórica') then
    raise exception 'No se conservó la escuela histórica';
  end if;
end $$;
reset role;
update public.profiles set role = 'areal' where id = (select actor from disposiciones_test_ids);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.disposiciones) or exists (select 1 from public.disposicion_motivos) then
    raise exception 'Areal tiene acceso a disposiciones';
  end if;
end $$;
reset role;
