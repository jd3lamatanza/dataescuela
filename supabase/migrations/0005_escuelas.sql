-- Escuelas: la ficha solo permite editar columnas específicas
revoke update on public.escuelas from authenticated;
grant update (nombre, localidad, calle, nu_calle, entre_calle, entre_calle_2, cp, eav, te, email, alfa, sede_electoral, sede_evacuacion, circuito_id, nudo_id)
  on public.escuelas to authenticated;

-- Restablece la contraseña de la cuenta escolar de una escuela (distrital)
create or replace function public.escuela_reset(p_escuela bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if not public.can_see_escuela(p_escuela) then raise exception 'Sin permiso'; end if;
  select p.id into uid from public.profiles p join public.escuelas e on e.cue = p.cue
  where e.id = p_escuela and p.role = 'escolar' order by p.created_at limit 1;
  if uid is null then raise exception 'La escuela no tiene una cuenta de usuario'; end if;
  perform public.usuario_reset(uid);
end $$;

-- Id de la escuela propia (fila única por CUE)
create or replace function public.mi_escuela() returns bigint
language sql stable security definer set search_path = public as $$
  select min(id) from public.escuelas where cue = public.app_cue()
$$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._crear_auth(uuid, text, text) from authenticated, anon, public;
