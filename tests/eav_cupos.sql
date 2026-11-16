-- Ejecutar dentro de una transacción que se revierte.
create temporary table eav_test_roles as
select
  (select p.id from public.profiles p where p.role = 'distrital' and p.active and not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1) as distrital,
  (select p.id from public.profiles p where p.role = 'escolar' and p.active and not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1) as escolar,
  (select p.id from public.profiles p where p.role = 'areal' and p.active and not exists (select 1 from public.simulaciones s where s.actor_id = p.id) limit 1) as areal,
  (select e.id from public.escuelas e order by e.id limit 1) as escuela;
grant select on eav_test_roles to authenticated;

set local role authenticated;
do $$
declare t record; bloqueado boolean; rol uuid;
begin
  select * into t from eav_test_roles;
  if t.distrital is null or t.escolar is null or t.areal is null or t.escuela is null then raise exception 'Faltan datos para probar permisos'; end if;
  perform set_config('request.jwt.claim.sub', t.distrital::text, true);
  perform public.eav_asignar_cupos(t.escuela, 0);
  if not exists (select 1 from public.eav_cupos where escuela_id = t.escuela and cupos = 0) then raise exception 'No se guardó cero'; end if;
  perform public.eav_asignar_cupos(t.escuela, 75);
  if not exists (select 1 from public.eav_cupos where escuela_id = t.escuela and cupos = 75) then raise exception 'No se actualizó el cupo'; end if;
  bloqueado := false;
  begin perform public.eav_asignar_cupos(t.escuela, -1); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Se aceptó un cupo negativo'; end if;
  bloqueado := false;
  begin perform public.eav_asignar_cupos(t.escuela, null); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Se aceptó un cupo nulo'; end if;
  bloqueado := false;
  begin perform public.eav_asignar_cupos(-1, 10); exception when raise_exception then bloqueado := true; end;
  if not bloqueado then raise exception 'Se aceptó una escuela inexistente'; end if;
  bloqueado := false;
  begin update public.eav_cupos set cupos = 3 where escuela_id = t.escuela; exception when insufficient_privilege then bloqueado := true; end;
  if not bloqueado then raise exception 'Se permitió escritura directa'; end if;
  foreach rol in array array[t.escolar, t.areal] loop
    perform set_config('request.jwt.claim.sub', rol::text, true);
    if exists (select 1 from public.eav_cupos where escuela_id = t.escuela) then raise exception 'Cupos visibles fuera del rol distrital'; end if;
    bloqueado := false;
    begin perform public.eav_asignar_cupos(t.escuela, 10); exception when raise_exception then bloqueado := true; end;
    if not bloqueado then raise exception 'Escritura permitida fuera del rol distrital'; end if;
  end loop;
end $$;
reset role;
