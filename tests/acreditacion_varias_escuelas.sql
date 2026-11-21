-- Ejecutar dentro de una transacción revertida.
do $$
declare
  evento uuid; escuela1 bigint; escuela2 bigint; distrital uuid; escolar uuid;
  persona bigint; resultado text; bloqueado boolean; escuelas jsonb;
begin
  select id into escuela1 from public.escuelas order by id limit 1;
  select id into escuela2 from public.escuelas where id <> escuela1 order by id limit 1;
  select id into distrital from public.profiles where role = 'distrital' and active limit 1;
  select id into escolar from public.profiles where role = 'escolar' and active limit 1;
  if escuela1 is null or escuela2 is null or distrital is null or escolar is null then raise exception 'Faltan datos de prueba'; end if;
  insert into public.acreditacion_eventos(nombre,lugar,fecha,hora_inicio,hora_fin,descripcion,estado)
    values ('Evento ficticio','Lugar ficticio','2099-01-01','10:00','11:00','Prueba','activo') returning id into evento;
  escuelas := jsonb_build_array(
    jsonb_build_object('escuela_id',escuela1,'escuela_externa',null,'cargo','Directora'),
    jsonb_build_object('escuela_id',null,'escuela_externa','Escuela externa','cargo','Docente'),
    jsonb_build_object('escuela_id',escuela2,'escuela_externa',null,'cargo','Secretaria'),
    jsonb_build_object('escuela_id',null,'escuela_externa','Otra externa','cargo','Preceptora'));
  perform set_config('request.jwt.claim.role', 'service_role', true);
  resultado := public.acreditacion_registrar_multi(evento,'Persona ficticia','99999888',escuelas,'ejemplo@abc.gob.ar',true);
  if resultado <> 'ok' then raise exception 'No se registraron cuatro escuelas: %', resultado; end if;
  select id into persona from public.acreditacion_personas where evento_id = evento and dni = '99999888';
  if not exists (select 1 from public.acreditacion_personas where id = persona and escuela_id = escuela1 and cargo = 'Directora'
    and cargos_busqueda = 'Directora Docente Secretaria Preceptora')
    or (select count(*) from public.acreditacion_escuelas_adicionales where persona_id = persona) <> 3
    or not exists (select 1 from public.acreditacion_escuelas_adicionales where persona_id = persona and orden = 2 and escuela_externa = 'Escuela externa' and cargo = 'Docente')
    or not exists (select 1 from public.acreditacion_escuelas_adicionales where persona_id = persona and orden = 3 and escuela_id = escuela2 and cargo = 'Secretaria')
    or not exists (select 1 from public.acreditacion_escuelas_adicionales where persona_id = persona and orden = 4 and escuela_externa = 'Otra externa' and cargo = 'Preceptora') then
    raise exception 'Se perdieron asociaciones entre escuela y cargo';
  end if;
  if public.acreditacion_registrar_multi(evento,'Persona ficticia','99999888',escuelas,'ejemplo@abc.gob.ar',true) <> 'duplicado' then
    raise exception 'Se aceptó el DNI duplicado';
  end if;
  resultado := public.acreditacion_registrar_multi(evento,'Persona externa','99999894',jsonb_build_array(escuelas->1,escuelas->0),'ejemplo@abc.gob.ar',true);
  if resultado <> 'ok' or not exists (select 1 from public.acreditacion_personas where evento_id = evento and dni = '99999894'
    and escuela_externa = 'Escuela externa' and cargo = 'Docente' and cargos_busqueda = 'Docente Directora') then
    raise exception 'No se conservó la escuela externa como primera opción';
  end if;
  if public.acreditacion_registrar_multi(evento,'Persona ficticia','99999889','[]','ejemplo@abc.gob.ar',true) <> 'invalido'
    or public.acreditacion_registrar_multi(evento,'Persona ficticia','99999889',escuelas || jsonb_build_array(escuelas->0),'ejemplo@abc.gob.ar',true) <> 'invalido'
    or public.acreditacion_registrar_multi(evento,'Persona ficticia','99999889',jsonb_build_array(escuelas->0,jsonb_build_object('escuela_id',escuela2,'escuela_externa',null,'cargo',' ')),'ejemplo@abc.gob.ar',true) <> 'invalido'
    or public.acreditacion_registrar_multi(evento,'Persona ficticia','99999889',jsonb_build_array(jsonb_build_object('escuela_id',999999999,'escuela_externa',null,'cargo','Docente')),'ejemplo@abc.gob.ar',true) <> 'invalido'
    or exists (select 1 from public.acreditacion_personas where evento_id = evento and dni = '99999889') then
    raise exception 'Se aceptó una lista inválida o se guardó parcialmente';
  end if;
  update public.acreditacion_eventos set estado = 'finalizado' where id = evento;
  if public.acreditacion_registrar_multi(evento,'Persona ficticia','99999889',escuelas,'ejemplo@abc.gob.ar',true) <> 'cerrado' then
    raise exception 'Se permitió registro público en un evento cerrado';
  end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', distrital::text, true);
  resultado := public.acreditacion_registrar_multi(evento,'Persona manual','99999890',jsonb_build_array(escuelas->0,escuelas->2),'ejemplo@abc.gob.ar',false);
  if resultado <> 'ok' then raise exception 'Registro manual de dos escuelas falló: %', resultado; end if;
  if public.acreditacion_registrar_multi(evento,'Persona manual','99999891',jsonb_build_array(escuelas->1),'ejemplo@abc.gob.ar',false) <> 'invalido' then
    raise exception 'Se habilitó escuela externa en la carga manual';
  end if;
  resultado := public.acreditacion_registrar(evento,'Persona anterior','99999892','Docente',escuela1,'ejemplo@abc.gob.ar',false);
  if resultado <> 'ok' or not exists (select 1 from public.acreditacion_personas where evento_id = evento and dni = '99999892' and cargos_busqueda = 'Docente') then
    raise exception 'El registro anterior dejó de funcionar';
  end if;
  perform set_config('request.jwt.claim.sub', escolar::text, true);
  bloqueado := false;
  begin perform public.acreditacion_registrar_multi(evento,'Persona ficticia','99999893',jsonb_build_array(escuelas->0),'ejemplo@abc.gob.ar',false);
  exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Escolar puede registrar manualmente'; end if;
end $$;
