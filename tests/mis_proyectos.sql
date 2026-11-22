-- Ejecutar dentro de una transacción revertida.
create temporary table proyectos_test as
select
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) order by id limit 1) usuario1,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) order by id offset 1 limit 1) usuario2,
  (select id from public.profiles p where not exists (select 1 from public.simulaciones s where s.actor_id = p.id) order by id offset 2 limit 1) supervisor,
  (select cue from public.escuelas where cue is not null and btrim(cue) <> '' order by cue limit 1) cue1,
  (select distinct cue from public.escuelas where cue is not null and btrim(cue) <> '' order by cue offset 1 limit 1) cue2,
  gen_random_uuid() id1, gen_random_uuid() id2, gen_random_uuid() reserva1, gen_random_uuid() reserva2;
grant select on proyectos_test to authenticated, service_role;
do $$ begin
  if exists (select 1 from proyectos_test where usuario1 is null or usuario2 is null or supervisor is null or cue1 is null or cue2 is null) then
    raise exception 'Faltan datos de prueba';
  end if;
end $$;
update public.profiles set role = 'escolar', active = true, cue = (select cue1 from proyectos_test) where id = (select usuario1 from proyectos_test);
update public.profiles set role = 'escolar', active = true, cue = (select cue2 from proyectos_test) where id = (select usuario2 from proyectos_test);
update public.profiles set role = 'distrital', active = true where id = (select supervisor from proyectos_test);
insert into public.proyectos_escolares(id,cue,tipo,nombre,bytes,drive_file_id)
select id1,cue1,'Proyecto Institucional','ejemplo.pdf',100,'test-' || id1 from proyectos_test
union all select id2,cue2,'Proyecto Institucional','ejemplo.pdf',100,'test-' || id2 from proyectos_test;

select set_config('request.jwt.claim.sub', (select usuario1::text from proyectos_test), true);
set local role authenticated;
do $$
declare rechazado boolean := false;
begin
  if not exists (select 1 from public.proyectos_escolares where id = (select id1 from proyectos_test))
    or exists (select 1 from public.proyectos_escolares where id = (select id2 from proyectos_test)) then
    raise exception 'La escuela no está aislada';
  end if;
  begin delete from public.proyectos_escolares where id = (select id1 from proyectos_test);
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Se permite eliminar sin controlar Drive'; end if;
  rechazado := false;
  begin perform public.proyecto_carpeta_reservar('ficticio','ficticio',gen_random_uuid());
  exception when insufficient_privilege then rechazado := true; end;
  if not rechazado then raise exception 'Un usuario puede reservar carpetas directamente'; end if;
end $$;
select set_config('request.jwt.claim.sub', (select usuario2::text from proyectos_test), true);
do $$ begin
  if not exists (select 1 from public.proyectos_escolares where id = (select id2 from proyectos_test))
    or exists (select 1 from public.proyectos_escolares where id = (select id1 from proyectos_test)) then
    raise exception 'Otra escuela puede ver proyectos ajenos';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', (select supervisor::text from proyectos_test), true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.proyectos_escolares where id in (select id1 from proyectos_test union all select id2 from proyectos_test)) <> 2 then
    raise exception 'Distrital no ve todos los proyectos';
  end if;
end $$;
reset role;
insert into public.simulaciones(actor_id,target_id) select supervisor,usuario1 from proyectos_test;
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.proyectos_escolares where id = (select id1 from proyectos_test))
    or exists (select 1 from public.proyectos_escolares where id = (select id2 from proyectos_test)) then
    raise exception 'El ingreso simulado no respeta la escuela efectiva';
  end if;
end $$;
reset role;
set local role service_role;
do $$
declare a jsonb; b jsonb; c jsonb;
begin
  select public.proyecto_carpeta_reservar('test-' || reserva1,'clave-ficticia',reserva1) into a from proyectos_test;
  select public.proyecto_carpeta_reservar('test-' || reserva1,'clave-ficticia',reserva2) into b from proyectos_test;
  if a->>'estado' <> 'reservada' or b->>'estado' <> 'ocupada' then raise exception 'No se excluyeron reservas concurrentes'; end if;
  if (select public.proyecto_carpeta_confirmar('test-' || reserva1,reserva2,'carpeta_ficticia') from proyectos_test) then
    raise exception 'Se confirmó una reserva ajena';
  end if;
  if not (select public.proyecto_carpeta_confirmar('test-' || reserva1,reserva1,'carpeta_ficticia') from proyectos_test) then
    raise exception 'No se pudo confirmar la reserva';
  end if;
  select public.proyecto_carpeta_reservar('test-' || reserva1,'clave-ficticia',reserva2) into c from proyectos_test;
  if c->>'estado' <> 'lista' or c->>'id' <> 'carpeta_ficticia' then raise exception 'No se reutilizó la carpeta'; end if;
end $$;
reset role;
do $$
declare rechazado boolean;
begin
  rechazado := false;
  begin insert into public.proyectos_escolares(cue,tipo,nombre,bytes,drive_file_id) values ('ficticio','Otro','a.pdf',1,'test-otro');
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception 'Otro tipo acepta nombre vacío'; end if;
  rechazado := false;
  begin insert into public.proyectos_escolares(cue,tipo,nombre,bytes,drive_file_id) values ('ficticio','Proyecto Institucional','a.pdf',5242881,'test-tamano');
  exception when check_violation then rechazado := true; end;
  if not rechazado then raise exception 'Acepta más de 5 MB'; end if;
end $$;
