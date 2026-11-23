create function public._restablecer_usuario(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update auth.users set encrypted_password = extensions.crypt('12345678', extensions.gen_salt('bf')), updated_at = now() where id = p_id;
  if not found then raise exception 'La cuenta de acceso no existe'; end if;
  update public.profiles set must_change = true where id = p_id;
  delete from auth.sessions where user_id = p_id;
end $$;
revoke all on function public._restablecer_usuario(uuid) from public, anon, authenticated;

create or replace function public.usuario_reset(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  select role into r from public.profiles where id = p_id;
  if r is null or not public._puede_gestionar(r) then raise exception 'Sin permiso'; end if;
  perform public._restablecer_usuario(p_id);
end $$;

create or replace function public.escuela_reset(p_escuela bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if public.real_role() is distinct from 'distrital' or public.app_role() is distinct from 'distrital'
    or public.eff_uid() is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
  if not public.can_see_escuela(p_escuela) then raise exception 'Sin permiso'; end if;
  select p.id into uid from public.profiles p join public.escuelas e on e.cue = p.cue
  where e.id = p_escuela and p.role = 'escolar' order by p.created_at, p.id limit 1;
  if uid is null then raise exception 'La escuela no tiene una cuenta de usuario'; end if;
  perform public._restablecer_usuario(uid);
end $$;
