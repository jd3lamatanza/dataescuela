create function public.circuito_guardar(p_id bigint, p_nombre text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_nombre text := btrim(p_nombre); v_id bigint;
begin
  if public.app_role() is distinct from 'admin' or public.real_role() is distinct from 'admin' then
    raise exception 'Sin permiso';
  end if;
  if v_nombre is null or length(v_nombre) not between 1 and 150 then raise exception 'Ingresá un nombre de hasta 150 caracteres'; end if;
  if p_id is null then
    insert into public.circuitos_electorales(nombre, activo) values (v_nombre, true) returning id into v_id;
  else
    update public.circuitos_electorales set nombre = v_nombre where id = p_id returning id into v_id;
    if not found then raise exception 'Circuito inexistente'; end if;
  end if;
  return v_id;
end $$;

create function public.circuito_eliminar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' or public.real_role() is distinct from 'admin' then
    raise exception 'Sin permiso';
  end if;
  begin
    delete from public.circuitos_electorales where id = p_id;
    if not found then raise exception 'Circuito inexistente'; end if;
  exception when foreign_key_violation then
    raise exception 'No se puede eliminar un circuito con escuelas asociadas';
  end;
end $$;

revoke all on function public.circuito_guardar(bigint, text), public.circuito_eliminar(bigint) from public, anon, authenticated;
grant execute on function public.circuito_guardar(bigint, text), public.circuito_eliminar(bigint) to authenticated;
