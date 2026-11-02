-- Datos personales del perfil (los edita cada usuario distrital sobre su propia cuenta)
alter table public.profiles add column telefono text, add column cargo text;

create or replace function public.perfil_actualizar(p_name text, p_email text, p_telefono text default null, p_cargo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(trim(p_email)), '');
begin
  if public.real_role() is distinct from 'distrital' then raise exception 'Sin permiso'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Completá tu nombre'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'El correo no es válido';
  end if;
  update public.profiles set name = trim(p_name), email = v_email,
    telefono = nullif(trim(p_telefono), ''), cargo = nullif(trim(p_cargo), '')
  where id = auth.uid();
end $$;
grant execute on function public.perfil_actualizar(text, text, text, text) to authenticated;
