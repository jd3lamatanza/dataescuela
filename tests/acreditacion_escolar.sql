create temporary table acreditacion_escolar_test as
with usuarios as (
  select distinct on (p.cue) p.id, e.id as escuela
  from public.profiles p join public.escuelas e on e.cue = p.cue
  where p.role = 'escolar' and p.active order by p.cue, p.id, e.id
)
select (select id from usuarios limit 1) as escolar_a,
  (select escuela from usuarios limit 1) as escuela_a,
  (select id from usuarios offset 1 limit 1) as escolar_b,
  (select escuela from usuarios offset 1 limit 1) as escuela_b,
  (select id from public.profiles where role = 'distrital' and active limit 1) as distrital,
  null::uuid as evento;
grant select, update on acreditacion_escolar_test to authenticated, service_role;

set local role service_role;
do $$
declare t record; v_evento uuid; firma jsonb := '[{"nombre":"Firma de prueba","mime":"image/png","base64":"iVBORw0KGgo="}]'; bloqueado boolean;
begin
  select * into t from acreditacion_escolar_test;
  if t.escolar_a is null or t.escolar_b is null or t.distrital is null then raise exception 'Faltan usuarios de prueba'; end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', t.distrital::text, true);
  v_evento := public.acreditacion_guardar_evento_firmado(null, 'Evento ficticio', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', firma, t.distrital);
  update acreditacion_escolar_test set evento = v_evento;
  bloqueado := false;
  begin perform public.acreditacion_configurar_firmas(v_evento, firma, t.distrital); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se pudieron cambiar las firmas fijas'; end if;
  bloqueado := false;
  begin perform public.acreditacion_guardar_evento_firmado(null, 'Sin firma', 'Lugar ficticio', '2099-01-01', '10:00', '11:00', 'Prueba', null, t.distrital);
  exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Se creó un evento sin firmas'; end if;
  if (select count(*) from public.acreditacion_firmas_evento_datos(v_evento)) <> 1 then raise exception 'No se guardó la firma del evento'; end if;
  perform set_config('request.jwt.claim.sub', t.escolar_a::text, true);
  bloqueado := false;
  begin perform public.acreditacion_configurar_firmas(v_evento, firma, t.escolar_a); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'Una escuela puede modificar firmas'; end if;
end $$;
reset role;

insert into public.acreditacion_eventos(nombre, lugar, fecha, hora_inicio, hora_fin, descripcion, estado)
values ('Evento anterior ficticio', 'Lugar ficticio', '2099-01-02', '10:00', '11:00', 'Prueba', 'finalizado');
set local role service_role;
do $$
declare t record; anterior uuid; firma jsonb := '[{"nombre":"Firma de prueba","mime":"image/png","base64":"iVBORw0KGgo="}]';
begin
  select * into t from acreditacion_escolar_test;
  select id into anterior from public.acreditacion_eventos where nombre = 'Evento anterior ficticio' and fecha = '2099-01-02';
  perform public.acreditacion_configurar_firmas(anterior, firma, t.distrital);
  if not (select firmas_configuradas from public.acreditacion_eventos where id = anterior) then raise exception 'No se configuró el evento anterior'; end if;
end $$;
reset role;

insert into public.acreditacion_personas(evento_id, nombre, dni, cargo, escuela_id, email)
select evento, 'Alfa ficticio', '99999881', 'Directora', escuela_a, 'ejemplo@abc.gob.ar' from acreditacion_escolar_test
union all select evento, 'Beta ficticio', '99999882', 'Docente', escuela_b, 'ejemplo@abc.gob.ar' from acreditacion_escolar_test
union all select evento, 'Gamma ficticio', '99999883', 'Secretaria', escuela_b, 'ejemplo@abc.gob.ar' from acreditacion_escolar_test;
insert into public.acreditacion_escuelas_adicionales(persona_id, orden, cargo, escuela_id)
select p.id, 2, 'Preceptora', t.escuela_a from public.acreditacion_personas p cross join acreditacion_escolar_test t
where p.evento_id = t.evento and p.dni = '99999882';

set local role authenticated;
do $$
declare t record; a bigint; b bigint; c bigint; resultado jsonb; bloqueado boolean;
begin
  select * into t from acreditacion_escolar_test;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', t.distrital::text, true);
  select id into a from public.acreditacion_personas where evento_id = t.evento and dni = '99999881';
  select id into b from public.acreditacion_personas where evento_id = t.evento and dni = '99999882';
  select id into c from public.acreditacion_personas where evento_id = t.evento and dni = '99999883';
  perform set_config('request.jwt.claim.sub', t.escolar_a::text, true);
  if not public.acreditacion_escolar_puede_ver(a, t.evento) or not public.acreditacion_escolar_puede_ver(b, t.evento)
    or public.acreditacion_escolar_puede_ver(c, t.evento) then raise exception 'Aislamiento escolar incorrecto'; end if;
  resultado := public.acreditacion_escolar_listar('', t.evento, 'nombre', false, 1, 0);
  if (resultado->>'total')::integer <> 2 or resultado->'registros'->0->>'nombre' <> 'Alfa ficticio' then raise exception 'Conteo, orden o paginación incorrectos'; end if;
  resultado := public.acreditacion_escolar_listar('', t.evento, 'nombre', false, 1, 1);
  if resultado->'registros'->0->>'nombre' <> 'Beta ficticio' or resultado->'registros'->0->>'cargo' <> 'Preceptora'
    then raise exception 'Cargo de escuela adicional o segunda página incorrectos'; end if;
  resultado := public.acreditacion_escolar_listar('', t.evento, 'nombre', true, 1, 0);
  if resultado->'registros'->0->>'nombre' <> 'Beta ficticio' then raise exception 'Orden descendente incorrecto'; end if;
  resultado := public.acreditacion_escolar_listar('Preceptora', t.evento, 'fecha', true, 15, 0);
  if (resultado->>'total')::integer <> 1 then raise exception 'Búsqueda por cargo incorrecta'; end if;
  resultado := public.acreditacion_escolar_listar('Docente', t.evento, 'fecha', true, 15, 0);
  if (resultado->>'total')::integer <> 0 then raise exception 'Se filtró un cargo de otra escuela'; end if;
  if exists (select 1 from public.acreditacion_personas where evento_id = t.evento) then raise exception 'La escuela accede directamente a datos distritales'; end if;
  bloqueado := false;
  begin perform * from public.acreditacion_firmas_evento_datos(t.evento); exception when others then bloqueado := true; end;
  if not bloqueado then raise exception 'La escuela accede directamente a firmas'; end if;
  perform set_config('request.jwt.claim.sub', t.escolar_b::text, true);
  if public.acreditacion_escolar_puede_ver(a, t.evento) or not public.acreditacion_escolar_puede_ver(b, t.evento)
    or not public.acreditacion_escolar_puede_ver(c, t.evento) then raise exception 'Aislamiento para otra escuela incorrecto'; end if;
end $$;
reset role;
