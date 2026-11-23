-- Ejecutar dentro de una transacción revertida.
do $$
declare
  escolar uuid := gen_random_uuid();
  distrital uuid := gen_random_uuid();
  areal uuid := gen_random_uuid();
  sesion uuid := gen_random_uuid();
begin
  perform public._crear_auth(escolar, escolar::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(distrital, distrital::text || '@example.invalid', 'clave-anterior');
  perform public._crear_auth(areal, areal::text || '@example.invalid', 'clave-anterior');
  insert into public.profiles(id, login, name, role, permiso_avanzado) values
    (escolar, escolar::text, 'Escolar prueba', 'escolar', false),
    (distrital, distrital::text, 'Distrital prueba', 'distrital', false),
    (areal, areal::text, 'Areal prueba', 'areal', false);
  insert into auth.sessions(id, user_id) values (sesion, escolar);
  if not public.ayuda_video_sesion_valida(escolar, sesion) then raise exception 'Escolar no puede reproducir'; end if;
  if public.ayuda_video_sesion_valida(areal, sesion) then raise exception 'Se aceptó una sesión ajena'; end if;
  update auth.sessions set not_after = now() - interval '1 minute' where id = sesion;
  if public.ayuda_video_sesion_valida(escolar, sesion) then raise exception 'Se aceptó una sesión vencida'; end if;
  update auth.sessions set user_id = distrital, not_after = null where id = sesion;
  if public.ayuda_video_sesion_valida(distrital, sesion) then raise exception 'Distrital sin permiso tiene acceso'; end if;
  update public.profiles set permiso_avanzado = true where id = distrital;
  if not public.ayuda_video_sesion_valida(distrital, sesion) then raise exception 'Distrital avanzado no tiene acceso'; end if;
  insert into public.simulaciones(actor_id, target_id) values (distrital, escolar);
  if not public.ayuda_video_sesion_valida(distrital, sesion) then raise exception 'La simulación escolar no tiene acceso'; end if;
  update public.simulaciones set target_id = areal where actor_id = distrital;
  if public.ayuda_video_sesion_valida(distrital, sesion) then raise exception 'La simulación areal tiene acceso'; end if;
  delete from public.simulaciones where actor_id = distrital;
  update public.profiles set active = false where id = distrital;
  if public.ayuda_video_sesion_valida(distrital, sesion) then raise exception 'Usuario inactivo tiene acceso'; end if;
  delete from auth.sessions where id = sesion;
  if public.ayuda_video_sesion_valida(escolar, sesion) then raise exception 'Se aceptó una sesión cerrada'; end if;
end $$;
