-- Ejecutar dentro de una transacción revertida.
create temporary table eav_ins_test as
select
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id)
    and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id limit 1) escolar,
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id)
    and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id offset 1 limit 1) otra_cuenta,
  (select p.id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id=p.id)
    and not exists (select 1 from public.inspectores i where i.user_id=p.id) order by p.id offset 2 limit 1) distrito,
  gen_random_uuid()::text token, null::bigint escuela, null::bigint otra;
grant select,update on eav_ins_test to authenticated, service_role;
do $$ begin
  if exists (select 1 from eav_ins_test where escolar is null or otra_cuenta is null or distrito is null)
    then raise exception 'Faltan perfiles de prueba'; end if;
end $$;
insert into public.escuelas(cue,clave,tipo,numero,nombre,eav)
select 'eav-'||token,'eav-'||token,'EP',991,'EAV de prueba','Sí' from eav_ins_test
union all select 'otra-'||token,'otra-'||token,'EP',992,'Otra EAV de prueba','Sí' from eav_ins_test;
update eav_ins_test set escuela=(select id from public.escuelas where cue='eav-'||eav_ins_test.token),
  otra=(select id from public.escuelas where cue='otra-'||eav_ins_test.token);
update public.profiles set role='escolar',active=true,permiso_avanzado=false,cue='eav-'||(select token from eav_ins_test)
where id=(select escolar from eav_ins_test);
update public.profiles set role='escolar',active=true,permiso_avanzado=false,cue='otra-'||(select token from eav_ins_test)
where id=(select otra_cuenta from eav_ins_test);
update public.profiles set role='distrital',active=true,permiso_avanzado=false where id=(select distrito from eav_ins_test);
insert into public.eav_cupos(escuela_id,cupos) select escuela,2 from eav_ins_test;

create temporary table eav_ins_fixtures (id bigint, nombre text);
grant select on eav_ins_fixtures to authenticated;
with dni_libres as (
  select n::text dni, row_number() over (order by n) rn
  from generate_series(80000000,80001000) n
  where not exists (select 1 from public.eav_preinscripciones p where p.temporada =
    extract(year from now() at time zone 'America/Argentina/Buenos_Aires')::integer +
    case when extract(month from now() at time zone 'America/Argentina/Buenos_Aires') = 1 then 0 else 1 end and p.dni=n::text)
  limit 3
), creados as (
  insert into public.eav_preinscripciones(temporada,escuela_eav_id,dni,nombre,nacimiento,genero,
    escuela_actual_otra,domicilio,responsable,vinculo,telefono,email)
  select extract(year from now() at time zone 'America/Argentina/Buenos_Aires')::integer +
    case when extract(month from now() at time zone 'America/Argentina/Buenos_Aires') = 1 then 0 else 1 end,
    case when d.rn=3 then t.otra else t.escuela end, d.dni, 'Estudiante ficticio '||d.rn,
    '2018-01-01','Mujer','Otra escuela','Domicilio ficticio','Responsable ficticio','Otro','01112345678','prueba@example.invalid'
  from dni_libres d cross join eav_ins_test t returning id,nombre
) insert into eav_ins_fixtures select id,nombre from creados;
do $$ begin if (select count(*) from eav_ins_fixtures) <> 3 then raise exception 'Faltan DNI de prueba'; end if; end $$;

select set_config('request.jwt.claim.sub',(select escolar::text from eav_ins_test),true);
set local role authenticated;
do $$ declare t record; bloqueado boolean:=false; begin
  select * into t from eav_ins_test;
  if (select count(*) from public.eav_preinscripciones where id in (select id from eav_ins_fixtures)) <> 2
    or exists (select 1 from public.eav_preinscripciones where id=(select id from eav_ins_fixtures where nombre='Estudiante ficticio 3')) then
    raise exception 'La escuela ve registros de otra EAV';
  end if;
  begin perform public.eav_confirmar_inscripcion((select id from eav_ins_fixtures where nombre='Estudiante ficticio 3'),true);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'La escuela confirmó una preinscripción ajena'; end if;
  bloqueado:=false;
  begin perform public.eav_confirmar_inscripcion((select id from eav_ins_fixtures where nombre='Estudiante ficticio 1'),null);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Se aceptó legajo sin indicar'; end if;
  perform public.eav_confirmar_inscripcion((select id from eav_ins_fixtures where nombre='Estudiante ficticio 1'),false);
  if not exists (select 1 from public.eav_preinscripciones where id=(select id from eav_ins_fixtures where nombre='Estudiante ficticio 1')
    and inscrito_en is not null and legajo_completo=false and inscrito_por=t.escolar) then
    raise exception 'Inscripción con legajo incompleto incorrecta';
  end if;
  bloqueado:=false;
  begin perform public.eav_confirmar_inscripcion((select id from eav_ins_fixtures where nombre='Estudiante ficticio 1'),true);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado or not exists (select 1 from public.eav_preinscripciones where id=(select id from eav_ins_fixtures where nombre='Estudiante ficticio 1') and legajo_completo=false)
    then raise exception 'Confirmación repetida alteró el legajo'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select distrito::text from eav_ins_test),true);
set local role authenticated;
do $$ declare bloqueado boolean:=false; begin
  begin perform public.eav_confirmar_inscripcion((select id from eav_ins_fixtures where nombre='Estudiante ficticio 2'),true);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Distrital puede confirmar sin simulación escolar'; end if;
end $$;
reset role;
insert into public.simulaciones(actor_id,target_id) select distrito,escolar from eav_ins_test;
set local role authenticated;
do $$ declare t record; begin
  select * into t from eav_ins_test;
  if (select count(*) from public.eav_preinscripciones where id in (select id from eav_ins_fixtures)) <> 2
    then raise exception 'Simulación escolar ve otra EAV'; end if;
  perform public.eav_confirmar_inscripcion((select id from eav_ins_fixtures where nombre='Estudiante ficticio 2'),true);
  if not exists (select 1 from public.eav_preinscripciones where id=(select id from eav_ins_fixtures where nombre='Estudiante ficticio 2')
    and legajo_completo=true and inscrito_por=t.escolar) then raise exception 'Confirmación simulada incorrecta'; end if;
end $$;
reset role;

set local role service_role;
do $$ declare t record; dni_nuevo text; resultado text; begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into t from eav_ins_test;
  select n::text into dni_nuevo from generate_series(80000000,80001000) n
    where not exists (select 1 from public.eav_preinscripciones p where p.dni=n::text
      and p.temporada=extract(year from now() at time zone 'America/Argentina/Buenos_Aires')::integer +
        case when extract(month from now() at time zone 'America/Argentina/Buenos_Aires') = 1 then 0 else 1 end) limit 1;
  resultado:=public.eav_preinscribir(t.escuela,dni_nuevo,'Estudiante ficticio','2018-01-01','Mujer',null,
    'Otra escuela','Domicilio ficticio','Responsable ficticio','Otro','01112345678','prueba@example.invalid');
  if resultado <> 'sin_cupo' then raise exception 'La confirmación alteró el cómputo de cupos: %',resultado; end if;
  if (select count(*) from public.eav_preinscripciones where escuela_eav_id=t.escuela) <> 2
    then raise exception 'La confirmación duplicó registros'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select otra_cuenta::text from eav_ins_test),true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.eav_preinscripciones where id in (select id from eav_ins_fixtures)) <> 1
    then raise exception 'La otra escuela no está aislada'; end if;
end $$;
reset role;
