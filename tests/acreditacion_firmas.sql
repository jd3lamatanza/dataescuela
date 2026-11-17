-- Ejecutar dentro de una transacción revertida.
do $$
declare firma bigint; r record; bloqueado boolean;
begin
  if has_function_privilege('authenticated', 'public.acreditacion_guardar_firma(text,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.acreditacion_eliminar_firma(bigint)', 'execute')
    or has_function_privilege('authenticated', 'public.acreditacion_firmas_datos(bigint[])', 'execute')
    or has_function_privilege('anon', 'public.acreditacion_firmas_datos(bigint[])', 'execute')
    or not has_function_privilege('service_role', 'public.acreditacion_firmas_datos(bigint[])', 'execute')
    or has_column_privilege('authenticated', 'public.acreditacion_firmas', 'contenido', 'select')
    or has_column_privilege('authenticated', 'public.acreditacion_firmas', 'drive_file_id', 'select')
    or not has_column_privilege('authenticated', 'public.acreditacion_firmas', 'nombre', 'select') then
    raise exception 'Permisos incorrectos en la biblioteca de firmas';
  end if;
  insert into public.acreditacion_firmas(nombre, mime, contenido)
    values ('Prueba', 'image/png', decode('89504e470d0a1a0a', 'hex')) returning id into firma;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  bloqueado := false;
  begin perform public.acreditacion_firmas_datos(array[firma]);
  exception when raise_exception then
    if sqlerrm <> 'Sin permiso' then raise; end if;
    bloqueado := true;
  end;
  if not bloqueado then raise exception 'Lectura de datos internos permitida'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into r from public.acreditacion_firmas_datos(array[firma]);
  if r.base64 is null or r.drive_file_id is not null then raise exception 'Firma anterior no disponible'; end if;
  update public.acreditacion_firmas set contenido = null, drive_file_id = 'archivo-prueba' where id = firma;
  select * into r from public.acreditacion_firmas_datos(array[firma]);
  if r.base64 is not null or r.drive_file_id <> 'archivo-prueba' then raise exception 'Firma de Drive no disponible'; end if;
  if exists (select 1 from public.acreditacion_firmas_datos(array[-1::bigint])) then raise exception 'La selección devuelve firmas ajenas'; end if;
end $$;