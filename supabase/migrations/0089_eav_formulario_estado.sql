create table public.eav_formulario_config (
  id boolean primary key default true check (id),
  activo boolean not null default true
);
insert into public.eav_formulario_config (id, activo) values (true, true);
alter table public.eav_formulario_config enable row level security;
revoke all on public.eav_formulario_config from public, anon, authenticated;

create function public.eav_formulario_estado() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_activo boolean;
begin
  if auth.role() is distinct from 'service_role'
    and (public.real_role() is distinct from 'distrital' or public.app_role() is distinct from 'distrital') then
    raise exception 'Sin permiso';
  end if;
  select activo into strict v_activo from public.eav_formulario_config where id;
  return v_activo;
end $$;
revoke all on function public.eav_formulario_estado() from public, anon;
grant execute on function public.eav_formulario_estado() to authenticated, service_role;

create function public.eav_formulario_cambiar_estado(p_activo boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.real_role() is distinct from 'distrital' or public.app_role() is distinct from 'distrital' then
    raise exception 'Sin permiso';
  end if;
  if p_activo is null then raise exception 'Indicá el estado del formulario'; end if;
  update public.eav_formulario_config set activo = p_activo where id;
  if not found then raise exception 'No se encontró la configuración del formulario'; end if;
  return p_activo;
end $$;
revoke all on function public.eav_formulario_cambiar_estado(boolean) from public, anon;
grant execute on function public.eav_formulario_cambiar_estado(boolean) to authenticated;

alter function public.eav_preinscribir(bigint, text, text, date, text, bigint, text, text, text, text, text, text)
  rename to eav_preinscribir_interno;
revoke all on function public.eav_preinscribir_interno(bigint, text, text, date, text, bigint, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

create function public.eav_preinscribir(
  p_escuela bigint, p_dni text, p_nombre text, p_nacimiento date, p_genero text,
  p_actual bigint, p_otra text, p_domicilio text, p_responsable text, p_vinculo text, p_telefono text, p_email text
) returns text language plpgsql security definer set search_path = public as $$
declare v_activo boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Sin permiso'; end if;
  select activo into strict v_activo from public.eav_formulario_config where id for share;
  if not v_activo then return 'cerrado'; end if;
  return public.eav_preinscribir_interno(p_escuela, p_dni, p_nombre, p_nacimiento, p_genero,
    p_actual, p_otra, p_domicilio, p_responsable, p_vinculo, p_telefono, p_email);
end $$;
revoke all on function public.eav_preinscribir(bigint, text, text, date, text, bigint, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.eav_preinscribir(bigint, text, text, date, text, bigint, text, text, text, text, text, text) to service_role;
